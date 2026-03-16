-- ============================================================================
-- COMBINED MIGRATION: Reconciliation + Assets + Payroll + VAT Returns
-- Run this file to set up all new features at once
-- ============================================================================

-- ============================================================================
-- MIGRATION 045: Bank/Mobile Money Reconciliation System
-- ============================================================================

-- ADD is_reconcilable FLAG TO ACCOUNTS
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS is_reconcilable BOOLEAN DEFAULT FALSE;

-- Update existing asset accounts to be reconcilable by default
UPDATE accounts
SET is_reconcilable = TRUE
WHERE type = 'asset'
  AND code IN ('1010', '1020') -- Bank and Mobile Money
  AND is_reconcilable IS NULL;

-- BANK_TRANSACTIONS TABLE
CREATE TABLE IF NOT EXISTS bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('debit', 'credit')),
  external_ref TEXT,
  status TEXT DEFAULT 'unreconciled' CHECK (status IN ('unreconciled', 'matched', 'ignored')),
  matches JSONB,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_business_id ON bank_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_id ON bank_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_date ON bank_transactions(date);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_status ON bank_transactions(status);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_external_ref ON bank_transactions(external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bank_transactions_deleted_at ON bank_transactions(deleted_at) WHERE deleted_at IS NULL;

-- RECONCILIATION_PERIODS TABLE
CREATE TABLE IF NOT EXISTS reconciliation_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  opening_balance NUMERIC NOT NULL DEFAULT 0,
  bank_ending_balance NUMERIC,
  system_ending_balance NUMERIC NOT NULL DEFAULT 0,
  difference NUMERIC NOT NULL DEFAULT 0,
  reconciled_by UUID REFERENCES auth.users(id),
  reconciled_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_periods_business_id ON reconciliation_periods(business_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_periods_account_id ON reconciliation_periods(account_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_periods_period ON reconciliation_periods(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_reconciliation_periods_deleted_at ON reconciliation_periods(deleted_at) WHERE deleted_at IS NULL;

-- FUNCTION: Get system transactions for an account
CREATE OR REPLACE FUNCTION get_system_transactions_for_account(
  p_business_id UUID,
  p_account_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  date DATE,
  description TEXT,
  amount NUMERIC,
  type TEXT,
  reference_type TEXT,
  reference_id UUID,
  journal_entry_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    jel.id,
    je.date,
    COALESCE(jel.description, je.description) as description,
    CASE
      WHEN jel.debit > 0 THEN jel.debit
      ELSE jel.credit
    END as amount,
    CASE
      WHEN jel.debit > 0 THEN 'debit'
      ELSE 'credit'
    END as type,
    je.reference_type,
    je.reference_id,
    je.id as journal_entry_id
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  WHERE je.business_id = p_business_id
    AND jel.account_id = p_account_id
    AND (p_start_date IS NULL OR je.date >= p_start_date)
    AND (p_end_date IS NULL OR je.date <= p_end_date)
  ORDER BY je.date ASC, je.created_at ASC;
END;
$$ LANGUAGE plpgsql;

-- FUNCTION: Calculate account balance as of date
CREATE OR REPLACE FUNCTION calculate_account_balance_as_of(
  p_business_id UUID,
  p_account_id UUID,
  p_as_of_date DATE
)
RETURNS NUMERIC AS $$
DECLARE
  account_type TEXT;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  balance NUMERIC := 0;
BEGIN
  SELECT type INTO account_type
  FROM accounts
  WHERE id = p_account_id
    AND business_id = p_business_id;

  IF account_type IS NULL THEN
    RETURN 0;
  END IF;

  SELECT
    COALESCE(SUM(jel.debit), 0),
    COALESCE(SUM(jel.credit), 0)
  INTO total_debit, total_credit
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  WHERE je.business_id = p_business_id
    AND jel.account_id = p_account_id
    AND je.date <= p_as_of_date;

  IF account_type IN ('asset', 'expense') THEN
    balance := total_debit - total_credit;
  ELSE
    balance := total_credit - total_debit;
  END IF;

  RETURN COALESCE(balance, 0);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_bank_transactions_updated_at ON bank_transactions;
CREATE TRIGGER update_bank_transactions_updated_at
  BEFORE UPDATE ON bank_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_reconciliation_periods_updated_at ON reconciliation_periods;
CREATE TRIGGER update_reconciliation_periods_updated_at
  BEFORE UPDATE ON reconciliation_periods
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS for reconciliation
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view bank transactions for their business" ON bank_transactions FOR SELECT USING (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = bank_transactions.business_id AND businesses.owner_id = auth.uid()));
CREATE POLICY "Users can insert bank transactions for their business" ON bank_transactions FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = bank_transactions.business_id AND businesses.owner_id = auth.uid()));
CREATE POLICY "Users can update bank transactions for their business" ON bank_transactions FOR UPDATE USING (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = bank_transactions.business_id AND businesses.owner_id = auth.uid()));
CREATE POLICY "Users can delete bank transactions for their business" ON bank_transactions FOR DELETE USING (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = bank_transactions.business_id AND businesses.owner_id = auth.uid()));

ALTER TABLE reconciliation_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view reconciliation periods for their business" ON reconciliation_periods FOR SELECT USING (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = reconciliation_periods.business_id AND businesses.owner_id = auth.uid()));
CREATE POLICY "Users can insert reconciliation periods for their business" ON reconciliation_periods FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = reconciliation_periods.business_id AND businesses.owner_id = auth.uid()));
CREATE POLICY "Users can update reconciliation periods for their business" ON reconciliation_periods FOR UPDATE USING (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = reconciliation_periods.business_id AND businesses.owner_id = auth.uid()));
CREATE POLICY "Users can delete reconciliation periods for their business" ON reconciliation_periods FOR DELETE USING (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = reconciliation_periods.business_id AND businesses.owner_id = auth.uid()));

