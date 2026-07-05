-- ============================================================================
-- Migration 522: Salary advance repayment lifecycle (schema only)
-- Extracted from feature branch migration 463 — excludes post_payroll_to_ledger rewrite.
-- ============================================================================

ALTER TABLE public.salary_advances
  ADD COLUMN IF NOT EXISTS repaid_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'outstanding',
  ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'salary_advances_status_check'
      AND conrelid = 'public.salary_advances'::regclass
  ) THEN
    ALTER TABLE public.salary_advances
      ADD CONSTRAINT salary_advances_status_check
      CHECK (status IN ('outstanding', 'partially_repaid', 'cleared', 'cancelled'));
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'salary_advances_repaid_amount_nonnegative'
      AND conrelid = 'public.salary_advances'::regclass
  ) THEN
    ALTER TABLE public.salary_advances
      ADD CONSTRAINT salary_advances_repaid_amount_nonnegative
      CHECK (repaid_amount >= 0);
  END IF;
END;
$$;

UPDATE public.salary_advances
SET
  repaid_amount = LEAST(COALESCE(repaid_amount, 0), amount),
  status = CASE
    WHEN cancelled_at IS NOT NULL THEN 'cancelled'
    WHEN LEAST(COALESCE(repaid_amount, 0), amount) >= amount THEN 'cleared'
    WHEN LEAST(COALESCE(repaid_amount, 0), amount) > 0 THEN 'partially_repaid'
    ELSE 'outstanding'
  END,
  cleared_at = CASE
    WHEN cancelled_at IS NULL AND LEAST(COALESCE(repaid_amount, 0), amount) >= amount THEN COALESCE(cleared_at, NOW())
    ELSE NULL
  END;

CREATE TABLE IF NOT EXISTS public.salary_advance_repayments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  salary_advance_id UUID NOT NULL REFERENCES public.salary_advances(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff(id),
  payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  payroll_entry_id UUID REFERENCES public.payroll_entries(id) ON DELETE SET NULL,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'voided')),
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salary_advance_repayments_business_id
  ON public.salary_advance_repayments(business_id);
CREATE INDEX IF NOT EXISTS idx_salary_advance_repayments_salary_advance_id
  ON public.salary_advance_repayments(salary_advance_id);
CREATE INDEX IF NOT EXISTS idx_salary_advance_repayments_staff_id
  ON public.salary_advance_repayments(staff_id);
CREATE INDEX IF NOT EXISTS idx_salary_advance_repayments_payroll_run_id
  ON public.salary_advance_repayments(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_salary_advance_repayments_status
  ON public.salary_advance_repayments(status);

CREATE UNIQUE INDEX IF NOT EXISTS salary_advance_repayments_unique_entry
  ON public.salary_advance_repayments(salary_advance_id, payroll_run_id, payroll_entry_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deductions_unique_advance_id
  ON public.deductions(advance_id)
  WHERE advance_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE public.salary_advance_repayments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "salary_advance_repayments: business members select" ON public.salary_advance_repayments;
CREATE POLICY "salary_advance_repayments: business members select"
  ON public.salary_advance_repayments FOR SELECT
  USING (public.finza_user_can_access_business(salary_advance_repayments.business_id));

DROP POLICY IF EXISTS "salary_advance_repayments: business members insert" ON public.salary_advance_repayments;
CREATE POLICY "salary_advance_repayments: business members insert"
  ON public.salary_advance_repayments FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(salary_advance_repayments.business_id));

DROP POLICY IF EXISTS "salary_advance_repayments: business members update" ON public.salary_advance_repayments;
CREATE POLICY "salary_advance_repayments: business members update"
  ON public.salary_advance_repayments FOR UPDATE
  USING (public.finza_user_can_access_business(salary_advance_repayments.business_id))
  WITH CHECK (public.finza_user_can_access_business(salary_advance_repayments.business_id));

DROP POLICY IF EXISTS "salary_advance_repayments: business members delete" ON public.salary_advance_repayments;
CREATE POLICY "salary_advance_repayments: business members delete"
  ON public.salary_advance_repayments FOR DELETE
  USING (public.finza_user_can_access_business(salary_advance_repayments.business_id));

DROP TRIGGER IF EXISTS update_salary_advances_updated_at ON public.salary_advances;
CREATE TRIGGER update_salary_advances_updated_at
  BEFORE UPDATE ON public.salary_advances
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_salary_advance_repayments_updated_at ON public.salary_advance_repayments;
CREATE TRIGGER update_salary_advance_repayments_updated_at
  BEFORE UPDATE ON public.salary_advance_repayments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.salary_advance_repayments IS
  'Tracks salary advance recoveries linked to payroll runs. Ledger posting is handled separately.';
