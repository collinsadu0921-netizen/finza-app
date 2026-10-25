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
  INSERT INTO public.accounts (business_id, name, code, type, sub_type, description, is_system) VALUES
    (p_business_id, 'Cash',                     '1000', 'asset',     'cash',              'Cash on hand',                                                          TRUE),
    (p_business_id, 'Bank',                     '1010', 'asset',     'bank',              'Bank account',                                                          TRUE),
    (p_business_id, 'Mobile Money',             '1020', 'asset',     'mobile_money',      'Mobile money accounts',                                                 TRUE),
    (p_business_id, 'Accounts Receivable',      '1100', 'asset',     NULL,                'Amounts owed by customers',                                             TRUE),
    (p_business_id, 'Staff Advances',           '1110', 'asset',     NULL,                'Salary advances issued to employees',                                   TRUE),
    (p_business_id, 'WHT Receivable',           '2155', 'asset',     NULL,                'Withholding tax deducted from your payments by customers',               TRUE),
    (p_business_id, 'Fixed Assets',             '1600', 'asset',     NULL,                'Fixed assets including equipment, vehicles, and property',              TRUE),
    (p_business_id, 'Accumulated Depreciation', '1650', 'asset',     NULL,                'Accumulated depreciation on fixed assets',                              TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  INSERT INTO public.accounts (business_id, name, code, type, sub_type, description, is_system) VALUES
    (p_business_id, 'Accounts Payable',                    '2000', 'liability', 'payable',         'Amounts owed to suppliers',                        TRUE),
    (p_business_id, 'VAT Payable',                         '2100', 'liability', 'tax_payable',     'VAT output tax minus input tax',                   TRUE),
    (p_business_id, 'NHIL Payable',                        '2110', 'liability', 'tax_payable',     'NHIL output tax minus input tax',                  TRUE),
    (p_business_id, 'GETFund Payable',                     '2120', 'liability', 'tax_payable',     'GETFund output tax minus input tax',               TRUE),
    (p_business_id, 'COVID Levy Payable',                  '2130', 'liability', 'tax_payable',     'COVID-19 Health Recovery Levy payable',            TRUE),
    (p_business_id, 'WHT Payable',                         '2150', 'liability', 'tax_payable',     'Withholding tax withheld from suppliers, payable to GRA', TRUE),
    (p_business_id, 'Other Tax Liabilities',               '2200', 'liability', 'tax_payable',     'Other tax obligations',                           TRUE),
    (p_business_id, 'PAYE Liability',                      '2210', 'liability', 'tax_payable',     'PAYE tax payable to GRA',                         TRUE),
    (p_business_id, 'SSNIT Employee Contribution Payable', '2220', 'liability', 'payroll_payable', 'SSNIT employee contributions payable',            TRUE),
    (p_business_id, 'PAYE Tax Payable',                    '2230', 'liability', 'payroll_payable', 'PAYE income tax payable to GRA',                  TRUE),
    (p_business_id, 'SSNIT / Tier 1 Pension Payable',      '2231', 'liability', 'payroll_payable', 'SSNIT / Tier 1 pension contributions payable',   TRUE),
    (p_business_id, 'Tier 2 Pension Payable',              '2232', 'liability', 'payroll_payable', 'Tier 2 pension contributions payable to trustee', TRUE),
    (p_business_id, 'Net Salaries Payable',                '2240', 'liability', 'payroll_payable', 'Net salaries payable to employees',               TRUE),
    (p_business_id, 'Employee Deductions / Recoveries Payable', '2241', 'liability', 'payroll_payable',
     'Employee deductions and internal recoveries payable/cleared through payroll', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  INSERT INTO public.accounts (business_id, name, code, type, sub_type, description, is_system) VALUES
    (p_business_id, 'Short-term Loan',     '2300', 'liability', 'loan', 'Loans and overdrafts repayable within 12 months', TRUE),
    (p_business_id, 'Long-term Bank Loan', '2310', 'liability', 'loan', 'Loans repayable after 12 months',                 TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  INSERT INTO public.accounts (business_id, name, code, type, sub_type, description, is_system) VALUES
    (p_business_id, 'Owner''s Equity',   '3000', 'equity', NULL, 'Owner investment',       TRUE),
    (p_business_id, 'Retained Earnings','3100', 'equity', NULL, 'Accumulated profits',    TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  INSERT INTO public.accounts (business_id, name, code, type, sub_type, description, is_system) VALUES
    (p_business_id, 'Service Revenue',        '4000', 'income', NULL, 'Revenue from services',               TRUE),
    (p_business_id, 'Gain on Asset Disposal', '4200', 'income', NULL, 'Gains from disposal of fixed assets', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  INSERT INTO public.accounts (business_id, name, code, type, sub_type, description, is_system) VALUES
    (p_business_id, 'Cost of Sales',               '5000', 'expense', NULL, 'Direct costs',                                  TRUE),
    (p_business_id, 'Operating Expenses',          '5100', 'expense', NULL, 'General operating expenses',                    TRUE),
    (p_business_id, 'Supplier Bills',              '5200', 'expense', NULL, 'Supplier invoices',                             TRUE),
    (p_business_id, 'Administrative Expenses',     '5300', 'expense', NULL, 'Admin and overhead',                            TRUE),
    (p_business_id, 'Employer Pension Expense',    '5610', 'expense', NULL, 'Employer pension / SSNIT contribution expense', TRUE),
    (p_business_id, 'Depreciation Expense',        '5700', 'expense', NULL, 'Depreciation expense for fixed assets',         TRUE),
    (p_business_id, 'Loss on Asset Disposal',      '5800', 'expense', NULL, 'Losses from disposal of fixed assets',          TRUE),
    (p_business_id, 'Payroll Expense',             '6000', 'expense', NULL, 'Employee salaries and wages',                   TRUE),
    (p_business_id, 'Employer SSNIT Contribution', '6010', 'expense', NULL, 'Employer SSNIT contributions',                  TRUE),
    (p_business_id, 'Interest Expense',            '6300', 'expense', NULL, 'Interest on loans and borrowings',              TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.create_system_accounts(UUID) IS
  'Idempotent system COA bootstrap. Semantic sub_types on funding + loan accounts (566). Preserves 469 payroll labels. Includes WHT Receivable (2155) and WHT Payable (2150).';

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
    sub_type,
    description,
    is_system
  )
  VALUES (
    p_business_id,
    'WHT Payable',
    '2150',
    'liability',
    'tax_payable',
    'Withholding tax withheld from suppliers, payable to GRA',
    TRUE
  )
  ON CONFLICT (business_id, code) DO UPDATE
  SET
    name = EXCLUDED.name,
    type = EXCLUDED.type,
    sub_type = EXCLUDED.sub_type,
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
