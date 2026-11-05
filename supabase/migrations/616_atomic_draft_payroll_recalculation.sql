-- ============================================================================
-- Migration 616: Atomic draft payroll statutory recalculation
-- ============================================================================
-- Statutory refresh previously updated the run header and recalculated employee
-- entries in separate statements. A failure after one or more entries left a
-- partially updated draft. This RPC applies the complete recalculated draft in a
-- single transaction: it locks the run and entries, verifies optimistic
-- concurrency, validates entry version consistency and totals reconciliation,
-- updates every entry plus the run header/totals, and writes an audit event.
-- Any failure rolls back the entire operation.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_payroll_draft_recalculation_atomic(
  p_business_id UUID,
  p_payroll_run_id UUID,
  p_expected_run_updated_at TIMESTAMPTZ,
  p_entries JSONB,
  p_run JSONB,
  p_reset_provisional_ack BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_run public.payroll_runs%ROWTYPE;
  v_entry_count INT;
  v_expected_count INT;
  v_totals RECORD;
  v_old_values JSONB;
  v_new_values JSONB;
BEGIN
  IF v_uid IS NULL
     OR NOT public.finza_user_can_access_business(p_business_id)
     OR NOT public.finza_user_has_permission(p_business_id, 'payroll.approve')
  THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_RECALCULATION_PERMISSION_DENIED',
      'Payroll approval permission is required to recalculate a draft.',
      '{}'::JSONB
    );
  END IF;

  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_RECALCULATION_INVALID_PAYLOAD',
      'The recalculation payload is invalid.',
      '{}'::JSONB
    );
  END IF;

  SELECT * INTO v_run
  FROM public.payroll_runs
  WHERE id = p_payroll_run_id
    AND business_id = p_business_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_RECALCULATION_RUN_NOT_FOUND',
      'Payroll run not found.',
      '{}'::JSONB
    );
  END IF;

  IF v_run.status <> 'draft' THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_RECALCULATION_NOT_DRAFT',
      'Only draft payroll runs can be recalculated.',
      jsonb_build_object('status', v_run.status)
    );
  END IF;

  -- Optimistic concurrency: the application computed entries from this exact
  -- version of the run. Any concurrent refresh/entry edit invalidates it.
  IF v_run.updated_at IS DISTINCT FROM p_expected_run_updated_at THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_RECALCULATION_CONCURRENT_MODIFICATION',
      'This payroll was modified by another request. Reload the draft and try again.',
      jsonb_build_object(
        'expected_run_updated_at', p_expected_run_updated_at,
        'actual_run_updated_at', v_run.updated_at
      )
    );
  END IF;

  -- Repair missing legacy metadata inside this same transaction. If the repair
  -- is rejected, nothing from the recalculation is committed either. The repair
  -- is only meaningful when the employee snapshots themselves are complete;
  -- otherwise the fully computed payload below supplies the metadata.
  IF (v_run.calculation_engine_version IS NULL
      OR v_run.calculation_jurisdiction IS NULL
      OR v_run.statutory_period_basis IS NULL
      OR v_run.paye_rate_version IS NULL
      OR v_run.pension_rate_version IS NULL)
     AND NOT EXISTS (
       SELECT 1
       FROM public.payroll_entries pe
       WHERE pe.payroll_run_id = p_payroll_run_id
         AND (
           pe.calculation_engine_version IS NULL
           OR pe.calculation_jurisdiction IS NULL
           OR pe.statutory_period_basis IS NULL
           OR pe.paye_rate_version IS NULL
           OR pe.pension_rate_version IS NULL
         )
     )
  THEN
    PERFORM public.repair_payroll_draft_calculation_metadata_atomic(
      p_business_id,
      p_payroll_run_id
    );

    SELECT * INTO v_run
    FROM public.payroll_runs
    WHERE id = p_payroll_run_id
      AND business_id = p_business_id
    FOR UPDATE;
  END IF;

  v_expected_count := jsonb_array_length(p_entries);
  IF v_expected_count < 1 THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_RECALCULATION_INCOMPLETE_ENTRIES',
      'No employee entries were supplied for recalculation.',
      '{}'::JSONB
    );
  END IF;

  SELECT COUNT(*) INTO v_entry_count
  FROM public.payroll_entries
  WHERE payroll_run_id = p_payroll_run_id;

  IF v_entry_count <> v_expected_count THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_RECALCULATION_INCOMPLETE_ENTRIES',
      'The recalculation payload does not cover every employee entry on this run.',
      jsonb_build_object('run_entries', v_entry_count, 'provided_entries', v_expected_count)
    );
  END IF;

  -- Lock every entry and verify the optimistic version each calculation was
  -- based on. This prevents a concurrent entry edit from being overwritten.
  PERFORM 1
  FROM public.payroll_entries
  WHERE payroll_run_id = p_payroll_run_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_entries) AS e
    LEFT JOIN public.payroll_entries pe
      ON pe.id = (e->>'entry_id')::UUID
     AND pe.payroll_run_id = p_payroll_run_id
    WHERE pe.id IS NULL
       OR pe.updated_at IS DISTINCT FROM NULLIF(e->>'expected_updated_at', '')::TIMESTAMPTZ
  ) THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_RECALCULATION_CONCURRENT_MODIFICATION',
      'One or more payroll entries were modified by another request. Reload the draft and try again.',
      '{}'::JSONB
    );
  END IF;

  v_old_values := jsonb_build_object(
    'calculation_engine_version', v_run.calculation_engine_version,
    'calculation_jurisdiction', v_run.calculation_jurisdiction,
    'statutory_period_basis', v_run.statutory_period_basis,
    'paye_rate_version', v_run.paye_rate_version,
    'pension_rate_version', v_run.pension_rate_version,
    'total_gross_salary', v_run.total_gross_salary,
    'total_ssnit_employee', v_run.total_ssnit_employee,
    'total_ssnit_employer', v_run.total_ssnit_employer,
    'total_paye', v_run.total_paye,
    'total_net_salary', v_run.total_net_salary
  );

  -- Apply every computed entry in one statement. All rows are updated or none.
  UPDATE public.payroll_entries AS pe
  SET is_included = r.is_included,
      base_salary_snapshot = r.base_salary_snapshot,
      adjustment_amount = r.adjustment_amount,
      adjustment_reason = r.adjustment_reason,
      exclusion_reason = r.exclusion_reason,
      salary_basis = r.salary_basis,
      period_basic_pay = r.period_basic_pay,
      one_off_items_snapshot = r.one_off_items_snapshot,
      basic_salary = r.basic_salary,
      allowances_total = r.allowances_total,
      regular_allowances_amount = r.regular_allowances_amount,
      bonus_amount = r.bonus_amount,
      overtime_amount = r.overtime_amount,
      deductions_total = r.deductions_total,
      gross_salary = r.gross_salary,
      ssnit_employee = r.ssnit_employee,
      ssnit_employer = r.ssnit_employer,
      taxable_income = r.taxable_income,
      paye = r.paye,
      bonus_tax_5 = r.bonus_tax_5,
      bonus_tax_graduated = r.bonus_tax_graduated,
      overtime_tax_5 = r.overtime_tax_5,
      overtime_tax_10 = r.overtime_tax_10,
      overtime_tax_graduated = r.overtime_tax_graduated,
      is_qualifying_junior_employee = r.is_qualifying_junior_employee,
      bonus_cap_amount = r.bonus_cap_amount,
      overtime_threshold_amount = r.overtime_threshold_amount,
      net_salary = r.net_salary,
      payroll_tax_profile = r.payroll_tax_profile,
      filing_tin = r.filing_tin,
      filing_employee_name = r.filing_employee_name,
      bonus_concessional_amount = r.bonus_concessional_amount,
      bonus_graduated_amount = r.bonus_graduated_amount,
      pensionable_base = r.pensionable_base,
      employee_pension_contribution = r.employee_pension_contribution,
      employer_pension_contribution = r.employer_pension_contribution,
      total_mandatory_pension = r.total_mandatory_pension,
      tier1_ssnit_remittance = r.tier1_ssnit_remittance,
      tier2_pension_remittance = r.tier2_pension_remittance,
      calculation_engine_version = r.calculation_engine_version,
      paye_rate_version = r.paye_rate_version,
      pension_rate_version = r.pension_rate_version,
      calculation_jurisdiction = r.calculation_jurisdiction,
      statutory_period_basis = r.statutory_period_basis,
      advance_recoveries_snapshot = r.advance_recoveries_snapshot,
      income_tax_method = r.income_tax_method,
      income_tax_method_version = r.income_tax_method_version,
      income_tax_regular_base = r.income_tax_regular_base,
      income_tax_regular_amount = r.income_tax_regular_amount,
      income_tax_bonus_base = r.income_tax_bonus_base,
      income_tax_bonus_amount = r.income_tax_bonus_amount,
      income_tax_overtime_base = r.income_tax_overtime_base,
      income_tax_overtime_amount = r.income_tax_overtime_amount,
      updated_at = NOW()
  FROM (
    SELECT (e->>'entry_id')::UUID AS target_entry_id,
           (jsonb_populate_record(NULL::public.payroll_entries, e->'fields')).*
    FROM jsonb_array_elements(p_entries) AS e
  ) AS r
  WHERE pe.id = r.target_entry_id
    AND pe.payroll_run_id = p_payroll_run_id;

  -- Every entry must use exactly the run-level engine, jurisdiction, period and
  -- rate versions that are about to be committed.
  IF EXISTS (
    SELECT 1
    FROM public.payroll_entries
    WHERE payroll_run_id = p_payroll_run_id
      AND (
        calculation_engine_version IS DISTINCT FROM NULLIF(p_run->>'calculation_engine_version', '')
        OR calculation_jurisdiction IS DISTINCT FROM NULLIF(p_run->>'calculation_jurisdiction', '')
        OR statutory_period_basis IS DISTINCT FROM NULLIF(p_run->>'statutory_period_basis', '')::DATE
        OR paye_rate_version IS DISTINCT FROM NULLIF(p_run->>'paye_rate_version', '')
        OR pension_rate_version IS DISTINCT FROM NULLIF(p_run->>'pension_rate_version', '')
      )
  ) THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_RECALCULATION_METADATA_INCONSISTENT',
      'Recalculated employee entries do not share the run statutory metadata.',
      '{}'::JSONB
    );
  END IF;

  SELECT
    COALESCE(SUM(basic_salary), 0)::NUMERIC AS total_basic_salary,
    COALESCE(SUM(gross_salary), 0)::NUMERIC AS total_gross_salary,
    COALESCE(SUM(allowances_total), 0)::NUMERIC AS total_allowances,
    COALESCE(SUM(deductions_total), 0)::NUMERIC AS total_deductions,
    COALESCE(SUM(ssnit_employee), 0)::NUMERIC AS total_ssnit_employee,
    COALESCE(SUM(ssnit_employer), 0)::NUMERIC AS total_ssnit_employer,
    COALESCE(SUM(paye), 0)::NUMERIC AS total_paye,
    COALESCE(SUM(net_salary), 0)::NUMERIC AS total_net_salary
  INTO v_totals
  FROM public.payroll_entries
  WHERE payroll_run_id = p_payroll_run_id
    AND is_included IS DISTINCT FROM FALSE;

  IF ROUND(v_totals.total_basic_salary, 2)
       <> ROUND(COALESCE((p_run->>'total_basic_salary')::NUMERIC, 0), 2)
     OR ROUND(v_totals.total_gross_salary, 2)
       <> ROUND(COALESCE((p_run->>'total_gross_salary')::NUMERIC, 0), 2)
     OR ROUND(v_totals.total_allowances, 2)
       <> ROUND(COALESCE((p_run->>'total_allowances')::NUMERIC, 0), 2)
     OR ROUND(v_totals.total_deductions, 2)
       <> ROUND(COALESCE((p_run->>'total_deductions')::NUMERIC, 0), 2)
     OR ROUND(v_totals.total_ssnit_employee, 2)
       <> ROUND(COALESCE((p_run->>'total_ssnit_employee')::NUMERIC, 0), 2)
     OR ROUND(v_totals.total_ssnit_employer, 2)
       <> ROUND(COALESCE((p_run->>'total_ssnit_employer')::NUMERIC, 0), 2)
     OR ROUND(v_totals.total_paye, 2)
       <> ROUND(COALESCE((p_run->>'total_paye')::NUMERIC, 0), 2)
     OR ROUND(v_totals.total_net_salary, 2)
       <> ROUND(COALESCE((p_run->>'total_net_salary')::NUMERIC, 0), 2)
  THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_RECALCULATION_RECONCILIATION_FAILED',
      'Recalculated payroll totals do not reconcile with employee entries.',
      jsonb_build_object(
        'entry_totals', to_jsonb(v_totals),
        'supplied_totals', p_run
      )
    );
  END IF;

  UPDATE public.payroll_runs
  SET calculation_engine_version = p_run->>'calculation_engine_version',
      calculation_jurisdiction = p_run->>'calculation_jurisdiction',
      statutory_period_basis = (p_run->>'statutory_period_basis')::DATE,
      paye_rate_version = p_run->>'paye_rate_version',
      pension_rate_version = p_run->>'pension_rate_version',
      pension_limits_provisional = COALESCE((p_run->>'pension_limits_provisional')::BOOLEAN, FALSE),
      pension_minimum_insurable_earnings = (p_run->>'pension_minimum_insurable_earnings')::NUMERIC,
      pension_maximum_insurable_earnings = (p_run->>'pension_maximum_insurable_earnings')::NUMERIC,
      pension_limits_effective_from = NULLIF(p_run->>'pension_limits_effective_from', '')::DATE,
      provisional_ssnit_acknowledged_at = CASE
        WHEN p_reset_provisional_ack THEN NULL
        ELSE provisional_ssnit_acknowledged_at
      END,
      provisional_ssnit_acknowledged_by = CASE
        WHEN p_reset_provisional_ack THEN NULL
        ELSE provisional_ssnit_acknowledged_by
      END,
      total_basic_salary = v_totals.total_basic_salary,
      total_gross_salary = v_totals.total_gross_salary,
      total_allowances = v_totals.total_allowances,
      total_deductions = v_totals.total_deductions,
      total_ssnit_employee = v_totals.total_ssnit_employee,
      total_ssnit_employer = v_totals.total_ssnit_employer,
      total_paye = v_totals.total_paye,
      total_net_salary = v_totals.total_net_salary,
      updated_at = NOW()
  WHERE id = p_payroll_run_id
    AND business_id = p_business_id
    AND status = 'draft';

  v_new_values := jsonb_build_object(
    'calculation_engine_version', p_run->>'calculation_engine_version',
    'calculation_jurisdiction', p_run->>'calculation_jurisdiction',
    'statutory_period_basis', p_run->>'statutory_period_basis',
    'paye_rate_version', p_run->>'paye_rate_version',
    'pension_rate_version', p_run->>'pension_rate_version',
    'total_gross_salary', v_totals.total_gross_salary,
    'total_ssnit_employee', v_totals.total_ssnit_employee,
    'total_ssnit_employer', v_totals.total_ssnit_employer,
    'total_paye', v_totals.total_paye,
    'total_net_salary', v_totals.total_net_salary
  );

  PERFORM public.create_audit_log(
    p_business_id,
    v_uid,
    'payroll.draft_statutory_recalculation_applied',
    'payroll_run',
    p_payroll_run_id,
    v_old_values,
    v_new_values,
    NULL,
    NULL,
    'Atomically recalculated a draft payroll after a statutory-rate refresh.'
  );

  RETURN jsonb_build_object(
    'applied', TRUE,
    'entry_count', v_expected_count,
    'totals', to_jsonb(v_totals)
  );
END;
$$;

COMMENT ON FUNCTION public.apply_payroll_draft_recalculation_atomic(UUID, UUID, TIMESTAMPTZ, JSONB, JSONB, BOOLEAN) IS
  'Atomically applies a fully computed statutory recalculation to a draft payroll. Locks the run and entries, verifies concurrency, validates entry metadata and totals, updates all entries and the run header, and writes an audit event. Rolls back everything on failure.';

REVOKE ALL ON FUNCTION public.apply_payroll_draft_recalculation_atomic(UUID, UUID, TIMESTAMPTZ, JSONB, JSONB, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_payroll_draft_recalculation_atomic(UUID, UUID, TIMESTAMPTZ, JSONB, JSONB, BOOLEAN)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
