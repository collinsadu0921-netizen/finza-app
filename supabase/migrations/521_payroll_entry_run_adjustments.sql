-- Migration 521: Per-run payroll line adjustments (include/exclude, one-off salary changes)

ALTER TABLE payroll_entries
  ADD COLUMN IF NOT EXISTS is_included BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS base_salary_snapshot NUMERIC,
  ADD COLUMN IF NOT EXISTS adjustment_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustment_reason TEXT,
  ADD COLUMN IF NOT EXISTS exclusion_reason TEXT;

UPDATE payroll_entries
SET base_salary_snapshot = basic_salary
WHERE base_salary_snapshot IS NULL;

ALTER TABLE payroll_entries
  ALTER COLUMN base_salary_snapshot SET DEFAULT 0;

UPDATE payroll_entries
SET base_salary_snapshot = 0
WHERE base_salary_snapshot IS NULL;

ALTER TABLE payroll_entries
  ALTER COLUMN base_salary_snapshot SET NOT NULL;

COMMENT ON COLUMN payroll_entries.is_included IS 'When false, employee is excluded from this run only; amounts are zeroed and they remain active for future runs.';
COMMENT ON COLUMN payroll_entries.base_salary_snapshot IS 'Staff basic salary at run calculation time; does not change when staff master salary changes.';
COMMENT ON COLUMN payroll_entries.adjustment_amount IS 'One-off basic salary delta for this run only (negative for deductions).';
COMMENT ON COLUMN payroll_entries.adjustment_reason IS 'Reason for one-off salary adjustment on this run.';
COMMENT ON COLUMN payroll_entries.exclusion_reason IS 'Reason employee is excluded from this payroll run.';

-- Allow business members to update entries while parent run is draft
DROP POLICY IF EXISTS "Users can update payroll entries for draft runs" ON public.payroll_entries;

CREATE POLICY "Users can update payroll entries for draft runs"
  ON public.payroll_entries FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.payroll_runs pr
      WHERE pr.id = payroll_entries.payroll_run_id
        AND pr.status = 'draft'
        AND pr.deleted_at IS NULL
        AND public.finza_user_can_access_business(pr.business_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.payroll_runs pr
      WHERE pr.id = payroll_entries.payroll_run_id
        AND pr.status = 'draft'
        AND pr.deleted_at IS NULL
        AND public.finza_user_can_access_business(pr.business_id)
    )
  );
