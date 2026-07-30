-- ============================================================================
-- Migration 561: Independently validate Ghana v3 payroll tax bases and totals
--
-- Migration 560 introduced immutable Ghana v3 calculation-method evidence.
-- This migration hardens approval by recomputing that evidence from the entry's
-- immutable earnings, profile, and statutory-version snapshots.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.payroll_ghana_calculate_paye_from_bands(
  p_income NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN COALESCE(p_income, 0) <= 0 THEN 0::NUMERIC
    ELSE ROUND(
      LEAST(GREATEST(p_income - 490, 0), 110) * 0.05
      + LEAST(GREATEST(p_income - 600, 0), 130) * 0.10
      + LEAST(GREATEST(p_income - 730, 0), 3166.67) * 0.175
      + LEAST(GREATEST(p_income - 3896.67, 0), 16000) * 0.25
      + LEAST(GREATEST(p_income - 19896.67, 0), 30520) * 0.30
      + GREATEST(p_income - 50416.67, 0) * 0.35,
      2
    )
  END
$fn$;

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

CREATE OR REPLACE FUNCTION public.payroll_ghana_raise_v3_validation_error(
  p_entry public.payroll_entries,
  p_classification TEXT,
  p_message TEXT DEFAULT 'Payroll entry failed Ghana v3 statutory validation.'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM public.raise_payroll_approval_error(
    'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
    p_message,
    jsonb_build_object(
      'code', 'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
      'affectedEmployees', jsonb_build_array(
        jsonb_build_object(
          'staffId', p_entry.staff_id,
          'unsupportedClassification', p_classification
        )
      )
    )
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.payroll_ghana_validate_v3_profile_snapshot(
  p_entry public.payroll_entries
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_profile JSONB := p_entry.payroll_tax_profile;
  v_expected_method TEXT;
  v_canonical_employment TEXT;
BEGIN
  IF v_profile IS NULL OR jsonb_typeof(v_profile) <> 'object' THEN
    PERFORM public.payroll_ghana_raise_v3_validation_error(
      p_entry, 'missing_tax_profile_snapshot'
    );
    RETURN;
  END IF;

  IF NOT (v_profile ? 'staff_is_pensionable')
     OR jsonb_typeof(v_profile->'staff_is_pensionable') <> 'boolean' THEN
    PERFORM public.payroll_ghana_raise_v3_validation_error(
      p_entry, 'missing_pensionability_snapshot'
    );
    RETURN;
  END IF;

  IF NOT (v_profile ? 'staff_is_tax_resident')
     OR jsonb_typeof(v_profile->'staff_is_tax_resident') <> 'boolean'
     OR NOT (v_profile ? 'secondary_employment')
     OR jsonb_typeof(v_profile->'secondary_employment') <> 'boolean'
     OR NULLIF(TRIM(COALESCE(v_profile->>'employment_type', '')), '') IS NULL THEN
    -- Preserve migration 560's unsupported-profile error contract.
    PERFORM public.payroll_ghana_resolve_income_tax_method(v_profile);
    RETURN;
  END IF;

  v_canonical_employment :=
    public.payroll_ghana_canonical_employment_type(v_profile->>'employment_type');
  IF v_canonical_employment IS NULL
     OR v_profile->>'employment_type' IS DISTINCT FROM v_canonical_employment THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE',
      'Payroll entry has an unsupported Ghana tax profile.',
      jsonb_build_object(
        'code', 'GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE',
        'affectedEmployees', jsonb_build_array(jsonb_build_object(
          'staffId', p_entry.staff_id,
          'unsupportedClassification', 'unknown_employment_type'
        ))
      )
    );
    RETURN;
  END IF;

  IF NULLIF(TRIM(COALESCE(p_entry.income_tax_method, '')), '') IS NULL
     OR NULLIF(TRIM(COALESCE(p_entry.income_tax_method_version, '')), '') IS NULL
     OR NULLIF(TRIM(COALESCE(v_profile->>'income_tax_method', '')), '') IS NULL
     OR NULLIF(TRIM(COALESCE(v_profile->>'income_tax_method_version', '')), '') IS NULL THEN
    PERFORM public.payroll_ghana_raise_v3_validation_error(
      p_entry, 'missing_income_tax_method_snapshot'
    );
    RETURN;
  END IF;

  IF v_profile->>'income_tax_method' IS DISTINCT FROM p_entry.income_tax_method
     OR v_profile->>'income_tax_method_version'
        IS DISTINCT FROM p_entry.income_tax_method_version THEN
    PERFORM public.payroll_ghana_raise_v3_validation_error(
      p_entry, 'income_tax_method_snapshot_mismatch'
    );
    RETURN;
  END IF;

  v_expected_method :=
    public.payroll_ghana_resolve_income_tax_method(v_profile);
  IF p_entry.income_tax_method IS DISTINCT FROM v_expected_method THEN
    PERFORM public.payroll_ghana_raise_v3_validation_error(
      p_entry, 'income_tax_method_mismatch'
    );
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.payroll_ghana_validate_v3_pension_snapshot(
  p_entry public.payroll_entries
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_is_pensionable BOOLEAN :=
    (p_entry.payroll_tax_profile->>'staff_is_pensionable')::BOOLEAN;
  v_expected JSONB;
BEGIN
  v_expected := public.payroll_ghana_expected_pension(
    p_entry.basic_salary,
    p_entry.pension_rate_version,
    v_is_pensionable
  );

  IF p_entry.pensionable_base IS NULL
     OR p_entry.employee_pension_contribution IS NULL
     OR p_entry.employer_pension_contribution IS NULL
     OR p_entry.total_mandatory_pension IS NULL
     OR p_entry.tier1_ssnit_remittance IS NULL
     OR p_entry.tier2_pension_remittance IS NULL
     OR p_entry.ssnit_employee IS NULL
     OR p_entry.ssnit_employer IS NULL
     OR ABS(p_entry.pensionable_base - (v_expected->>'pensionable_base')::NUMERIC) > 0.01
     OR ABS(p_entry.employee_pension_contribution - (v_expected->>'employee')::NUMERIC) > 0.01
     OR ABS(p_entry.employer_pension_contribution - (v_expected->>'employer')::NUMERIC) > 0.01
     OR ABS(p_entry.total_mandatory_pension - (v_expected->>'total_mandatory')::NUMERIC) > 0.01
     OR ABS(p_entry.tier1_ssnit_remittance - (v_expected->>'tier1')::NUMERIC) > 0.01
     OR ABS(p_entry.tier2_pension_remittance - (v_expected->>'tier2')::NUMERIC) > 0.01
     OR ABS(p_entry.ssnit_employee - (v_expected->>'employee')::NUMERIC) > 0.01
     OR ABS(p_entry.ssnit_employer - (v_expected->>'employer')::NUMERIC) > 0.01 THEN
    PERFORM public.payroll_ghana_raise_v3_validation_error(
      p_entry, 'pension_snapshot_mismatch'
    );
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.payroll_ghana_validate_v3_earnings(
  p_entry public.payroll_entries
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_expected_gross NUMERIC := ROUND(
    COALESCE(p_entry.basic_salary, 0)
    + COALESCE(p_entry.regular_allowances_amount, 0)
    + COALESCE(p_entry.bonus_amount, 0)
    + COALESCE(p_entry.overtime_amount, 0),
    2
  );
  v_expected_allowances NUMERIC := ROUND(
    COALESCE(p_entry.regular_allowances_amount, 0)
    + COALESCE(p_entry.bonus_amount, 0)
    + COALESCE(p_entry.overtime_amount, 0),
    2
  );
BEGIN
  IF p_entry.basic_salary IS NULL
     OR p_entry.regular_allowances_amount IS NULL
     OR p_entry.bonus_amount IS NULL
     OR p_entry.overtime_amount IS NULL
     OR p_entry.gross_salary IS NULL
     OR p_entry.allowances_total IS NULL
     OR ABS(p_entry.gross_salary - v_expected_gross) > 0.01
     OR ABS(p_entry.allowances_total - v_expected_allowances) > 0.01 THEN
    PERFORM public.payroll_ghana_raise_v3_validation_error(
      p_entry, 'earnings_component_mismatch'
    );
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.payroll_ghana_validate_v3_income_tax(
  p_entry public.payroll_entries,
  p_period DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_is_pensionable BOOLEAN :=
    (p_entry.payroll_tax_profile->>'staff_is_pensionable')::BOOLEAN;
  v_expected_pension JSONB;
  v_employee_pension NUMERIC;
  v_basic NUMERIC := ROUND(COALESCE(p_entry.basic_salary, 0), 2);
  v_regular_allowances NUMERIC := ROUND(COALESCE(p_entry.regular_allowances_amount, 0), 2);
  v_bonus NUMERIC := ROUND(GREATEST(0, COALESCE(p_entry.bonus_amount, 0)), 2);
  v_overtime NUMERIC := ROUND(GREATEST(0, COALESCE(p_entry.overtime_amount, 0)), 2);
  v_gross NUMERIC;
  v_bonus_cap NUMERIC;
  v_bonus_concessional NUMERIC;
  v_bonus_graduated NUMERIC;
  v_bonus_tax_5 NUMERIC;
  v_ot_threshold NUMERIC;
  v_ot_at_5 NUMERIC;
  v_ot_at_10 NUMERIC;
  v_ot_graduated NUMERIC;
  v_ot_tax_5 NUMERIC;
  v_ot_tax_10 NUMERIC;
  v_taxable NUMERIC;
  v_graduated_base NUMERIC;
  v_regular_graduated_base NUMERIC;
  v_regular_paye NUMERIC;
  v_regular_plus_bonus_paye NUMERIC;
  v_graduated_paye NUMERIC;
  v_bonus_tax_graduated NUMERIC;
  v_ot_tax_graduated NUMERIC;
  v_paye NUMERIC;
  v_regular_component_base NUMERIC;
  v_regular_component_amount NUMERIC;
  v_bonus_component_amount NUMERIC;
  v_ot_component_amount NUMERIC;
BEGIN
  IF p_entry.income_tax_method_version <> 'gh-profile-tax-2024-01' THEN
    PERFORM public.payroll_ghana_raise_v3_validation_error(
      p_entry, 'unknown_profile_tax_version'
    );
    RETURN;
  END IF;
  IF NOT public.payroll_ghana_profile_tax_version_covers_period(
    p_entry.income_tax_method_version, p_period
  ) THEN
    PERFORM public.payroll_ghana_raise_v3_validation_error(
      p_entry, 'profile_tax_version_does_not_cover_period'
    );
    RETURN;
  END IF;

  v_expected_pension := public.payroll_ghana_expected_pension(
    p_entry.basic_salary, p_entry.pension_rate_version, v_is_pensionable
  );
  v_employee_pension := (v_expected_pension->>'employee')::NUMERIC;
  v_gross := ROUND(v_basic + v_regular_allowances + v_bonus + v_overtime, 2);

  IF p_entry.income_tax_regular_base IS NULL
     OR p_entry.income_tax_regular_amount IS NULL
     OR p_entry.income_tax_bonus_base IS NULL
     OR p_entry.income_tax_bonus_amount IS NULL
     OR p_entry.income_tax_overtime_base IS NULL
     OR p_entry.income_tax_overtime_amount IS NULL THEN
    PERFORM public.payroll_ghana_raise_v3_validation_error(
      p_entry, 'income_tax_component_mismatch'
    );
    RETURN;
  END IF;

  IF p_entry.income_tax_method = 'gh_casual_flat_5' THEN
    v_paye := ROUND(v_gross * 0.05, 2);
    IF ABS(p_entry.income_tax_regular_base - v_gross) > 0.01
       OR ABS(p_entry.income_tax_bonus_base) > 0.01
       OR ABS(p_entry.income_tax_overtime_base) > 0.01
       OR ABS(COALESCE(p_entry.taxable_income, 0) - v_gross) > 0.01 THEN
      PERFORM public.payroll_ghana_raise_v3_validation_error(
        p_entry, 'income_tax_base_mismatch'
      );
      RETURN;
    END IF;
    IF p_entry.payroll_tax_profile->'casual_worker_flat_tax_applied'
         IS DISTINCT FROM 'true'::JSONB
       OR ABS(p_entry.income_tax_regular_amount - v_paye) > 0.01
       OR ABS(p_entry.income_tax_bonus_amount) > 0.01
       OR ABS(p_entry.income_tax_overtime_amount) > 0.01
       OR ABS(COALESCE(p_entry.bonus_tax_5, 0)) > 0.01
       OR ABS(COALESCE(p_entry.bonus_tax_graduated, 0)) > 0.01
       OR ABS(COALESCE(p_entry.overtime_tax_5, 0)) > 0.01
       OR ABS(COALESCE(p_entry.overtime_tax_10, 0)) > 0.01
       OR ABS(COALESCE(p_entry.overtime_tax_graduated, 0)) > 0.01
       OR ABS(COALESCE(p_entry.paye, 0) - v_paye) > 0.01 THEN
      PERFORM public.payroll_ghana_raise_v3_validation_error(
        p_entry, 'income_tax_component_mismatch'
      );
    END IF;
    RETURN;
  END IF;

  IF p_entry.income_tax_method = 'gh_nonresident_split_25_20' THEN
    v_regular_component_base := ROUND(
      GREATEST(0, v_basic + v_regular_allowances - v_employee_pension), 2
    );
    v_regular_component_amount := ROUND(v_regular_component_base * 0.25, 2);
    v_bonus_component_amount := ROUND(v_bonus * 0.20, 2);
    v_ot_component_amount := ROUND(v_overtime * 0.20, 2);
    v_paye := ROUND(
      v_regular_component_amount + v_bonus_component_amount + v_ot_component_amount,
      2
    );

    IF ABS(p_entry.income_tax_regular_base - v_regular_component_base) > 0.01
       OR ABS(p_entry.income_tax_bonus_base - v_bonus) > 0.01
       OR ABS(p_entry.income_tax_overtime_base - v_overtime) > 0.01
       OR ABS(COALESCE(p_entry.taxable_income, 0) - v_regular_component_base) > 0.01 THEN
      PERFORM public.payroll_ghana_raise_v3_validation_error(
        p_entry, 'income_tax_base_mismatch'
      );
      RETURN;
    END IF;
    IF ABS(p_entry.income_tax_regular_amount - v_regular_component_amount) > 0.01
       OR ABS(p_entry.income_tax_bonus_amount - v_bonus_component_amount) > 0.01
       OR ABS(p_entry.income_tax_overtime_amount - v_ot_component_amount) > 0.01
       OR ABS(COALESCE(p_entry.bonus_tax_5, 0)) > 0.01
       OR ABS(COALESCE(p_entry.bonus_tax_graduated, 0) - v_bonus_component_amount) > 0.01
       OR ABS(COALESCE(p_entry.overtime_tax_5, 0)) > 0.01
       OR ABS(COALESCE(p_entry.overtime_tax_10, 0)) > 0.01
       OR ABS(COALESCE(p_entry.overtime_tax_graduated, 0) - v_ot_component_amount) > 0.01
       OR ABS(COALESCE(p_entry.paye, 0) - v_paye) > 0.01 THEN
      PERFORM public.payroll_ghana_raise_v3_validation_error(
        p_entry, 'income_tax_component_mismatch'
      );
    END IF;
    RETURN;
  END IF;

  IF p_entry.income_tax_method <> 'gh_resident_graduated' THEN
    PERFORM public.payroll_ghana_raise_v3_validation_error(
      p_entry, 'unknown_income_tax_method'
    );
    RETURN;
  END IF;

  v_bonus_cap := ROUND(GREATEST(0, v_basic * 12 * 0.15), 2);
  v_bonus_concessional := LEAST(v_bonus, v_bonus_cap);
  v_bonus_graduated := ROUND(GREATEST(0, v_bonus - v_bonus_concessional), 2);
  v_bonus_tax_5 := ROUND(v_bonus_concessional * 0.05, 2);
  v_ot_threshold := ROUND(GREATEST(0, v_basic * 0.5), 2);
  v_ot_at_5 := CASE WHEN COALESCE(p_entry.is_qualifying_junior_employee, FALSE)
    THEN LEAST(v_overtime, v_ot_threshold) ELSE 0 END;
  v_ot_at_10 := CASE WHEN COALESCE(p_entry.is_qualifying_junior_employee, FALSE)
    THEN ROUND(GREATEST(0, v_overtime - v_ot_at_5), 2) ELSE 0 END;
  v_ot_graduated := CASE WHEN COALESCE(p_entry.is_qualifying_junior_employee, FALSE)
    THEN 0 ELSE v_overtime END;
  v_ot_tax_5 := ROUND(v_ot_at_5 * 0.05, 2);
  v_ot_tax_10 := ROUND(v_ot_at_10 * 0.10, 2);
  v_taxable := ROUND(GREATEST(0, v_gross - v_employee_pension), 2);
  v_graduated_base := ROUND(
    v_taxable - v_bonus_concessional - v_ot_at_5 - v_ot_at_10, 2
  );
  v_regular_graduated_base := ROUND(
    v_graduated_base - v_bonus_graduated - v_ot_graduated, 2
  );
  v_regular_paye := public.payroll_ghana_calculate_paye_from_bands(
    GREATEST(0, v_regular_graduated_base)
  );
  v_regular_plus_bonus_paye := public.payroll_ghana_calculate_paye_from_bands(
    GREATEST(0, v_regular_graduated_base + v_bonus_graduated)
  );
  v_graduated_paye := public.payroll_ghana_calculate_paye_from_bands(
    GREATEST(0, v_graduated_base)
  );
  v_bonus_tax_graduated := ROUND(
    GREATEST(0, v_regular_plus_bonus_paye - v_regular_paye), 2
  );
  v_ot_tax_graduated := ROUND(
    GREATEST(0, v_graduated_paye - v_regular_plus_bonus_paye), 2
  );
  v_paye := ROUND(
    v_graduated_paye + v_bonus_tax_5 + v_ot_tax_5 + v_ot_tax_10, 2
  );
  v_bonus_component_amount := ROUND(v_bonus_tax_5 + v_bonus_tax_graduated, 2);
  v_ot_component_amount := ROUND(
    v_ot_tax_5 + v_ot_tax_10 + v_ot_tax_graduated, 2
  );
  v_regular_component_amount := ROUND(
    v_paye - v_bonus_component_amount - v_ot_component_amount, 2
  );
  -- applyGhanaV3IncomeTax stores taxable - full bonus - full overtime.
  v_regular_component_base := ROUND(
    GREATEST(0, v_taxable - v_bonus - v_overtime), 2
  );

  IF ABS(COALESCE(p_entry.taxable_income, 0) - v_taxable) > 0.01
     OR ABS(COALESCE(p_entry.bonus_cap_amount, 0) - v_bonus_cap) > 0.01
     OR ABS(COALESCE(p_entry.bonus_concessional_amount, 0) - v_bonus_concessional) > 0.01
     OR ABS(COALESCE(p_entry.bonus_graduated_amount, 0) - v_bonus_graduated) > 0.01
     OR ABS(COALESCE(p_entry.overtime_threshold_amount, 0) - v_ot_threshold) > 0.01
     OR ABS(p_entry.income_tax_regular_base - v_regular_component_base) > 0.01
     OR ABS(p_entry.income_tax_bonus_base - v_bonus) > 0.01
     OR ABS(p_entry.income_tax_overtime_base - v_overtime) > 0.01 THEN
    PERFORM public.payroll_ghana_raise_v3_validation_error(
      p_entry, 'resident_tax_base_mismatch'
    );
    RETURN;
  END IF;

  IF ABS(COALESCE(p_entry.bonus_tax_5, 0) - v_bonus_tax_5) > 0.01
     OR ABS(COALESCE(p_entry.bonus_tax_graduated, 0) - v_bonus_tax_graduated) > 0.01
     OR ABS(COALESCE(p_entry.overtime_tax_5, 0) - v_ot_tax_5) > 0.01
     OR ABS(COALESCE(p_entry.overtime_tax_10, 0) - v_ot_tax_10) > 0.01
     OR ABS(COALESCE(p_entry.overtime_tax_graduated, 0) - v_ot_tax_graduated) > 0.01
     OR ABS(COALESCE(p_entry.paye, 0) - v_paye) > 0.01 THEN
    PERFORM public.payroll_ghana_raise_v3_validation_error(
      p_entry, 'resident_tax_amount_mismatch'
    );
    RETURN;
  END IF;

  IF ABS(p_entry.income_tax_regular_amount - v_regular_component_amount) > 0.01
     OR ABS(p_entry.income_tax_bonus_amount - v_bonus_component_amount) > 0.01
     OR ABS(p_entry.income_tax_overtime_amount - v_ot_component_amount) > 0.01
     OR ABS(
       p_entry.paye
       - p_entry.income_tax_regular_amount
       - p_entry.income_tax_bonus_amount
       - p_entry.income_tax_overtime_amount
     ) > 0.01 THEN
    PERFORM public.payroll_ghana_raise_v3_validation_error(
      p_entry, 'income_tax_component_mismatch'
    );
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.payroll_ghana_validate_v3_net_salary(
  p_entry public.payroll_entries
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_expected_net NUMERIC := ROUND(
    COALESCE(p_entry.gross_salary, 0)
    - COALESCE(p_entry.employee_pension_contribution, 0)
    - COALESCE(p_entry.paye, 0)
    - COALESCE(p_entry.deductions_total, 0),
    2
  );
BEGIN
  IF p_entry.net_salary IS NULL
     OR ABS(p_entry.net_salary - v_expected_net) > 0.01 THEN
    PERFORM public.payroll_ghana_raise_v3_validation_error(
      p_entry, 'net_salary_mismatch'
    );
  END IF;
END;
$fn$;

-- V2 behavior is retained from migration 560. V3 validation is deliberately
-- ordered profile -> earnings -> pension -> tax -> net.
CREATE OR REPLACE FUNCTION public.payroll_ghana_verify_income_tax_components(
  p_entry public.payroll_entries,
  p_engine TEXT,
  p_period DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_classification TEXT;
BEGIN
  IF p_engine = 'finza-ghana-v2' THEN
    IF p_entry.income_tax_method IS NOT NULL
       OR p_entry.income_tax_method_version IS NOT NULL
       OR p_entry.income_tax_regular_base IS NOT NULL
       OR p_entry.income_tax_regular_amount IS NOT NULL
       OR p_entry.income_tax_bonus_base IS NOT NULL
       OR p_entry.income_tax_bonus_amount IS NOT NULL
       OR p_entry.income_tax_overtime_base IS NOT NULL
       OR p_entry.income_tax_overtime_amount IS NOT NULL THEN
      v_classification := 'income_tax_component_mismatch';
    ELSE
      RETURN;
    END IF;
  ELSIF p_engine <> 'finza-ghana-v3' THEN
    v_classification := 'income_tax_component_mismatch';
  ELSE
    PERFORM public.payroll_ghana_validate_v3_profile_snapshot(p_entry);
    PERFORM public.payroll_ghana_validate_v3_earnings(p_entry);
    PERFORM public.payroll_ghana_validate_v3_pension_snapshot(p_entry);
    PERFORM public.payroll_ghana_validate_v3_income_tax(p_entry, p_period);
    PERFORM public.payroll_ghana_validate_v3_net_salary(p_entry);
    RETURN;
  END IF;

  PERFORM public.raise_payroll_approval_error(
    'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
    'Payroll entry income-tax components failed Ghana statutory validation.',
    jsonb_build_object(
      'code', 'GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED',
      'affectedEmployees', jsonb_build_array(
        jsonb_build_object(
          'staffId', p_entry.staff_id,
          'unsupportedClassification', v_classification
        )
      )
    )
  );
END;
$fn$;

-- Ghana approval validator. The v2 loop below is retained exactly from 560;
-- only the v3 helper call and post-loop v3 reconciliations are additive.
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
  -- For v3, surface the profile-tax support classification before the legacy
  -- run-level statutory-window error.
  IF v_engine = 'finza-ghana-v3'
     AND (v_period < DATE '2024-01-01' OR v_period > DATE '2026-12-31') THEN
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
  IF v_period < DATE '2024-01-01' OR v_period > DATE '2026-12-31' THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_UNKNOWN_RATE_VERSION',
      format('Ghana payroll period %s is outside the verified statutory support window (2024-01-01 through 2026-12-31).', v_period)
    );
  END IF;

  v_paye_ok :=
    v_paye = 'gh-paye-2024-01'
    AND v_period BETWEEN DATE '2024-01-01' AND DATE '2026-12-31';
  v_pension_ok :=
    (v_pension = 'gh-pension-2024-01' AND v_period BETWEEN DATE '2024-01-01' AND DATE '2024-12-31')
    OR (v_pension = 'gh-pension-2025-01' AND v_period BETWEEN DATE '2025-01-01' AND DATE '2025-12-31')
    OR (v_pension = 'gh-pension-2026-01' AND v_period BETWEEN DATE '2026-01-01' AND DATE '2026-12-31');
  IF NOT v_paye_ok OR NOT v_pension_ok THEN
    PERFORM public.raise_payroll_approval_error(
      'GHANA_PAYROLL_UNKNOWN_RATE_VERSION',
      'Stored Ghana PAYE or pension version does not cover the payroll period.'
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
  'Calculates Ghana resident monthly PAYE from the gh-paye-2024-01 Next-band widths.';
COMMENT ON FUNCTION public.payroll_ghana_expected_pension(NUMERIC, TEXT, BOOLEAN) IS
  'Recomputes Ghana pension snapshots from basic salary, the frozen pension version, and frozen pensionability.';
COMMENT ON FUNCTION public.payroll_ghana_validate_v3_profile_snapshot(public.payroll_entries) IS
  'Validates the immutable Ghana v3 profile and calculation-method snapshot.';
COMMENT ON FUNCTION public.payroll_ghana_validate_v3_pension_snapshot(public.payroll_entries) IS
  'Validates all Ghana v3 pension fields against independently recomputed amounts.';
COMMENT ON FUNCTION public.payroll_ghana_validate_v3_earnings(public.payroll_entries) IS
  'Reconciles Ghana v3 gross salary and allowances to immutable earnings components.';
COMMENT ON FUNCTION public.payroll_ghana_validate_v3_income_tax(public.payroll_entries, DATE) IS
  'Recomputes Ghana v3 resident, casual, or non-resident income-tax bases and amounts.';
COMMENT ON FUNCTION public.payroll_ghana_validate_v3_net_salary(public.payroll_entries) IS
  'Recomputes Ghana v3 net salary without clamping negative results.';

REVOKE ALL ON FUNCTION public.payroll_ghana_calculate_paye_from_bands(NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_ghana_expected_pension(NUMERIC, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_ghana_raise_v3_validation_error(
  public.payroll_entries, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_ghana_validate_v3_profile_snapshot(
  public.payroll_entries
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_ghana_validate_v3_pension_snapshot(
  public.payroll_entries
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_ghana_validate_v3_earnings(
  public.payroll_entries
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_ghana_validate_v3_income_tax(
  public.payroll_entries, DATE
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_ghana_validate_v3_net_salary(
  public.payroll_entries
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_ghana_verify_income_tax_components(
  public.payroll_entries, TEXT, DATE
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_ghana_validate_run_for_approval(
  UUID, public.payroll_runs, INT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.payroll_ghana_calculate_paye_from_bands(NUMERIC)
  TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_expected_pension(NUMERIC, TEXT, BOOLEAN)
  TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_raise_v3_validation_error(
  public.payroll_entries, TEXT, TEXT
) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_validate_v3_profile_snapshot(
  public.payroll_entries
) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_validate_v3_pension_snapshot(
  public.payroll_entries
) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_validate_v3_earnings(
  public.payroll_entries
) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_validate_v3_income_tax(
  public.payroll_entries, DATE
) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_validate_v3_net_salary(
  public.payroll_entries
) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_verify_income_tax_components(
  public.payroll_entries, TEXT, DATE
) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_validate_run_for_approval(
  UUID, public.payroll_runs, INT
) TO postgres;
