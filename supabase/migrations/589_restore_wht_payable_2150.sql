-- ============================================================================
-- Migration 589: Restore WHT Payable (2150) for Service tenants
--
-- Problem:
--   Migration 436 replaced create_system_accounts() and omitted WHT Payable
--   (2150). Service supplier bills with WHT then fail at posting with
--   "Invalid account code for this business: 2150".
--
-- This migration:
--   1) Re-adds active WHT Payable (2150) to create_system_accounts() so new
--      tenants get it in accounts, and the normal chart bootstrap copies it
--      into chart_of_accounts.
--   2) Backfills/repairs 2150 for existing Service tenants idempotently.
--      It never inserts journal lines and never changes balances.
--   3) Fails closed if any Service tenant still lacks an active 2150 row after
--      the repair.
--
-- Scope:
--   - 2150 WHT Payable only. 2155 WHT Receivable (customer WHT) is unchanged.
--   - No WHT rate, page, or remittance changes.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) create_system_accounts(): restore WHT Payable 2150 for new tenants
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_system_accounts(p_business_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  -- Assets
  INSERT INTO public.accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Cash',                       '1000', 'asset',     'Cash on hand',                                                          TRUE),
    (p_business_id, 'Bank',                       '1010', 'asset',     'Bank account',                                                          TRUE),
    (p_business_id, 'Mobile Money',               '1020', 'asset',     'Mobile money accounts',                                                 TRUE),
    (p_business_id, 'Accounts Receivable',        '1100', 'asset',     'Amounts owed by customers',                                             TRUE),
    (p_business_id, 'Staff Advances',             '1110', 'asset',     'Salary advances issued to employees',                                   TRUE),
    (p_business_id, 'WHT Receivable',             '2155', 'asset',     'Withholding tax deducted from your payments by customers',               TRUE),
    (p_business_id, 'Fixed Assets',               '1600', 'asset',     'Fixed assets including equipment, vehicles, and property',              TRUE),
    (p_business_id, 'Accumulated Depreciation',   '1650', 'asset',     'Accumulated depreciation on fixed assets',                              TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Liabilities - Current
  INSERT INTO public.accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Accounts Payable',                    '2000', 'liability', 'Amounts owed to suppliers',                        TRUE),
    (p_business_id, 'VAT Payable',                         '2100', 'liability', 'VAT output tax minus input tax',                   TRUE),
    (p_business_id, 'NHIL Payable',                        '2110', 'liability', 'NHIL output tax minus input tax',                  TRUE),
    (p_business_id, 'GETFund Payable',                     '2120', 'liability', 'GETFund output tax minus input tax',               TRUE),
    (p_business_id, 'COVID Levy Payable',                  '2130', 'liability', 'COVID-19 Health Recovery Levy payable',            TRUE),
    (p_business_id, 'WHT Payable',                         '2150', 'liability', 'Withholding tax withheld from suppliers, payable to GRA', TRUE),
    (p_business_id, 'Other Tax Liabilities',               '2200', 'liability', 'Other tax obligations',                           TRUE),
    (p_business_id, 'PAYE Liability',                      '2210', 'liability', 'PAYE tax payable to GRA',                         TRUE),
    (p_business_id, 'SSNIT Employee Contribution Payable', '2220', 'liability', 'SSNIT employee contributions payable',            TRUE),
    (p_business_id, 'SSNIT Employer Contribution Payable', '2230', 'liability', 'SSNIT employer contributions payable',            TRUE),
    (p_business_id, 'Net Salaries Payable',                '2240', 'liability', 'Net salaries payable to employees',               TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Liabilities - Loan
  INSERT INTO public.accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Short-term Loan',      '2300', 'liability', 'Loans and overdrafts repayable within 12 months',   TRUE),
    (p_business_id, 'Long-term Bank Loan',  '2310', 'liability', 'Loans repayable after 12 months',                   TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Equity
  INSERT INTO public.accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Owner''s Equity',  '3000', 'equity', 'Owner investment',       TRUE),
    (p_business_id, 'Retained Earnings','3100', 'equity', 'Accumulated profits',    TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Income
  INSERT INTO public.accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Service Revenue',        '4000', 'income', 'Revenue from services',                    TRUE),
    (p_business_id, 'Gain on Asset Disposal', '4200', 'income', 'Gains from disposal of fixed assets',      TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Expenses
  INSERT INTO public.accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Cost of Sales',               '5000', 'expense', 'Direct costs',                                  TRUE),
    (p_business_id, 'Operating Expenses',          '5100', 'expense', 'General operating expenses',                    TRUE),
    (p_business_id, 'Supplier Bills',              '5200', 'expense', 'Supplier invoices',                             TRUE),
    (p_business_id, 'Administrative Expenses',     '5300', 'expense', 'Admin and overhead',                            TRUE),
    (p_business_id, 'Depreciation Expense',        '5700', 'expense', 'Depreciation expense for fixed assets',         TRUE),
    (p_business_id, 'Loss on Asset Disposal',      '5800', 'expense', 'Losses from disposal of fixed assets',          TRUE),
    (p_business_id, 'Payroll Expense',             '6000', 'expense', 'Employee salaries and wages',                   TRUE),
    (p_business_id, 'Employer SSNIT Contribution', '6010', 'expense', 'Employer SSNIT contributions',                  TRUE),
    (p_business_id, 'Interest Expense',            '6300', 'expense', 'Interest on loans and borrowings',              TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.create_system_accounts(UUID) IS
  'Idempotent system accounts for a business. Includes WHT Receivable (2155, asset) and WHT Payable (2150, liability).';

-- ---------------------------------------------------------------------------
-- 2) Idempotent ensure helper for existing and future Service tenants
--    - creates 2150 when absent
--    - reactivates soft-deleted 2150 / inactive chart row
--    - never inserts journal lines or changes balances
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_wht_payable_account_id(
  p_business_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  INSERT INTO public.accounts (
    business_id,
    name,
    code,
    type,
    description,
    is_system
  )
  VALUES (
    p_business_id,
    'WHT Payable',
    '2150',
    'liability',
    'Withholding tax withheld from suppliers, payable to GRA',
    TRUE
  )
  ON CONFLICT (business_id, code) DO UPDATE
  SET
    name = EXCLUDED.name,
    type = EXCLUDED.type,
    description = EXCLUDED.description,
    is_system = TRUE,
    deleted_at = NULL
  RETURNING id INTO v_account_id;

  INSERT INTO public.chart_of_accounts (
    business_id,
    account_code,
    account_name,
    account_type,
    is_active
  )
  VALUES (
    p_business_id,
    '2150',
    'WHT Payable',
    'liability',
    TRUE
  )
  ON CONFLICT (business_id, account_code) DO UPDATE
  SET
    account_name = EXCLUDED.account_name,
    account_type = EXCLUDED.account_type,
    is_active = TRUE;

  RETURN v_account_id;
END;
$$;

COMMENT ON FUNCTION public.ensure_wht_payable_account_id(UUID) IS
  'Idempotently ensures an active WHT Payable (2150) account and active chart_of_accounts row for a business. Does not create journal lines or alter balances.';

REVOKE ALL ON FUNCTION public.ensure_wht_payable_account_id(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_wht_payable_account_id(UUID)
  TO postgres;

-- ---------------------------------------------------------------------------
-- 3) Backfill / repair existing Service tenants
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tenant RECORD;
BEGIN
  FOR tenant IN
    SELECT b.id
    FROM public.businesses b
    WHERE b.archived_at IS NULL
      AND LOWER(COALESCE(b.industry, '')) = 'service'
  LOOP
    PERFORM public.ensure_wht_payable_account_id(tenant.id);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Fail closed if any Service tenant is still missing an active 2150 row
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  missing_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO missing_count
  FROM public.businesses b
  WHERE b.archived_at IS NULL
    AND LOWER(COALESCE(b.industry, '')) = 'service'
    AND (
      NOT EXISTS (
        SELECT 1
        FROM public.accounts a
        WHERE a.business_id = b.id
          AND a.code = '2150'
          AND a.deleted_at IS NULL
      )
      OR NOT EXISTS (
        SELECT 1
        FROM public.chart_of_accounts c
        WHERE c.business_id = b.id
          AND c.account_code = '2150'
          AND c.is_active = TRUE
      )
    );

  IF missing_count > 0 THEN
    RAISE EXCEPTION
      'Migration 589: % Service tenant(s) still lack an active WHT Payable (2150) account',
      missing_count;
  END IF;
END;
$$;
