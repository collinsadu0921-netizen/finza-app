-- ============================================================================
-- Migration 467: Split Tier 1 / Tier 2 pension liabilities on payroll approval
-- ============================================================================
-- Goal:
--   Cr 2231 = Tier 1 (SSNIT) remittance total
--   Cr 2232 = Tier 2 pension remittance total
--   Sum of tier credits = total_ssnit_employee + total_ssnit_employer (±0.02)
--
-- Preserves:
--   - Salary advance clearing (463)
--   - Open period assert
--   - Idempotency via payroll_runs.journal_entry_id (restore 391 pattern)
--   - SECURITY DEFINER + finza_user_can_access_business (391)
--
-- Does not modify historical posted journals; duplicate post returns existing id.
--
-- NOTE (superseded): If this migration was already applied, use 468 to correct
-- journal line posting (single INSERT for balance trigger). Do not re-edit 467.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.post_payroll_to_ledger(p_payroll_run_id UUID)
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
  v_total_pension                    NUMERIC;
  v_tier1_snap                       NUMERIC;
  v_tier2_snap                       NUMERIC;
  v_tier1_total                      NUMERIC;
  v_tier2_total                      NUMERIC;
  v_advance_repayment_total          NUMERIC := 0;
  v_payroll_expense_account_id       UUID;
  v_ssnit_employer_expense_id        UUID;
  v_paye_liability_account_id        UUID;
  v_tier1_liability_account_id       UUID;
  v_tier2_liability_account_id       UUID;
  v_net_salaries_payable_account_id  UUID;
  v_deductions_payable_account_id    UUID;
  v_staff_advances_account_id        UUID;
  v_journal_entry_id                 UUID;
  v_existing_journal_id              UUID;
