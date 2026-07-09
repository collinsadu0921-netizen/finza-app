-- Migration 525: Payroll pay period model + period-aware duplicate guard
-- Supports monthly, weekly, fortnightly, and other run types without month-only locking.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- New period / scope columns on payroll_runs
-- ---------------------------------------------------------------------------
ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS pay_period_start DATE,
  ADD COLUMN IF NOT EXISTS pay_period_end DATE,
  ADD COLUMN IF NOT EXISTS payroll_frequency TEXT NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS run_type TEXT NOT NULL DEFAULT 'regular',
  ADD COLUMN IF NOT EXISTS staff_scope_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS corrects_payroll_run_id UUID REFERENCES public.payroll_runs(id) ON DELETE SET NULL;

ALTER TABLE public.payroll_runs
  DROP CONSTRAINT IF EXISTS payroll_runs_payroll_frequency_check;

ALTER TABLE public.payroll_runs
  ADD CONSTRAINT payroll_runs_payroll_frequency_check
  CHECK (
    payroll_frequency IN (
      'monthly',
      'weekly',
      'fortnightly',
      'daily',
      'casual',
      'custom'
    )
  );

ALTER TABLE public.payroll_runs
  DROP CONSTRAINT IF EXISTS payroll_runs_run_type_check;

ALTER TABLE public.payroll_runs
  ADD CONSTRAINT payroll_runs_run_type_check
  CHECK (
    run_type IN (
      'regular',
      'bonus',
      'correction',
      'job_based',
      'advance_adjustment'
    )
  );

COMMENT ON COLUMN public.payroll_runs.pay_period_start IS
  'Inclusive start date of the pay period covered by this run.';
COMMENT ON COLUMN public.payroll_runs.pay_period_end IS
  'Inclusive end date of the pay period covered by this run.';
COMMENT ON COLUMN public.payroll_runs.payroll_frequency IS
  'How often this style of payroll is run (monthly, weekly, etc.).';
COMMENT ON COLUMN public.payroll_runs.run_type IS
  'Purpose of the run: regular salary, bonus, correction, job-based, etc.';
COMMENT ON COLUMN public.payroll_runs.staff_scope_fingerprint IS
  'SHA-256 of sorted included staff IDs — duplicate guard scope key.';
COMMENT ON COLUMN public.payroll_runs.corrects_payroll_run_id IS
  'When run_type=correction, optional link to the payroll run being corrected.';

-- Backfill period boundaries from legacy payroll_month (calendar month).
UPDATE public.payroll_runs pr
SET
  pay_period_start = COALESCE(
    pr.pay_period_start,
    date_trunc('month', pr.payroll_month)::date
  ),
  pay_period_end = COALESCE(
    pr.pay_period_end,
    (date_trunc('month', pr.payroll_month) + interval '1 month' - interval '1 day')::date
  )
WHERE pr.pay_period_start IS NULL OR pr.pay_period_end IS NULL;

-- Normalize payroll_month anchor to period start for reporting consistency.
UPDATE public.payroll_runs
SET payroll_month = pay_period_start
WHERE payroll_month IS DISTINCT FROM pay_period_start;

-- Backfill staff scope fingerprint from included payroll entries.
UPDATE public.payroll_runs pr
SET staff_scope_fingerprint = sub.fp
FROM (
  SELECT
    pe.payroll_run_id,
    encode(
      digest(
        COALESCE(string_agg(pe.staff_id::text, ',' ORDER BY pe.staff_id), ''),
        'sha256'
      ),
      'hex'
    ) AS fp
  FROM public.payroll_entries pe
  WHERE pe.is_included IS DISTINCT FROM false
  GROUP BY pe.payroll_run_id
) sub
WHERE pr.id = sub.payroll_run_id
  AND (pr.staff_scope_fingerprint IS NULL OR pr.staff_scope_fingerprint = '');

UPDATE public.payroll_runs
SET staff_scope_fingerprint = encode(digest('all_active', 'sha256'), 'hex')
WHERE staff_scope_fingerprint IS NULL OR staff_scope_fingerprint = '';

ALTER TABLE public.payroll_runs
  ALTER COLUMN pay_period_start SET NOT NULL,
  ALTER COLUMN pay_period_end SET NOT NULL,
  ALTER COLUMN staff_scope_fingerprint SET NOT NULL;

-- Resolve legacy duplicate monthly runs that share period + scope by marking later runs as corrections.
WITH ranked AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY
        business_id,
        payroll_frequency,
        run_type,
        pay_period_start,
        pay_period_end,
        staff_scope_fingerprint
      ORDER BY created_at ASC, id ASC
    ) AS primary_id,
    ROW_NUMBER() OVER (
      PARTITION BY
        business_id,
        payroll_frequency,
        run_type,
        pay_period_start,
        pay_period_end,
        staff_scope_fingerprint
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.payroll_runs
  WHERE deleted_at IS NULL
)
UPDATE public.payroll_runs pr
SET
  run_type = 'correction',
  corrects_payroll_run_id = ranked.primary_id
FROM ranked
WHERE pr.id = ranked.id
  AND ranked.rn > 1
  AND pr.run_type = 'regular';

-- Drop obsolete month-only uniqueness (allowed duplicate calendar months with different dates).
ALTER TABLE public.payroll_runs
  DROP CONSTRAINT IF EXISTS payroll_runs_business_id_payroll_month_key;

-- Period + scope duplicate guard (allows bonus vs regular, weekly vs monthly, corrections).
CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_runs_period_scope_active
  ON public.payroll_runs (
    business_id,
    payroll_frequency,
    run_type,
    pay_period_start,
    pay_period_end,
    staff_scope_fingerprint
  )
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_runs_pay_period
  ON public.payroll_runs (business_id, pay_period_start DESC, pay_period_end DESC);
