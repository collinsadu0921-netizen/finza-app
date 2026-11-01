-- ============================================================================
-- Migration 615: Controlled repair of legacy draft calculation metadata
-- ============================================================================
-- Older draft payroll runs can have NULL calculation_engine_version,
-- calculation_jurisdiction or statutory_period_basis even when their included
-- employee entries carry consistent snapshots. Approval must not require a new
-- payroll run for those drafts.
--
-- This RPC repairs only missing draft header fields, only when every included
-- entry agrees, never recalculates amounts and writes an audit event.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.repair_payroll_draft_calculation_metadata_atomic(
  p_business_id UUID,
  p_payroll_run_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_run public.payroll_runs%ROWTYPE;
  v_count INT;
  v_missing INT;
  v_engine_count INT;
  v_jurisdiction_count INT;
  v_period_count INT;
  v_paye_count INT;
  v_pension_count INT;
  v_engine TEXT;
  v_jurisdiction TEXT;
  v_period DATE;
  v_paye TEXT;
  v_pension TEXT;
  v_fields TEXT[] := ARRAY[]::TEXT[];
  v_old JSONB;
  v_new JSONB;
BEGIN
  IF v_uid IS NULL
     OR NOT public.finza_user_can_access_business(p_business_id)
     OR NOT public.finza_user_has_permission(p_business_id, 'payroll.approve')
  THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_METADATA_REPAIR_PERMISSION_DENIED',
      'Payroll approval permission is required to repair draft calculation metadata.',
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
      'PAYROLL_METADATA_REPAIR_RUN_NOT_FOUND',
      'Payroll run not found.',
      '{}'::JSONB
    );
  END IF;

  IF v_run.status <> 'draft' THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_METADATA_REPAIR_NOT_DRAFT',
      'Only draft payroll runs can have calculation metadata repaired.',
      jsonb_build_object('status', v_run.status)
    );
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (
      WHERE pe.calculation_engine_version IS NULL
         OR NULLIF(TRIM(pe.calculation_engine_version), '') IS NULL
         OR pe.calculation_jurisdiction IS NULL
         OR NULLIF(TRIM(pe.calculation_jurisdiction), '') IS NULL
         OR pe.statutory_period_basis IS NULL
         OR pe.paye_rate_version IS NULL
         OR NULLIF(TRIM(pe.paye_rate_version), '') IS NULL
         OR pe.pension_rate_version IS NULL
         OR NULLIF(TRIM(pe.pension_rate_version), '') IS NULL
    ),
    COUNT(DISTINCT pe.calculation_engine_version),
    COUNT(DISTINCT UPPER(TRIM(pe.calculation_jurisdiction))),
    COUNT(DISTINCT pe.statutory_period_basis),
    COUNT(DISTINCT pe.paye_rate_version),
    COUNT(DISTINCT pe.pension_rate_version)
  INTO
    v_count,
    v_missing,
    v_engine_count,
    v_jurisdiction_count,
    v_period_count,
    v_paye_count,
    v_pension_count
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE;

  IF v_count < 1 THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_METADATA_REPAIR_INCOMPLETE_ENTRIES',
      'No included employee entries are available to supply calculation metadata.',
      '{}'::JSONB
    );
  END IF;

  IF v_missing > 0
     OR v_engine_count <> 1
     OR v_jurisdiction_count <> 1
     OR v_period_count <> 1
     OR v_paye_count <> 1
     OR v_pension_count <> 1
  THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_METADATA_REPAIR_INCONSISTENT_ENTRIES',
      'Included employee calculation snapshots are incomplete or disagree, so the draft cannot be repaired automatically.',
      jsonb_build_object(
        'included_entries', v_count,
        'missing_snapshots', v_missing,
        'distinct_engines', v_engine_count,
        'distinct_jurisdictions', v_jurisdiction_count,
        'distinct_periods', v_period_count,
        'distinct_paye_versions', v_paye_count,
        'distinct_pension_versions', v_pension_count
      )
    );
  END IF;

  SELECT
    MIN(TRIM(pe.calculation_engine_version)),
    MIN(UPPER(TRIM(pe.calculation_jurisdiction))),
    MIN(pe.statutory_period_basis),
    MIN(pe.paye_rate_version),
    MIN(pe.pension_rate_version)
  INTO v_engine, v_jurisdiction, v_period, v_paye, v_pension
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE;

  IF v_engine NOT IN ('finza-ghana-v2', 'finza-ghana-v3') THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_METADATA_REPAIR_ENGINE_UNRECOGNIZED',
      'The employee calculation snapshots use an unrecognized Ghana calculation engine.',
      jsonb_build_object('engine', v_engine)
    );
  END IF;

  IF v_jurisdiction <> 'GH' THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_METADATA_REPAIR_JURISDICTION_UNRECOGNIZED',
      'The employee calculation snapshots do not use the Ghana jurisdiction.',
      jsonb_build_object('jurisdiction', v_jurisdiction)
    );
  END IF;

  IF v_period IS NULL
     OR v_period < COALESCE(v_run.pay_period_start::DATE, v_run.payroll_month::DATE)
     OR v_period > COALESCE(v_run.pay_period_end::DATE, v_run.payroll_month::DATE)
  THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_METADATA_REPAIR_PERIOD_INVALID',
      'The employee calculation period is missing or outside this payroll period.',
      jsonb_build_object('statutory_period_basis', v_period)
    );
  END IF;

  -- Preserve any non-null run metadata. A mismatch needs an explicitly
  -- authorized correction, not an automatic repair.
  IF (v_run.calculation_engine_version IS NOT NULL
        AND TRIM(v_run.calculation_engine_version) <> v_engine)
     OR (v_run.calculation_jurisdiction IS NOT NULL
        AND UPPER(TRIM(v_run.calculation_jurisdiction)) <> v_jurisdiction)
     OR (v_run.statutory_period_basis IS NOT NULL
        AND v_run.statutory_period_basis <> v_period)
     OR (v_run.paye_rate_version IS NOT NULL
        AND TRIM(v_run.paye_rate_version) <> v_paye)
     OR (v_run.pension_rate_version IS NOT NULL
        AND TRIM(v_run.pension_rate_version) <> v_pension)
  THEN
    PERFORM public.raise_payroll_approval_error(
      'PAYROLL_METADATA_REPAIR_CONFLICT',
      'Existing run calculation metadata conflicts with the employee snapshots and cannot be repaired automatically.',
      jsonb_build_object(
        'run_engine', v_run.calculation_engine_version,
        'entry_engine', v_engine,
        'run_jurisdiction', v_run.calculation_jurisdiction,
        'entry_jurisdiction', v_jurisdiction,
        'run_period', v_run.statutory_period_basis,
        'entry_period', v_period,
        'run_paye_version', v_run.paye_rate_version,
        'entry_paye_version', v_paye,
        'run_pension_version', v_run.pension_rate_version,
        'entry_pension_version', v_pension
      )
    );
  END IF;

  IF v_run.calculation_engine_version IS NULL THEN
    v_fields := array_append(v_fields, 'calculation_engine_version');
  END IF;
  IF v_run.calculation_jurisdiction IS NULL THEN
    v_fields := array_append(v_fields, 'calculation_jurisdiction');
  END IF;
  IF v_run.statutory_period_basis IS NULL THEN
    v_fields := array_append(v_fields, 'statutory_period_basis');
  END IF;
  IF v_run.paye_rate_version IS NULL THEN
    v_fields := array_append(v_fields, 'paye_rate_version');
  END IF;
  IF v_run.pension_rate_version IS NULL THEN
    v_fields := array_append(v_fields, 'pension_rate_version');
  END IF;

  IF array_length(v_fields, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'repaired', FALSE,
      'reason', 'already_present',
      'calculation_engine_version', v_run.calculation_engine_version,
      'calculation_jurisdiction', v_run.calculation_jurisdiction,
      'statutory_period_basis', v_run.statutory_period_basis,
      'paye_rate_version', v_run.paye_rate_version,
      'pension_rate_version', v_run.pension_rate_version
    );
  END IF;

  v_old := jsonb_build_object(
    'calculation_engine_version', v_run.calculation_engine_version,
    'calculation_jurisdiction', v_run.calculation_jurisdiction,
    'statutory_period_basis', v_run.statutory_period_basis,
    'paye_rate_version', v_run.paye_rate_version,
    'pension_rate_version', v_run.pension_rate_version
  );
  v_new := jsonb_build_object(
    'calculation_engine_version', COALESCE(v_run.calculation_engine_version, v_engine),
    'calculation_jurisdiction', COALESCE(v_run.calculation_jurisdiction, v_jurisdiction),
    'statutory_period_basis', COALESCE(v_run.statutory_period_basis, v_period),
    'paye_rate_version', COALESCE(v_run.paye_rate_version, v_paye),
    'pension_rate_version', COALESCE(v_run.pension_rate_version, v_pension)
  );

  UPDATE public.payroll_runs
  SET calculation_engine_version = COALESCE(calculation_engine_version, v_engine),
      calculation_jurisdiction = COALESCE(calculation_jurisdiction, v_jurisdiction),
      statutory_period_basis = COALESCE(statutory_period_basis, v_period),
      paye_rate_version = COALESCE(paye_rate_version, v_paye),
      pension_rate_version = COALESCE(pension_rate_version, v_pension),
      updated_at = NOW()
  WHERE id = p_payroll_run_id
    AND business_id = p_business_id
    AND status = 'draft'
    AND deleted_at IS NULL;

  PERFORM public.create_audit_log(
    p_business_id,
    v_uid,
    'payroll.calculation_metadata_repaired',
    'payroll_run',
    p_payroll_run_id,
    v_old,
    v_new,
    NULL,
    NULL,
    'Restored missing draft calculation metadata from consistent employee entry snapshots.'
  );

  RETURN jsonb_build_object(
    'repaired', TRUE,
    'reason', 'legacy_metadata_repaired',
    'fields', to_jsonb(v_fields),
    'calculation_engine_version', v_engine,
    'calculation_jurisdiction', v_jurisdiction,
    'statutory_period_basis', v_period,
    'paye_rate_version', v_paye,
    'pension_rate_version', v_pension
  );
END;
$$;

COMMENT ON FUNCTION public.repair_payroll_draft_calculation_metadata_atomic(UUID, UUID) IS
  'Repairs missing calculation metadata on a draft payroll from consistent included employee snapshots. Does not recalculate amounts or touch approved/locked/reversed runs. Writes an audit event.';

REVOKE ALL ON FUNCTION public.repair_payroll_draft_calculation_metadata_atomic(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repair_payroll_draft_calculation_metadata_atomic(UUID, UUID)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
