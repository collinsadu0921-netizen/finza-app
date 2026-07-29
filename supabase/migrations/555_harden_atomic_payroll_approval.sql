-- ============================================================================
-- Migration 555: Harden atomic payroll approval (post-554)
-- ============================================================================
-- Does NOT edit migration 554. Production untouched.
-- - Revoke direct EXECUTE on internal mutation helpers
-- - Enforce payroll.approve inside approve_payroll_run_atomic
-- - Reject ALL conflicting existing obligations (including unpaid)
-- - Guarantee unique active obligations + unique payroll journals
-- - Reconcile total_basic_salary
-- - Strengthen reused-approval consistency (incl. audit event)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Schema: total_basic_salary on payroll_runs
-- ---------------------------------------------------------------------------
ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS total_basic_salary NUMERIC DEFAULT 0;

COMMENT ON COLUMN public.payroll_runs.total_basic_salary IS
  'Sum of included payroll_entries.basic_salary. Reconciled under lock during atomic approval.';

-- ---------------------------------------------------------------------------
-- 1) Fail-closed uniqueness: payroll journals
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_dups TEXT;
BEGIN
  SELECT string_agg(format('business=%s run=%s count=%s', business_id, reference_id, n), '; ')
  INTO v_dups
  FROM (
    SELECT business_id, reference_id, COUNT(*)::INT AS n
    FROM public.journal_entries
    WHERE reference_type = 'payroll'
      AND reference_id IS NOT NULL
    GROUP BY business_id, reference_id
    HAVING COUNT(*) > 1
    LIMIT 50
  ) d;

  IF v_dups IS NOT NULL THEN
    RAISE EXCEPTION 'PAYROLL_JOURNAL_DUPLICATES_BLOCK_INDEX: %', v_dups;
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS ux_journal_entries_one_payroll_reference
    ON public.journal_entries (business_id, reference_id)
    WHERE reference_type = 'payroll' AND reference_id IS NOT NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Fail-closed uniqueness: active obligations
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_dups TEXT;
BEGIN
  SELECT string_agg(
    format('business=%s run=%s type=%s count=%s', business_id, payroll_run_id, obligation_type, n),
    '; '
  )
  INTO v_dups
  FROM (
    SELECT business_id, payroll_run_id, obligation_type, COUNT(*)::INT AS n
    FROM public.payroll_obligations
    WHERE deleted_at IS NULL
    GROUP BY business_id, payroll_run_id, obligation_type
    HAVING COUNT(*) > 1
    LIMIT 50
  ) d;

  IF v_dups IS NOT NULL THEN
    RAISE EXCEPTION 'PAYROLL_OBLIGATION_DUPLICATES_BLOCK_INDEX: %', v_dups;
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_obligations_unique_active
    ON public.payroll_obligations (business_id, payroll_run_id, obligation_type)
    WHERE deleted_at IS NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Permission helper (mirrors lib/permissions.ts for payroll.approve)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finza_user_has_permission(
  p_business_id UUID,
  p_permission TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_custom JSONB;
  v_has BOOLEAN := FALSE;
  v_defaults TEXT[];
BEGIN
  IF v_uid IS NULL OR p_business_id IS NULL OR NULLIF(TRIM(COALESCE(p_permission, '')), '') IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Business owner always has every permission
  IF EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = p_business_id AND b.owner_id = v_uid
  ) THEN
    RETURN TRUE;
  END IF;

  SELECT bu.role, COALESCE(bu.custom_permissions, '{}'::jsonb)
  INTO v_role, v_custom
  FROM public.business_users bu
  WHERE bu.business_id = p_business_id
    AND bu.user_id = v_uid
  LIMIT 1;

  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_role = 'owner' THEN
    RETURN TRUE;
  END IF;

  -- Role defaults (subset aligned with lib/permissions.ts ROLE_DEFAULTS)
  IF v_role = 'admin' THEN
    -- admin defaults to all permissions
    v_has := TRUE;
  ELSIF v_role = 'manager' THEN
    v_defaults := ARRAY[
      'customers.view','customers.create','invoices.view','invoices.create','invoices.send',
      'estimates.view','estimates.create','jobs.view','jobs.create','jobs.update',
      'bills.view','expenses.view','expenses.create','reports.view','settings.view',
      'team.manage','staff.manage'
    ];
    v_has := p_permission = ANY (v_defaults);
  ELSIF v_role = 'accountant' THEN
    v_defaults := ARRAY[
      'customers.view','invoices.view','estimates.view','bills.view','bills.create',
      'expenses.view','expenses.create','reports.view','accounting.view','accounting.reconcile',
      'accounting.close_period','payroll.view','settings.view'
    ];
    v_has := p_permission = ANY (v_defaults);
  ELSIF v_role = 'staff' THEN
    v_defaults := ARRAY[
      'customers.view','invoices.view','jobs.view','jobs.update','settings.view'
    ];
    v_has := p_permission = ANY (v_defaults);
  ELSIF v_role = 'employee' THEN
    v_defaults := ARRAY['customers.view','jobs.view','jobs.update'];
    v_has := p_permission = ANY (v_defaults);
  ELSE
    v_has := FALSE;
  END IF;

  -- custom_permissions.granted
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(v_custom->'granted', '[]'::jsonb)) g(val)
    WHERE g.val = p_permission
  ) THEN
    v_has := TRUE;
  END IF;

  -- custom_permissions.revoked
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(v_custom->'revoked', '[]'::jsonb)) r(val)
    WHERE r.val = p_permission
  ) THEN
    v_has := FALSE;
  END IF;

  RETURN v_has;