-- ============================================================================
-- MIGRATION 046: Asset Register and Depreciation System
-- ============================================================================

-- ASSETS TABLE
CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  asset_code TEXT,
  category TEXT NOT NULL CHECK (category IN ('vehicle', 'equipment', 'furniture', 'electronics', 'tools', 'other')),
  purchase_date DATE NOT NULL,
  purchase_amount NUMERIC NOT NULL DEFAULT 0,
  supplier_name TEXT,
  useful_life_years INTEGER NOT NULL DEFAULT 5,
  depreciation_method TEXT DEFAULT 'straight_line' CHECK (depreciation_method = 'straight_line'),
  salvage_value NUMERIC DEFAULT 0,
  current_value NUMERIC NOT NULL DEFAULT 0,
  accumulated_depreciation NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'disposed')),
  disposal_date DATE,
  disposal_amount NUMERIC,
  disposal_buyer TEXT,
  disposal_notes TEXT,
  notes TEXT,
  attachment_path TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_assets_business_id ON assets(business_id);
CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_asset_code ON assets(asset_code) WHERE asset_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_deleted_at ON assets(deleted_at) WHERE deleted_at IS NULL;

-- DEPRECIATION_ENTRIES TABLE
CREATE TABLE IF NOT EXISTS depreciation_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  amount NUMERIC NOT NULL,
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(asset_id, date)
);

CREATE INDEX IF NOT EXISTS idx_depreciation_entries_asset_id ON depreciation_entries(asset_id);
CREATE INDEX IF NOT EXISTS idx_depreciation_entries_business_id ON depreciation_entries(business_id);
CREATE INDEX IF NOT EXISTS idx_depreciation_entries_date ON depreciation_entries(date);
CREATE INDEX IF NOT EXISTS idx_depreciation_entries_journal_entry_id ON depreciation_entries(journal_entry_id) WHERE journal_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_depreciation_entries_deleted_at ON depreciation_entries(deleted_at) WHERE deleted_at IS NULL;