BEGIN
  SELECT
    business_id,
    payroll_month,
    total_gross_salary,
    COALESCE(total_deductions, 0),
    COALESCE(total_ssnit_employer, 0),
    COALESCE(total_paye, 0),
    COALESCE(total_ssnit_employee, 0),
    COALESCE(total_net_salary, 0),
    journal_entry_id
  INTO
    v_business_id,
    v_payroll_month,
    v_total_gross,
    v_total_deductions,
    v_total_ssnit_employer,
    v_total_paye,
    v_total_ssnit_employee,
    v_total_net,
    v_existing_journal_id
  FROM public.payroll_runs
  WHERE id = p_payroll_run_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Payroll run not found: %', p_payroll_run_id;
  END IF;

  IF NOT public.finza_user_can_access_business(v_business_id) THEN
    RAISE EXCEPTION 'Not authorized to post payroll for this business';
  END IF;

  IF v_existing_journal_id IS NOT NULL THEN
    RETURN v_existing_journal_id;
  END IF;

  PERFORM public.assert_accounting_period_is_open(v_business_id, v_payroll_month);

  v_total_pension := COALESCE(v_total_ssnit_employee, 0) + COALESCE(v_total_ssnit_employer, 0);

  SELECT
    COALESCE(SUM(pe.tier1_ssnit_remittance), 0),
    COALESCE(SUM(pe.tier2_pension_remittance), 0)
  INTO v_tier1_snap, v_tier2_snap
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id;

  IF v_total_pension <= 0.01 THEN
    v_tier1_total := 0;
    v_tier2_total := 0;
  ELSIF (v_tier1_snap <= 0.01 AND v_tier2_snap <= 0.01 AND v_total_pension > 0.01)
     OR (ABS((v_tier1_snap + v_tier2_snap) - v_total_pension) > 0.02) THEN
    -- Legacy / draft: tier columns empty or inconsistent; split from aggregate (13.5/18.5 + residual)
    v_tier1_total := ROUND(v_total_pension * (13.5 / 18.5), 2);
    v_tier2_total := ROUND(v_total_pension - v_tier1_total, 2);
  ELSE
    v_tier1_total := ROUND(v_tier1_snap::NUMERIC, 2);
    v_tier2_total := ROUND(v_tier2_snap::NUMERIC, 2);
  END IF;

  IF ABS((v_tier1_total + v_tier2_total) - v_total_pension) > 0.02 THEN
    RAISE EXCEPTION
      'Payroll pension tier split does not reconcile (tier1=%, tier2=%, total pension=%)',
      v_tier1_total, v_tier2_total, v_total_pension;
  END IF;

  SELECT COALESCE(SUM(sar.amount), 0)
  INTO v_advance_repayment_total
  FROM public.salary_advance_repayments sar
  WHERE sar.payroll_run_id = p_payroll_run_id
    AND sar.business_id = v_business_id
    AND sar.status = 'pending';

  -- 5600 Payroll Expense
  SELECT id INTO v_payroll_expense_account_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '5600' AND deleted_at IS NULL;
  IF v_payroll_expense_account_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Payroll Expense', '5600', 'expense', 'Gross salaries, wages and allowances', TRUE)
    RETURNING id INTO v_payroll_expense_account_id;
  END IF;

  -- 5610 Employer pension / SSNIT expense
  SELECT id INTO v_ssnit_employer_expense_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '5610' AND deleted_at IS NULL;
  IF v_ssnit_employer_expense_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Employer Pension Expense', '5610', 'expense', 'Employer pension / SSNIT contribution expense', TRUE)
    RETURNING id INTO v_ssnit_employer_expense_id;
  END IF;

  -- 2230 PAYE Tax Payable
  SELECT id INTO v_paye_liability_account_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '2230' AND deleted_at IS NULL;
  IF v_paye_liability_account_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'PAYE Tax Payable', '2230', 'liability', 'PAYE income tax payable to GRA', TRUE)
    RETURNING id INTO v_paye_liability_account_id;
  END IF;

  -- 2231 SSNIT / Tier 1 Pension Payable
  SELECT id INTO v_tier1_liability_account_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '2231' AND deleted_at IS NULL;
  IF v_tier1_liability_account_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'SSNIT / Tier 1 Pension Payable', '2231', 'liability', 'SSNIT / Tier 1 pension contributions payable', TRUE)
    RETURNING id INTO v_tier1_liability_account_id;
  END IF;

  -- 2232 Tier 2 Pension Payable (created when absent; postings skip near-zero tier 2)
  SELECT id INTO v_tier2_liability_account_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '2232' AND deleted_at IS NULL;
  IF v_tier2_liability_account_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Tier 2 Pension Payable', '2232', 'liability', 'Tier 2 pension contributions payable to trustee', TRUE)
    RETURNING id INTO v_tier2_liability_account_id;
  END IF;

  -- 2240 Net Salaries Payable
  SELECT id INTO v_net_salaries_payable_account_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '2240' AND deleted_at IS NULL;
  IF v_net_salaries_payable_account_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Net Salaries Payable', '2240', 'liability', 'Net salaries payable to employees', TRUE)
    RETURNING id INTO v_net_salaries_payable_account_id;
  END IF;

  -- 2241 Employee Deductions Payable
  SELECT id INTO v_deductions_payable_account_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '2241' AND deleted_at IS NULL;
  IF v_deductions_payable_account_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Employee Deductions / Recoveries Payable', '2241', 'liability', 'Employee deductions and internal recoveries payable/cleared through payroll', TRUE)
    RETURNING id INTO v_deductions_payable_account_id;
  END IF;

  -- 1110 Staff Advances
  SELECT id INTO v_staff_advances_account_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '1110' AND deleted_at IS NULL;
  IF v_staff_advances_account_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Staff Advances', '1110', 'asset', 'Salary advances issued to employees', TRUE)
    RETURNING id INTO v_staff_advances_account_id;
  END IF;

  INSERT INTO public.journal_entries (business_id, date, description, reference_type, reference_id, posting_source)
  VALUES (
    v_business_id,
    v_payroll_month,
    'Payroll Run: ' || TO_CHAR(v_payroll_month, 'Month YYYY'),
    'payroll',
    p_payroll_run_id,
    'system'
  )
  RETURNING id INTO v_journal_entry_id;

  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_journal_entry_id, v_payroll_expense_account_id,      v_total_gross,           0, 'Gross Salaries and Allowances'),
    (v_journal_entry_id, v_ssnit_employer_expense_id,       v_total_ssnit_employer,  0, 'Employer pension / SSNIT contribution'),
    (v_journal_entry_id, v_paye_liability_account_id,       0, v_total_paye,           'PAYE Tax Payable'),
    (v_journal_entry_id, v_net_salaries_payable_account_id, 0, v_total_net,            'Net Salaries Payable'),
    (v_journal_entry_id, v_deductions_payable_account_id,   0, v_total_deductions,     'Employee Deductions Payable');

  IF v_tier1_total > 0.01 THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_journal_entry_id, v_tier1_liability_account_id, 0, v_tier1_total, 'SSNIT / Tier 1 pension payable');
  END IF;

  IF v_tier2_total > 0.01 THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_journal_entry_id, v_tier2_liability_account_id, 0, v_tier2_total, 'Tier 2 pension payable');
  END IF;

  IF v_advance_repayment_total > 0 THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES
      (v_journal_entry_id, v_deductions_payable_account_id, v_advance_repayment_total, 0, 'Clear salary advance deductions payable'),
      (v_journal_entry_id, v_staff_advances_account_id, 0, v_advance_repayment_total, 'Clear staff advances receivable');
  END IF;

  WITH posted_rows AS (
    UPDATE public.salary_advance_repayments sar
    SET
      status = 'posted',
      journal_entry_id = v_journal_entry_id,
      posted_at = NOW()
    WHERE sar.payroll_run_id = p_payroll_run_id
      AND sar.business_id = v_business_id
      AND sar.status = 'pending'
    RETURNING sar.salary_advance_id, sar.amount
  ),
  repayment_totals AS (
    SELECT salary_advance_id, SUM(amount) AS amount
    FROM posted_rows
    GROUP BY salary_advance_id
  )
  UPDATE public.salary_advances sa
  SET
    repaid_amount = LEAST(sa.amount, COALESCE(sa.repaid_amount, 0) + rt.amount),
    status = CASE
      WHEN sa.cancelled_at IS NOT NULL THEN 'cancelled'
      WHEN LEAST(sa.amount, COALESCE(sa.repaid_amount, 0) + rt.amount) >= sa.amount THEN 'cleared'
      WHEN LEAST(sa.amount, COALESCE(sa.repaid_amount, 0) + rt.amount) > 0 THEN 'partially_repaid'
      ELSE 'outstanding'
    END,
    cleared_at = CASE
      WHEN sa.cancelled_at IS NULL AND LEAST(sa.amount, COALESCE(sa.repaid_amount, 0) + rt.amount) >= sa.amount
        THEN COALESCE(sa.cleared_at, NOW())
      ELSE NULL
    END
  FROM repayment_totals rt
  WHERE sa.id = rt.salary_advance_id;

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

COMMENT ON FUNCTION public.post_payroll_to_ledger(UUID) IS
'Posts payroll run to ledger (SECURITY DEFINER). Balanced: DR 5600+5610 (+ advance Dr 2241); CR 2230+2231+2232+2240+2241 (+ advance Cr 1110). Pension split: CR 2231 Tier 1, CR 2232 Tier 2. Idempotent: returns existing payroll_runs.journal_entry_id if set.';

REVOKE ALL ON FUNCTION public.post_payroll_to_ledger(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_payroll_to_ledger(UUID) TO authenticated;
