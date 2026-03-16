-- ============================================================================
-- 334_add_rounding_adjustment_account.sql
--
-- Adds account 7990 "Rounding Adjustment" to the system chart of accounts.
--
-- Background:
--   The Ghana tax engine rounds each tax component (NHIL, GETFund, VAT) to 2dp
--   independently. Because of banker's rounding the sum of individual components
--   sometimes differs by ±0.01 from the authoritative rounded total. Prior to
--   this change, the ₵0.01 delta was silently absorbed into VAT, causing VAT to
--   display as e.g. ₵5,000.01 instead of the correct ₵5,000.00.
--
--   The industry-standard fix is an explicit "Rounding Adjustment" line item on
--   the invoice. The Ghana tax engine (ghana.ts) now emits a ROUNDING TaxLine
--   (ledger_account_code = '7990') whenever the delta is ≥ ₵0.01. This migration
--   ensures account 7990 exists for all businesses.
--
-- Account classification:
--   type = 'expense' with code 7900–7999 is used for rounding/miscellaneous.
--   Account 7990 is typed 'income' (credit-normal) because the rounding credit
--   for sales appears here. In practice the balance will be near-zero (positive
--   and negative deltas cancel over many invoices), making the classification
--   immaterial. We choose 'income' for the majority-credit use case (sales).
--
-- This migration:
--   1. Adds account 7990 to create_system_accounts so new businesses get it.
--   2. Inserts account 7990 into all existing businesses that do not already
--      have it (idempotent via ON CONFLICT DO NOTHING).
-- ============================================================================

-- ============================================================================
-- STEP 1: Replace create_system_accounts to include account 7990
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
    (p_business_id, 'Interest Expense',        '7000', 'expense',      'Interest on loans and borrowings',                     TRUE),
    -- Rounding (credit-normal — balance is near-zero; positive and negative deltas cancel)
    (p_business_id, 'Rounding Adjustment',     '7990', 'income',       'Cent-level rounding adjustments on invoices/bills',    TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_system_accounts IS
  'Bootstraps the standard chart of accounts for a new business. '
  'Account 1650 (Accumulated Depreciation) is typed as contra_asset (credit-normal). '
  'Account 7990 (Rounding Adjustment) holds ±0.01 tax rounding deltas from invoices.';

-- ============================================================================
-- STEP 2: Back-fill account 7990 into all existing businesses
-- ============================================================================
INSERT INTO accounts (business_id, name, code, type, description, is_system)
SELECT
  b.id,
  'Rounding Adjustment',
  '7990',
  'income',
  'Cent-level rounding adjustments on invoices/bills',
  TRUE
FROM businesses b
WHERE b.archived_at IS NULL
ON CONFLICT (business_id, code) DO NOTHING;