-- FUNCTION: Generate asset code
CREATE OR REPLACE FUNCTION generate_asset_code(p_business_id UUID)
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
  prefix TEXT := 'AST-';
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(asset_code FROM '[0-9]+$') AS INTEGER)), 0) + 1
  INTO next_num
  FROM assets
  WHERE business_id = p_business_id
    AND asset_code ~ '^AST-[0-9]+$';
  RETURN prefix || LPAD(next_num::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- FUNCTION: Calculate monthly depreciation
CREATE OR REPLACE FUNCTION calculate_monthly_depreciation(
  p_purchase_amount NUMERIC,
  p_salvage_value NUMERIC,
  p_useful_life_years INTEGER
)
RETURNS NUMERIC AS $$
BEGIN
  IF p_useful_life_years <= 0 THEN
    RETURN 0;
  END IF;
  RETURN ROUND((p_purchase_amount - p_salvage_value) / (p_useful_life_years * 12), 2);
END;
$$ LANGUAGE plpgsql;

-- FUNCTION: Post asset purchase to ledger
CREATE OR REPLACE FUNCTION post_asset_purchase_to_ledger(
  p_asset_id UUID,
  p_payment_account_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_business_id UUID;
  v_purchase_amount NUMERIC;
  v_asset_account_id UUID;
  v_payment_account UUID;
  v_journal_entry_id UUID;
BEGIN
  SELECT business_id, purchase_amount
  INTO v_business_id, v_purchase_amount
  FROM assets
  WHERE id = p_asset_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  SELECT id INTO v_asset_account_id
  FROM accounts
  WHERE business_id = v_business_id
    AND code = '1600'
    AND type = 'asset';

  IF v_asset_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Fixed Assets', '1600', 'asset', 'Fixed assets including equipment, vehicles, and property', TRUE)
    RETURNING id INTO v_asset_account_id;
  END IF;

  IF p_payment_account_id IS NOT NULL THEN
    v_payment_account := p_payment_account_id;
  ELSE
    SELECT id INTO v_payment_account
    FROM accounts
    WHERE business_id = v_business_id
      AND code = '1010'
      AND type = 'asset';

    IF v_payment_account IS NULL THEN
      RAISE EXCEPTION 'Cash account (1010) not found';
    END IF;
  END IF;

  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id)
  VALUES (v_business_id, CURRENT_DATE, 'Asset Purchase: ' || (SELECT name FROM assets WHERE id = p_asset_id), 'asset', p_asset_id)
  RETURNING id INTO v_journal_entry_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_asset_account_id, v_purchase_amount, 0, 'Asset Purchase');

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_payment_account, 0, v_purchase_amount, 'Payment for Asset');

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql;

-- FUNCTION: Post depreciation to ledger
CREATE OR REPLACE FUNCTION post_depreciation_to_ledger(
  p_depreciation_entry_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_business_id UUID;
  v_asset_id UUID;
  v_amount NUMERIC;
  v_date DATE;
  v_asset_name TEXT;
  v_depreciation_expense_account_id UUID;
  v_accumulated_depreciation_account_id UUID;
  v_journal_entry_id UUID;
BEGIN
  SELECT de.business_id, de.asset_id, de.amount, de.date, a.name
  INTO v_business_id, v_asset_id, v_amount, v_date, v_asset_name
  FROM depreciation_entries de
  JOIN assets a ON a.id = de.asset_id
  WHERE de.id = p_depreciation_entry_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Depreciation entry not found';
  END IF;

  SELECT id INTO v_depreciation_expense_account_id
  FROM accounts
  WHERE business_id = v_business_id
    AND code = '5700'
    AND type = 'expense';

  IF v_depreciation_expense_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Depreciation Expense', '5700', 'expense', 'Depreciation expense for fixed assets', TRUE)
    RETURNING id INTO v_depreciation_expense_account_id;
  END IF;

  SELECT id INTO v_accumulated_depreciation_account_id
  FROM accounts
  WHERE business_id = v_business_id
    AND code = '1650'
    AND type = 'asset';

  IF v_accumulated_depreciation_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Accumulated Depreciation', '1650', 'asset', 'Accumulated depreciation on fixed assets', TRUE)
    RETURNING id INTO v_accumulated_depreciation_account_id;
  END IF;

  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id)
  VALUES (v_business_id, v_date, 'Depreciation: ' || v_asset_name, 'depreciation', p_depreciation_entry_id)
  RETURNING id INTO v_journal_entry_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_depreciation_expense_account_id, v_amount, 0, 'Depreciation Expense');

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_accumulated_depreciation_account_id, 0, v_amount, 'Accumulated Depreciation');

  UPDATE depreciation_entries
  SET journal_entry_id = v_journal_entry_id
  WHERE id = p_depreciation_entry_id;

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql;

