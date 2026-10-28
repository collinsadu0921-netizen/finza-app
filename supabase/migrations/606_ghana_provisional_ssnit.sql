-- ============================================================================
-- Migration 606: Provisional annual SSNIT limits for the 2027 transition
--
-- SSNIT sometimes publishes annual insurable-earnings notices after 1 January.
-- Until the next official notice is available, Finza may calculate pensionable
-- payroll with the latest published limits, but only provisionally and only
-- after explicit employer acknowledgement.
--
-- This migration:
--   1. Adds the run-level provisional-limits snapshot and acknowledgement fields.
--   2. Recognises gh-pension-2027-provisional (latest 2026 limits, 2027 period).
--   3. Requires a provisional snapshot and acknowledgement before approval.
--   4. Blocks provisional approval once an official version is configured for
--      the period, forcing draft recalculation instead of silent finalisation.
--
-- PAYE remains unchanged and effective-dated. Approved/locked/reversed runs and
-- their journals are immutable; differences on already-paid provisional runs use
-- the existing reversal/correction workflow.
-- ============================================================================

ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS pension_limits_provisional BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pension_minimum_insurable_earnings NUMERIC,
  ADD COLUMN IF NOT EXISTS pension_maximum_insurable_earnings NUMERIC,
  ADD COLUMN IF NOT EXISTS pension_limits_effective_from DATE,
  ADD COLUMN IF NOT EXISTS provisional_ssnit_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provisional_ssnit_acknowledged_by UUID;

COMMENT ON COLUMN public.payroll_runs.pension_limits_provisional IS
  'True when the run reused the latest published SSNIT limits before the next annual notice.';
COMMENT ON COLUMN public.payroll_runs.pension_minimum_insurable_earnings IS
  'Minimum monthly insurable earnings actually used for this run.';
COMMENT ON COLUMN public.payroll_runs.pension_maximum_insurable_earnings IS
  'Maximum monthly insurable earnings actually used for this run.';
COMMENT ON COLUMN public.payroll_runs.pension_limits_effective_from IS
  'Statutory effective date of the SSNIT limits used (not necessarily the payroll month).';
COMMENT ON COLUMN public.payroll_runs.provisional_ssnit_acknowledged_at IS
  'Employer acknowledgement timestamp for provisional SSNIT payroll.';
COMMENT ON COLUMN public.payroll_runs.provisional_ssnit_acknowledged_by IS
  'User who acknowledged provisional SSNIT payroll.';

