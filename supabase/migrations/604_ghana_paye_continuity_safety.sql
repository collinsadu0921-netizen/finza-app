-- ============================================================================
-- Migration 604: PAYE continuity beyond 2026 and explicit PAYE version safety
--
-- Act 1178 amends the First Schedule to Act 896. The 1 September 2026 PAYE
-- schedule has no statutory expiry; it continues until Parliament amends it.
-- SSNIT minimum/maximum insurable earnings are annual and are verified only
-- through 31 December 2026. This migration therefore:
--   1. Stops approval from treating the Act 1178 PAYE schedule as expiring on
--      31 December 2026.
--   2. Keeps the 2027 payroll block tied to the missing annual SSNIT notice.
--   3. Disables the ambiguous one-argument PAYE band helper that silently
--      defaulted to gh-paye-2024-01. Historical calculations use the explicit
--      two-argument helper with their stored paye_rate_version.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.payroll_ghana_calculate_paye_from_bands(
  p_income NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION
    USING ERRCODE = 'P0001',
          MESSAGE = 'Ghana PAYE version is required. Use payroll_ghana_calculate_paye_from_bands(income, paye_rate_version); the legacy one-argument form silently assumed gh-paye-2024-01 and is disabled.',
          DETAIL = jsonb_build_object(
            'code', 'GHANA_PAYROLL_UNKNOWN_RATE_VERSION'
          )::TEXT;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.payroll_ghana_validate_run_for_approval(
  p_business_id UUID,
  p_run public.payroll_runs,
  p_entry_count INT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_country TEXT;
  v_is_ghana BOOLEAN := FALSE;
  v_period DATE;
  v_paye TEXT;
  v_pension TEXT;
  v_engine TEXT;
  v_jurisdiction TEXT;
  v_frequency TEXT;
  v_entry public.payroll_entries%ROWTYPE;
  v_profile JSONB;
  v_emp TEXT;
  v_class TEXT;
  v_affected JSONB := '[]'::JSONB;
  v_paye_ok BOOLEAN;
  v_pension_ok BOOLEAN;
  v_entry_period DATE;
  v_entry_paye NUMERIC;
  v_component_paye NUMERIC;
  v_entry_employee_pension NUMERIC;
  v_entry_employer_pension NUMERIC;
BEGIN
  SELECT LOWER(TRIM(COALESCE(b.address_country, '')))
  INTO v_country
  FROM public.businesses b
  WHERE b.id = p_business_id;

  v_is_ghana := v_country IN ('gh', 'ghana') OR v_country LIKE '%ghana%';
  IF NOT v_is_ghana THEN RETURN; END IF;

  IF p_entry_count < 1 THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
      'Payroll run has no included entries to approve'
    );
  END IF;

  v_engine := NULLIF(TRIM(COALESCE(p_run.calculation_engine_version, '')), '');
  v_paye := NULLIF(TRIM(COALESCE(p_run.paye_rate_version, '')), '');
  v_pension := NULLIF(TRIM(COALESCE(p_run.pension_rate_version, '')), '');
  v_jurisdiction := UPPER(NULLIF(TRIM(COALESCE(p_run.calculation_jurisdiction, '')), ''));
  v_frequency := LOWER(NULLIF(TRIM(COALESCE(p_run.payroll_frequency, '')), ''));
  v_period := COALESCE(p_run.statutory_period_basis, p_run.payroll_month);

  IF v_engine IS NULL OR v_paye IS NULL OR v_pension IS NULL
     OR v_jurisdiction IS NULL OR v_frequency IS NULL OR v_period IS NULL THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_UNKNOWN_RATE_VERSION',
      'This payroll run is missing a recognized Ghana calculation-engine, jurisdiction, period basis, frequency, or statutory-rate version and cannot be approved.'
    );
  END IF;
  IF v_engine NOT IN ('finza-ghana-v2', 'finza-ghana-v3') THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_UNKNOWN_RATE_VERSION',
      format('Unrecognized Ghana calculation engine version "%s".', v_engine)
    );
  END IF;
  IF v_jurisdiction <> 'GH' THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
      format('Ghana payroll approval requires calculation_jurisdiction "GH" (received "%s").', v_jurisdiction)
    );
  END IF;
  IF v_frequency <> 'monthly' THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
      format('Ghana payroll approval currently requires monthly frequency (received "%s").', v_frequency)
    );
  END IF;
  -- For v3, surface the profile-tax support classification before the
  -- run-level period error. PAYE has no statutory expiry after Act 1178, so
  -- only periods before the verified start are pre-classified here.
  IF v_engine = 'finza-ghana-v3' AND v_period < DATE '2024-01-01' THEN
    SELECT pe.* INTO v_entry
    FROM public.payroll_entries pe
    WHERE pe.payroll_run_id = p_run.id
      AND pe.is_included IS DISTINCT FROM FALSE
    ORDER BY pe.id
    LIMIT 1;
    IF FOUND THEN
      PERFORM public.payroll_ghana_verify_income_tax_components(
        v_entry, v_engine, v_period
      );
    END IF;
  END IF;
  IF v_period < DATE '2024-01-01' THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_UNKNOWN_RATE_VERSION',
      format('Ghana payroll period %s is before the verified statutory start 2024-01-01.', v_period)
    );
  END IF;

  v_paye_ok :=
    (v_paye = 'gh-paye-2024-01' AND v_period BETWEEN DATE '2024-01-01' AND DATE '2026-08-31')
    OR (v_paye = 'gh-paye-2026-09' AND v_period >= DATE '2026-09-01');
  v_pension_ok :=
    (v_pension = 'gh-pension-2024-01' AND v_period BETWEEN DATE '2024-01-01' AND DATE '2024-12-31')
    OR (v_pension = 'gh-pension-2025-01' AND v_period BETWEEN DATE '2025-01-01' AND DATE '2025-12-31')
    OR (v_pension = 'gh-pension-2026-01' AND v_period BETWEEN DATE '2026-01-01' AND DATE '2026-12-31');
  IF NOT v_paye_ok THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_UNKNOWN_RATE_VERSION',
      'Stored Ghana PAYE version does not cover the payroll period.'
    );
  END IF;
  IF NOT v_pension_ok THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_UNKNOWN_RATE_VERSION',
      format(
        'Ghana payroll period %s is beyond the verified annual SSNIT insurable-earnings limits (through 2026-12-31). Add the SSNIT version for that year before approval; the PAYE schedule itself does not expire.',
        v_period
      )
    );
  END IF;

  FOR v_entry IN
    SELECT pe.*
    FROM public.payroll_entries pe
    WHERE pe.payroll_run_id = p_run.id
      AND pe.is_included IS DISTINCT FROM FALSE
    ORDER BY pe.id
  LOOP
    IF v_entry.calculation_engine_version IS NULL
       OR v_entry.paye_rate_version IS NULL
       OR v_entry.pension_rate_version IS NULL
       OR v_entry.calculation_jurisdiction IS NULL
       OR v_entry.statutory_period_basis IS NULL THEN
      v_affected := v_affected || jsonb_build_array(jsonb_build_object(
        'staffId', v_entry.staff_id,
        'unsupportedClassification', 'missing_rate_version_snapshot'
      ));
      CONTINUE;
    END IF;

    IF v_entry.calculation_engine_version IS DISTINCT FROM p_run.calculation_engine_version THEN
      v_affected := v_affected || jsonb_build_array(jsonb_build_object(
        'staffId', v_entry.staff_id,
        'unsupportedClassification', 'engine_version_mismatch'
      ));
    END IF;
    IF v_entry.paye_rate_version IS DISTINCT FROM p_run.paye_rate_version THEN
      v_affected := v_affected || jsonb_build_array(jsonb_build_object(
        'staffId', v_entry.staff_id,
        'unsupportedClassification', 'paye_version_mismatch'
      ));
    END IF;
    IF v_entry.pension_rate_version IS DISTINCT FROM p_run.pension_rate_version THEN
      v_affected := v_affected || jsonb_build_array(jsonb_build_object(
        'staffId', v_entry.staff_id,
        'unsupportedClassification', 'pension_version_mismatch'
      ));
    END IF;
    IF UPPER(TRIM(COALESCE(v_entry.calculation_jurisdiction, '')))
       IS DISTINCT FROM v_jurisdiction THEN
      v_affected := v_affected || jsonb_build_array(jsonb_build_object(
        'staffId', v_entry.staff_id,
        'unsupportedClassification', 'jurisdiction_mismatch'
      ));
    END IF;

    v_entry_period := v_entry.statutory_period_basis;
    IF v_entry_period IS DISTINCT FROM v_period THEN
      v_affected := v_affected || jsonb_build_array(jsonb_build_object(
        'staffId', v_entry.staff_id,
        'unsupportedClassification', 'statutory_period_mismatch'
      ));
    END IF;

    IF v_engine = 'finza-ghana-v2' THEN
      v_profile := v_entry.payroll_tax_profile;
      v_class := NULL;
      IF v_profile IS NULL OR jsonb_typeof(v_profile) <> 'object' THEN
        v_class := 'missing_tax_profile_snapshot';
      ELSIF NOT (v_profile ? 'staff_is_tax_resident')
            OR jsonb_typeof(v_profile->'staff_is_tax_resident') <> 'boolean' THEN
        v_class := 'missing_tax_profile_snapshot';
      ELSIF NOT (v_profile ? 'secondary_employment')
            OR jsonb_typeof(v_profile->'secondary_employment') <> 'boolean' THEN
        v_class := 'missing_tax_profile_snapshot';
      ELSE
        v_emp := LOWER(TRIM(COALESCE(v_profile->>'employment_type', '')));
        IF v_emp = '' THEN
          v_class := 'missing_tax_profile_snapshot';
        ELSIF (v_profile->>'staff_is_tax_resident')::BOOLEAN IS FALSE THEN
          v_class := 'non_resident';
        ELSIF (v_profile->>'secondary_employment')::BOOLEAN IS TRUE THEN
          v_class := 'secondary_employment';
        ELSIF v_emp LIKE '%casual%'
              OR COALESCE((v_profile->>'casual_worker_flat_tax_applied')::BOOLEAN, FALSE) THEN
          v_class := 'casual_worker';
        ELSIF v_emp LIKE '%temporary%' THEN
          v_class := 'temporary_worker';
        END IF;
      END IF;
      IF v_class IS NOT NULL THEN
        v_affected := v_affected || jsonb_build_array(jsonb_build_object(
          'staffId', v_entry.staff_id,
          'unsupportedClassification', v_class
        ));
      END IF;
    ELSE
      PERFORM public.payroll_ghana_verify_income_tax_components(
        v_entry, v_engine, v_period
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_affected) > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_affected) e
      WHERE e.value->>'unsupportedClassification' IN (
        'non_resident', 'secondary_employment', 'casual_worker',
        'temporary_worker', 'missing_tax_profile_snapshot'
      )
    ) THEN
      PERFORM public.raise_payroll_approval_error(
        'GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE',
        'Payroll includes employees with unsupported Ghana tax profiles and cannot be approved.',
        jsonb_build_object(
          'code', 'GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE',
          'affectedEmployees', v_affected
        )
      );
    ELSE
      PERFORM public.raise_payroll_approval_error(
        'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
        'Payroll entry statutory snapshots do not match the run and cannot be approved.',
        jsonb_build_object(
          'code', 'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
          'affectedEmployees', v_affected
        )
      );
    END IF;
  END IF;

  IF v_engine = 'finza-ghana-v3' THEN
    SELECT
      ROUND(COALESCE(SUM(pe.paye), 0), 2),
      ROUND(COALESCE(SUM(
        pe.income_tax_regular_amount
        + pe.income_tax_bonus_amount
        + pe.income_tax_overtime_amount
      ), 0), 2),
      ROUND(COALESCE(SUM(pe.employee_pension_contribution), 0), 2),
      ROUND(COALESCE(SUM(pe.employer_pension_contribution), 0), 2)
    INTO
      v_entry_paye,
      v_component_paye,
      v_entry_employee_pension,
      v_entry_employer_pension
    FROM public.payroll_entries pe
    WHERE pe.payroll_run_id = p_run.id
      AND pe.is_included IS DISTINCT FROM FALSE;

    IF ABS(COALESCE(p_run.total_paye, 0) - v_entry_paye) > 0.01
       OR ABS(v_entry_paye - v_component_paye) > 0.01 THEN
      PERFORM public.raise_payroll_approval_error(
        'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
        'Ghana v3 PAYE totals do not reconcile.',
        jsonb_build_object(
          'code', 'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
          'affectedEmployees', jsonb_build_array(jsonb_build_object(
            'unsupportedClassification', 'paye_totals_mismatch'
          ))
        )
      );
    END IF;

    IF ABS(COALESCE(p_run.total_ssnit_employee, 0) - v_entry_employee_pension) > 0.01
       OR ABS(COALESCE(p_run.total_ssnit_employer, 0) - v_entry_employer_pension) > 0.01 THEN
      PERFORM public.raise_payroll_approval_error(
        'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
        'Ghana v3 pension totals do not reconcile.',
        jsonb_build_object(
          'code', 'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
          'affectedEmployees', jsonb_build_array(jsonb_build_object(
            'unsupportedClassification', 'pension_snapshot_mismatch'
          ))
        )
      );
    END IF;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION public.payroll_ghana_calculate_paye_from_bands(NUMERIC) IS
  'Disabled legacy wrapper. Callers must pass an explicit PAYE rate version so September 2026+ payroll cannot silently use the 2024 schedule.';

REVOKE ALL ON FUNCTION public.payroll_ghana_calculate_paye_from_bands(NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_ghana_validate_run_for_approval(
  UUID, public.payroll_runs, INT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.payroll_ghana_calculate_paye_from_bands(NUMERIC)
  TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_validate_run_for_approval(
  UUID, public.payroll_runs, INT
) TO postgres;