-- FUNCTION: Post asset disposal to ledger
CREATE OR REPLACE FUNCTION post_asset_disposal_to_ledger(
  p_asset_id UUID,
  p_disposal_amount NUMERIC,
  p_payment_account_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_business_id UUID;
  v_purchase_amount NUMERIC;
  v_accumulated_depreciation NUMERIC;
  v_current_value NUMERIC;
  v_asset_account_id UUID;
  v_accumulated_depreciation_account_id UUID;
  v_payment_account UUID;
  v_gain_loss_account_id UUID;
  v_journal_entry_id UUID;
  v_asset_name TEXT;
  v_gain_loss_amount NUMERIC;
  v_is_gain BOOLEAN;
BEGIN
  SELECT business_id, purchase_amount, accumulated_depreciation, current_value, name
  INTO v_business_id, v_purchase_amount, v_accumulated_depreciation, v_current_value, v_asset_name
  FROM assets
  WHERE id = p_asset_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  v_gain_loss_amount := p_disposal_amount - v_current_value;
  v_is_gain := v_gain_loss_amount > 0;

  SELECT id INTO v_asset_account_id
  FROM accounts
  WHERE business_id = v_business_id
    AND code = '1600'
    AND type = 'asset';

  SELECT id INTO v_accumulated_depreciation_account_id
  FROM accounts
  WHERE business_id = v_business_id
    AND code = '1650'
    AND type = 'asset';

  IF p_payment_account_id IS NOT NULL THEN
    v_payment_account := p_payment_account_id;
  ELSE
    SELECT id INTO v_payment_account
    FROM accounts
    WHERE business_id = v_business_id
      AND code = '1010'
      AND type = 'asset';
  END IF;

  IF v_is_gain THEN
    SELECT id INTO v_gain_loss_account_id
    FROM accounts
    WHERE business_id = v_business_id
      AND code = '4200'
      AND type = 'income';

    IF v_gain_loss_account_id IS NULL THEN
      INSERT INTO accounts (business_id, name, code, type, description, is_system)
      VALUES (v_business_id, 'Gain on Asset Disposal', '4200', 'income', 'Gains from disposal of fixed assets', TRUE)
      RETURNING id INTO v_gain_loss_account_id;
    END IF;
  ELSE
    SELECT id INTO v_gain_loss_account_id
    FROM accounts
    WHERE business_id = v_business_id
      AND code = '5800'
      AND type = 'expense';

    IF v_gain_loss_account_id IS NULL THEN
      INSERT INTO accounts (business_id, name, code, type, description, is_system)
      VALUES (v_business_id, 'Loss on Asset Disposal', '5800', 'expense', 'Losses from disposal of fixed assets', TRUE)
      RETURNING id INTO v_gain_loss_account_id;
    END IF;
  END IF;

  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id)
  VALUES (v_business_id, CURRENT_DATE, 'Asset Disposal: ' || v_asset_name, 'asset', p_asset_id)
  RETURNING id INTO v_journal_entry_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_payment_account, p_disposal_amount, 0, 'Proceeds from Asset Disposal');

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_accumulated_depreciation_account_id, 0, v_accumulated_depreciation, 'Remove Accumulated Depreciation');

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_asset_account_id, 0, v_purchase_amount, 'Remove Asset from Books');

  IF v_is_gain THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_journal_entry_id, v_gain_loss_account_id, 0, v_gain_loss_amount, 'Gain on Disposal');
  ELSE
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_journal_entry_id, v_gain_loss_account_id, v_gain_loss_amount, 0, 'Loss on Disposal');
  END IF;

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_assets_updated_at ON assets;
CREATE TRIGGER update_assets_updated_at
  BEFORE UPDATE ON assets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_depreciation_entries_updated_at ON depreciation_entries;
CREATE TRIGGER update_depreciation_entries_updated_at
  BEFORE UPDATE ON depreciation_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS for assets
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view assets for their business" ON assets FOR SELECT USING (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = assets.business_id AND businesses.owner_id = auth.uid()));
CREATE POLICY "Users can insert assets for their business" ON assets FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = assets.business_id AND businesses.owner_id = auth.uid()));
CREATE POLICY "Users can update assets for their business" ON assets FOR UPDATE USING (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = assets.business_id AND businesses.owner_id = auth.uid()));
CREATE POLICY "Users can delete assets for their business" ON assets FOR DELETE USING (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = assets.business_id AND businesses.owner_id = auth.uid()));

ALTER TABLE depreciation_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view depreciation entries for their business" ON depreciation_entries FOR SELECT USING (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = depreciation_entries.business_id AND businesses.owner_id = auth.uid()));
CREATE POLICY "Users can insert depreciation entries for their business" ON depreciation_entries FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = depreciation_entries.business_id AND businesses.owner_id = auth.uid()));
CREATE POLICY "Users can update depreciation entries for their business" ON depreciation_entries FOR UPDATE USING (EXISTS (SELECT 1 FROM businesses WHERE depreciation_entries.business_id = businesses.id AND businesses.owner_id = auth.uid()));
CREATE POLICY "Users can delete depreciation entries for their business" ON depreciation_entries FOR DELETE USING (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = depreciation_entries.business_id AND businesses.owner_id = auth.uid()));

