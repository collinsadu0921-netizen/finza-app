-- Phase 2A: GRA DT 107A filing integrity — snapshot staff identity and engine bonus split on payroll_entries.
-- Nullable for legacy rows created before this migration.
-- filing_*: frozen TIN/name at run creation for GRA exports (does not change PAYE).
-- bonus_*: engine outputs for GRA column (13) without re-deriving cap logic in export (Phase 2B/C fields unchanged).

ALTER TABLE public.payroll_entries
  ADD COLUMN IF NOT EXISTS filing_tin text,
  ADD COLUMN IF NOT EXISTS filing_employee_name text,
  ADD COLUMN IF NOT EXISTS bonus_concessional_amount numeric,
  ADD COLUMN IF NOT EXISTS bonus_graduated_amount numeric;
