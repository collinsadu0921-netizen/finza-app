-- ============================================================================
-- MIGRATION: Phase 4 - Enforce Ledger-Only Financial Statements
-- ============================================================================
-- Documents and enforces that financial statements MUST be derived from
-- ledger ONLY (journal_entries + journal_entry_lines + accounts).
-- 
-- Rules:
-- 1. P&L COGS MUST come from journal_entry_lines (account code 5000)
-- 2. Balance Sheet Inventory MUST come from journal_entry_lines (account code 1200)
-- 3. Zero operational table access in reporting layer
-- 
-- Operational tables (sales, sale_items, products_stock) are NOT authoritative
-- for financial reporting. They are supporting data only.
-- ============================================================================

-- ============================================================================
-- FUNCTION: Validate ledger-only COGS calculation
-- ============================================================================
-- Returns COGS from ledger ONLY (account code 5000)
-- This is the authoritative source for P&L COGS
CREATE OR REPLACE FUNCTION get_cogs_from_ledger(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS NUMERIC AS $$
DECLARE
  cogs_account_id UUID;
  ledger_cogs NUMERIC := 0;
BEGIN
  -- Get COGS account (code 5000)
  cogs_account_id := get_account_by_code(p_business_id, '5000');
  
  IF cogs_account_id IS NULL THEN
    RETURN 0; -- No COGS account means no COGS
  END IF;

  -- Calculate COGS from ledger ONLY
  -- COGS is an expense account: debit - credit
  SELECT COALESCE(SUM(jel.debit - jel.credit), 0)
  INTO ledger_cogs
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  WHERE jel.account_id = cogs_account_id
    AND je.business_id = p_business_id
    AND je.date >= p_start_date
    AND je.date <= p_end_date;

  RETURN COALESCE(ledger_cogs, 0);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_cogs_from_ledger IS 'Returns COGS from ledger ONLY (journal_entry_lines for account code 5000). This is the authoritative source for P&L COGS. Operational tables (sale_items) are NOT used.';

-- ============================================================================
-- FUNCTION: Validate ledger-only Inventory calculation
-- ============================================================================
-- Returns Inventory asset value from ledger ONLY (account code 1200)
-- This is the authoritative source for Balance Sheet Inventory
CREATE OR REPLACE FUNCTION get_inventory_from_ledger(
  p_business_id UUID,
  p_as_of_date DATE
)
RETURNS NUMERIC AS $$
DECLARE
  inventory_account_id UUID;
  ledger_inventory NUMERIC := 0;
BEGIN
  -- Get Inventory account (code 1200)
  inventory_account_id := get_account_by_code(p_business_id, '1200');
  
  IF inventory_account_id IS NULL THEN
    RETURN 0; -- No inventory account means no inventory
  END IF;

  -- Calculate Inventory from ledger ONLY
  -- Inventory is an asset account: debit - credit
  SELECT COALESCE(SUM(jel.debit - jel.credit), 0)
  INTO ledger_inventory
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  WHERE jel.account_id = inventory_account_id
    AND je.business_id = p_business_id
    AND je.date <= p_as_of_date;

  RETURN COALESCE(ledger_inventory, 0);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_inventory_from_ledger IS 'Returns Inventory asset value from ledger ONLY (journal_entry_lines for account code 1200). This is the authoritative source for Balance Sheet Inventory. Operational tables (products_stock) are NOT used.';

-- ============================================================================
-- ENFORCEMENT: Update get_profit_and_loss comment to explicitly state
-- COGS comes from ledger only (account code 5000)
-- ============================================================================
COMMENT ON FUNCTION get_profit_and_loss IS 'Returns profit & loss for given date range. Ledger-only (journal_entries + journal_entry_lines + accounts). Only income and expense accounts. Period-aware via date filters. COGS (account code 5000) is calculated from journal_entry_lines ONLY - operational tables (sale_items) are NOT used.';

-- ============================================================================
-- ENFORCEMENT: Update get_balance_sheet comment to explicitly state
-- Inventory comes from ledger only (account code 1200)
-- ============================================================================
COMMENT ON FUNCTION get_balance_sheet IS 'Returns balance sheet as of given date. Ledger-only (journal_entries + journal_entry_lines + accounts). Only asset, liability, equity accounts. Uses cumulative balances up to as_of_date. Period-aware via date filter. Inventory (account code 1200) is calculated from journal_entry_lines ONLY - operational tables (products_stock) are NOT used.';

-- ============================================================================
-- DOCUMENTATION: Table authority classification
-- ============================================================================
-- Authoritative tables for financial reporting:
-- - journal_entries: Journal entry headers
-- - journal_entry_lines: Individual debit/credit movements
-- - accounts: Chart of accounts
--
-- Supporting tables (NOT used in financial reporting):
-- - sales: Operational sale records
-- - sale_items: Line items for each sale (COGS stored here but NOT used for reporting)
-- - products_stock: Current inventory quantities (operational tracking only)
-- - stock_movements: Inventory movement history (audit trail only)
--
-- Rule: Financial statements MUST be generated exclusively from authoritative tables.
-- Supporting tables provide operational context but are NOT part of accounting records.
-- ============================================================================