-- ============================================================================
-- MIGRATION 047: Payroll System for Ghana Service Businesses
-- ============================================================================

-- STAFF TABLE
CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position TEXT,
  phone TEXT,
  whatsapp_phone TEXT,
  email TEXT,
  basic_salary NUMERIC NOT NULL DEFAULT 0,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  employment_type TEXT DEFAULT 'full_time' CHECK (employment_type IN ('full_time', 'part_time', 'casual')),
  bank_name TEXT,
  bank_account TEXT,
  ssnit_number TEXT,
  tin_number TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'terminated')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_staff_business_id ON staff(business_id);
CREATE INDEX IF NOT EXISTS idx_staff_status ON staff(status);
CREATE INDEX IF NOT EXISTS idx_staff_deleted_at ON staff(deleted_at) WHERE deleted_at IS NULL;

-- ALLOWANCES TABLE
CREATE TABLE IF NOT EXISTS allowances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('transport', 'housing', 'utility', 'medical', 'bonus', 'other')),
  amount NUMERIC NOT NULL DEFAULT 0,
  recurring BOOLEAN DEFAULT TRUE,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_allowances_staff_id ON allowances(staff_id);
CREATE INDEX IF NOT EXISTS idx_allowances_recurring ON allowances(recurring) WHERE recurring = TRUE;
CREATE INDEX IF NOT EXISTS idx_allowances_deleted_at ON allowances(deleted_at) WHERE deleted_at IS NULL;

-- DEDUCTIONS TABLE
CREATE TABLE IF NOT EXISTS deductions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('loan', 'advance', 'penalty', 'other')),
  amount NUMERIC NOT NULL DEFAULT 0,
  recurring BOOLEAN DEFAULT TRUE,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_deductions_staff_id ON deductions(staff_id);
CREATE INDEX IF NOT EXISTS idx_deductions_recurring ON deductions(recurring) WHERE recurring = TRUE;
CREATE INDEX IF NOT EXISTS idx_deductions_deleted_at ON deductions(deleted_at) WHERE deleted_at IS NULL;

