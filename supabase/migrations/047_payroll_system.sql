-- Migration: Payroll System for Ghana Service Businesses
-- Implements staff management, PAYE tax, SSNIT, and payroll processing

-- ============================================================================
-- STAFF TABLE
-- ============================================================================
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

-- Indexes for staff
CREATE INDEX IF NOT EXISTS idx_staff_business_id ON staff(business_id);
CREATE INDEX IF NOT EXISTS idx_staff_status ON staff(status);
CREATE INDEX IF NOT EXISTS idx_staff_deleted_at ON staff(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- ALLOWANCES TABLE
-- ============================================================================
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

-- Indexes for allowances
CREATE INDEX IF NOT EXISTS idx_allowances_staff_id ON allowances(staff_id);
CREATE INDEX IF NOT EXISTS idx_allowances_recurring ON allowances(recurring) WHERE recurring = TRUE;
CREATE INDEX IF NOT EXISTS idx_allowances_deleted_at ON allowances(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- DEDUCTIONS TABLE
-- ============================================================================
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

-- Indexes for deductions
CREATE INDEX IF NOT EXISTS idx_deductions_staff_id ON deductions(staff_id);
CREATE INDEX IF NOT EXISTS idx_deductions_recurring ON deductions(recurring) WHERE recurring = TRUE;
CREATE INDEX IF NOT EXISTS idx_deductions_deleted_at ON deductions(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- PAYROLL_RUNS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  payroll_month DATE NOT NULL, -- First day of the month
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
  UNIQUE(business_id, payroll_month) -- One payroll run per month per business
);

-- Indexes for payroll_runs
CREATE INDEX IF NOT EXISTS idx_payroll_runs_business_id ON payroll_runs(business_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_payroll_month ON payroll_runs(payroll_month);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_status ON payroll_runs(status);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_deleted_at ON payroll_runs(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- PAYROLL_ENTRIES TABLE
-- ============================================================================
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

-- Indexes for payroll_entries
CREATE INDEX IF NOT EXISTS idx_payroll_entries_payroll_run_id ON payroll_entries(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_staff_id ON payroll_entries(staff_id);

-- ============================================================================
-- PAYSLIPS TABLE
-- ============================================================================
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

-- Indexes for payslips
CREATE INDEX IF NOT EXISTS idx_payslips_payroll_entry_id ON payslips(payroll_entry_id);
CREATE INDEX IF NOT EXISTS idx_payslips_staff_id ON payslips(staff_id);
CREATE INDEX IF NOT EXISTS idx_payslips_payroll_run_id ON payslips(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payslips_public_token ON payslips(public_token) WHERE public_token IS NOT NULL;

-- ============================================================================
-- FUNCTION: Calculate Ghana PAYE Tax
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_ghana_paye(taxable_income NUMERIC)
RETURNS NUMERIC AS $$
DECLARE
  tax_amount NUMERIC := 0;
BEGIN
  -- GRA PAYE Tax Bands (Monthly)
  -- 0 – 490: 0%
  -- 491 – 650: 5%
  -- 651 – 3850: 10%
  -- 3851 – 20000: 17.5%
  -- 20001 – 50000: 25%
  -- 50000+: 30%

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

-- ============================================================================
-- FUNCTION: Calculate SSNIT Employee Contribution
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_ssnit_employee(gross_salary NUMERIC)
RETURNS NUMERIC AS $$
BEGIN
  -- Employee SSNIT = 5.5% of gross salary
  RETURN ROUND(gross_salary * 0.055, 2);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Calculate SSNIT Employer Contribution
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_ssnit_employer(gross_salary NUMERIC)
RETURNS NUMERIC AS $$
BEGIN
  -- Employer SSNIT = 13% of gross salary
  RETURN ROUND(gross_salary * 0.13, 2);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Post payroll to ledger
-- ============================================================================
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
  -- Get payroll run details
  SELECT business_id, total_gross_salary, total_allowances, total_ssnit_employee, 
         total_ssnit_employer, total_paye, total_net_salary, payroll_month
  INTO v_business_id, v_total_gross, v_total_allowances, v_total_ssnit_employee,
       v_total_ssnit_employer, v_total_paye, v_total_net, v_payroll_month
  FROM payroll_runs
  WHERE id = p_payroll_run_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Payroll run not found';
  END IF;

  -- Get or create accounts
  -- Payroll Expense (6000)
  SELECT id INTO v_payroll_expense_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '6000' AND type = 'expense';

  IF v_payroll_expense_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Payroll Expense', '6000', 'expense', 'Employee salaries and wages', TRUE)
    RETURNING id INTO v_payroll_expense_account_id;
  END IF;

  -- Employer SSNIT Expense (6010)
  SELECT id INTO v_ssnit_employer_expense_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '6010' AND type = 'expense';

  IF v_ssnit_employer_expense_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Employer SSNIT Contribution', '6010', 'expense', 'Employer SSNIT contributions', TRUE)
    RETURNING id INTO v_ssnit_employer_expense_account_id;
  END IF;

  -- PAYE Liability (2210)
  SELECT id INTO v_paye_liability_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '2210' AND type = 'liability';

  IF v_paye_liability_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'PAYE Liability', '2210', 'liability', 'PAYE tax payable to GRA', TRUE)
    RETURNING id INTO v_paye_liability_account_id;
  END IF;

  -- SSNIT Employee Liability (2220)
  SELECT id INTO v_ssnit_employee_liability_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '2220' AND type = 'liability';

  IF v_ssnit_employee_liability_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'SSNIT Employee Contribution Payable', '2220', 'liability', 'SSNIT employee contributions payable', TRUE)
    RETURNING id INTO v_ssnit_employee_liability_account_id;
  END IF;

  -- SSNIT Employer Liability (2230)
  SELECT id INTO v_ssnit_employer_liability_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '2230' AND type = 'liability';

  IF v_ssnit_employer_liability_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'SSNIT Employer Contribution Payable', '2230', 'liability', 'SSNIT employer contributions payable', TRUE)
    RETURNING id INTO v_ssnit_employer_liability_account_id;
  END IF;

  -- Net Salaries Payable (2240)
  SELECT id INTO v_net_salaries_payable_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '2240' AND type = 'liability';

  IF v_net_salaries_payable_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Net Salaries Payable', '2240', 'liability', 'Net salaries payable to employees', TRUE)
    RETURNING id INTO v_net_salaries_payable_account_id;
  END IF;

  -- Create journal entry
  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id)
  VALUES (v_business_id, v_payroll_month, 'Payroll Run: ' || TO_CHAR(v_payroll_month, 'Month YYYY'), 'payroll', p_payroll_run_id)
  RETURNING id INTO v_journal_entry_id;

  -- Debit Payroll Expense (gross salary + allowances)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_payroll_expense_account_id, v_total_gross + v_total_allowances, 0, 'Gross Salaries and Allowances');

  -- Debit Employer SSNIT Expense
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_ssnit_employer_expense_account_id, v_total_ssnit_employer, 0, 'Employer SSNIT Contribution');

  -- Credit PAYE Liability
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_paye_liability_account_id, 0, v_total_paye, 'PAYE Tax Payable');

  -- Credit SSNIT Employee Liability
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_ssnit_employee_liability_account_id, 0, v_total_ssnit_employee, 'SSNIT Employee Contribution Payable');

  -- Credit SSNIT Employer Liability
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_ssnit_employer_liability_account_id, 0, v_total_ssnit_employer, 'SSNIT Employer Contribution Payable');

  -- Credit Net Salaries Payable
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_net_salaries_payable_account_id, 0, v_total_net, 'Net Salaries Payable');

  -- Update payroll run with journal entry ID
  UPDATE payroll_runs
  SET journal_entry_id = v_journal_entry_id
  WHERE id = p_payroll_run_id;

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Generate public token for payslip
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_payslip_token()
RETURNS TEXT AS $$
BEGIN
  RETURN encode(gen_random_bytes(32), 'base64url');
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- AUTO-UPDATE updated_at
-- ============================================================================
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

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on staff
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view staff for their business"
  ON staff FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = staff.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert staff for their business"
  ON staff FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = staff.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update staff for their business"
  ON staff FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = staff.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete staff for their business"
  ON staff FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = staff.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- Enable RLS on allowances
