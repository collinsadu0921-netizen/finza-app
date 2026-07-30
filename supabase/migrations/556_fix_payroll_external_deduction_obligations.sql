-- ============================================================================
-- Migration 556: External deduction obligations exclude salary-advance recoveries
-- ============================================================================
-- Does NOT edit 552–555. Production untouched.
-- Advance recovery (Dr 2241 / Cr 1110) is internal clearing — not an external payable.
-- external deductions payable = total_deductions - posted salary-advance recoveries
-- ============================================================================

CREATE OR REPLACE FUNCTION public.payroll_obligation_posted_payments_total(
  p_obligation_id UUID
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(pop.amount), 0)::NUMERIC
  FROM public.payroll_obligation_payments pop
  WHERE pop.payroll_obligation_id = p_obligation_id
    AND pop.deleted_at IS NULL
    AND pop.journal_entry_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.payroll_obligation_posted_payments_total(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_obligation_posted_payments_total(UUID) TO postgres;

CREATE OR REPLACE FUNCTION public.sync_payroll_obligations_for_approval(
  p_business_id UUID,
  p_payroll_run_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run RECORD;
  v_tier1_snap NUMERIC := 0;
  v_tier2_snap NUMERIC := 0;
  v_aggregate_pension NUMERIC := 0;
  v_tier1 NUMERIC := 0;
  v_tier2 NUMERIC := 0;
  v_total_deductions NUMERIC := 0;
  v_advance_recovered NUMERIC := 0;
  v_external_deductions NUMERIC := 0;
  v_has_2232 BOOLEAN := false;
  v_tier1_code TEXT := '2231';
  v_tier2_code TEXT := '2232';
  v_existing RECORD;
  v_ids JSONB := '[]'::jsonb;
  v_id UUID;
  v_tol NUMERIC := 0.01;
  v_posted_paid NUMERIC := 0;
  v_bad_repay INT := 0;
BEGIN
  SELECT *
  INTO v_run
  FROM public.payroll_runs
  WHERE id = p_payroll_run_id
    AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_OBLIGATION_FAILED',
      'Payroll run not found for obligation sync'
    );
  END IF;

  -- Included entries only for pension snapshots
  SELECT
    COALESCE(SUM(COALESCE(pe.tier1_ssnit_remittance, 0)), 0),
    COALESCE(SUM(COALESCE(pe.tier2_pension_remittance, 0)), 0)
  INTO v_tier1_snap, v_tier2_snap
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE;

  v_aggregate_pension := COALESCE(v_run.total_ssnit_employee, 0) + COALESCE(v_run.total_ssnit_employer, 0);

  IF v_aggregate_pension <= 0.01 THEN
    v_tier1 := 0;
    v_tier2 := 0;
  ELSIF
    v_tier1_snap >= 0
    AND v_tier2_snap >= 0
    AND (v_tier1_snap + v_tier2_snap) > 0.01
    AND ABS((v_tier1_snap + v_tier2_snap) - v_aggregate_pension) <= 0.02
  THEN
    v_tier1 := ROUND(v_tier1_snap::NUMERIC, 2);
    v_tier2 := ROUND(v_tier2_snap::NUMERIC, 2);
  ELSE
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_OBLIGATION_FAILED',
      'Pension tier snapshots do not reconcile to payroll pension totals',
      jsonb_build_object(
        'code', 'PAYROLL_APPROVAL_OBLIGATION_FAILED',
        'tier1Snapshot', v_tier1_snap,
        'tier2Snapshot', v_tier2_snap,
        'aggregatePension', v_aggregate_pension
      )
    );
  END IF;

  -- Posted advance recoveries must link to included entries of this run
  SELECT COUNT(*) INTO v_bad_repay
  FROM public.salary_advance_repayments sar
  LEFT JOIN public.payroll_entries pe ON pe.id = sar.payroll_entry_id
  WHERE sar.business_id = p_business_id
    AND sar.payroll_run_id = p_payroll_run_id
    AND sar.status = 'posted'
    AND (
      sar.payroll_entry_id IS NULL
      OR pe.id IS NULL
      OR pe.payroll_run_id IS DISTINCT FROM p_payroll_run_id
      OR pe.is_included IS FALSE
      OR (sar.staff_id IS NOT NULL AND pe.staff_id IS DISTINCT FROM sar.staff_id)
    );

  IF v_bad_repay > 0 THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_INCONSISTENT_STATE',
      'Posted salary-advance recovery is linked to an excluded or mismatched payroll entry',
      jsonb_build_object(
        'code', 'PAYROLL_APPROVAL_INCONSISTENT_STATE',
        'badRepaymentCount', v_bad_repay
      )
    );
  END IF;

  SELECT COALESCE(SUM(sar.amount), 0)
  INTO v_advance_recovered
  FROM public.salary_advance_repayments sar
  JOIN public.payroll_entries pe ON pe.id = sar.payroll_entry_id
  WHERE sar.business_id = p_business_id
    AND sar.payroll_run_id = p_payroll_run_id
    AND sar.status = 'posted'
    AND pe.is_included IS DISTINCT FROM FALSE;

  v_total_deductions := ROUND(COALESCE(v_run.total_deductions, 0)::NUMERIC, 2);
  v_advance_recovered := ROUND(COALESCE(v_advance_recovered, 0)::NUMERIC, 2);

  IF v_advance_recovered > v_total_deductions + v_tol THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_INCONSISTENT_STATE',
      'Salary-advance recoveries exceed total employee deductions',
      jsonb_build_object(
        'code', 'PAYROLL_APPROVAL_INCONSISTENT_STATE',
        'totalDeductions', v_total_deductions,
        'advanceRecovered', v_advance_recovered,
        'externalDeductions', 0
      )
    );
  END IF;

  v_external_deductions := ROUND(GREATEST(0, v_total_deductions - v_advance_recovered), 2);

  SELECT EXISTS (
    SELECT 1
    FROM public.journal_entry_lines jel
    JOIN public.accounts a ON a.id = jel.account_id
    WHERE jel.journal_entry_id = v_run.journal_entry_id
      AND a.business_id = p_business_id
      AND a.code = '2232'
      AND a.deleted_at IS NULL
      AND jel.credit > 0.01
  ) INTO v_has_2232;

  IF NOT v_has_2232 THEN
    v_tier1_code := '2231';
    v_tier2_code := '2231';
  END IF;

  PERFORM 1
  FROM public.payroll_obligations o
  WHERE o.business_id = p_business_id
    AND o.payroll_run_id = p_payroll_run_id
    AND o.deleted_at IS NULL
  ORDER BY o.obligation_type, o.id
  FOR UPDATE;

  -- Draft first-approval: reject any pre-paid obligations / posted payments
  IF v_run.status = 'draft' THEN
    IF EXISTS (
      SELECT 1
      FROM public.payroll_obligations o
      WHERE o.business_id = p_business_id
        AND o.payroll_run_id = p_payroll_run_id
        AND o.deleted_at IS NULL
        AND COALESCE(o.amount_paid, 0) > v_tol
    ) OR EXISTS (
      SELECT 1
      FROM public.payroll_obligation_payments pop
      WHERE pop.business_id = p_business_id
        AND pop.payroll_run_id = p_payroll_run_id
        AND pop.deleted_at IS NULL
        AND pop.journal_entry_id IS NOT NULL
    ) THEN
      PERFORM public.raise_payroll_approval_error(
        'PAYROLL_APPROVAL_INCONSISTENT_STATE',
        'Draft payroll has pre-existing paid obligations or posted obligation payments',
        jsonb_build_object('code', 'PAYROLL_APPROVAL_INCONSISTENT_STATE')
      );
    END IF;
  END IF;

  -- salary_net
  IF COALESCE(v_run.total_net_salary, 0) > 0.01 THEN
    SELECT * INTO v_existing
    FROM public.payroll_obligations
    WHERE business_id = p_business_id
      AND payroll_run_id = p_payroll_run_id
      AND obligation_type = 'salary_net'
      AND deleted_at IS NULL
    LIMIT 1;

    IF FOUND THEN
      v_posted_paid := public.payroll_obligation_posted_payments_total(v_existing.id);
      IF ABS(COALESCE(v_existing.amount_due, 0) - ROUND(v_run.total_net_salary::NUMERIC, 2)) > v_tol
         OR COALESCE(v_existing.liability_account_code, '') IS DISTINCT FROM '2240'
         OR ABS(COALESCE(v_existing.amount_paid, 0) - v_posted_paid) > v_tol THEN
        PERFORM public.raise_payroll_approval_error(
          'PAYROLL_APPROVAL_INCONSISTENT_STATE',
          'Conflicting salary_net obligation for this payroll run',
          jsonb_build_object(
            'code', 'PAYROLL_APPROVAL_INCONSISTENT_STATE',
            'obligationType', 'salary_net',
            'existingAmountDue', v_existing.amount_due,
            'expectedAmountDue', ROUND(v_run.total_net_salary::NUMERIC, 2),
            'existingAmountPaid', v_existing.amount_paid,
            'postedPayments', v_posted_paid
          )
        );
      END IF;
      UPDATE public.payroll_obligations
      SET
        label = 'Net salaries payable',
        due_date = v_run.payroll_month,
        status = public.payroll_obligation_status(amount_due, COALESCE(amount_paid, 0)),
        updated_at = NOW()
      WHERE id = v_existing.id
      RETURNING id INTO v_id;
    ELSE
      INSERT INTO public.payroll_obligations (
        business_id, payroll_run_id, obligation_type, label, amount_due, amount_paid,
        status, due_date, liability_account_code
      ) VALUES (
        p_business_id, p_payroll_run_id, 'salary_net', 'Net salaries payable',
        ROUND(v_run.total_net_salary::NUMERIC, 2), 0, 'unpaid', v_run.payroll_month, '2240'
      ) RETURNING id INTO v_id;
    END IF;
    v_ids := v_ids || jsonb_build_array(jsonb_build_object('type', 'salary_net', 'id', v_id, 'amount', ROUND(v_run.total_net_salary::NUMERIC, 2)));
  END IF;

  -- paye_gra
  IF COALESCE(v_run.total_paye, 0) > 0.01 THEN
    SELECT * INTO v_existing
    FROM public.payroll_obligations
    WHERE business_id = p_business_id
      AND payroll_run_id = p_payroll_run_id
      AND obligation_type = 'paye_gra'
      AND deleted_at IS NULL
    LIMIT 1;

    IF FOUND THEN
      v_posted_paid := public.payroll_obligation_posted_payments_total(v_existing.id);
      IF ABS(COALESCE(v_existing.amount_due, 0) - ROUND(v_run.total_paye::NUMERIC, 2)) > v_tol
         OR COALESCE(v_existing.liability_account_code, '') IS DISTINCT FROM '2230'
         OR ABS(COALESCE(v_existing.amount_paid, 0) - v_posted_paid) > v_tol THEN
        PERFORM public.raise_payroll_approval_error(
          'PAYROLL_APPROVAL_INCONSISTENT_STATE',
          'Conflicting paye_gra obligation for this payroll run',
          jsonb_build_object(
            'code', 'PAYROLL_APPROVAL_INCONSISTENT_STATE',
            'obligationType', 'paye_gra',
            'existingAmountDue', v_existing.amount_due,
            'expectedAmountDue', ROUND(v_run.total_paye::NUMERIC, 2)
          )
        );
      END IF;
      UPDATE public.payroll_obligations
      SET
        label = 'PAYE payable to GRA',
        due_date = public.payroll_next_month_paye_due_date(v_run.payroll_month),
        status = public.payroll_obligation_status(amount_due, COALESCE(amount_paid, 0)),
        updated_at = NOW()
      WHERE id = v_existing.id
      RETURNING id INTO v_id;
    ELSE
      INSERT INTO public.payroll_obligations (
        business_id, payroll_run_id, obligation_type, label, amount_due, amount_paid,
        status, due_date, liability_account_code
      ) VALUES (
        p_business_id, p_payroll_run_id, 'paye_gra', 'PAYE payable to GRA',
        ROUND(v_run.total_paye::NUMERIC, 2), 0, 'unpaid',
        public.payroll_next_month_paye_due_date(v_run.payroll_month), '2230'
      ) RETURNING id INTO v_id;
    END IF;
    v_ids := v_ids || jsonb_build_array(jsonb_build_object('type', 'paye_gra', 'id', v_id, 'amount', ROUND(v_run.total_paye::NUMERIC, 2)));
  END IF;

  -- ssnit_tier1
  IF v_tier1 > 0.01 THEN
    SELECT * INTO v_existing
    FROM public.payroll_obligations
    WHERE business_id = p_business_id
      AND payroll_run_id = p_payroll_run_id
      AND obligation_type = 'ssnit_tier1'
      AND deleted_at IS NULL
    LIMIT 1;

    IF FOUND THEN
      v_posted_paid := public.payroll_obligation_posted_payments_total(v_existing.id);
      IF ABS(COALESCE(v_existing.amount_due, 0) - v_tier1) > v_tol
         OR COALESCE(v_existing.liability_account_code, '') IS DISTINCT FROM v_tier1_code
         OR ABS(COALESCE(v_existing.amount_paid, 0) - v_posted_paid) > v_tol THEN
        PERFORM public.raise_payroll_approval_error(
          'PAYROLL_APPROVAL_INCONSISTENT_STATE',
          'Conflicting ssnit_tier1 obligation for this payroll run',
          jsonb_build_object(
            'code', 'PAYROLL_APPROVAL_INCONSISTENT_STATE',
            'obligationType', 'ssnit_tier1',
            'existingAmountDue', v_existing.amount_due,
            'expectedAmountDue', v_tier1
          )
        );
      END IF;
      UPDATE public.payroll_obligations
      SET
        label = 'SSNIT / Tier 1 pension remittance',
        status = public.payroll_obligation_status(amount_due, COALESCE(amount_paid, 0)),
        updated_at = NOW()
      WHERE id = v_existing.id
      RETURNING id INTO v_id;
    ELSE
      INSERT INTO public.payroll_obligations (
        business_id, payroll_run_id, obligation_type, label, amount_due, amount_paid,
        status, due_date, liability_account_code
      ) VALUES (
        p_business_id, p_payroll_run_id, 'ssnit_tier1', 'SSNIT / Tier 1 pension remittance',
        v_tier1, 0, 'unpaid', NULL, v_tier1_code
      ) RETURNING id INTO v_id;
    END IF;
    v_ids := v_ids || jsonb_build_array(jsonb_build_object('type', 'ssnit_tier1', 'id', v_id, 'amount', v_tier1));
  END IF;

  -- tier2_pension
  IF v_tier2 > 0.01 THEN
    SELECT * INTO v_existing
    FROM public.payroll_obligations
    WHERE business_id = p_business_id
      AND payroll_run_id = p_payroll_run_id
      AND obligation_type = 'tier2_pension'
      AND deleted_at IS NULL
    LIMIT 1;

    IF FOUND THEN
      v_posted_paid := public.payroll_obligation_posted_payments_total(v_existing.id);
      IF ABS(COALESCE(v_existing.amount_due, 0) - v_tier2) > v_tol
         OR COALESCE(v_existing.liability_account_code, '') IS DISTINCT FROM v_tier2_code
         OR ABS(COALESCE(v_existing.amount_paid, 0) - v_posted_paid) > v_tol THEN
        PERFORM public.raise_payroll_approval_error(
          'PAYROLL_APPROVAL_INCONSISTENT_STATE',
          'Conflicting tier2_pension obligation for this payroll run',
          jsonb_build_object(
            'code', 'PAYROLL_APPROVAL_INCONSISTENT_STATE',
            'obligationType', 'tier2_pension',
            'existingAmountDue', v_existing.amount_due,
            'expectedAmountDue', v_tier2
          )
        );
      END IF;
      UPDATE public.payroll_obligations
      SET
        label = 'Tier 2 pension remittance',
        status = public.payroll_obligation_status(amount_due, COALESCE(amount_paid, 0)),
        updated_at = NOW()
      WHERE id = v_existing.id
      RETURNING id INTO v_id;
    ELSE
      INSERT INTO public.payroll_obligations (
        business_id, payroll_run_id, obligation_type, label, amount_due, amount_paid,
        status, due_date, liability_account_code
      ) VALUES (
        p_business_id, p_payroll_run_id, 'tier2_pension', 'Tier 2 pension remittance',
        v_tier2, 0, 'unpaid', NULL, v_tier2_code
      ) RETURNING id INTO v_id;
    END IF;
    v_ids := v_ids || jsonb_build_array(jsonb_build_object('type', 'tier2_pension', 'id', v_id, 'amount', v_tier2));
  END IF;

  -- other_employee_deductions = residual EXTERNAL only (never seed amount_paid from advances)
  IF v_external_deductions > 0.01 THEN
    SELECT * INTO v_existing
    FROM public.payroll_obligations
    WHERE business_id = p_business_id
      AND payroll_run_id = p_payroll_run_id
      AND obligation_type = 'other_employee_deductions'
      AND deleted_at IS NULL
    LIMIT 1;

    IF FOUND THEN
      v_posted_paid := public.payroll_obligation_posted_payments_total(v_existing.id);
      IF ABS(COALESCE(v_existing.amount_due, 0) - v_external_deductions) > v_tol
         OR COALESCE(v_existing.liability_account_code, '') IS DISTINCT FROM '2241'
         OR ABS(COALESCE(v_existing.amount_paid, 0) - v_posted_paid) > v_tol THEN
        PERFORM public.raise_payroll_approval_error(
          'PAYROLL_APPROVAL_INCONSISTENT_STATE',
          'Conflicting other_employee_deductions obligation for this payroll run',
          jsonb_build_object(
            'code', 'PAYROLL_APPROVAL_INCONSISTENT_STATE',
            'obligationType', 'other_employee_deductions',
            'existingAmountDue', v_existing.amount_due,
            'expectedAmountDue', v_external_deductions,
            'totalDeductions', v_total_deductions,
            'advanceRecovered', v_advance_recovered,
            'externalDeductions', v_external_deductions
          )
        );
      END IF;
      UPDATE public.payroll_obligations
      SET
        label = 'Employee deductions / recoveries',
        status = public.payroll_obligation_status(amount_due, COALESCE(amount_paid, 0)),
        updated_at = NOW()
      WHERE id = v_existing.id
      RETURNING id INTO v_id;
    ELSE
      INSERT INTO public.payroll_obligations (
        business_id, payroll_run_id, obligation_type, label, amount_due, amount_paid,
        status, due_date, liability_account_code
      ) VALUES (
        p_business_id, p_payroll_run_id, 'other_employee_deductions',
        'Employee deductions / recoveries',
        v_external_deductions, 0, 'unpaid', NULL, '2241'
      ) RETURNING id INTO v_id;
    END IF;
    v_ids := v_ids || jsonb_build_array(jsonb_build_object(
      'type', 'other_employee_deductions',
      'id', v_id,
      'amount', v_external_deductions
    ));
  ELSE
    -- Residual zero: any active other_employee_deductions is inconsistent for first approval
    IF EXISTS (
      SELECT 1 FROM public.payroll_obligations o
      WHERE o.business_id = p_business_id
        AND o.payroll_run_id = p_payroll_run_id
        AND o.obligation_type = 'other_employee_deductions'
        AND o.deleted_at IS NULL
    ) THEN
      PERFORM public.raise_payroll_approval_error(
        'PAYROLL_APPROVAL_INCONSISTENT_STATE',
        'Unexpected other_employee_deductions when external deductions are zero',
        jsonb_build_object(
          'code', 'PAYROLL_APPROVAL_INCONSISTENT_STATE',
          'totalDeductions', v_total_deductions,
          'advanceRecovered', v_advance_recovered,
          'externalDeductions', v_external_deductions
        )
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'obligations', v_ids,
    'tier1', v_tier1,
    'tier2', v_tier2,
    'totalDeductions', v_total_deductions,
    'advanceRecovered', v_advance_recovered,
    'externalDeductions', v_external_deductions,
    'salaryAdvanceRecoveryTotal', v_advance_recovered,
    'externalEmployeeDeductionsTotal', v_external_deductions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_payroll_obligations_for_approval(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_payroll_obligations_for_approval(UUID, UUID) TO postgres;


CREATE OR REPLACE FUNCTION public.payroll_approval_obligations_consistent(
  p_business_id UUID,
  p_payroll_run_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run RECORD;
  v_tier1 NUMERIC := 0;
  v_tier2 NUMERIC := 0;
  v_agg NUMERIC := 0;
  v_t1s NUMERIC := 0;
  v_t2s NUMERIC := 0;
  v_obl RECORD;
  v_expected_types TEXT[] := ARRAY[]::TEXT[];
  v_type TEXT;
  v_count INT;
  v_tol NUMERIC := 0.01;
  v_total_deductions NUMERIC := 0;
  v_advance_recovered NUMERIC := 0;
  v_external_deductions NUMERIC := 0;
  v_has_2232 BOOLEAN := false;
  v_tier1_code TEXT := '2231';
  v_tier2_code TEXT := '2232';
  v_expected_code TEXT;
  v_expected_due NUMERIC;
  v_posted_paid NUMERIC := 0;
  v_bad_repay INT := 0;
BEGIN
  SELECT * INTO v_run
  FROM public.payroll_runs
  WHERE id = p_payroll_run_id AND business_id = p_business_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Included entries only
  SELECT
    COALESCE(SUM(COALESCE(pe.tier1_ssnit_remittance, 0)), 0),
    COALESCE(SUM(COALESCE(pe.tier2_pension_remittance, 0)), 0)
  INTO v_t1s, v_t2s
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE;

  v_agg := COALESCE(v_run.total_ssnit_employee, 0) + COALESCE(v_run.total_ssnit_employer, 0);
  IF v_agg <= 0.01 THEN
    v_tier1 := 0;
    v_tier2 := 0;
  ELSIF
    v_t1s >= 0
    AND v_t2s >= 0
    AND (v_t1s + v_t2s) > 0.01
    AND ABS((v_t1s + v_t2s) - v_agg) <= 0.02
  THEN
    v_tier1 := ROUND(v_t1s::NUMERIC, 2);
    v_tier2 := ROUND(v_t2s::NUMERIC, 2);
  ELSE
    RETURN FALSE;
  END IF;

  SELECT COUNT(*) INTO v_bad_repay
  FROM public.salary_advance_repayments sar
  LEFT JOIN public.payroll_entries pe ON pe.id = sar.payroll_entry_id
  WHERE sar.business_id = p_business_id
    AND sar.payroll_run_id = p_payroll_run_id
    AND sar.status = 'posted'
    AND (
      sar.payroll_entry_id IS NULL
      OR pe.id IS NULL
      OR pe.payroll_run_id IS DISTINCT FROM p_payroll_run_id
      OR pe.is_included IS FALSE
      OR (sar.staff_id IS NOT NULL AND pe.staff_id IS DISTINCT FROM sar.staff_id)
    );
  IF v_bad_repay > 0 THEN
    RETURN FALSE;
  END IF;

  SELECT COALESCE(SUM(sar.amount), 0)
  INTO v_advance_recovered
  FROM public.salary_advance_repayments sar
  JOIN public.payroll_entries pe ON pe.id = sar.payroll_entry_id
  WHERE sar.business_id = p_business_id
    AND sar.payroll_run_id = p_payroll_run_id
    AND sar.status = 'posted'
    AND pe.is_included IS DISTINCT FROM FALSE;

  v_total_deductions := ROUND(COALESCE(v_run.total_deductions, 0)::NUMERIC, 2);
  v_advance_recovered := ROUND(COALESCE(v_advance_recovered, 0)::NUMERIC, 2);

  IF v_advance_recovered > v_total_deductions + v_tol THEN
    RETURN FALSE;
  END IF;

  v_external_deductions := ROUND(GREATEST(0, v_total_deductions - v_advance_recovered), 2);

  SELECT EXISTS (
    SELECT 1
    FROM public.journal_entry_lines jel
    JOIN public.accounts a ON a.id = jel.account_id
    WHERE jel.journal_entry_id = v_run.journal_entry_id
      AND a.business_id = p_business_id
      AND a.code = '2232'
      AND a.deleted_at IS NULL
      AND jel.credit > 0.01
  ) INTO v_has_2232;

  IF NOT v_has_2232 THEN
    v_tier1_code := '2231';
    v_tier2_code := '2231';
  END IF;

  IF COALESCE(v_run.total_net_salary, 0) > 0.01 THEN
    v_expected_types := array_append(v_expected_types, 'salary_net');
  END IF;
  IF COALESCE(v_run.total_paye, 0) > 0.01 THEN
    v_expected_types := array_append(v_expected_types, 'paye_gra');
  END IF;
  IF v_tier1 > 0.01 THEN
    v_expected_types := array_append(v_expected_types, 'ssnit_tier1');
  END IF;
  IF v_tier2 > 0.01 THEN
    v_expected_types := array_append(v_expected_types, 'tier2_pension');
  END IF;
  IF v_external_deductions > 0.01 THEN
    v_expected_types := array_append(v_expected_types, 'other_employee_deductions');
  END IF;

  -- Reject unexpected / duplicate obligations
  SELECT COUNT(*) INTO v_count
  FROM public.payroll_obligations
  WHERE business_id = p_business_id
    AND payroll_run_id = p_payroll_run_id
    AND deleted_at IS NULL
    AND (
      COALESCE(cardinality(v_expected_types), 0) = 0
      OR NOT (obligation_type = ANY (v_expected_types))
    );
  IF v_count > 0 THEN
    RETURN FALSE;
  END IF;

  FOREACH v_type IN ARRAY COALESCE(v_expected_types, ARRAY[]::TEXT[]) LOOP
    SELECT COUNT(*) INTO v_count
    FROM public.payroll_obligations
    WHERE business_id = p_business_id
      AND payroll_run_id = p_payroll_run_id
      AND obligation_type = v_type
      AND deleted_at IS NULL;
    IF v_count <> 1 THEN
      RETURN FALSE;
    END IF;

    SELECT * INTO v_obl
    FROM public.payroll_obligations
    WHERE business_id = p_business_id
      AND payroll_run_id = p_payroll_run_id
      AND obligation_type = v_type
      AND deleted_at IS NULL
    LIMIT 1;

    IF v_obl.business_id IS DISTINCT FROM p_business_id
       OR v_obl.payroll_run_id IS DISTINCT FROM p_payroll_run_id
       OR v_obl.deleted_at IS NOT NULL THEN
      RETURN FALSE;
    END IF;

    IF v_type = 'salary_net' THEN
      v_expected_due := ROUND(COALESCE(v_run.total_net_salary, 0)::NUMERIC, 2);
      v_expected_code := '2240';
    ELSIF v_type = 'paye_gra' THEN
      v_expected_due := ROUND(COALESCE(v_run.total_paye, 0)::NUMERIC, 2);
      v_expected_code := '2230';
    ELSIF v_type = 'ssnit_tier1' THEN
      v_expected_due := v_tier1;
      v_expected_code := v_tier1_code;
    ELSIF v_type = 'tier2_pension' THEN
      v_expected_due := v_tier2;
      v_expected_code := v_tier2_code;
    ELSIF v_type = 'other_employee_deductions' THEN
      v_expected_due := v_external_deductions;
      v_expected_code := '2241';
    ELSE
      RETURN FALSE;
    END IF;

    IF ABS(COALESCE(v_obl.amount_due, 0) - v_expected_due) > v_tol THEN
      RETURN FALSE;
    END IF;

    -- Reject gross-deduction obligation when residual differs
    IF v_type = 'other_employee_deductions'
       AND ABS(COALESCE(v_obl.amount_due, 0) - v_total_deductions) <= v_tol
       AND ABS(v_external_deductions - v_total_deductions) > v_tol THEN
      RETURN FALSE;
    END IF;

    IF COALESCE(v_obl.liability_account_code, '') IS DISTINCT FROM v_expected_code THEN
      RETURN FALSE;
    END IF;

    IF COALESCE(v_obl.amount_paid, 0) - COALESCE(v_obl.amount_due, 0) > v_tol THEN
      RETURN FALSE;
    END IF;

    v_posted_paid := public.payroll_obligation_posted_payments_total(v_obl.id);
    IF ABS(COALESCE(v_obl.amount_paid, 0) - v_posted_paid) > v_tol THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  -- Residual zero: other_employee_deductions must be absent
  IF v_external_deductions <= v_tol THEN
    SELECT COUNT(*) INTO v_count
    FROM public.payroll_obligations
    WHERE business_id = p_business_id
      AND payroll_run_id = p_payroll_run_id
      AND obligation_type = 'other_employee_deductions'
      AND deleted_at IS NULL;
    IF v_count > 0 THEN
      RETURN FALSE;
    END IF;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_approval_obligations_consistent(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_approval_obligations_consistent(UUID, UUID) TO postgres;

-- ---------------------------------------------------------------------------
-- Atomic approval: audit / response expose external vs advance recovery totals
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_payroll_run_atomic(
  p_business_id UUID,
  p_payroll_run_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_run public.payroll_runs%ROWTYPE;
  v_entry_count INT := 0;
  v_journal_count INT := 0;
  v_journal_id UUID;
  v_active_journal UUID;
  v_obl JSONB;
  v_advance_total NUMERIC := 0;
  v_external_total NUMERIC := 0;
  v_total_deductions NUMERIC := 0;
  v_audit_count INT := 0;
  v_audit_id UUID;
  v_recomputed RECORD;
  v_diffs JSONB := '[]'::jsonb;
  v_tol NUMERIC := 0.01;
  v_msg TEXT;
  v_repay_dup INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_PERMISSION_DENIED',
      'Authentication required for payroll approval',
      jsonb_build_object('code', 'PAYROLL_APPROVAL_PERMISSION_DENIED')
    );
  END IF;

  IF p_business_id IS NULL OR p_payroll_run_id IS NULL THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_CONFLICT',
      'business_id and payroll_run_id are required'
    );
  END IF;

  IF NOT public.finza_user_can_access_business(p_business_id) THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_PERMISSION_DENIED',
      'Not authorized to approve payroll for this business',
      jsonb_build_object('code', 'PAYROLL_APPROVAL_PERMISSION_DENIED')
    );
  END IF;

  IF NOT public.finza_user_has_permission(p_business_id, 'payroll.approve') THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_PERMISSION_DENIED',
      'Payroll approval permission required',
      jsonb_build_object('code', 'PAYROLL_APPROVAL_PERMISSION_DENIED')
    );
  END IF;

  SELECT * INTO v_run
  FROM public.payroll_runs
  WHERE id = p_payroll_run_id
  FOR UPDATE;

  IF NOT FOUND OR v_run.deleted_at IS NOT NULL THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_CONFLICT',
      'Payroll run not found'
    );
  END IF;

  IF v_run.business_id IS DISTINCT FROM p_business_id THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_CONFLICT',
      'Payroll run does not belong to the requested business'
    );
  END IF;

  SELECT COUNT(*) INTO v_journal_count
  FROM public.journal_entries je
  WHERE je.business_id = p_business_id
    AND je.reference_type = 'payroll'
    AND je.reference_id = p_payroll_run_id;

  IF v_journal_count > 1 THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_INCONSISTENT_STATE',
      'Multiple payroll journals exist for this run',
      jsonb_build_object('code', 'PAYROLL_APPROVAL_INCONSISTENT_STATE', 'journalCount', v_journal_count)
    );
  END IF;

  SELECT je.id INTO v_active_journal
  FROM public.journal_entries je
  WHERE je.business_id = p_business_id
    AND je.reference_type = 'payroll'
    AND je.reference_id = p_payroll_run_id
  ORDER BY je.created_at ASC
  LIMIT 1;

  IF v_run.status = 'draft' AND v_run.journal_entry_id IS NOT NULL THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_INCONSISTENT_STATE',
      'Draft payroll run already has a journal_entry_id'
    );
  END IF;

  IF v_run.status IN ('approved', 'locked') THEN
    IF v_run.journal_entry_id IS NULL THEN
      PERFORM public.raise_payroll_approval_error(
        'PAYROLL_APPROVAL_INCONSISTENT_STATE',
        format('%s payroll run is missing journal_entry_id', v_run.status)
      );
    END IF;

    IF v_journal_count <> 1 OR v_active_journal IS DISTINCT FROM v_run.journal_entry_id THEN
      PERFORM public.raise_payroll_approval_error(
        'PAYROLL_APPROVAL_INCONSISTENT_STATE',
        'Payroll journal reference does not match the run'
      );
    END IF;

    IF NOT public.payroll_approval_obligations_consistent(p_business_id, p_payroll_run_id) THEN
      PERFORM public.raise_payroll_approval_error(
        'PAYROLL_APPROVAL_INCONSISTENT_STATE',
        'Approved payroll obligations are incomplete or do not match run totals'
      );
    END IF;

    SELECT COUNT(*) INTO v_audit_count
    FROM public.audit_logs
    WHERE business_id = p_business_id
      AND entity_id = p_payroll_run_id
      AND action_type = 'payroll.run_approved'
      AND entity_type = 'payroll_run';

    IF v_audit_count <> 1 THEN
      PERFORM public.raise_payroll_approval_error(
        'PAYROLL_APPROVAL_INCONSISTENT_STATE',
        'Approved payroll is missing a unique approval audit event',
        jsonb_build_object('code', 'PAYROLL_APPROVAL_INCONSISTENT_STATE', 'auditCount', v_audit_count)
      );
    END IF;

    SELECT COUNT(*) INTO v_repay_dup
    FROM (
      SELECT idempotency_identity
      FROM public.salary_advance_repayments
      WHERE business_id = p_business_id
        AND payroll_run_id = p_payroll_run_id
        AND idempotency_identity IS NOT NULL
      GROUP BY idempotency_identity
      HAVING COUNT(*) > 1
    ) d;
    IF v_repay_dup > 0 THEN
      PERFORM public.raise_payroll_approval_error(
        'PAYROLL_APPROVAL_INCONSISTENT_STATE',
        'Duplicate salary-advance repayment identities for this payroll run'
      );
    END IF;

    SELECT COALESCE(SUM(sar.amount), 0) INTO v_advance_total
    FROM public.salary_advance_repayments sar
    JOIN public.payroll_entries pe ON pe.id = sar.payroll_entry_id
    WHERE sar.business_id = p_business_id
      AND sar.payroll_run_id = p_payroll_run_id
      AND sar.status = 'posted'
      AND pe.is_included IS DISTINCT FROM FALSE;

    v_total_deductions := ROUND(COALESCE(v_run.total_deductions, 0)::NUMERIC, 2);
    v_advance_total := ROUND(COALESCE(v_advance_total, 0)::NUMERIC, 2);
    v_external_total := ROUND(GREATEST(0, v_total_deductions - v_advance_total), 2);

    RETURN jsonb_build_object(
      'ok', true,
      'reused', true,
      'payroll_run_id', p_payroll_run_id,
      'business_id', p_business_id,
      'status', v_run.status,
      'journal_entry_id', v_run.journal_entry_id,
      'approved_at', v_run.approved_at,
      'approved_by', v_run.approved_by,
      'advance_recovery_total', v_advance_total,
      'totalDeductions', v_total_deductions,
      'advanceRecovered', v_advance_total,
      'externalDeductions', v_external_total,
      'salaryAdvanceRecoveryTotal', v_advance_total,
      'externalEmployeeDeductionsTotal', v_external_total
    );
  END IF;

  IF v_run.status IS DISTINCT FROM 'draft' THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_CONFLICT',
      format('Cannot approve payroll run in status "%s"', v_run.status)
    );
  END IF;

  IF v_run.journal_entry_id IS NOT NULL OR v_active_journal IS NOT NULL THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_INCONSISTENT_STATE',
      'Draft payroll already has a payroll journal'
    );
  END IF;

  PERFORM 1
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE
  ORDER BY pe.id
  FOR UPDATE;

  SELECT COUNT(*) INTO v_entry_count
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE;

  IF v_entry_count < 1 THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_CONFLICT',
      'Cannot approve an empty payroll run'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payroll_entries pe
    LEFT JOIN public.staff s ON s.id = pe.staff_id
    WHERE pe.payroll_run_id = p_payroll_run_id
      AND pe.is_included IS DISTINCT FROM FALSE
      AND (
        s.id IS NULL
        OR s.business_id IS DISTINCT FROM p_business_id
        OR COALESCE(pe.net_salary, 0) < -0.0001
        OR COALESCE(pe.gross_salary, 0) < -0.0001
        OR COALESCE(pe.paye, 0) < -0.0001
        OR COALESCE(pe.ssnit_employee, 0) < -0.0001
        OR COALESCE(pe.ssnit_employer, 0) < -0.0001
        OR COALESCE(pe.deductions_total, 0) < -0.0001
        OR COALESCE(pe.basic_salary, 0) < -0.0001
        OR COALESCE(pe.allowances_total, 0) < -0.0001
        OR pe.gross_salary IS NULL
        OR pe.net_salary IS NULL
      )
  ) THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_CONFLICT',
      'One or more included payroll entries fail monetary or ownership validation'
    );
  END IF;

  PERFORM public.payroll_ghana_validate_run_for_approval(p_business_id, v_run, v_entry_count);

  SELECT
    COALESCE(SUM(COALESCE(pe.basic_salary, 0)), 0) AS basic,
    COALESCE(SUM(COALESCE(pe.allowances_total, 0)), 0) AS allowances,
    COALESCE(SUM(COALESCE(pe.gross_salary, 0)), 0) AS gross,
    COALESCE(SUM(COALESCE(pe.ssnit_employee, 0)), 0) AS ssnit_employee,
    COALESCE(SUM(COALESCE(pe.ssnit_employer, 0)), 0) AS ssnit_employer,
    COALESCE(SUM(COALESCE(pe.paye, 0)), 0) AS paye,
    COALESCE(SUM(COALESCE(pe.deductions_total, 0)), 0) AS deductions,
    COALESCE(SUM(COALESCE(pe.net_salary, 0)), 0) AS net
  INTO v_recomputed
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE;

  IF ABS(COALESCE(v_run.total_basic_salary, 0) - v_recomputed.basic) > v_tol THEN
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'field', 'total_basic_salary',
      'stored', COALESCE(v_run.total_basic_salary, 0),
      'recomputed', v_recomputed.basic,
      'difference', COALESCE(v_run.total_basic_salary, 0) - v_recomputed.basic
    ));
  END IF;
  IF ABS(COALESCE(v_run.total_allowances, 0) - v_recomputed.allowances) > v_tol THEN
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'field', 'total_allowances',
      'stored', COALESCE(v_run.total_allowances, 0),
      'recomputed', v_recomputed.allowances,
      'difference', COALESCE(v_run.total_allowances, 0) - v_recomputed.allowances
    ));
  END IF;
  IF ABS(COALESCE(v_run.total_gross_salary, 0) - v_recomputed.gross) > v_tol THEN
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'field', 'total_gross_salary',
      'stored', COALESCE(v_run.total_gross_salary, 0),
      'recomputed', v_recomputed.gross,
      'difference', COALESCE(v_run.total_gross_salary, 0) - v_recomputed.gross
    ));
  END IF;
  IF ABS(COALESCE(v_run.total_ssnit_employee, 0) - v_recomputed.ssnit_employee) > v_tol THEN
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'field', 'total_ssnit_employee',
      'stored', COALESCE(v_run.total_ssnit_employee, 0),
      'recomputed', v_recomputed.ssnit_employee,
      'difference', COALESCE(v_run.total_ssnit_employee, 0) - v_recomputed.ssnit_employee
    ));
  END IF;
  IF ABS(COALESCE(v_run.total_ssnit_employer, 0) - v_recomputed.ssnit_employer) > v_tol THEN
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'field', 'total_ssnit_employer',
      'stored', COALESCE(v_run.total_ssnit_employer, 0),
      'recomputed', v_recomputed.ssnit_employer,
      'difference', COALESCE(v_run.total_ssnit_employer, 0) - v_recomputed.ssnit_employer
    ));
  END IF;
  IF ABS(COALESCE(v_run.total_paye, 0) - v_recomputed.paye) > v_tol THEN
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'field', 'total_paye',
      'stored', COALESCE(v_run.total_paye, 0),
      'recomputed', v_recomputed.paye,
      'difference', COALESCE(v_run.total_paye, 0) - v_recomputed.paye
    ));
  END IF;
  IF ABS(COALESCE(v_run.total_deductions, 0) - v_recomputed.deductions) > v_tol THEN
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'field', 'total_deductions',
      'stored', COALESCE(v_run.total_deductions, 0),
      'recomputed', v_recomputed.deductions,
      'difference', COALESCE(v_run.total_deductions, 0) - v_recomputed.deductions
    ));
  END IF;
  IF ABS(COALESCE(v_run.total_net_salary, 0) - v_recomputed.net) > v_tol THEN
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
      'field', 'total_net_salary',
      'stored', COALESCE(v_run.total_net_salary, 0),
      'recomputed', v_recomputed.net,
      'difference', COALESCE(v_run.total_net_salary, 0) - v_recomputed.net
    ));
  END IF;

  IF jsonb_array_length(v_diffs) > 0 THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_TOTALS_OUT_OF_SYNC',
      'Payroll run totals do not reconcile to included entries',
      jsonb_build_object(
        'code', 'PAYROLL_TOTALS_OUT_OF_SYNC',
        'differences', v_diffs
      )
    );
  END IF;

  BEGIN
    v_journal_id := public.post_payroll_to_ledger(p_payroll_run_id);
  EXCEPTION
    WHEN OTHERS THEN
      v_msg := SQLERRM;
      IF v_msg ILIKE '%period%closed%' OR v_msg ILIKE '%accounting period%' THEN
        PERFORM public.raise_payroll_approval_error(
          'PAYROLL_APPROVAL_PERIOD_CLOSED',
          v_msg,
          jsonb_build_object('code', 'PAYROLL_APPROVAL_PERIOD_CLOSED')
        );
      END IF;
      RAISE;
  END;

  IF v_journal_id IS NULL THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_CONFLICT',
      'Payroll journal posting returned no journal id'
    );
  END IF;

  SELECT * INTO v_run
  FROM public.payroll_runs
  WHERE id = p_payroll_run_id
  FOR UPDATE;

  IF v_run.journal_entry_id IS DISTINCT FROM v_journal_id THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_INCONSISTENT_STATE',
      'Payroll journal_entry_id does not match posted journal'
    );
  END IF;

  BEGIN
    v_obl := public.sync_payroll_obligations_for_approval(p_business_id, p_payroll_run_id);
  EXCEPTION
    WHEN unique_violation THEN
      PERFORM public.raise_payroll_approval_error(
        'PAYROLL_APPROVAL_OBLIGATION_FAILED',
        'Obligation uniqueness conflict during approval'
      );
    WHEN OTHERS THEN
      IF SQLERRM ILIKE '%PAYROLL_APPROVAL_%' OR SQLERRM ILIKE '%Conflicting%' THEN
        RAISE;
      END IF;
      PERFORM public.raise_payroll_approval_error(
        'PAYROLL_APPROVAL_OBLIGATION_FAILED',
        SQLERRM
      );
  END;

  v_total_deductions := COALESCE((v_obl->>'totalDeductions')::NUMERIC, COALESCE(v_run.total_deductions, 0));
  v_advance_total := COALESCE((v_obl->>'advanceRecovered')::NUMERIC, 0);
  v_external_total := COALESCE((v_obl->>'externalDeductions')::NUMERIC, 0);

  UPDATE public.payroll_runs
  SET
    status = 'approved',
    approved_at = NOW(),
    approved_by = v_uid,
    journal_entry_id = v_journal_id,
    updated_at = NOW()
  WHERE id = p_payroll_run_id
    AND business_id = p_business_id
    AND status = 'draft'
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_APPROVAL_CONFLICT',
      'Payroll run status changed during approval'
    );
  END IF;

  BEGIN
    v_audit_id := public.create_audit_log(
      p_business_id,
      v_uid,
      'payroll.run_approved',
      'payroll_run',
      p_payroll_run_id,
      jsonb_build_object('status', 'draft'),
      jsonb_build_object(
        'status', 'approved',
        'journal_entry_id', v_journal_id,
        'totals', jsonb_build_object(
          'total_basic_salary', v_run.total_basic_salary,
          'total_gross_salary', v_run.total_gross_salary,
          'total_allowances', v_run.total_allowances,
          'total_ssnit_employee', v_run.total_ssnit_employee,
          'total_ssnit_employer', v_run.total_ssnit_employer,
          'total_paye', v_run.total_paye,
          'total_deductions', v_run.total_deductions,
          'total_net_salary', v_run.total_net_salary
        ),
        'obligations', COALESCE(v_obl->'obligations', '[]'::jsonb),
        'salary_advance_recovery_total', v_advance_total,
        'salaryAdvanceRecoveryTotal', v_advance_total,
        'externalEmployeeDeductionsTotal', v_external_total,
        'totalDeductions', v_total_deductions,
        'advanceRecovered', v_advance_total,
        'externalDeductions', v_external_total
      ),
      NULL,
      NULL,
      format('Payroll run %s approved atomically', p_payroll_run_id)
    );
  EXCEPTION
    WHEN unique_violation THEN
      PERFORM public.raise_payroll_approval_error(
        'PAYROLL_APPROVAL_INCONSISTENT_STATE',
        'Duplicate approval audit event during approval'
      );
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'reused', false,
    'payroll_run_id', p_payroll_run_id,
    'business_id', p_business_id,
    'status', 'approved',
    'journal_entry_id', v_journal_id,
    'approved_by', v_uid,
    'advance_recovery_total', v_advance_total,
    'totalDeductions', v_total_deductions,
    'advanceRecovered', v_advance_total,
    'externalDeductions', v_external_total,
    'salaryAdvanceRecoveryTotal', v_advance_total,
    'externalEmployeeDeductionsTotal', v_external_total,
    'obligations', COALESCE(v_obl->'obligations', '[]'::jsonb),
    'audit_log_id', v_audit_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_payroll_run_atomic(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_payroll_run_atomic(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.approve_payroll_run_atomic(UUID, UUID) IS
  'Atomically approve a draft payroll run. External deduction obligations exclude salary-advance recoveries.';

-- Re-assert helper revokes after REPLACE
REVOKE ALL ON FUNCTION public.payroll_obligation_posted_payments_total(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_payroll_obligations_for_approval(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_approval_obligations_consistent(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_ghana_validate_run_for_approval(UUID, public.payroll_runs, INT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raise_payroll_approval_error(TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_next_month_paye_due_date(DATE)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_obligation_status(NUMERIC, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_obligation_posted_payments_total(UUID) TO postgres;
GRANT EXECUTE ON FUNCTION public.sync_payroll_obligations_for_approval(UUID, UUID) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_approval_obligations_consistent(UUID, UUID) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_validate_run_for_approval(UUID, public.payroll_runs, INT) TO postgres;
GRANT EXECUTE ON FUNCTION public.raise_payroll_approval_error(TEXT, TEXT, JSONB) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_next_month_paye_due_date(DATE) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_obligation_status(NUMERIC, NUMERIC) TO postgres;
