-- Migration: Add Generic Tax Columns for Multi-Jurisdiction Support
-- Replaces Ghana-specific columns (nhil, getfund, covid, vat) as source of truth
-- Legacy columns are kept temporarily but are now derived from tax_lines JSONB

-- ============================================================================
-- INVOICES TABLE - Add Generic Tax Columns
-- ============================================================================
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS tax_lines JSONB,
  ADD COLUMN IF NOT EXISTS tax_engine_code TEXT,
  ADD COLUMN IF NOT EXISTS tax_engine_effective_from DATE,
  ADD COLUMN IF NOT EXISTS tax_jurisdiction TEXT;

-- Index for tax_lines queries
CREATE INDEX IF NOT EXISTS idx_invoices_tax_engine_code ON invoices(tax_engine_code) WHERE tax_engine_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_tax_jurisdiction ON invoices(tax_jurisdiction) WHERE tax_jurisdiction IS NOT NULL;

-- Comments
COMMENT ON COLUMN invoices.tax_lines IS 'Array of tax line items: [{"code": "NHIL", "name": "NHIL", "rate": 0.025, "base": 100, "amount": 2.5}, ...]';
COMMENT ON COLUMN invoices.tax_engine_code IS 'Tax engine identifier (e.g., "ghana", "us", "ke")';
COMMENT ON COLUMN invoices.tax_engine_effective_from IS 'Effective date for tax calculation (invoice sent_at date)';
COMMENT ON COLUMN invoices.tax_jurisdiction IS 'Jurisdiction/country code (e.g., "GH", "US", "KE")';

-- ============================================================================
-- SALES TABLE - Add Generic Tax Columns
-- ============================================================================
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS tax_lines JSONB,
  ADD COLUMN IF NOT EXISTS tax_engine_code TEXT,
  ADD COLUMN IF NOT EXISTS tax_engine_effective_from TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS tax_jurisdiction TEXT;

-- Index for sales tax queries
CREATE INDEX IF NOT EXISTS idx_sales_tax_engine_code ON sales(tax_engine_code) WHERE tax_engine_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_tax_jurisdiction ON sales(tax_jurisdiction) WHERE tax_jurisdiction IS NOT NULL;

-- Comments
COMMENT ON COLUMN sales.tax_lines IS 'Array of tax line items from tax calculation';
COMMENT ON COLUMN sales.tax_engine_code IS 'Tax engine identifier used for calculation';
COMMENT ON COLUMN sales.tax_engine_effective_from IS 'Effective date for tax calculation (sale created_at)';
COMMENT ON COLUMN sales.tax_jurisdiction IS 'Jurisdiction/country code for tax calculation';

-- ============================================================================
-- NOTE: Legacy Columns (nhil, getfund, covid, vat)
-- ============================================================================
-- Legacy columns are kept for backward compatibility
-- They should be derived from tax_lines when tax_engine_code = 'ghana'
-- This allows existing code and reports to continue working