-- PAYROLL_RUNS TABLE
CREATE TABLE IF NOT EXISTS payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  payroll_month DATE NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'locked')),
  total_gross_salary NUMERIC DEFAULT 0,
  total_allowances NUMERIC DEFAULT 0,
  total_deductions NUMERIC DEFAULT 0,
  total_ssnit_employee NUMERIC DEFAULT 0,
  total_ssnit_employer NUMERIC DEFAULT 0,
  total_paye NUMERIC DEFAULT 0,
  total_net_salary NUMERIC DEFAULT 0,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMP WITH TIME ZONE,
  journal_entry_id UUID REFERENCES journal_entries(id),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(business_id, payroll_month)
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_business_id ON payroll_runs(business_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_payroll_month ON payroll_runs(payroll_month);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_status ON payroll_runs(status);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_deleted_at ON payroll_runs(deleted_at) WHERE deleted_at IS NULL;

-- PAYROLL_ENTRIES TABLE
CREATE TABLE IF NOT EXISTS payroll_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  basic_salary NUMERIC NOT NULL DEFAULT 0,
  allowances_total NUMERIC DEFAULT 0,
  deductions_total NUMERIC DEFAULT 0,
  gross_salary NUMERIC NOT NULL DEFAULT 0,
  ssnit_employee NUMERIC DEFAULT 0,
  ssnit_employer NUMERIC DEFAULT 0,
  taxable_income NUMERIC DEFAULT 0,
  paye NUMERIC DEFAULT 0,
  net_salary NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_entries_payroll_run_id ON payroll_entries(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_staff_id ON payroll_entries(staff_id);

-- PAYSLIPS TABLE
CREATE TABLE IF NOT EXISTS payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_entry_id UUID NOT NULL REFERENCES payroll_entries(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  public_token TEXT UNIQUE,
  sent_via_whatsapp BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payslips_payroll_entry_id ON payslips(payroll_entry_id);
CREATE INDEX IF NOT EXISTS idx_payslips_staff_id ON payslips(staff_id);
CREATE INDEX IF NOT EXISTS idx_payslips_payroll_run_id ON payslips(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payslips_public_token ON payslips(public_token) WHERE public_token IS NOT NULL;

-- FUNCTION: Calculate Ghana PAYE Tax
CREATE OR REPLACE FUNCTION calculate_ghana_paye(taxable_income NUMERIC)
RETURNS NUMERIC AS $$
DECLARE
  tax_amount NUMERIC := 0;
BEGIN
  IF taxable_income <= 490 THEN
    tax_amount := 0;
  ELSIF taxable_income <= 650 THEN
    tax_amount := (taxable_income - 490) * 0.05;
  ELSIF taxable_income <= 3850 THEN
    tax_amount := (650 - 490) * 0.05 + (taxable_income - 650) * 0.10;
  ELSIF taxable_income <= 20000 THEN
    tax_amount := (650 - 490) * 0.05 + (3850 - 650) * 0.10 + (taxable_income - 3850) * 0.175;
  ELSIF taxable_income <= 50000 THEN
    tax_amount := (650 - 490) * 0.05 + (3850 - 650) * 0.10 + (20000 - 3850) * 0.175 + (taxable_income - 20000) * 0.25;
  ELSE
    tax_amount := (650 - 490) * 0.05 + (3850 - 650) * 0.10 + (20000 - 3850) * 0.175 + (50000 - 20000) * 0.25 + (taxable_income - 50000) * 0.30;
  END IF;
  RETURN ROUND(tax_amount, 2);
END;
$$ LANGUAGE plpgsql;

-- FUNCTION: Calculate SSNIT Employee Contribution
CREATE OR REPLACE FUNCTION calculate_ssnit_employee(gross_salary NUMERIC)
RETURNS NUMERIC AS $$
BEGIN
  RETURN ROUND(gross_salary * 0.055, 2);
END;
$$ LANGUAGE plpgsql;

-- FUNCTION: Calculate SSNIT Employer Contribution
CREATE OR REPLACE FUNCTION calculate_ssnit_employer(gross_salary NUMERIC)
RETURNS NUMERIC AS $$
BEGIN
  RETURN ROUND(gross_salary * 0.13, 2);
END;
$$ LANGUAGE plpgsql;

-- FUNCTION: Post payroll to ledger
CREATE OR REPLACE FUNCTION post_payroll_to_ledger(p_payroll_run_id UUID)
RETURNS UUID AS $$
DECLARE
  v_business_id UUID;
  v_total_gross NUMERIC;
  v_total_allowances NUMERIC;
  v_total_ssnit_employee NUMERIC;
  v_total_ssnit_employer NUMERIC;
  v_total_paye NUMERIC;
  v_total_net NUMERIC;
  v_payroll_expense_account_id UUID;
  v_ssnit_employer_expense_account_id UUID;
  v_paye_liability_account_id UUID;
  v_ssnit_employee_liability_account_id UUID;
  v_ssnit_employer_liability_account_id UUID;
  v_net_salaries_payable_account_id UUID;
  v_journal_entry_id UUID;
  v_payroll_month DATE;
BEGIN
  SELECT business_id, total_gross_salary, total_allowances, total_ssnit_employee, 
         total_ssnit_employer, total_paye, total_net_salary, payroll_month
  INTO v_business_id, v_total_gross, v_total_allowances, v_total_ssnit_employee,
       v_total_ssnit_employer, v_total_paye, v_total_net, v_payroll_month
  FROM payroll_runs
  WHERE id = p_payroll_run_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Payroll run not found';
  END IF;

  SELECT id INTO v_payroll_expense_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '6000' AND type = 'expense';

  IF v_payroll_expense_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Payroll Expense', '6000', 'expense', 'Employee salaries and wages', TRUE)
    RETURNING id INTO v_payroll_expense_account_id;
  END IF;

  SELECT id INTO v_ssnit_employer_expense_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '6010' AND type = 'expense';

  IF v_ssnit_employer_expense_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Employer SSNIT Contribution', '6010', 'expense', 'Employer SSNIT contributions', TRUE)
    RETURNING id INTO v_ssnit_employer_expense_account_id;
  END IF;

  SELECT id INTO v_paye_liability_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '2210' AND type = 'liability';

  IF v_paye_liability_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'PAYE Liability', '2210', 'liability', 'PAYE tax payable to GRA', TRUE)
    RETURNING id INTO v_paye_liability_account_id;
  END IF;

  SELECT id INTO v_ssnit_employee_liability_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '2220' AND type = 'liability';

  IF v_ssnit_employee_liability_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'SSNIT Employee Contribution Payable', '2220', 'liability', 'SSNIT employee contributions payable', TRUE)
    RETURNING id INTO v_ssnit_employee_liability_account_id;
  END IF;

  SELECT id INTO v_ssnit_employer_liability_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '2230' AND type = 'liability';

  IF v_ssnit_employer_liability_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'SSNIT Employer Contribution Payable', '2230', 'liability', 'SSNIT employer contributions payable', TRUE)
    RETURNING id INTO v_ssnit_employer_liability_account_id;
  END IF;

  SELECT id INTO v_net_salaries_payable_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '2240' AND type = 'liability';

  IF v_net_salaries_payable_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Net Salaries Payable', '2240', 'liability', 'Net salaries payable to employees', TRUE)
    RETURNING id INTO v_net_salaries_payable_account_id;
  END IF;

  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id)
  VALUES (v_business_id, v_payroll_month, 'Payroll Run: ' || TO_CHAR(v_payroll_month, 'Month YYYY'), 'payroll', p_payroll_run_id)
  RETURNING id INTO v_journal_entry_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_payroll_expense_account_id, v_total_gross + v_total_allowances, 0, 'Gross Salaries and Allowances');

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_ssnit_employer_expense_account_id, v_total_ssnit_employer, 0, 'Employer SSNIT Contribution');

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_paye_liability_account_id, 0, v_total_paye, 'PAYE Tax Payable');

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_ssnit_employee_liability_account_id, 0, v_total_ssnit_employee, 'SSNIT Employee Contribution Payable');

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_ssnit_employer_liability_account_id, 0, v_total_ssnit_employer, 'SSNIT Employer Contribution Payable');

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_net_salaries_payable_account_id, 0, v_total_net, 'Net Salaries Payable');

  UPDATE payroll_runs
  SET journal_entry_id = v_journal_entry_id
  WHERE id = p_payroll_run_id;

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql;

