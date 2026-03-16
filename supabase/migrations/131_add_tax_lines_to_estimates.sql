-- Migration: Add Canonical Tax Support to Estimates Table
-- Adds tax_lines JSONB and tax metadata columns for multi-jurisdiction tax support
-- Legacy columns (nhil, getfund, covid, vat, etc.) are NOT removed - kept for backward compatibility
-- Existing rows are NOT backfilled - they will have NULL values for new columns

-- ============================================================================
-- ESTIMATES TABLE - Add Generic Tax Columns
-- ============================================================================
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS tax_lines JSONB,
  ADD COLUMN IF NOT EXISTS tax_jurisdiction TEXT,
  ADD COLUMN IF NOT EXISTS tax_engine_code TEXT,
  ADD COLUMN IF NOT EXISTS tax_engine_effective_from DATE;

-- Indexes for tax queries
CREATE INDEX IF NOT EXISTS idx_estimates_tax_engine_code ON estimates(tax_engine_code) WHERE tax_engine_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_estimates_tax_jurisdiction ON estimates(tax_jurisdiction) WHERE tax_jurisdiction IS NOT NULL;

-- Comments
COMMENT ON COLUMN estimates.tax_lines IS 'Canonical tax lines JSONB format: {"lines": [{"code": "VAT", "name": "VAT", "rate": 0.15, "amount": 15.90, ...}], "meta": {"jurisdiction": "GH", "effective_date_used": "2025-12-31", "engine_version": "GH-2025-A"}, "pricing_mode": "inclusive"}';
COMMENT ON COLUMN estimates.tax_jurisdiction IS 'Jurisdiction/country code (e.g., "GH", "US", "KE")';
COMMENT ON COLUMN estimates.tax_engine_code IS 'Tax engine identifier (e.g., "ghana", "us", "ke")';
COMMENT ON COLUMN estimates.tax_engine_effective_from IS 'Effective date for tax calculation (estimate issue_date)';

-- ============================================================================
-- NOTE: Legacy Columns
-- ============================================================================
-- Legacy columns (nhil, getfund, covid, vat, nhil_amount, getfund_amount, 
-- covid_amount, vat_amount, total_tax_amount, tax) are kept for backward compatibility.
-- They should be derived from tax_lines when tax_engine_code = 'ghana'.
-- This allows existing code and reports to continue working during the migration period.
