-- ============================================================================
-- Migration 360: Fix payroll ledger imbalance when employee deductions exist
-- ============================================================================
-- The post_payroll_to_ledger function (migration 289) debits gross and credits
-- PAYE + SSNIT + net, but omits a credit for other deductions (loans, advances).
--
-- Net salary formula:
--   net = gross - paye - ssnit_employee - deductions
--
-- Without the deductions credit line:
--   DR = gross + ssnit_employer
--   CR = paye + ssnit_employee + ssnit_employer + net
--      = paye + ssnit_employee + ssnit_employer + (gross - paye - ssnit_employee - deductions)
--      = gross + ssnit_employer - deductions
--   DR - CR = deductions  ← imbalance!
--
-- Fix: add CR Employee Deductions Payable (2241) = total_deductions.
-- When total_deductions = 0, line has zero amount, journal still balances.
--
-- Proof of balance after fix:
--   DR = gross + ssnit_employer
--   CR = paye + (ssnit_employee + ssnit_employer) + net + deductions
--      = paye + ssnit_employee + ssnit_employer
--        + (gross - paye - ssnit_employee - deductions) + deductions
--      = gross + ssnit_employer  ✓
-- ============================================================================

CREATE OR REPLACE FUNCTION post_payroll_to_ledger(p_payroll_run_id UUID)
RETURNS UUID AS $$
DECLARE
  v_business_id                      UUID;
  v_payroll_month                    DATE;
  v_total_gross                      NUMERIC;
  v_total_deductions                 NUMERIC;
  v_total_ssnit_employer             NUMERIC;
  v_total_paye                       NUMERIC;
  v_total_ssnit_employee             NUMERIC;
  v_total_net                        NUMERIC;
  v_payroll_expense_account_id       UUID;
  v_ssnit_employer_expense_id        UUID;
  v_paye_liability_account_id        UUID;
  v_ssnit_liability_account_id       UUID;
  v_net_salaries_payable_account_id  UUID;
  v_deductions_payable_account_id    UUID;
  v_journal_entry_id                 UUID;
