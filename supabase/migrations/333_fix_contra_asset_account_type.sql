-- ============================================================================
-- 333_fix_contra_asset_account_type.sql
--
-- Fix: Accumulated Depreciation (1650) was incorrectly typed as 'asset'.
-- A contra-asset has a CREDIT normal balance (credits increase it), so the
-- trial balance must compute closing_balance = credit - debit, not debit - credit.
--
-- With the old type='asset', the engine computed debit - credit = -2000 for a
-- ₵2,000 accumulated balance. The balance-sheet equation still held (total assets
-- was reduced by the negative amount), but individual line display was wrong
-- (showed "Accumulated Depreciation: -₵2,000" instead of a proper deduction row).
--
-- This migration:
--   1. Adds 'contra_asset' to the accounts.type CHECK constraint.
--   2. Updates all existing 1650 accounts to type = 'contra_asset'.
--   3. Replaces create_system_accounts / init_system_accounts to use 'contra_asset'.
--   4. Replaces generate_trial_balance (snapshot engine) to handle 'contra_asset'
--      with credit-normal closing balance.
--   5. Replaces get_balance_sheet_from_trial_balance to include 'contra_asset' rows
--      and return their balance as a NEGATIVE value (so TypeScript/UI can display
--      them as deduction lines while keeping the totalAssets equation correct).
-- ============================================================================

-- ============================================================================
-- STEP 1: Widen the accounts.type CHECK constraint
-- ============================================================================
ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_type_check;

ALTER TABLE accounts
  ADD CONSTRAINT accounts_type_check
  CHECK (type IN ('asset', 'contra_asset', 'liability', 'equity', 'income', 'expense'));

-- ============================================================================
-- STEP 2: Update existing account 1650 rows
-- ============================================================================
UPDATE accounts
SET type = 'contra_asset'
WHERE code = '1650'
  AND is_system = TRUE
  AND deleted_at IS NULL;

