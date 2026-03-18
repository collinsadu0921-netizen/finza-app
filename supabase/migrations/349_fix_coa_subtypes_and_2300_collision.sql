-- ============================================================================
-- MIGRATION 349: Fix chart-of-accounts sub_type gaps and code-2300 collision
-- ============================================================================
--
-- Problems fixed:
--
--   A) Code 2300 collision
--      Migration 334 placed 'Deferred Revenue' at code 2300.
--      Migration 295 maps code LIKE '23%' → sub_type = 'loan'.
--      Migration 348 tried to create 2300 as 'Short-term Loan' but
--      ON CONFLICT DO NOTHING silently skipped it for existing businesses,
--      leaving them with Deferred Revenue in the loan slot forever.
--
--      Fix: Move Deferred Revenue → 2800.  Journal entry lines reference
--      account_id (UUID), so all historical DR postings follow automatically.
--      Then insert 2300/2310 as loan accounts for every business.
--
--   B) sub_type never written on account creation
--      create_system_accounts() never set sub_type.  Migration 295's
--      one-time backfill is gone.  All businesses created after migration 295
--      (and all new ones going forward) have sub_type = NULL on every system
--      account, so selectors that filter by sub_type find nothing.
--
--      Fix: Rewrite create_system_accounts() to explicitly pass sub_type for
--      every account.  Then back-fill the full mapping for existing accounts.
--
--   C) Account 1650 type inconsistency
--      Migration 334 typed 1650 as 'contra_asset'; migration 348 typed it
--      'asset'.  The cash flow report detects accumulated depreciation via
--      closing_balance < 0 (which requires 'asset' normal-debit convention).
--
--      Fix: Normalise all 1650 rows to type = 'asset'.
--
-- ============================================================================


-- ============================================================================
-- STEP 1: Move 'Deferred Revenue' from code 2300 → 2800
--   Journal entry lines reference account_id UUID so historical entries
--   follow the row automatically.  ON CONFLICT DO NOTHING guards the rare
--   case where a business already has a 2800 account.
-- ============================================================================

-- Rename the 2300 row to 2800 where the account was the system Deferred Revenue
-- (name check protects user-created accounts also sitting at 2300).
UPDATE accounts
SET
  code        = '2800',
  name        = 'Deferred Revenue',
  description = 'Advance payments and deferred income from customers'
WHERE
  code        = '2300'
  AND name    = 'Deferred Revenue'
  AND is_system = TRUE
  AND deleted_at IS NULL;


-- ============================================================================
-- STEP 2: Normalise account 1650 → type = 'asset'
--   The cash flow report detects accumulated depreciation by checking
--   closing_balance < 0 under debit-normal convention.  contra_asset uses
--   the opposite convention and breaks that check.
-- ============================================================================

UPDATE accounts
SET type = 'asset'
WHERE
  code      = '1650'
  AND type  = 'contra_asset'
  AND deleted_at IS NULL;


-- ============================================================================
-- STEP 3: Replace create_system_accounts() with explicit sub_type values
-- ============================================================================