BEGIN
  SELECT
    business_id,
    payroll_month,
    total_gross_salary,
    COALESCE(total_deductions, 0),
    COALESCE(total_ssnit_employer, 0),
    COALESCE(total_paye, 0),
    COALESCE(total_ssnit_employee, 0),
    COALESCE(total_net_salary, 0)
  INTO
    v_business_id,
    v_payroll_month,
    v_total_gross,
    v_total_deductions,
    v_total_ssnit_employer,
    v_total_paye,
    v_total_ssnit_employee,
    v_total_net
  FROM payroll_runs
  WHERE id = p_payroll_run_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Payroll run not found: %', p_payroll_run_id;
  END IF;

  PERFORM assert_accounting_period_is_open(v_business_id, v_payroll_month);

  -- ── Resolve / auto-create accounts ────────────────────────────────────────

  -- 5600 Payroll Expense
  SELECT id INTO v_payroll_expense_account_id
  FROM accounts WHERE business_id = v_business_id AND code = '5600' AND deleted_at IS NULL;
  IF v_payroll_expense_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Payroll Expense', '5600', 'expense', 'Gross salaries, wages and allowances', TRUE)
    RETURNING id INTO v_payroll_expense_account_id;
  END IF;

  -- 5610 SSNIT Employer Expense
  SELECT id INTO v_ssnit_employer_expense_id
  FROM accounts WHERE business_id = v_business_id AND code = '5610' AND deleted_at IS NULL;
  IF v_ssnit_employer_expense_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'SSNIT Employer Expense', '5610', 'expense', 'Employer SSNIT contribution expense', TRUE)
    RETURNING id INTO v_ssnit_employer_expense_id;
  END IF;

  -- 2230 PAYE Tax Payable
  SELECT id INTO v_paye_liability_account_id
  FROM accounts WHERE business_id = v_business_id AND code = '2230' AND deleted_at IS NULL;
  IF v_paye_liability_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'PAYE Tax Payable', '2230', 'liability', 'PAYE income tax payable to GRA', TRUE)
    RETURNING id INTO v_paye_liability_account_id;
  END IF;

  -- 2231 SSNIT Payable
  SELECT id INTO v_ssnit_liability_account_id
  FROM accounts WHERE business_id = v_business_id AND code = '2231' AND deleted_at IS NULL;
  IF v_ssnit_liability_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'SSNIT Payable', '2231', 'liability', 'SSNIT contributions payable', TRUE)
    RETURNING id INTO v_ssnit_liability_account_id;
  END IF;

  -- 2240 Net Salaries Payable
  SELECT id INTO v_net_salaries_payable_account_id
  FROM accounts WHERE business_id = v_business_id AND code = '2240' AND deleted_at IS NULL;
  IF v_net_salaries_payable_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Net Salaries Payable', '2240', 'liability', 'Net salaries payable to employees', TRUE)
    RETURNING id INTO v_net_salaries_payable_account_id;
  END IF;

  -- 2241 Employee Deductions Payable (loan repayments, advances, etc.)
  SELECT id INTO v_deductions_payable_account_id
  FROM accounts WHERE business_id = v_business_id AND code = '2241' AND deleted_at IS NULL;
  IF v_deductions_payable_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Employee Deductions Payable', '2241', 'liability', 'Loan repayments and other employee deductions held by employer', TRUE)
    RETURNING id INTO v_deductions_payable_account_id;
  END IF;

  -- ── Journal entry ──────────────────────────────────────────────────────────

  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id, posting_source)
  VALUES (
    v_business_id,
    v_payroll_month,
    'Payroll Run: ' || TO_CHAR(v_payroll_month, 'Month YYYY'),
    'payroll',
    p_payroll_run_id,
    'system'
  )
  RETURNING id INTO v_journal_entry_id;

  -- Single INSERT keeps the balance trigger happy:
  --   DR Payroll Expense  = gross (includes allowances — do not add total_allowances again)
  --   DR SSNIT Employer   = ssnit_employer
  --   CR PAYE Payable     = paye
  --   CR SSNIT Payable    = ssnit_employee + ssnit_employer
  --   CR Net Salaries     = net
  --   CR Deductions Paybl = deductions  ← NEW line that makes DR = CR
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_journal_entry_id, v_payroll_expense_account_id,      v_total_gross,                                   0, 'Gross Salaries and Allowances'),
    (v_journal_entry_id, v_ssnit_employer_expense_id,       v_total_ssnit_employer,                          0, 'Employer SSNIT Contribution'),
    (v_journal_entry_id, v_paye_liability_account_id,       0, v_total_paye,                                    'PAYE Tax Payable'),
    (v_journal_entry_id, v_ssnit_liability_account_id,      0, v_total_ssnit_employee + v_total_ssnit_employer, 'SSNIT Payable'),
    (v_journal_entry_id, v_net_salaries_payable_account_id, 0, v_total_net,                                     'Net Salaries Payable'),
    (v_journal_entry_id, v_deductions_payable_account_id,   0, v_total_deductions,                              'Employee Deductions Payable');

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_payroll_to_ledger(UUID) IS
'Posts payroll run to ledger. Balanced journal entry:
  DR Payroll Expense (5600) = gross (already includes allowances)
  DR SSNIT Employer Expense (5610) = ssnit_employer
  CR PAYE Tax Payable (2230) = paye
  CR SSNIT Payable (2231) = ssnit_employee + ssnit_employer
  CR Net Salaries Payable (2240) = net
  CR Employee Deductions Payable (2241) = deductions
Proof: gross + ssnit_emp = paye + (ssnit_emp+ssnit_empr) + net + deductions
     = paye + ssnit_empr + (gross - paye - ssnit_emp - deductions) + deductions
     = gross + ssnit_empr. Enforces open accounting period.';

-- Backfill Employee Deductions Payable account (2241) for all existing businesses
-- so it exists before any payroll run is approved.
DO $$
DECLARE
  biz_id UUID;
BEGIN
  FOR biz_id IN SELECT id FROM businesses LOOP
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (biz_id, 'Employee Deductions Payable', '2241', 'liability', 'Loan repayments and other employee deductions held by employer', TRUE)
    ON CONFLICT (business_id, code) DO NOTHING;
  END LOOP;
END;
$$;