END;
$$;

REVOKE ALL ON FUNCTION public.finza_user_has_permission(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finza_user_has_permission(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.finza_user_has_permission(UUID, TEXT) IS
  'Effective permission check for auth.uid(): owner always true; else role defaults + custom_permissions granted − revoked.';

-- ---------------------------------------------------------------------------
-- 4) Revoke direct EXECUTE on internal helpers from clients
-- ---------------------------------------------------------------------------
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

-- Owner (postgres / migration role) retains EXECUTE for SECURITY DEFINER composition.
GRANT EXECUTE ON FUNCTION public.sync_payroll_obligations_for_approval(UUID, UUID) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_approval_obligations_consistent(UUID, UUID) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_validate_run_for_approval(UUID, public.payroll_runs, INT) TO postgres;
GRANT EXECUTE ON FUNCTION public.raise_payroll_approval_error(TEXT, TEXT, JSONB) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_next_month_paye_due_date(DATE) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_obligation_status(NUMERIC, NUMERIC) TO postgres;

-- Only public RPC for approval mutation
REVOKE ALL ON FUNCTION public.approve_payroll_run_atomic(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_payroll_run_atomic(UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Obligation sync: fail closed on ANY conflict (including unpaid)
-- ---------------------------------------------------------------------------
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
  v_advance_recovered NUMERIC := 0;
  v_other_due NUMERIC := 0;
  v_other_paid_internal NUMERIC := 0;
  v_has_2232 BOOLEAN := false;
  v_tier1_code TEXT := '2231';
  v_tier2_code TEXT := '2232';
  v_existing RECORD;
  v_ids JSONB := '[]'::jsonb;
  v_id UUID;
  v_tol NUMERIC := 0.01;
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

  SELECT
    COALESCE(SUM(COALESCE(pe.tier1_ssnit_remittance, 0)), 0),
    COALESCE(SUM(COALESCE(pe.tier2_pension_remittance, 0)), 0)
  INTO v_tier1_snap, v_tier2_snap
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id;

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

  SELECT COALESCE(SUM(sar.amount), 0)
  INTO v_advance_recovered
  FROM public.salary_advance_repayments sar
  WHERE sar.business_id = p_business_id
    AND sar.payroll_run_id = p_payroll_run_id
    AND sar.status = 'posted';

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

  -- Local helper pattern: assert match or insert; never rewrite conflicting amounts
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
      IF ABS(COALESCE(v_existing.amount_due, 0) - ROUND(v_run.total_net_salary::NUMERIC, 2)) > v_tol
         OR COALESCE(v_existing.liability_account_code, '') IS DISTINCT FROM '2240'
         OR v_existing.business_id IS DISTINCT FROM p_business_id
         OR v_existing.payroll_run_id IS DISTINCT FROM p_payroll_run_id THEN
        PERFORM public.raise_payroll_approval_error(
          'PAYROLL_APPROVAL_INCONSISTENT_STATE',
          'Conflicting salary_net obligation for this payroll run',
          jsonb_build_object(
            'code', 'PAYROLL_APPROVAL_INCONSISTENT_STATE',
            'obligationType', 'salary_net',
            'existingAmountDue', v_existing.amount_due,
            'expectedAmountDue', ROUND(v_run.total_net_salary::NUMERIC, 2)
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
      IF ABS(COALESCE(v_existing.amount_due, 0) - ROUND(v_run.total_paye::NUMERIC, 2)) > v_tol
         OR COALESCE(v_existing.liability_account_code, '') IS DISTINCT FROM '2230' THEN
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
      IF ABS(COALESCE(v_existing.amount_due, 0) - v_tier1) > v_tol
         OR COALESCE(v_existing.liability_account_code, '') IS DISTINCT FROM v_tier1_code THEN
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
      IF ABS(COALESCE(v_existing.amount_due, 0) - v_tier2) > v_tol
         OR COALESCE(v_existing.liability_account_code, '') IS DISTINCT FROM v_tier2_code THEN
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

  -- other_employee_deductions
  v_other_due := ROUND(COALESCE(v_run.total_deductions, 0)::NUMERIC, 2);
  v_other_paid_internal := CASE
    WHEN v_other_due <= 0.01 OR v_advance_recovered <= 0.01 THEN 0
    ELSE LEAST(v_other_due, ROUND(v_advance_recovered::NUMERIC, 2))
  END;

  IF v_other_due > 0.01 THEN
    SELECT * INTO v_existing
    FROM public.payroll_obligations
    WHERE business_id = p_business_id
      AND payroll_run_id = p_payroll_run_id
      AND obligation_type = 'other_employee_deductions'
      AND deleted_at IS NULL
    LIMIT 1;

    IF FOUND THEN
      IF ABS(COALESCE(v_existing.amount_due, 0) - v_other_due) > v_tol
         OR COALESCE(v_existing.liability_account_code, '') IS DISTINCT FROM '2241' THEN
        PERFORM public.raise_payroll_approval_error(
          'PAYROLL_APPROVAL_INCONSISTENT_STATE',
          'Conflicting other_employee_deductions obligation for this payroll run',
          jsonb_build_object(
            'code', 'PAYROLL_APPROVAL_INCONSISTENT_STATE',
            'obligationType', 'other_employee_deductions',
            'existingAmountDue', v_existing.amount_due,
            'expectedAmountDue', v_other_due
          )
        );
      END IF;
      UPDATE public.payroll_obligations
      SET
        label = CASE
          WHEN COALESCE(amount_paid, 0) >= amount_due - 0.01 THEN 'Salary advance recoveries'
          ELSE 'Employee deductions / recoveries'
        END,
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
        CASE
          WHEN v_other_paid_internal >= v_other_due - 0.01 THEN 'Salary advance recoveries'
          ELSE 'Employee deductions / recoveries'
        END,
        v_other_due, v_other_paid_internal,
        public.payroll_obligation_status(v_other_due, v_other_paid_internal),
        NULL, '2241'
      ) RETURNING id INTO v_id;
    END IF;
    v_ids := v_ids || jsonb_build_array(jsonb_build_object(
      'type', 'other_employee_deductions',
      'id', v_id,
      'amount', v_other_due,
      'excludedAdvanceRecoveries', v_other_paid_internal
    ));
  END IF;

  RETURN jsonb_build_object(
    'obligations', v_ids,
    'tier1', v_tier1,
    'tier2', v_tier2,
    'advanceRecovered', v_advance_recovered,
    'otherDeductionsDue', v_other_due,
    'otherDeductionsPaidInternal', v_other_paid_internal
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_payroll_obligations_for_approval(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_payroll_obligations_for_approval(UUID, UUID) TO postgres;

-- ---------------------------------------------------------------------------
-- 6) Stronger consistency check (reuse path)
-- ---------------------------------------------------------------------------
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
  v_tier1 NUMERIC;
  v_tier2 NUMERIC;
  v_agg NUMERIC;
  v_t1s NUMERIC;
  v_t2s NUMERIC;
  v_obl RECORD;
  v_expected_types TEXT[] := ARRAY[]::TEXT[];
  v_type TEXT;
  v_count INT;
BEGIN
  SELECT * INTO v_run
  FROM public.payroll_runs
  WHERE id = p_payroll_run_id AND business_id = p_business_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  SELECT COALESCE(SUM(tier1_ssnit_remittance),0), COALESCE(SUM(tier2_pension_remittance),0)
  INTO v_t1s, v_t2s
  FROM public.payroll_entries WHERE payroll_run_id = p_payroll_run_id;

  v_agg := COALESCE(v_run.total_ssnit_employee,0) + COALESCE(v_run.total_ssnit_employer,0);
  IF v_agg <= 0.01 THEN
    v_tier1 := 0; v_tier2 := 0;
  ELSIF ABS((v_t1s + v_t2s) - v_agg) <= 0.02 THEN
    v_tier1 := ROUND(v_t1s, 2); v_tier2 := ROUND(v_t2s, 2);
  ELSE
    RETURN FALSE;
  END IF;

  IF COALESCE(v_run.total_net_salary,0) > 0.01 THEN
    v_expected_types := array_append(v_expected_types, 'salary_net');
  END IF;
  IF COALESCE(v_run.total_paye,0) > 0.01 THEN
    v_expected_types := array_append(v_expected_types, 'paye_gra');
  END IF;
  IF v_tier1 > 0.01 THEN
    v_expected_types := array_append(v_expected_types, 'ssnit_tier1');
  END IF;
  IF v_tier2 > 0.01 THEN
    v_expected_types := array_append(v_expected_types, 'tier2_pension');
  END IF;
  IF COALESCE(v_run.total_deductions,0) > 0.01 THEN
    v_expected_types := array_append(v_expected_types, 'other_employee_deductions');
  END IF;

  FOREACH v_type IN ARRAY v_expected_types LOOP
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

    IF COALESCE(v_obl.amount_paid, 0) - COALESCE(v_obl.amount_due, 0) > 0.01 THEN
      RETURN FALSE;
    END IF;

    IF v_type = 'salary_net' AND ABS(COALESCE(v_obl.amount_due,0) - v_run.total_net_salary) > 0.01 THEN
      RETURN FALSE;
    END IF;
    IF v_type = 'paye_gra' AND ABS(COALESCE(v_obl.amount_due,0) - v_run.total_paye) > 0.01 THEN
      RETURN FALSE;
    END IF;
    IF v_type = 'ssnit_tier1' AND ABS(COALESCE(v_obl.amount_due,0) - v_tier1) > 0.01 THEN
      RETURN FALSE;
    END IF;
    IF v_type = 'tier2_pension' AND ABS(COALESCE(v_obl.amount_due,0) - v_tier2) > 0.01 THEN
      RETURN FALSE;
    END IF;
    IF v_type = 'other_employee_deductions' AND ABS(COALESCE(v_obl.amount_due,0) - v_run.total_deductions) > 0.01 THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  IF COALESCE(cardinality(v_expected_types), 0) = 0 THEN
    SELECT COUNT(*) INTO v_count
    FROM public.payroll_obligations
    WHERE business_id = p_business_id
      AND payroll_run_id = p_payroll_run_id
      AND deleted_at IS NULL;
    IF v_count > 0 THEN
      RETURN FALSE;
    END IF;
  ELSE
    SELECT COUNT(*) INTO v_count
    FROM public.payroll_obligations
    WHERE business_id = p_business_id
      AND payroll_run_id = p_payroll_run_id
      AND deleted_at IS NULL
      AND NOT (obligation_type = ANY (v_expected_types));
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
-- 7) Atomic approval RPC (hardened)
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

  -- 1. Lock payroll run
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
    WHERE sar.business_id = p_business_id
      AND sar.payroll_run_id = p_payroll_run_id
      AND sar.status = 'posted';

    RETURN jsonb_build_object(
      'ok', true,
      'reused', true,
      'payroll_run_id', p_payroll_run_id,
      'business_id', p_business_id,
      'status', v_run.status,
      'journal_entry_id', v_run.journal_entry_id,
      'approved_at', v_run.approved_at,
      'approved_by', v_run.approved_by,
      'advance_recovery_total', v_advance_total
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

  SELECT COALESCE(SUM(sar.amount), 0) INTO v_advance_total
  FROM public.salary_advance_repayments sar
  WHERE sar.business_id = p_business_id
    AND sar.payroll_run_id = p_payroll_run_id
    AND sar.status = 'posted';

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
        'salary_advance_recovery_total', v_advance_total
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
    'obligations', COALESCE(v_obl->'obligations', '[]'::jsonb),
    'audit_log_id', v_audit_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_payroll_run_atomic(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_payroll_run_atomic(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.approve_payroll_run_atomic(UUID, UUID) IS
  'Atomically approve a draft payroll run with payroll.approve permission, fail-closed obligation conflicts, and total_basic_salary reconciliation.';

-- Re-assert helper revokes after REPLACE
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
GRANT EXECUTE ON FUNCTION public.sync_payroll_obligations_for_approval(UUID, UUID) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_approval_obligations_consistent(UUID, UUID) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_validate_run_for_approval(UUID, public.payroll_runs, INT) TO postgres;
GRANT EXECUTE ON FUNCTION public.raise_payroll_approval_error(TEXT, TEXT, JSONB) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_next_month_paye_due_date(DATE) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_obligation_status(NUMERIC, NUMERIC) TO postgres;
