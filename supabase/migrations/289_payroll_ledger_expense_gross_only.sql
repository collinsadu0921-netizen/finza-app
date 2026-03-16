-- Fix payroll ledger: debit payroll expense by total_gross_salary only.
-- total_gross_salary in payroll_runs is already sum(basic+allowances) per employee, so adding
-- total_allowances again would double-count allowances. Expense debit = gross only.
-- Period enforcement and balanced journal structure unchanged.

CREATE OR REPLACE FUNCTION post_payroll_to_ledger(p_payroll_run_id UUID)
RETURNS UUID AS $$
DECLARE
  v_business_id UUID;
  v_payroll_month DATE;
  v_total_gross NUMERIC;
  v_total_allowances NUMERIC;
  v_total_ssnit_employer NUMERIC;
  v_total_paye NUMERIC;
  v_total_ssnit_employee NUMERIC;
  v_total_net NUMERIC;
  v_payroll_expense_account_id UUID;
  v_ssnit_employer_expense_account_id UUID;
  v_paye_liability_account_id UUID;
  v_ssnit_liability_account_id UUID;
  v_net_salaries_payable_account_id UUID;
  v_journal_entry_id UUID;
BEGIN
  SELECT
    business_id,
    payroll_month,
    total_gross_salary,
    total_allowances,
    total_ssnit_employer,
    total_paye,
    total_ssnit_employee,
    total_net_salary
  INTO
    v_business_id,
    v_payroll_month,
    v_total_gross,
    v_total_allowances,
    v_total_ssnit_employer,
    v_total_paye,
    v_total_ssnit_employee,
    v_total_net
  FROM payroll_runs
  WHERE id = p_payroll_run_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Payroll run not found';
  END IF;

  PERFORM assert_accounting_period_is_open(v_business_id, v_payroll_month);

  SELECT id INTO v_payroll_expense_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '5600' AND type = 'expense';

  IF v_payroll_expense_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Payroll Expense', '5600', 'expense', 'Payroll expense', TRUE)
    RETURNING id INTO v_payroll_expense_account_id;
  END IF;

  SELECT id INTO v_ssnit_employer_expense_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '5610' AND type = 'expense';

  IF v_ssnit_employer_expense_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'SSNIT Employer Expense', '5610', 'expense', 'SSNIT employer contribution expense', TRUE)
    RETURNING id INTO v_ssnit_employer_expense_account_id;
  END IF;

  SELECT id INTO v_paye_liability_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '2230' AND type = 'liability';

  IF v_paye_liability_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'PAYE Tax Payable', '2230', 'liability', 'PAYE tax payable', TRUE)
    RETURNING id INTO v_paye_liability_account_id;
  END IF;

  SELECT id INTO v_ssnit_liability_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '2231' AND type = 'liability';

  IF v_ssnit_liability_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'SSNIT Payable', '2231', 'liability', 'SSNIT payable', TRUE)
    RETURNING id INTO v_ssnit_liability_account_id;
  END IF;

  SELECT id INTO v_net_salaries_payable_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '2240' AND type = 'liability';

  IF v_net_salaries_payable_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Net Salaries Payable', '2240', 'liability', 'Net salaries payable to employees', TRUE)
    RETURNING id INTO v_net_salaries_payable_account_id;
  END IF;

  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id, posting_source)
  VALUES (v_business_id, v_payroll_month, 'Payroll Run: ' || TO_CHAR(v_payroll_month, 'Month YYYY'), 'payroll', p_payroll_run_id, 'system')
  RETURNING id INTO v_journal_entry_id;

  -- DR Payroll Expense = gross only (total_gross_salary already includes allowances; do not add total_allowances).
  -- CR PAYE, CR SSNIT (employee + employer), CR Net Salaries Payable. Journal balances: DR = CR.
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_journal_entry_id, v_payroll_expense_account_id, v_total_gross, 0, 'Gross Salaries and Allowances'),
    (v_journal_entry_id, v_ssnit_employer_expense_account_id, v_total_ssnit_employer, 0, 'Employer SSNIT Contribution'),
    (v_journal_entry_id, v_paye_liability_account_id, 0, v_total_paye, 'PAYE Tax Payable'),
    (v_journal_entry_id, v_ssnit_liability_account_id, 0, v_total_ssnit_employee + v_total_ssnit_employer, 'SSNIT Payable'),
    (v_journal_entry_id, v_net_salaries_payable_account_id, 0, v_total_net, 'Net Salaries Payable');

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_payroll_to_ledger IS
  'Posts payroll to ledger. DR Payroll Expense = total_gross_salary only (gross already includes allowances). CR PAYE, SSNIT, Net Payable. Enforces assert_accounting_period_is_open. Single-statement insert for balance trigger.';
