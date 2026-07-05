-- ============================================================================
-- Migration 474: post_payroll_to_ledger — row lock + idempotent active journal
-- ============================================================================
-- Prevents duplicate payroll approval journals under concurrent/double approval:
--   1) SELECT payroll_runs ... FOR UPDATE serializes callers per run.
--   2) Return payroll_runs.journal_entry_id when already set.
--   3) If an unreversed payroll journal already exists for this run (no reversal
--      row pointing at it), link payroll_runs.journal_entry_id and return it.
--   4) Only insert a new journal when none exists.
-- Active journal: NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = je.id)
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
  v_run_journal_id                   UUID;
  v_active_payroll_journal_id        UUID;
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
    v_run_journal_id
  FROM public.payroll_runs
  WHERE id = p_payroll_run_id
  FOR UPDATE;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Payroll run not found: %', p_payroll_run_id;
  END IF;

  IF NOT public.finza_user_can_access_business(v_business_id) THEN
    RAISE EXCEPTION 'Not authorized to post payroll for this business';
  END IF;

  IF v_run_journal_id IS NOT NULL THEN
    RETURN v_run_journal_id;
  END IF;

  SELECT je.id
  INTO v_active_payroll_journal_id
  FROM public.journal_entries je
  WHERE je.business_id = v_business_id
    AND je.reference_type = 'payroll'
    AND je.reference_id = p_payroll_run_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.journal_entries r
      WHERE r.reverses_entry_id = je.id
    )
  ORDER BY je.created_at ASC
  LIMIT 1;

  IF v_active_payroll_journal_id IS NOT NULL THEN
    UPDATE public.payroll_runs pr
    SET journal_entry_id = v_active_payroll_journal_id
    WHERE pr.id = p_payroll_run_id
      AND pr.business_id = v_business_id
      AND pr.journal_entry_id IS NULL;
    RETURN v_active_payroll_journal_id;
  END IF;

  PERFORM public.assert_accounting_period_is_open(v_business_id, v_payroll_month);

  v_total_pension := COALESCE(v_total_ssnit_employee, 0) + COALESCE(v_total_ssnit_employer, 0);

  SELECT
    COALESCE(SUM(COALESCE(pe.tier1_ssnit_remittance, 0)), 0),
    COALESCE(SUM(COALESCE(pe.tier2_pension_remittance, 0)), 0)
  INTO v_tier1_snap, v_tier2_snap
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id;

  IF v_total_pension <= 0.01 THEN
    v_tier1_total := 0;
    v_tier2_total := 0;
  ELSIF
    v_tier1_snap >= 0
    AND v_tier2_snap >= 0
    AND (v_tier1_snap + v_tier2_snap) > 0.01
    AND ABS((v_tier1_snap + v_tier2_snap) - v_total_pension) <= 0.02
  THEN
    v_tier1_total := ROUND(v_tier1_snap::NUMERIC, 2);
    v_tier2_total := ROUND(v_tier2_snap::NUMERIC, 2);
  ELSE
    v_tier1_total := ROUND(v_total_pension * (13.5 / 18.5), 2);
    v_tier2_total := ROUND(v_total_pension - v_tier1_total, 2);
  END IF;

  IF ABS(
    COALESCE(v_tier1_total, 0) + COALESCE(v_tier2_total, 0) - COALESCE(v_total_pension, 0)
  ) > 0.02 THEN
    RAISE EXCEPTION 'Pension split does not reconcile to total pension liability.'
      USING DETAIL = format('tier1_total=%, tier2_total=%, total_pension=%', v_tier1_total, v_tier2_total, v_total_pension);
  END IF;

  IF v_total_pension > 0.01 AND COALESCE(v_tier1_total, 0) <= 0.01 AND COALESCE(v_tier2_total, 0) <= 0.01 THEN
    RAISE EXCEPTION 'Pension split does not reconcile to total pension liability.'
      USING DETAIL = format(
        'Non-zero pension total (%s) yielded zero tier allocations (tier1=%, tier2=%)',
        v_total_pension, v_tier1_total, v_tier2_total
      );
  END IF;

  SELECT COALESCE(SUM(sar.amount), 0)
  INTO v_advance_repayment_total
  FROM public.salary_advance_repayments sar
  WHERE sar.payroll_run_id = p_payroll_run_id
    AND sar.business_id = v_business_id
    AND sar.status = 'pending';

  SELECT id INTO v_payroll_expense_account_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '5600' AND deleted_at IS NULL;
  IF v_payroll_expense_account_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Payroll Expense', '5600', 'expense', 'Gross salaries, wages and allowances', TRUE)
    RETURNING id INTO v_payroll_expense_account_id;
  END IF;

  SELECT id INTO v_ssnit_employer_expense_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '5610' AND deleted_at IS NULL;
  IF v_ssnit_employer_expense_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Employer Pension Expense', '5610', 'expense', 'Employer pension / SSNIT contribution expense', TRUE)
    RETURNING id INTO v_ssnit_employer_expense_id;
  END IF;

  SELECT id INTO v_paye_liability_account_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '2230' AND deleted_at IS NULL;
  IF v_paye_liability_account_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'PAYE Tax Payable', '2230', 'liability', 'PAYE income tax payable to GRA', TRUE)
    RETURNING id INTO v_paye_liability_account_id;
  END IF;

  SELECT id INTO v_tier1_liability_account_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '2231' AND deleted_at IS NULL;
  IF v_tier1_liability_account_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'SSNIT / Tier 1 Pension Payable', '2231', 'liability', 'SSNIT / Tier 1 pension contributions payable', TRUE)
    RETURNING id INTO v_tier1_liability_account_id;
  END IF;

  IF v_tier1_liability_account_id IS NULL THEN
    RAISE EXCEPTION
      'Cannot resolve Tier 1 pension payable account code 2231 for business %. Create or unblock the liability account before posting payroll.',
      v_business_id;
  END IF;

  SELECT id INTO v_tier2_liability_account_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '2232' AND deleted_at IS NULL;
  IF v_tier2_liability_account_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Tier 2 Pension Payable', '2232', 'liability', 'Tier 2 pension contributions payable to trustee', TRUE)
    RETURNING id INTO v_tier2_liability_account_id;
  END IF;

  IF v_tier2_liability_account_id IS NULL THEN
    RAISE EXCEPTION
      'Cannot resolve Tier 2 pension payable account code 2232 for business %. Create or unblock the liability account before posting payroll.',
      v_business_id;
  END IF;

  SELECT id INTO v_net_salaries_payable_account_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '2240' AND deleted_at IS NULL;
  IF v_net_salaries_payable_account_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Net Salaries Payable', '2240', 'liability', 'Net salaries payable to employees', TRUE)
    RETURNING id INTO v_net_salaries_payable_account_id;
  END IF;

  SELECT id INTO v_deductions_payable_account_id
  FROM public.accounts WHERE business_id = v_business_id AND code = '2241' AND deleted_at IS NULL;
  IF v_deductions_payable_account_id IS NULL THEN
    INSERT INTO public.accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Employee Deductions / Recoveries Payable', '2241', 'liability', 'Employee deductions and internal recoveries payable/cleared through payroll', TRUE)
    RETURNING id INTO v_deductions_payable_account_id;
  END IF;

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
  SELECT l.journal_entry_id, l.account_id, l.debit, l.credit, l.description
  FROM (
    SELECT v_journal_entry_id AS journal_entry_id, v_payroll_expense_account_id AS account_id, v_total_gross AS debit,
           0::NUMERIC AS credit, 'Gross Salaries and Allowances'::TEXT AS description
    UNION ALL
    SELECT v_journal_entry_id, v_ssnit_employer_expense_id, v_total_ssnit_employer, 0::NUMERIC,
           'Employer pension / SSNIT contribution'::TEXT
    UNION ALL SELECT v_journal_entry_id, v_paye_liability_account_id, 0::NUMERIC, v_total_paye, 'PAYE Tax Payable'::TEXT
    UNION ALL
    SELECT v_journal_entry_id, v_net_salaries_payable_account_id, 0::NUMERIC, v_total_net, 'Net Salaries Payable'::TEXT
    UNION ALL
    SELECT v_journal_entry_id, v_deductions_payable_account_id, 0::NUMERIC, v_total_deductions, 'Employee Deductions Payable'::TEXT
    UNION ALL
    SELECT v_journal_entry_id, v_tier1_liability_account_id, 0::NUMERIC, v_tier1_total, 'SSNIT / Tier 1 pension payable'::TEXT
    WHERE v_total_pension > 0.01 AND v_tier1_total > 0.01
    UNION ALL
    SELECT v_journal_entry_id, v_tier2_liability_account_id, 0::NUMERIC, v_tier2_total, 'Tier 2 pension payable'::TEXT
    WHERE v_total_pension > 0.01 AND v_tier2_total > 0.01
    UNION ALL
    SELECT v_journal_entry_id, v_deductions_payable_account_id, v_advance_repayment_total, 0::NUMERIC,
           'Clear salary advance deductions payable'::TEXT
    WHERE COALESCE(v_advance_repayment_total, 0) > 0
    UNION ALL
    SELECT v_journal_entry_id, v_staff_advances_account_id, 0::NUMERIC, v_advance_repayment_total,
           'Clear staff advances receivable'::TEXT
    WHERE COALESCE(v_advance_repayment_total, 0) > 0
  ) l;

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
'Posts payroll run to ledger (SECURITY DEFINER). Single INSERT into journal_entry_lines. Idempotent: SELECT payroll_runs FOR UPDATE; returns linked journal id; else returns existing active payroll journal for run (not superseded by reversal); else inserts.';

REVOKE ALL ON FUNCTION public.post_payroll_to_ledger(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_payroll_to_ledger(UUID) TO authenticated;