CREATE OR REPLACE FUNCTION create_system_accounts(p_business_id UUID)
RETURNS VOID AS $$
BEGIN

  -- ── Assets (debit-normal) ──────────────────────────────────────────────────
  INSERT INTO accounts (business_id, name, code, type, sub_type, description, is_system) VALUES
    (p_business_id, 'Cash',                     '1000', 'asset',     'cash',              'Cash on hand',                                              TRUE),
    (p_business_id, 'Bank',                     '1010', 'asset',     'bank',              'Bank account balance',                                      TRUE),
    (p_business_id, 'Mobile Money',             '1020', 'asset',     'bank',              'Mobile money accounts',                                     TRUE),
    (p_business_id, 'Accounts Receivable',      '1100', 'asset',     'receivable',        'Amounts owed by customers',                                 TRUE),
    (p_business_id, 'Inventory',                '1200', 'asset',     'inventory',         'Goods held for sale',                                       TRUE),
    (p_business_id, 'Prepaid Expenses',         '1300', 'asset',     'prepaid',           'Prepaid expenses and deposits',                             TRUE),
    (p_business_id, 'Fixed Assets',             '1600', 'asset',     'fixed_asset',       'Fixed assets including equipment, vehicles, property',      TRUE),
    -- Accumulated Depreciation: typed 'asset' so debit-normal convention
    -- applies.  Credit entries produce a negative closing_balance, which the
    -- cash-flow report uses to identify it without relying on contra_asset.
    (p_business_id, 'Accumulated Depreciation', '1650', 'asset',     'accum_depreciation','Accumulated depreciation on fixed assets',                  TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- ── Liabilities — Operating (credit-normal) ───────────────────────────────
  INSERT INTO accounts (business_id, name, code, type, sub_type, description, is_system) VALUES
    (p_business_id, 'Accounts Payable',                    '2000', 'liability', 'payable',        'Amounts owed to suppliers',                         TRUE),
    (p_business_id, 'VAT Payable',                         '2100', 'liability', 'tax_payable',    'VAT output tax minus input tax',                    TRUE),
    (p_business_id, 'NHIL Payable',                        '2110', 'liability', 'tax_payable',    'NHIL levy owed to GRA',                             TRUE),
    (p_business_id, 'GETFund Payable',                     '2120', 'liability', 'tax_payable',    'GETFund levy owed to GRA',                          TRUE),
    -- Account retained for historical pre-2026 transactions; levy abolished 2 Apr 2025
    (p_business_id, 'COVID Levy Payable',                  '2130', 'liability', 'tax_payable',    'COVID-19 Health Recovery Levy (abolished Apr 2025)', TRUE),
    (p_business_id, 'Other Tax Liabilities',               '2200', 'liability', 'tax_payable',    'Other tax obligations',                             TRUE),
    (p_business_id, 'PAYE Liability',                      '2210', 'liability', 'tax_payable',    'PAYE tax payable to GRA',                           TRUE),
    (p_business_id, 'SSNIT Employee Contribution Payable', '2220', 'liability', 'tax_payable',    'SSNIT employee contributions payable',              TRUE),
    (p_business_id, 'SSNIT Employer Contribution Payable', '2230', 'liability', 'tax_payable',    'SSNIT employer contributions payable',              TRUE),
    (p_business_id, 'Net Salaries Payable',                '2240', 'liability', 'tax_payable',    'Net salaries payable to employees',                 TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- ── Liabilities — Loans (sub_type='loan'; code range 23xx per migration 295) ──
  INSERT INTO accounts (business_id, name, code, type, sub_type, description, is_system) VALUES
    (p_business_id, 'Short-term Loan',     '2300', 'liability', 'loan', 'Loans and overdrafts repayable within 12 months', TRUE),
    (p_business_id, 'Long-term Bank Loan', '2310', 'liability', 'loan', 'Loans repayable after 12 months',                 TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- ── Liabilities — Other ───────────────────────────────────────────────────
  INSERT INTO accounts (business_id, name, code, type, sub_type, description, is_system) VALUES
    (p_business_id, 'Deferred Revenue', '2800', 'liability', 'deferred_revenue', 'Advance payments and deferred income from customers', TRUE),
    (p_business_id, 'Accrued Liabilities', '2900', 'liability', NULL, 'Accrued expenses and other liabilities', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- ── Equity (credit-normal) ────────────────────────────────────────────────
  INSERT INTO accounts (business_id, name, code, type, sub_type, description, is_system) VALUES
    (p_business_id, 'Owner''s Equity',  '3000', 'equity', 'owner_capital',     'Owner capital investment',    TRUE),
    (p_business_id, 'Retained Earnings','3100', 'equity', 'retained_earnings', 'Accumulated net profit',      TRUE),
    (p_business_id, 'Other Reserves',   '3200', 'equity', 'other_reserve',     'Other equity reserves',       TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- ── Income (credit-normal) ────────────────────────────────────────────────
  INSERT INTO accounts (business_id, name, code, type, sub_type, description, is_system) VALUES
    (p_business_id, 'Service Revenue',        '4000', 'income', 'operating_revenue', 'Revenue from services',                    TRUE),
    (p_business_id, 'Sales Revenue',          '4100', 'income', 'operating_revenue', 'Revenue from product sales',               TRUE),
    (p_business_id, 'Other Income',           '4900', 'income', 'other_income',      'Miscellaneous income',                     TRUE),
    (p_business_id, 'Gain on Asset Disposal', '4200', 'income', 'other_income',      'Gains from disposal of fixed assets',      TRUE),
    (p_business_id, 'Rounding Adjustment',    '7990', 'income', 'rounding',          'Cent-level rounding adjustments',          TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- ── Expenses (debit-normal) ───────────────────────────────────────────────
  INSERT INTO accounts (business_id, name, code, type, sub_type, description, is_system) VALUES
    (p_business_id, 'Cost of Sales',                '5000', 'expense', 'cost_of_sales',   'Direct costs of goods and services sold',  TRUE),
    (p_business_id, 'Operating Expenses',           '5100', 'expense', 'operating',       'General operating expenses',               TRUE),
    (p_business_id, 'Supplier Bills',               '5200', 'expense', 'operating',       'Supplier invoices and purchases',          TRUE),
    (p_business_id, 'Administrative Expenses',      '5300', 'expense', 'operating',       'Admin and overhead',                       TRUE),
    (p_business_id, 'Depreciation Expense',         '5700', 'expense', 'depreciation',    'Depreciation on fixed assets',             TRUE),
    (p_business_id, 'Loss on Asset Disposal',       '5800', 'expense', 'other',           'Losses from disposal of fixed assets',     TRUE),
    (p_business_id, 'Payroll Expense',              '6000', 'expense', 'payroll',         'Employee salaries and wages',              TRUE),
    (p_business_id, 'Employer SSNIT Contribution',  '6010', 'expense', 'payroll',         'Employer SSNIT contributions',             TRUE),
    (p_business_id, 'Interest Expense',             '7000', 'expense', 'interest',        'Interest on loans and borrowings',         TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_system_accounts IS
  'Bootstraps the standard chart of accounts for a new business. '
  'Every account row now includes an explicit sub_type so selectors do not '
  'depend on the one-time backfill from migration 295. '
  'Account 1650 (Accumulated Depreciation) is typed asset (debit-normal) so '
  'its credit balance is negative — detectable by the cash-flow report. '
  'Loan accounts occupy the 23xx range (sub_type=loan) per migration 295. '
  'Deferred Revenue lives at 2800 to avoid that range.';


-- ============================================================================
-- STEP 4: Back-fill sub_type for all existing system accounts
--   Covers every business that was created after migration 295 ran (or that
--   had sub_type = NULL for any other reason).
-- ============================================================================

UPDATE accounts
SET sub_type = CASE code
  -- Cash & bank
  WHEN '1000' THEN 'cash'
  WHEN '1010' THEN 'bank'
  WHEN '1020' THEN 'bank'
  -- Receivables / current assets
  WHEN '1100' THEN 'receivable'
  WHEN '1200' THEN 'inventory'
  WHEN '1300' THEN 'prepaid'
  -- Fixed assets
  WHEN '1600' THEN 'fixed_asset'
  WHEN '1650' THEN 'accum_depreciation'
  -- Operating liabilities
  WHEN '2000' THEN 'payable'
  WHEN '2100' THEN 'tax_payable'
  WHEN '2110' THEN 'tax_payable'
  WHEN '2120' THEN 'tax_payable'
  WHEN '2130' THEN 'tax_payable'
  WHEN '2200' THEN 'tax_payable'
  WHEN '2210' THEN 'tax_payable'
  WHEN '2220' THEN 'tax_payable'
  WHEN '2230' THEN 'tax_payable'
  WHEN '2240' THEN 'tax_payable'
  -- Loans
  WHEN '2300' THEN 'loan'
  WHEN '2310' THEN 'loan'
  -- Other liabilities
  WHEN '2800' THEN 'deferred_revenue'
  -- Equity
  WHEN '3000' THEN 'owner_capital'
  WHEN '3100' THEN 'retained_earnings'
  WHEN '3200' THEN 'other_reserve'
  -- Income
  WHEN '4000' THEN 'operating_revenue'
  WHEN '4100' THEN 'operating_revenue'
  WHEN '4200' THEN 'other_income'
  WHEN '4900' THEN 'other_income'
  WHEN '7990' THEN 'rounding'
  -- Expenses
  WHEN '5000' THEN 'cost_of_sales'
  WHEN '5100' THEN 'operating'
  WHEN '5200' THEN 'operating'
  WHEN '5300' THEN 'operating'
  WHEN '5700' THEN 'depreciation'
  WHEN '5800' THEN 'other'
  WHEN '6000' THEN 'payroll'
  WHEN '6010' THEN 'payroll'
  WHEN '7000' THEN 'interest'
  ELSE sub_type  -- leave user-created accounts unchanged
END
WHERE is_system = TRUE
  AND deleted_at IS NULL;


-- ============================================================================
-- STEP 5: Insert missing loan accounts for existing businesses
--   Runs AFTER step 1 renamed the old 2300 row to 2800, so the code = '2300'
--   slot is now free for the real Short-term Loan account.
-- ============================================================================

INSERT INTO accounts (business_id, name, code, type, sub_type, description, is_system)
SELECT
  b.id,
  v.name,
  v.code,
  'liability',
  'loan',
  v.description,
  TRUE
FROM businesses b
CROSS JOIN (VALUES
  ('Short-term Loan',     '2300', 'Loans and overdrafts repayable within 12 months'),
  ('Long-term Bank Loan', '2310', 'Loans repayable after 12 months')
) AS v(name, code, description)
WHERE b.archived_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.business_id = b.id
      AND a.code        = v.code
      AND a.deleted_at  IS NULL
  )
ON CONFLICT (business_id, code) DO NOTHING;