-- FUNCTION: Generate public token for payslip
CREATE OR REPLACE FUNCTION generate_payslip_token()
RETURNS TEXT AS $$
BEGIN
  RETURN encode(gen_random_bytes(32), 'base64url');
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_staff_updated_at ON staff;
CREATE TRIGGER update_staff_updated_at
  BEFORE UPDATE ON staff
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_allowances_updated_at ON allowances;
CREATE TRIGGER update_allowances_updated_at
  BEFORE UPDATE ON allowances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_deductions_updated_at ON deductions;
CREATE TRIGGER update_deductions_updated_at
  BEFORE UPDATE ON deductions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_payroll_runs_updated_at ON payroll_runs;
CREATE TRIGGER update_payroll_runs_updated_at
  BEFORE UPDATE ON payroll_runs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_payslips_updated_at ON payslips;
CREATE TRIGGER update_payslips_updated_at
  BEFORE UPDATE ON payslips
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS for payroll
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view staff for their business" ON staff FOR SELECT USING (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = staff.business_id AND businesses.owner_id = auth.uid()));
CREATE POLICY "Users can insert staff for their business" ON staff FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = staff.business_id AND businesses.owner_id = auth.uid()));
CREATE POLICY "Users can update staff for their business" ON staff FOR UPDATE USING (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = staff.business_id AND businesses.owner_id = auth.uid()));
CREATE POLICY "Users can delete staff for their business" ON staff FOR DELETE USING (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = staff.business_id AND businesses.owner_id = auth.uid()));

ALTER TABLE allowances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage allowances for their business staff" ON allowances FOR ALL USING (EXISTS (SELECT 1 FROM staff s JOIN businesses b ON b.id = s.business_id WHERE s.id = allowances.staff_id AND b.owner_id = auth.uid()));

ALTER TABLE deductions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage deductions for their business staff" ON deductions FOR ALL USING (EXISTS (SELECT 1 FROM staff s JOIN businesses b ON b.id = s.business_id WHERE s.id = deductions.staff_id AND b.owner_id = auth.uid()));

ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view payroll runs for their business" ON payroll_runs FOR SELECT USING (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = payroll_runs.business_id AND businesses.owner_id = auth.uid()));
CREATE POLICY "Users can insert payroll runs for their business" ON payroll_runs FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = payroll_runs.business_id AND businesses.owner_id = auth.uid()));
CREATE POLICY "Users can update payroll runs for their business" ON payroll_runs FOR UPDATE USING (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = payroll_runs.business_id AND businesses.owner_id = auth.uid()));