ALTER TABLE allowances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage allowances for their business staff"
  ON allowances FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM staff s
      JOIN businesses b ON b.id = s.business_id
      WHERE s.id = allowances.staff_id
        AND b.owner_id = auth.uid()
    )
  );

-- Enable RLS on deductions
ALTER TABLE deductions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage deductions for their business staff"
  ON deductions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM staff s
      JOIN businesses b ON b.id = s.business_id
      WHERE s.id = deductions.staff_id
        AND b.owner_id = auth.uid()
    )
  );

-- Enable RLS on payroll_runs
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view payroll runs for their business"
  ON payroll_runs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = payroll_runs.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert payroll runs for their business"
  ON payroll_runs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = payroll_runs.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update payroll runs for their business"
  ON payroll_runs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = payroll_runs.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- Enable RLS on payroll_entries
ALTER TABLE payroll_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view payroll entries for their business"
  ON payroll_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM payroll_runs pr
      JOIN businesses b ON b.id = pr.business_id
      WHERE pr.id = payroll_entries.payroll_run_id
        AND b.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert payroll entries for their business"
  ON payroll_entries FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM payroll_runs pr
      JOIN businesses b ON b.id = pr.business_id
      WHERE pr.id = payroll_entries.payroll_run_id
        AND b.owner_id = auth.uid()
    )
  );

-- Enable RLS on payslips
ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view payslips for their business"
  ON payslips FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM payroll_runs pr
      JOIN businesses b ON b.id = pr.business_id
      WHERE pr.id = payslips.payroll_run_id
        AND b.owner_id = auth.uid()
    )
  );

CREATE POLICY "Public can view payslips by token"
  ON payslips FOR SELECT
  USING (public_token IS NOT NULL);

CREATE POLICY "Users can insert payslips for their business"
  ON payslips FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM payroll_runs pr
      JOIN businesses b ON b.id = pr.business_id
      WHERE pr.id = payslips.payroll_run_id
        AND b.owner_id = auth.uid()
    )
  );

