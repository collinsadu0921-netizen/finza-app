-- ============================================================================
-- ADD DIAGNOSTIC LOGGING TABLE
-- ============================================================================
-- This creates a temporary table to log journal_lines JSONB so we can query it
-- The function has been modified to INSERT into this table before calling post_journal_entry

-- Create diagnostic table (drop if exists)
DROP TABLE IF EXISTS diagnostic_journal_lines_log;

CREATE TABLE diagnostic_journal_lines_log (
  id SERIAL PRIMARY KEY,
  sale_id UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  gross_total NUMERIC,
  net_total NUMERIC,
  total_tax_amount NUMERIC,
  journal_lines JSONB,
  cash_account_id UUID,
  revenue_account_id UUID,
  cogs_account_id UUID,
  inventory_account_id UUID
);

COMMENT ON TABLE diagnostic_journal_lines_log IS 
'TEMPORARY: Diagnostic logging for journal_lines JSONB. DROP after root cause analysis.';

-- After running this script:
-- 1. Run MANUAL_TEST_POST_SALE.sql to trigger the error
-- 2. Run the query below to see the actual journal_lines JSONB that was passed to post_journal_entry

-- Query to inspect logged data:
-- SELECT 
--   sale_id,
--   gross_total,
--   net_total,
--   total_tax_amount,
--   journal_lines,
--   cash_account_id,
--   revenue_account_id,
--   -- Calculate totals from journal_lines
--   (SELECT SUM(COALESCE((line->>'debit')::NUMERIC, 0)) FROM jsonb_array_elements(journal_lines) as line) as calculated_debit,
--   (SELECT SUM(COALESCE((line->>'credit')::NUMERIC, 0)) FROM jsonb_array_elements(journal_lines) as line) as calculated_credit
-- FROM diagnostic_journal_lines_log
-- ORDER BY created_at DESC
-- LIMIT 1;
