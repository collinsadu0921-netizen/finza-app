-- Migration 534: Payroll Phase 1B — salary basis + exact-run one-off items
-- Existing staff.basic_salary values are monthly amounts; backfill salary_basis = monthly.
-- Does not alter historical payroll_entries amounts or journals.

-- ---------------------------------------------------------------------------
-- Staff salary basis
-- ---------------------------------------------------------------------------
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS salary_basis TEXT;

UPDATE public.staff
SET salary_basis = 'monthly'
WHERE salary_basis IS NULL;

ALTER TABLE public.staff
  ALTER COLUMN salary_basis SET DEFAULT 'monthly';

ALTER TABLE public.staff
  ALTER COLUMN salary_basis SET NOT NULL;

ALTER TABLE public.staff
  DROP CONSTRAINT IF EXISTS staff_salary_basis_check;

ALTER TABLE public.staff
  ADD CONSTRAINT staff_salary_basis_check
  CHECK (salary_basis IN ('monthly', 'weekly', 'fortnightly'));

COMMENT ON COLUMN public.staff.salary_basis IS
  'Pay basis for basic_salary: monthly, weekly, or fortnightly. basic_salary is the amount for that basis (no cross-frequency conversion).';

-- ---------------------------------------------------------------------------
-- Payroll entry snapshots (historical integrity)
-- ---------------------------------------------------------------------------
ALTER TABLE public.payroll_entries
  ADD COLUMN IF NOT EXISTS salary_basis TEXT,
  ADD COLUMN IF NOT EXISTS period_basic_pay NUMERIC,
  ADD COLUMN IF NOT EXISTS one_off_items_snapshot JSONB;

UPDATE public.payroll_entries pe
SET salary_basis = COALESCE(pe.salary_basis, 'monthly')
WHERE pe.salary_basis IS NULL;

UPDATE public.payroll_entries pe
SET period_basic_pay = COALESCE(
  pe.period_basic_pay,
  GREATEST(0, COALESCE(pe.base_salary_snapshot, pe.basic_salary, 0) + COALESCE(pe.adjustment_amount, 0))
)
WHERE pe.period_basic_pay IS NULL
  AND pe.is_included IS DISTINCT FROM false;

UPDATE public.payroll_entries pe
SET period_basic_pay = 0
WHERE pe.period_basic_pay IS NULL
  AND pe.is_included = false;

COMMENT ON COLUMN public.payroll_entries.salary_basis IS
  'Snapshot of staff.salary_basis at calculation time.';
COMMENT ON COLUMN public.payroll_entries.period_basic_pay IS
  'Final basic pay for the period: base_salary_snapshot + adjustment_amount (0 when excluded).';
COMMENT ON COLUMN public.payroll_entries.one_off_items_snapshot IS
  'Snapshot of one-off allowances/deductions applied to this entry (id, type, amount, description).';

-- ---------------------------------------------------------------------------
-- Exact-run one-off assignment on allowances / deductions
-- Legacy applies_to_month is retained and not converted.
-- ---------------------------------------------------------------------------
ALTER TABLE public.allowances
  ADD COLUMN IF NOT EXISTS payroll_run_id UUID REFERENCES public.payroll_runs(id) ON DELETE SET NULL;

ALTER TABLE public.deductions
  ADD COLUMN IF NOT EXISTS payroll_run_id UUID REFERENCES public.payroll_runs(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.allowances.payroll_run_id IS
  'Phase 1B: when set on a non-recurring allowance, scopes the item to exactly one payroll run.';
COMMENT ON COLUMN public.deductions.payroll_run_id IS
  'Phase 1B: when set on a non-recurring deduction, scopes the item to exactly one payroll run.';

-- Recurring items must not reference a run; one-offs may.
ALTER TABLE public.allowances
  DROP CONSTRAINT IF EXISTS allowances_recurring_run_check;
ALTER TABLE public.allowances
  ADD CONSTRAINT allowances_recurring_run_check
  CHECK (
    (recurring IS TRUE AND payroll_run_id IS NULL)
    OR (recurring IS DISTINCT FROM TRUE)
  );

ALTER TABLE public.deductions
  DROP CONSTRAINT IF EXISTS deductions_recurring_run_check;
ALTER TABLE public.deductions
  ADD CONSTRAINT deductions_recurring_run_check
  CHECK (
    (recurring IS TRUE AND payroll_run_id IS NULL)
    OR (recurring IS DISTINCT FROM TRUE)
  );

-- Reject duplicate assignment of the same source shape to the same employee/run.
CREATE UNIQUE INDEX IF NOT EXISTS ux_allowances_one_off_run_assignment
  ON public.allowances (
    staff_id,
    payroll_run_id,
    type,
    amount,
    (COALESCE(description, ''))
  )
  WHERE deleted_at IS NULL
    AND payroll_run_id IS NOT NULL
    AND recurring IS DISTINCT FROM TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS ux_deductions_one_off_run_assignment
  ON public.deductions (
    staff_id,
    payroll_run_id,
    type,
    amount,
    (COALESCE(description, ''))
  )
  WHERE deleted_at IS NULL
    AND payroll_run_id IS NOT NULL
    AND recurring IS DISTINCT FROM TRUE;

CREATE INDEX IF NOT EXISTS idx_allowances_payroll_run_id
  ON public.allowances (payroll_run_id)
  WHERE payroll_run_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_deductions_payroll_run_id
  ON public.deductions (payroll_run_id)
  WHERE payroll_run_id IS NOT NULL AND deleted_at IS NULL;
