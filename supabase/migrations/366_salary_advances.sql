-- ============================================================================
-- MIGRATION 366: Salary Advances
-- ============================================================================
-- 1. Add Staff Advances account (1110) to system accounts + backfill
-- 2. Create salary_advances table
-- 3. Add advance_id column to deductions table
-- ============================================================================


-- ── 1. Update create_system_accounts to include 1110 Staff Advances ──────────

CREATE OR REPLACE FUNCTION create_system_accounts(p_business_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Assets
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Cash',                       '1000', 'asset',     'Cash on hand',                                                          TRUE),
    (p_business_id, 'Bank',                       '1010', 'asset',     'Bank account',                                                          TRUE),
    (p_business_id, 'Mobile Money',               '1020', 'asset',     'Mobile money accounts',                                                 TRUE),
    (p_business_id, 'Accounts Receivable',        '1100', 'asset',     'Amounts owed by customers',                                             TRUE),
    (p_business_id, 'Staff Advances',             '1110', 'asset',     'Salary advances issued to employees',                                   TRUE),
    (p_business_id, 'Fixed Assets',               '1600', 'asset',     'Fixed assets including equipment, vehicles, and property',              TRUE),
    (p_business_id, 'Accumulated Depreciation',   '1650', 'asset',     'Accumulated depreciation on fixed assets',                              TRUE)
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
    (p_business_id, 'SSNIT Employer Contribution Payable', '2230', 'liability', 'SSNIT employer contributions payable',            TRUE),
    (p_business_id, 'Net Salaries Payable',                '2240', 'liability', 'Net salaries payable to employees',               TRUE)
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
    (p_business_id, 'Depreciation Expense',        '5700', 'expense', 'Depreciation expense for fixed assets',         TRUE),
    (p_business_id, 'Loss on Asset Disposal',      '5800', 'expense', 'Losses from disposal of fixed assets',          TRUE),
    (p_business_id, 'Payroll Expense',             '6000', 'expense', 'Employee salaries and wages',                   TRUE),
    (p_business_id, 'Employer SSNIT Contribution', '6010', 'expense', 'Employer SSNIT contributions',                  TRUE),
    (p_business_id, 'Interest Expense',            '6300', 'expense', 'Interest on loans and borrowings',              TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;


-- ── 2. Backfill 1110 Staff Advances for existing businesses ──────────────────

INSERT INTO accounts (business_id, name, code, type, description, is_system)
SELECT b.id, 'Staff Advances', '1110', 'asset', 'Salary advances issued to employees', TRUE
FROM businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
  WHERE a.business_id = b.id AND a.code = '1110' AND a.deleted_at IS NULL
);


-- ── 3. Create salary_advances table ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS salary_advances (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID          NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  staff_id          UUID          NOT NULL REFERENCES staff(id),
  amount            NUMERIC(15,2) NOT NULL,
  monthly_repayment NUMERIC(15,2) NOT NULL,
  date_issued       DATE          NOT NULL,
  bank_account_id   UUID          REFERENCES accounts(id),
  journal_entry_id  UUID,
  notes             TEXT,
  created_at        TIMESTAMPTZ   DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salary_advances_business_id ON salary_advances(business_id);
CREATE INDEX IF NOT EXISTS idx_salary_advances_staff_id    ON salary_advances(staff_id);

ALTER TABLE salary_advances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "salary_advances: business members" ON salary_advances;
CREATE POLICY "salary_advances: business members" ON salary_advances
  USING (
    business_id IN (
      SELECT id FROM businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM business_users WHERE user_id = auth.uid()
    )
  );

COMMENT ON TABLE salary_advances IS 'Tracks salary advances issued to employees: amount, monthly repayment, and the disbursement journal entry.';
COMMENT ON COLUMN salary_advances.monthly_repayment IS 'Amount deducted per payroll run to recover the advance.';


-- ── 4. Add advance_id to deductions ──────────────────────────────────────────

ALTER TABLE deductions
  ADD COLUMN IF NOT EXISTS advance_id UUID REFERENCES salary_advances(id);

COMMENT ON COLUMN deductions.advance_id IS 'Links a recurring repayment deduction back to its parent salary_advance record.';