CREATE OR REPLACE FUNCTION public.payroll_ghana_expected_pension(
  p_basic NUMERIC,
  p_pension_version TEXT,
  p_is_pensionable BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_min NUMERIC;
  v_max NUMERIC;
  v_base NUMERIC;
  v_employee NUMERIC;
  v_employer NUMERIC;
  v_tier1 NUMERIC;
  v_tier2 NUMERIC;
  v_total NUMERIC;
  v_tier_sum NUMERIC;
  v_drift NUMERIC;
BEGIN
  IF p_is_pensionable IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'pensionable_base', 0,
      'employee', 0,
      'employer', 0,
      'total_mandatory', 0,
      'tier1', 0,
      'tier2', 0
    );
  END IF;

  CASE p_pension_version
    WHEN 'gh-pension-2024-01' THEN v_min := 490.05; v_max := 52000;
    WHEN 'gh-pension-2025-01' THEN v_min := 539.19; v_max := 61000;
    WHEN 'gh-pension-2026-01' THEN v_min := 587.8; v_max := 69000;
    WHEN 'gh-pension-2027-provisional' THEN v_min := 587.8; v_max := 69000;
    ELSE
      RAISE EXCEPTION
        USING ERRCODE = 'P0001',
              MESSAGE = format('Unrecognized Ghana pension rate version "%s".', p_pension_version),
              DETAIL = jsonb_build_object(
                'code', 'GHANA_PAYROLL_UNKNOWN_RATE_VERSION'
              )::TEXT;
  END CASE;

  v_base := ROUND(LEAST(v_max, GREATEST(v_min, COALESCE(p_basic, 0))), 2);
  v_employee := ROUND(v_base * 0.055, 2);
  v_employer := ROUND(v_base * 0.13, 2);
  v_tier1 := ROUND(v_base * 0.135, 2);
  v_tier2 := ROUND(v_base * 0.05, 2);
  v_total := ROUND(v_employee + v_employer, 2);
  v_tier_sum := ROUND(v_tier1 + v_tier2, 2);
  v_drift := ROUND(v_total - v_tier_sum, 2);

  IF ABS(v_drift) > 0 AND ABS(v_drift) <= 0.01 THEN
    v_tier2 := ROUND(v_tier2 + v_drift, 2);
  ELSIF ABS(v_drift) > 0.01 THEN
    v_tier2 := ROUND(v_total - v_tier1, 2);
  END IF;

  RETURN jsonb_build_object(
    'pensionable_base', v_base,
    'employee', v_employee,
    'employer', v_employer,
    'total_mandatory', v_total,
    'tier1', v_tier1,
    'tier2', v_tier2
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.payroll_ghana_confirmed_pension_version_for_period(
  p_period DATE
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_period BETWEEN DATE '2024-01-01' AND DATE '2024-12-31'
      THEN 'gh-pension-2024-01'
    WHEN p_period BETWEEN DATE '2025-01-01' AND DATE '2025-12-31'
      THEN 'gh-pension-2025-01'
    WHEN p_period BETWEEN DATE '2026-01-01' AND DATE '2026-12-31'
      THEN 'gh-pension-2026-01'
    -- When the official 2027 notice is published, add its version here and in
    -- payroll_ghana_expected_pension. Until then 2027 uses the provisional version.
    ELSE NULL
  END
$fn$;

COMMENT ON FUNCTION public.payroll_ghana_confirmed_pension_version_for_period(DATE) IS
  'Returns the officially configured annual SSNIT version for a period, or NULL when only provisional limits are available. Update this function when a new SSNIT notice is configured.';

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
  v_confirmed_pension TEXT;
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
  v_confirmed_pension :=
    public.payroll_ghana_confirmed_pension_version_for_period(v_period);

  IF v_confirmed_pension IS NOT NULL THEN
    IF v_pension = 'gh-pension-2027-provisional' THEN
      PERFORM public.raise_payroll_approval_error(
        'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
        'Official SSNIT limits are now configured for this payroll period. Recalculate this draft before approval.',
        jsonb_build_object(
          'code', 'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
          'affectedEmployees', jsonb_build_array(jsonb_build_object(
            'unsupportedClassification', 'official_ssnit_limits_require_recalculation'
          ))
        )
      );
    END IF;
    v_pension_ok := (v_pension = v_confirmed_pension);
  ELSE
    v_pension_ok := (
      v_pension = 'gh-pension-2027-provisional'
      AND v_period BETWEEN DATE '2027-01-01' AND DATE '2027-12-31'
    );
  END IF;

  IF NOT v_paye_ok THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_UNKNOWN_RATE_VERSION',
      'Stored Ghana PAYE version does not cover the payroll period.'
    );
  END IF;

  IF v_pension = 'gh-pension-2027-provisional' AND v_pension_ok THEN
    IF p_run.pension_limits_provisional IS NOT TRUE THEN
      PERFORM public.raise_payroll_approval_error(
        'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
        'Provisional SSNIT payroll is missing its provisional-limits snapshot.',
        jsonb_build_object(
          'code', 'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
          'affectedEmployees', jsonb_build_array(jsonb_build_object(
            'unsupportedClassification', 'provisional_ssnit_snapshot_mismatch'
          ))
        )
      );
    END IF;
    IF p_run.provisional_ssnit_acknowledged_at IS NULL THEN
      PERFORM public.raise_payroll_approval_error(
        'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
        'Employer acknowledgement is required before approving payroll that uses provisional SSNIT limits.',
        jsonb_build_object(
          'code', 'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
          'affectedEmployees', jsonb_build_array(jsonb_build_object(
            'unsupportedClassification', 'provisional_ssnit_acknowledgement_required'
          ))
        )
      );
    END IF;
    IF p_run.pension_minimum_insurable_earnings IS DISTINCT FROM 587.80
       OR p_run.pension_maximum_insurable_earnings IS DISTINCT FROM 69000
       OR p_run.pension_limits_effective_from IS DISTINCT FROM DATE '2026-01-01' THEN
      PERFORM public.raise_payroll_approval_error(
        'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
        'Provisional SSNIT limits snapshot does not match the configured interim limits.',
        jsonb_build_object(
          'code', 'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
          'affectedEmployees', jsonb_build_array(jsonb_build_object(
            'unsupportedClassification', 'provisional_ssnit_snapshot_mismatch'
          ))
        )
      );
    END IF;
  ELSIF p_run.pension_limits_provisional IS TRUE THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
      'Payroll run is flagged provisional but does not use the provisional SSNIT version.',
      jsonb_build_object(
        'code', 'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
        'affectedEmployees', jsonb_build_array(jsonb_build_object(
          'unsupportedClassification', 'provisional_ssnit_snapshot_mismatch'
        ))
      )
    );
  END IF;

  IF NOT v_pension_ok THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_UNKNOWN_RATE_VERSION',
      format(
        'Ghana payroll period %s does not have a configured annual SSNIT insurable-earnings version. Add the official SSNIT version for that year before approval.',
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


COMMENT ON FUNCTION public.payroll_ghana_expected_pension(NUMERIC, TEXT, BOOLEAN) IS
  'Recomputes Ghana pension snapshots from basic salary, the frozen pension version, and frozen pensionability. Supports the provisional 2027 version.';

REVOKE ALL ON FUNCTION public.payroll_ghana_expected_pension(NUMERIC, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_ghana_confirmed_pension_version_for_period(DATE)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_ghana_validate_run_for_approval(
  UUID, public.payroll_runs, INT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.payroll_ghana_expected_pension(NUMERIC, TEXT, BOOLEAN)
  TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_confirmed_pension_version_for_period(DATE)
  TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_validate_run_for_approval(
  UUID, public.payroll_runs, INT
) TO postgres;
