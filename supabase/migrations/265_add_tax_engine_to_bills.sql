-- ============================================================================
-- Add canonical tax columns to bills for post_bill_to_ledger compatibility
-- ============================================================================
-- post_bill_to_ledger (190) reads b.tax_lines from bills. The bills table
-- (042) did not include tax_lines. This migration adds only the missing
-- columns. No backfill; bills without taxes use default empty array.
-- ============================================================================

ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS tax_lines JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tax_engine_code TEXT,
  ADD COLUMN IF NOT EXISTS tax_engine_effective_from DATE,
  ADD COLUMN IF NOT EXISTS tax_jurisdiction TEXT;

COMMENT ON COLUMN bills.tax_lines IS 'Canonical tax line items (array of {code, amount, ledger_account_code, ledger_side}). Default [] for bills without tax breakdown.';
COMMENT ON COLUMN bills.tax_engine_code IS 'Tax engine version/code at time of bill creation (audit).';
COMMENT ON COLUMN bills.tax_engine_effective_from IS 'Effective-from date for tax engine (audit).';
COMMENT ON COLUMN bills.tax_jurisdiction IS 'Tax jurisdiction (e.g. GH) for audit.';