-- ============================================================================
-- STEP 3: Replace create_system_accounts to use 'contra_asset' for 1650
-- ============================================================================
CREATE OR REPLACE FUNCTION create_system_accounts(p_business_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO accounts (business_id, name, code, type, description, is_system)
  VALUES
    -- Assets (normal debit balance)
    (p_business_id, 'Cash',                    '1000', 'asset',        'Cash on hand',                                         TRUE),
    (p_business_id, 'Bank Account',            '1010', 'asset',        'Bank account balance',                                 TRUE),
    (p_business_id, 'Mobile Money',            '1020', 'asset',        'Mobile money balance',                                 TRUE),
    (p_business_id, 'Accounts Receivable',     '1100', 'asset',        'Amounts owed by customers',                            TRUE),
    (p_business_id, 'Inventory',               '1200', 'asset',        'Inventory and stock',                                  TRUE),
    (p_business_id, 'Prepaid Expenses',        '1300', 'asset',        'Prepaid expenses and deposits',                        TRUE),
    (p_business_id, 'Fixed Assets',            '1600', 'asset',        'Fixed assets including equipment, vehicles, property', TRUE),
    -- Contra-asset (normal credit balance — deducted from assets on balance sheet)
    (p_business_id, 'Accumulated Depreciation','1650', 'contra_asset', 'Accumulated depreciation on fixed assets',             TRUE),
    -- Liabilities (normal credit balance)
    (p_business_id, 'Accounts Payable',        '2000', 'liability',    'Amounts owed to suppliers',                            TRUE),
    (p_business_id, 'VAT Payable',             '2100', 'liability',    'VAT collected and owed to tax authority',              TRUE),
    (p_business_id, 'NHIL Payable',            '2110', 'liability',    'NHIL levy owed to tax authority',                      TRUE),
    (p_business_id, 'GETFund Payable',         '2120', 'liability',    'GETFund levy owed to tax authority',                   TRUE),
    (p_business_id, 'COVID Levy Payable',      '2130', 'liability',    'COVID health recovery levy',                           TRUE),
    (p_business_id, 'Accrued Liabilities',     '2200', 'liability',    'Accrued expenses and liabilities',                     TRUE),
    (p_business_id, 'Deferred Revenue',        '2300', 'liability',    'Advance payments from customers',                      TRUE),
    -- Equity (normal credit balance)
    (p_business_id, 'Owner Equity',            '3000', 'equity',       'Owner capital investment',                             TRUE),
    (p_business_id, 'Retained Earnings',       '3100', 'equity',       'Accumulated profits',                                  TRUE),
    -- Income (normal credit balance)
    (p_business_id, 'Sales Revenue',           '4000', 'income',       'Revenue from sales of goods and services',             TRUE),
    (p_business_id, 'Service Revenue',         '4100', 'income',       'Revenue from services provided',                       TRUE),
    (p_business_id, 'Other Income',            '4900', 'income',       'Other miscellaneous income',                           TRUE),
    -- Expenses (normal debit balance)
    (p_business_id, 'Cost of Goods Sold',      '5000', 'expense',      'Direct cost of goods sold',                            TRUE),
    (p_business_id, 'Operating Expenses',      '6000', 'expense',      'General operating expenses',                           TRUE),
    (p_business_id, 'Salaries & Wages',        '6100', 'expense',      'Employee salaries and wages',                          TRUE),
    (p_business_id, 'Rent Expense',            '6200', 'expense',      'Rent and lease payments',                              TRUE),
    (p_business_id, 'Utilities Expense',       '6300', 'expense',      'Utilities and services',                               TRUE),
    (p_business_id, 'Depreciation Expense',    '6400', 'expense',      'Depreciation on fixed assets',                         TRUE),
    (p_business_id, 'Interest Expense',        '7000', 'expense',      'Interest on loans and borrowings',                     TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_system_accounts IS
  'Bootstraps the standard chart of accounts for a new business. '
  'Account 1650 (Accumulated Depreciation) is typed as contra_asset (credit-normal).';

-- ============================================================================
-- STEP 4: generate_trial_balance (snapshot engine from migration 247)
-- The canonical function is generate_trial_balance(p_period_id UUID, p_generated_by UUID).
-- It already treats any type NOT IN ('asset','expense') as credit-normal, so once
-- account 1650 has type = 'contra_asset' (STEP 2), it is handled correctly.
-- We only document that here and disambiguate the COMMENT (multiple overloads exist).
-- ============================================================================
COMMENT ON FUNCTION generate_trial_balance(UUID, UUID) IS
  'Snapshot Engine v2: Canonical trial balance generator. contra_asset accounts (e.g. 1650 Accumulated Depreciation) use credit-normal closing balance (credit − debit). Ledger-only source. Enforces hard invariant: SUM(debits) == SUM(credits).';

-- ============================================================================
-- STEP 5: Replace get_balance_sheet_from_trial_balance to handle contra_asset.
--         contra_asset rows are returned with a NEGATIVE balance so they appear
--         as deductions on the balance sheet while keeping totalAssets correct.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_balance_sheet_from_trial_balance(
  p_period_id UUID
)
RETURNS TABLE (
  account_id   UUID,
  account_code TEXT,
  account_name TEXT,
  account_type TEXT,
  balance      NUMERIC
) AS $$
DECLARE
  trial_balance_row RECORD;
BEGIN
  FOR trial_balance_row IN
    SELECT tb.account_id, tb.account_code, tb.account_name, tb.account_type, tb.closing_balance
    FROM get_trial_balance_from_snapshot(p_period_id) AS tb
    WHERE tb.account_type IN ('asset', 'contra_asset', 'liability', 'equity')
  LOOP
    RETURN QUERY SELECT
      trial_balance_row.account_id,
      trial_balance_row.account_code,
      trial_balance_row.account_name,
      trial_balance_row.account_type,
      -- contra_asset: return as negative so TypeScript totalAssets = Σ(amounts) stays correct
      -- e.g. Accumulated Depreciation closing_balance = +2000 → returned as -2000
      -- Normal assets: returned as-is (positive debit balance)
      CASE
        WHEN trial_balance_row.account_type = 'contra_asset'
        THEN -trial_balance_row.closing_balance
        ELSE trial_balance_row.closing_balance
      END AS balance;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_balance_sheet_from_trial_balance IS
  'Returns Balance Sheet rows from Trial Balance snapshot. '
  'contra_asset rows (e.g. Accumulated Depreciation) are returned with negative balance '
  'so the TypeScript layer can sum all asset rows (including deductions) and get correct totals. '
  'The account_type field is preserved as contra_asset for display differentiation.';

-- Mark all existing trial balance snapshots as stale so they regenerate with the new logic
UPDATE trial_balance_snapshots SET is_stale = TRUE;
