-- Phase 1A: One-off payroll lines can be scoped to a specific payroll month.
-- recurring=true → included in every run (unchanged).
-- recurring=false → included only when applies_to_month matches the run's payroll_month
--   (same calendar month, compared as DATE first-of-month).
-- NULL applies_to_month on recurring=false → legacy behavior: still included every run
--   until backfilled (avoids silently dropping existing rows).

ALTER TABLE public.allowances
  ADD COLUMN IF NOT EXISTS applies_to_month DATE;

ALTER TABLE public.deductions
  ADD COLUMN IF NOT EXISTS applies_to_month DATE;

COMMENT ON COLUMN public.allowances.applies_to_month IS
  'If recurring=false: include this allowance only when payroll run payroll_month matches this month (first day). NULL = include in every run (legacy).';

COMMENT ON COLUMN public.deductions.applies_to_month IS
  'If recurring=false: include this deduction only when payroll run payroll_month matches this month (first day). NULL = include in every run (legacy).';
