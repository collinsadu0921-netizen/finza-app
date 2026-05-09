-- ============================================================================
-- Migration 469: Payroll system account display-name cleanup (all businesses)
-- ============================================================================
-- DISPLAY-NAME CLEANUP ONLY: updates accounts.name / accounts.description for
-- known payroll ledger codes on system rows. Ledger amounts unaffected;
-- journal_entry_lines.description stays historical per line (not rewritten).
--
-- Idempotent: SET target labels every run; unchanged rows rewritten to same
-- values only (cheap no-op logically).
--
-- Also replaces create_system_accounts() so NEW businesses inherit correct
-- labels on INSERT … ON CONFLICT DO NOTHING paths.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Canonical labels on all existing tenants (system accounts, active rows)
-- ---------------------------------------------------------------------------
UPDATE public.accounts AS a
SET
  name = v.target_name,
  description = v.target_description,
  updated_at = NOW()
FROM (
  VALUES
    ('2230'::text, 'PAYE Tax Payable'::text, 'PAYE income tax payable to GRA'::text),
    ('2231', 'SSNIT / Tier 1 Pension Payable', 'SSNIT / Tier 1 pension contributions payable'),
    ('2232', 'Tier 2 Pension Payable', 'Tier 2 pension contributions payable to trustee'),
    ('2240', 'Net Salaries Payable', 'Net salaries payable to employees'),
    ('2241', 'Employee Deductions / Recoveries Payable', 'Employee deductions and internal recoveries payable/cleared through payroll'),
    ('5610', 'Employer Pension Expense', 'Employer pension / SSNIT contribution expense')
) AS v(target_code, target_name, target_description)
WHERE a.code = v.target_code
  AND a.deleted_at IS NULL
  AND a.is_system = TRUE;

-- ---------------------------------------------------------------------------
-- 2) create_system_accounts — PAYE semantics for 2230 + payroll extension codes
--    (Copied from migration 436; payroll lines aligned with ledger posting.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_system_accounts(p_business_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Assets
  INSERT INTO accounts (business_id, name, code, type, sub_type, description, is_system) VALUES
    (p_business_id, 'Cash',                       '1000', 'asset',     'cash',         'Cash on hand',                                                          TRUE),
    (p_business_id, 'Bank',                       '1010', 'asset',     'bank',         'Bank account',                                                          TRUE),
    (p_business_id, 'Mobile Money',               '1020', 'asset',     'mobile_money', 'Mobile money accounts',                                                 TRUE),
    (p_business_id, 'Accounts Receivable',        '1100', 'asset',     NULL,           'Amounts owed by customers',                                             TRUE),
    (p_business_id, 'Staff Advances',             '1110', 'asset',     NULL,           'Salary advances issued to employees',                                   TRUE),
    (p_business_id, 'WHT Receivable',             '2155', 'asset',     NULL,           'Withholding tax deducted from your payments by customers',               TRUE),
    (p_business_id, 'Fixed Assets',               '1600', 'asset',     NULL,           'Fixed assets including equipment, vehicles, and property',              TRUE),
    (p_business_id, 'Accumulated Depreciation',   '1650', 'asset',     NULL,           'Accumulated depreciation on fixed assets',                              TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Liabilities — Current
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Accounts Payable',                    '2000', 'liability', 'Amounts owed to suppliers',                        TRUE),
    (p_business_id, 'VAT Payable',                         '2100', 'liability', 'VAT output tax minus input tax',                   TRUE),
    (p_business_id, 'NHIL Payable',                        '2110', 'liability', 'NHIL output tax minus input tax',                  TRUE),
    (p_business_id, 'GETFund Payable',                     '2120', 'liability', 'GETFund output tax minus input tax',               TRUE),
    (p_business_id, 'COVID Levy Payable',                  '2130', 'liability', 'COVID-19 Health Recovery Levy payable',            TRUE),
    (p_business_id, 'Other Tax Liabilities',               '2200', 'liability', 'Other tax obligations',                           TRUE),
    (p_business_id, 'PAYE Liability',                      '2210', 'liability', 'PAYE tax payable to GRA',                         TRUE),
    (p_business_id, 'SSNIT Employee Contribution Payable', '2220', 'liability', 'SSNIT employee contributions payable',            TRUE),
    (p_business_id, 'PAYE Tax Payable',                    '2230', 'liability', 'PAYE income tax payable to GRA',                  TRUE),
    (p_business_id, 'SSNIT / Tier 1 Pension Payable',      '2231', 'liability', 'SSNIT / Tier 1 pension contributions payable',  TRUE),
    (p_business_id, 'Tier 2 Pension Payable',             '2232', 'liability', 'Tier 2 pension contributions payable to trustee', TRUE),
    (p_business_id, 'Net Salaries Payable',                '2240', 'liability', 'Net salaries payable to employees',               TRUE),
    (p_business_id, 'Employee Deductions / Recoveries Payable', '2241', 'liability',
     'Employee deductions and internal recoveries payable/cleared through payroll', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Liabilities — Loan
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Short-term Loan',      '2300', 'liability', 'Loans and overdrafts repayable within 12 months',   TRUE),
    (p_business_id, 'Long-term Bank Loan',  '2310', 'liability', 'Loans repayable after 12 months',                   TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Equity
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Owner''s Equity',  '3000', 'equity', 'Owner investment',       TRUE),
    (p_business_id, 'Retained Earnings','3100', 'equity', 'Accumulated profits',    TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Income
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Service Revenue',        '4000', 'income', 'Revenue from services',                    TRUE),
    (p_business_id, 'Gain on Asset Disposal', '4200', 'income', 'Gains from disposal of fixed assets',      TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Expenses
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Cost of Sales',               '5000', 'expense', 'Direct costs',                                  TRUE),
    (p_business_id, 'Operating Expenses',          '5100', 'expense', 'General operating expenses',                    TRUE),
    (p_business_id, 'Supplier Bills',              '5200', 'expense', 'Supplier invoices',                             TRUE),
    (p_business_id, 'Administrative Expenses',     '5300', 'expense', 'Admin and overhead',                            TRUE),
    (p_business_id, 'Employer Pension Expense',    '5610', 'expense', 'Employer pension / SSNIT contribution expense', TRUE),
    (p_business_id, 'Depreciation Expense',        '5700', 'expense', 'Depreciation expense for fixed assets',         TRUE),
    (p_business_id, 'Loss on Asset Disposal',      '5800', 'expense', 'Losses from disposal of fixed assets',          TRUE),
    (p_business_id, 'Payroll Expense',             '6000', 'expense', 'Employee salaries and wages',                   TRUE),
    (p_business_id, 'Employer SSNIT Contribution', '6010', 'expense', 'Employer SSNIT contributions',                  TRUE),
    (p_business_id, 'Interest Expense',            '6300', 'expense', 'Interest on loans and borrowings',              TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_system_accounts(UUID) IS
'Idempotent system accounts for a business. Includes WHT Receivable (2155). Payroll labels: 2230 PAYE Tax Payable (payroll withholdings ledger), SSNIT / Tier 1 (2231), Tier 2 pension (2232), net salaries (2240), deductions/recoveries (2241), Employer Pension Expense (5610).';
