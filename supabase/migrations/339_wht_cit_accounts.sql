-- Migration 339: Withholding Tax (WHT) and Corporate Income Tax (CIT)
-- Adds system accounts, WHT rates, remittance tracking, and CIT provisions

-- ============================================================================
-- 1. NEW SYSTEM ACCOUNTS
-- ============================================================================

-- Add WHT Payable, WHT Receivable, CIT Payable, and Income Tax Expense
-- to every existing business (and to the create_system_accounts function)

-- Patch all existing businesses with the new system accounts
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM businesses LOOP
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES
      (r.id, 'WHT Payable',          '2150', 'liability', 'Withholding tax withheld from suppliers, payable to GRA',      TRUE),
      (r.id, 'WHT Receivable',       '2155', 'asset',     'Withholding tax deducted from your payments by customers',     TRUE),
      (r.id, 'CIT Payable',          '2160', 'liability', 'Corporate Income Tax provision payable to GRA',                TRUE),
      (r.id, 'Income Tax Expense',   '9000', 'expense',   'Corporate income tax charged to the period',                   TRUE)
    ON CONFLICT (business_id, code) DO NOTHING;
  END LOOP;
END;
$$;

-- Update create_system_accounts to include new accounts for future businesses
CREATE OR REPLACE FUNCTION create_system_accounts(p_business_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Assets
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Cash',                                '1000', 'asset',     'Cash on hand',                                                        TRUE),
    (p_business_id, 'Bank',                                '1010', 'asset',     'Bank account',                                                        TRUE),
    (p_business_id, 'Mobile Money',                        '1020', 'asset',     'Mobile money accounts',                                               TRUE),
    (p_business_id, 'Accounts Receivable',                 '1100', 'asset',     'Amounts owed by customers',                                           TRUE),
    (p_business_id, 'Inventory',                           '1200', 'asset',     'Stock and inventory',                                                 TRUE),
    (p_business_id, 'WHT Receivable',                      '2155', 'asset',     'Withholding tax deducted from your payments by customers',            TRUE),
    (p_business_id, 'Fixed Assets',                        '1600', 'asset',     'Fixed assets including equipment, vehicles, and property',            TRUE),
    (p_business_id, 'Accumulated Depreciation',            '1650', 'asset',     'Accumulated depreciation on fixed assets',                            TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Liabilities
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Accounts Payable',                    '2000', 'liability', 'Amounts owed to suppliers',                                           TRUE),
    (p_business_id, 'VAT Payable',                         '2100', 'liability', 'VAT output tax minus input tax',                                      TRUE),
    (p_business_id, 'NHIL Payable',                        '2110', 'liability', 'NHIL output tax minus input tax',                                     TRUE),
    (p_business_id, 'GETFund Payable',                     '2120', 'liability', 'GETFund output tax minus input tax',                                  TRUE),
    (p_business_id, 'COVID Levy Payable',                  '2130', 'liability', 'COVID-19 Health Recovery Levy output tax minus input tax',            TRUE),
    (p_business_id, 'WHT Payable',                         '2150', 'liability', 'Withholding tax withheld from suppliers, payable to GRA',             TRUE),
    (p_business_id, 'CIT Payable',                         '2160', 'liability', 'Corporate Income Tax provision payable to GRA',                       TRUE),
    (p_business_id, 'Other Tax Liabilities',               '2200', 'liability', 'Other tax obligations',                                               TRUE),
    (p_business_id, 'PAYE Liability',                      '2210', 'liability', 'PAYE tax payable to GRA',                                             TRUE),
    (p_business_id, 'SSNIT Employee Contribution Payable', '2220', 'liability', 'SSNIT employee contributions payable',                                TRUE),
    (p_business_id, 'SSNIT Employer Contribution Payable', '2230', 'liability', 'SSNIT employer contributions payable',                                TRUE),
    (p_business_id, 'Net Salaries Payable',                '2240', 'liability', 'Net salaries payable to employees',                                   TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Equity
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Owner''s Equity',                     '3000', 'equity',    'Owner investment',                                                    TRUE),
    (p_business_id, 'Retained Earnings',                   '3100', 'equity',    'Accumulated profits',                                                 TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Income
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Service Revenue',                     '4000', 'income',    'Revenue from services',                                               TRUE),
    (p_business_id, 'Gain on Asset Disposal',              '4200', 'income',    'Gains from disposal of fixed assets',                                 TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Expenses
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Cost of Sales',                       '5000', 'expense',   'Direct costs',                                                        TRUE),
    (p_business_id, 'Operating Expenses',                  '5100', 'expense',   'General operating expenses',                                          TRUE),
    (p_business_id, 'Supplier Bills',                      '5200', 'expense',   'Supplier invoices',                                                   TRUE),
    (p_business_id, 'Administrative Expenses',             '5300', 'expense',   'Admin and overhead',                                                  TRUE),
    (p_business_id, 'Depreciation Expense',                '5700', 'expense',   'Depreciation expense for fixed assets',                               TRUE),
    (p_business_id, 'Loss on Asset Disposal',              '5800', 'expense',   'Losses from disposal of fixed assets',                                TRUE),
    (p_business_id, 'Payroll Expense',                     '6000', 'expense',   'Employee salaries and wages',                                         TRUE),
    (p_business_id, 'Employer SSNIT Contribution',         '6010', 'expense',   'Employer SSNIT contributions',                                        TRUE),
    (p_business_id, 'Rounding Adjustment',                 '7990', 'expense',   'Rounding adjustments for tax calculations',                           TRUE),
    (p_business_id, 'Income Tax Expense',                  '9000', 'expense',   'Corporate income tax charged to the period',                          TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 2. WHT RATES TABLE (system-wide, not per-business)
-- ============================================================================

CREATE TABLE IF NOT EXISTS wht_rates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,         -- e.g. 'GH_SVC_5', 'GH_RENT_10'
  name          TEXT NOT NULL,                -- Human label: "Services (Resident) 5%"
  rate          NUMERIC(6,4) NOT NULL,        -- 0.05 = 5%
  description   TEXT,
  jurisdiction  TEXT NOT NULL DEFAULT 'GH',
  effective_from DATE NOT NULL DEFAULT '2000-01-01',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed Ghana WHT rates (GRA-authorised 2024)
INSERT INTO wht_rates (code, name, rate, description, jurisdiction, effective_from) VALUES
  ('GH_SVC_5',    'Services – Resident (5%)',                 0.05, 'Payments for services rendered by a resident person',                 'GH', '2000-01-01'),
  ('GH_GOODS_3',  'Supply of Goods – Resident (3%)',          0.03, 'Payments for supply of goods by a resident person',                  'GH', '2000-01-01'),
  ('GH_RENT_8',   'Rent (8%)',                                0.08, 'Rental payments for the use of property',                           'GH', '2000-01-01'),
  ('GH_MGMT_20',  'Management / Technical Fees (20%)',        0.20, 'Fees paid to non-residents for management or technical services',    'GH', '2000-01-01'),
  ('GH_INT_8',    'Interest (8%)',                            0.08, 'Interest payments to residents',                                    'GH', '2000-01-01'),
  ('GH_DIV_8',    'Dividends (8%)',                           0.08, 'Dividend payments to residents',                                    'GH', '2000-01-01'),
  ('GH_NR_20',    'Non-Resident Payments (20%)',              0.20, 'Payments to non-resident persons (general)',                        'GH', '2000-01-01')
ON CONFLICT (code) DO NOTHING;


-- ============================================================================
-- 3. ADD WHT COLUMNS TO BILLS
-- ============================================================================

ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS wht_applicable     BOOLEAN       DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS wht_rate_code      TEXT          REFERENCES wht_rates(code),
  ADD COLUMN IF NOT EXISTS wht_rate           NUMERIC(6,4),     -- snapshot of rate at time of creation
  ADD COLUMN IF NOT EXISTS wht_amount         NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wht_remitted_at    TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS wht_remittance_ref TEXT;


-- ============================================================================
-- 4. ADD WHT RECEIVABLE COLUMNS TO INVOICES
--    (when a customer withholds WHT on payment to you)
-- ============================================================================

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS wht_receivable_applicable  BOOLEAN       DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS wht_receivable_rate         NUMERIC(6,4),
  ADD COLUMN IF NOT EXISTS wht_receivable_amount       NUMERIC(12,2) DEFAULT 0;


-- ============================================================================
-- 5. WHT REMITTANCES TABLE
--    Records when you have remitted WHT to GRA (may cover multiple bills)
-- ============================================================================

CREATE TABLE IF NOT EXISTS wht_remittances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  remittance_date DATE NOT NULL,
  amount          NUMERIC(12,2) NOT NULL,
  reference       TEXT,                           -- GRA receipt / transaction ref
  notes           TEXT,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by      UUID REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS wht_remittance_bills (
  remittance_id   UUID NOT NULL REFERENCES wht_remittances(id) ON DELETE CASCADE,
  bill_id         UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  wht_amount      NUMERIC(12,2) NOT NULL,
  PRIMARY KEY (remittance_id, bill_id)
);

CREATE INDEX IF NOT EXISTS idx_wht_remittances_business_id ON wht_remittances(business_id);
CREATE INDEX IF NOT EXISTS idx_wht_remittance_bills_bill_id ON wht_remittance_bills(bill_id);


-- ============================================================================
-- 6. CIT PROVISIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS cit_provisions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_label      TEXT NOT NULL,               -- e.g. "Q1 2026", "FY 2025"
  provision_type    TEXT NOT NULL DEFAULT 'quarterly'
                    CHECK (provision_type IN ('quarterly', 'annual', 'final')),
  chargeable_income NUMERIC(15,2) NOT NULL DEFAULT 0,
  cit_rate          NUMERIC(6,4)  NOT NULL DEFAULT 0.25,   -- 25%
  cit_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'posted', 'paid')),
  journal_entry_id  UUID REFERENCES journal_entries(id),
  paid_at           TIMESTAMP WITH TIME ZONE,
  paid_amount       NUMERIC(12,2),
  payment_ref       TEXT,
  notes             TEXT,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by        UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_cit_provisions_business_id ON cit_provisions(business_id);


-- ============================================================================
-- 7. RLS POLICIES
-- ============================================================================

-- wht_rates: readable by all authenticated users (system-wide)
ALTER TABLE wht_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wht_rates_select_all" ON wht_rates FOR SELECT USING (TRUE);

-- wht_remittances
ALTER TABLE wht_remittances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wht_remittances_business_access" ON wht_remittances
  FOR ALL USING (
    business_id IN (
      SELECT business_id FROM business_users WHERE user_id = auth.uid()
    )
  );

-- wht_remittance_bills
ALTER TABLE wht_remittance_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wht_remittance_bills_access" ON wht_remittance_bills
  FOR ALL USING (
    remittance_id IN (
      SELECT id FROM wht_remittances WHERE business_id IN (
        SELECT business_id FROM business_users WHERE user_id = auth.uid()
      )
    )
  );

-- cit_provisions
ALTER TABLE cit_provisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cit_provisions_business_access" ON cit_provisions
  FOR ALL USING (
    business_id IN (
      SELECT business_id FROM business_users WHERE user_id = auth.uid()
    )
  );


-- ============================================================================
-- 8. POST WHT REMITTANCE TO LEDGER
--    Dr WHT Payable 2150 / Cr Cash/Bank 1000|1010
-- ============================================================================

CREATE OR REPLACE FUNCTION post_wht_remittance_to_ledger(
  p_remittance_id UUID,
  p_payment_account_code TEXT DEFAULT '1010'   -- default: Bank
)
RETURNS UUID AS $$
DECLARE
  v_remittance    wht_remittances%ROWTYPE;
  v_business_id   UUID;
  v_je_id         UUID;
  v_wht_acc_id    UUID;
  v_cash_acc_id   UUID;
BEGIN
  SELECT * INTO v_remittance FROM wht_remittances WHERE id = p_remittance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WHT remittance % not found', p_remittance_id;
  END IF;

  v_business_id := v_remittance.business_id;

  -- Resolve account IDs
  SELECT id INTO v_wht_acc_id  FROM accounts WHERE business_id = v_business_id AND code = '2150' AND deleted_at IS NULL;
  SELECT id INTO v_cash_acc_id FROM accounts WHERE business_id = v_business_id AND code = p_payment_account_code AND deleted_at IS NULL;

  IF v_wht_acc_id IS NULL THEN
    RAISE EXCEPTION 'WHT Payable account (2150) not found for business %', v_business_id;
  END IF;
  IF v_cash_acc_id IS NULL THEN
    RAISE EXCEPTION 'Payment account (%) not found for business %', p_payment_account_code, v_business_id;
  END IF;

  -- Create journal entry
  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id)
  VALUES (
    v_business_id,
    v_remittance.remittance_date,
    'WHT Remittance to GRA' || COALESCE(' – ' || v_remittance.reference, ''),
    'wht_remittance',
    p_remittance_id
  )
  RETURNING id INTO v_je_id;

  -- Dr WHT Payable (reduces liability)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_wht_acc_id, v_remittance.amount, 0, 'WHT remitted to GRA');

  -- Cr Cash/Bank
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_cash_acc_id, 0, v_remittance.amount, 'Payment to GRA for WHT');

  -- Link journal entry back to remittance
  UPDATE wht_remittances SET journal_entry_id = v_je_id WHERE id = p_remittance_id;

  RETURN v_je_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- 9. POST CIT PROVISION TO LEDGER
--    Dr Income Tax Expense 9000 / Cr CIT Payable 2160
-- ============================================================================

CREATE OR REPLACE FUNCTION post_cit_provision_to_ledger(p_provision_id UUID)
RETURNS UUID AS $$
DECLARE
  v_prov        cit_provisions%ROWTYPE;
  v_je_id       UUID;
  v_tax_exp_id  UUID;
  v_cit_pay_id  UUID;
BEGIN
  SELECT * INTO v_prov FROM cit_provisions WHERE id = p_provision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CIT provision % not found', p_provision_id;
  END IF;

  IF v_prov.status != 'draft' THEN
    RAISE EXCEPTION 'CIT provision % is already posted or paid', p_provision_id;
  END IF;

  SELECT id INTO v_tax_exp_id FROM accounts WHERE business_id = v_prov.business_id AND code = '9000' AND deleted_at IS NULL;
  SELECT id INTO v_cit_pay_id FROM accounts WHERE business_id = v_prov.business_id AND code = '2160' AND deleted_at IS NULL;

  IF v_tax_exp_id IS NULL THEN RAISE EXCEPTION 'Income Tax Expense account (9000) not found'; END IF;
  IF v_cit_pay_id IS NULL THEN RAISE EXCEPTION 'CIT Payable account (2160) not found'; END IF;

  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id)
  VALUES (
    v_prov.business_id,
    CURRENT_DATE,
    'CIT Provision – ' || v_prov.period_label,
    'cit_provision',
    p_provision_id
  )
  RETURNING id INTO v_je_id;

  -- Dr Income Tax Expense
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_tax_exp_id, v_prov.cit_amount, 0, 'Corporate income tax – ' || v_prov.period_label);

  -- Cr CIT Payable
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_cit_pay_id, 0, v_prov.cit_amount, 'CIT liability – ' || v_prov.period_label);

  UPDATE cit_provisions
    SET status = 'posted', journal_entry_id = v_je_id
  WHERE id = p_provision_id;

  RETURN v_je_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
