-- Phase 1B-A: Persist payroll tax/pension snapshots per payroll entry.
-- Keeps historical runs stable even if future tax rules change.

ALTER TABLE public.payroll_entries
  ADD COLUMN IF NOT EXISTS pensionable_base NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS employee_pension_contribution NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS employer_pension_contribution NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_mandatory_pension NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tier1_ssnit_remittance NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tier2_pension_remittance NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payroll_tax_profile JSONB;