ALTER TABLE payroll_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view payroll entries for their business" ON payroll_entries FOR SELECT USING (EXISTS (SELECT 1 FROM payroll_runs pr JOIN businesses b ON b.id = pr.business_id WHERE pr.id = payroll_entries.payroll_run_id AND b.owner_id = auth.uid()));
CREATE POLICY "Users can insert payroll entries for their business" ON payroll_entries FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM payroll_runs pr JOIN businesses b ON b.id = pr.business_id WHERE pr.id = payroll_entries.payroll_run_id AND b.owner_id = auth.uid()));

ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view payslips for their business" ON payslips FOR SELECT USING (EXISTS (SELECT 1 FROM payroll_runs pr JOIN businesses b ON b.id = pr.business_id WHERE pr.id = payslips.payroll_run_id AND b.owner_id = auth.uid()));
CREATE POLICY "Public can view payslips by token" ON payslips FOR SELECT USING (public_token IS NOT NULL);
CREATE POLICY "Users can insert payslips for their business" ON payslips FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM payroll_runs pr JOIN businesses b ON b.id = pr.business_id WHERE pr.id = payslips.payroll_run_id AND b.owner_id = auth.uid()));

-- ============================================================================
-- MIGRATION 048: VAT Return Filing System for Ghana
-- ============================================================================

-- VAT_RETURNS TABLE
CREATE TABLE IF NOT EXISTS vat_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_start_date DATE NOT NULL,
  period_end_date DATE NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'paid')),
  
  total_taxable_sales NUMERIC DEFAULT 0,
  total_output_nhil NUMERIC DEFAULT 0,
  total_output_getfund NUMERIC DEFAULT 0,
  total_output_covid NUMERIC DEFAULT 0,
  total_output_vat NUMERIC DEFAULT 0,
  total_output_tax NUMERIC DEFAULT 0,
  
  total_taxable_purchases NUMERIC DEFAULT 0,
  total_input_nhil NUMERIC DEFAULT 0,
  total_input_getfund NUMERIC DEFAULT 0,
  total_input_covid NUMERIC DEFAULT 0,
  total_input_vat NUMERIC DEFAULT 0,
  total_input_tax NUMERIC DEFAULT 0,
  
  net_vat_payable NUMERIC DEFAULT 0,
  net_vat_refund NUMERIC DEFAULT 0,
  
  output_adjustment NUMERIC DEFAULT 0,
  input_adjustment NUMERIC DEFAULT 0,
  adjustment_reason TEXT,
  
  submission_date DATE,
  payment_date DATE,
  payment_reference TEXT,
  notes TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  
  UNIQUE(business_id, period_start_date, period_end_date)
);

CREATE INDEX IF NOT EXISTS idx_vat_returns_business_id ON vat_returns(business_id);
CREATE INDEX IF NOT EXISTS idx_vat_returns_period ON vat_returns(period_start_date, period_end_date);
CREATE INDEX IF NOT EXISTS idx_vat_returns_status ON vat_returns(status);
CREATE INDEX IF NOT EXISTS idx_vat_returns_deleted_at ON vat_returns(deleted_at) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS update_vat_returns_updated_at ON vat_returns;
CREATE TRIGGER update_vat_returns_updated_at
  BEFORE UPDATE ON vat_returns
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS for VAT returns
ALTER TABLE vat_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view VAT returns for their business" ON vat_returns FOR SELECT USING (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = vat_returns.business_id AND businesses.owner_id = auth.uid()));
CREATE POLICY "Users can insert VAT returns for their business" ON vat_returns FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = vat_returns.business_id AND businesses.owner_id = auth.uid()));
CREATE POLICY "Users can update VAT returns for their business" ON vat_returns FOR UPDATE USING (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = vat_returns.business_id AND businesses.owner_id = auth.uid()));
CREATE POLICY "Users can delete VAT returns for their business" ON vat_returns FOR DELETE USING (EXISTS (SELECT 1 FROM businesses WHERE businesses.id = vat_returns.business_id AND businesses.owner_id = auth.uid()));


