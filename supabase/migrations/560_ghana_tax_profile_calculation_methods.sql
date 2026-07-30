-- ============================================================================
-- Migration 560: Ghana tax-profile calculation methods
--
-- Additive only: no historical backfill and no default calculation method.
-- Replaces approval validation, approval-time export snapshot materialization,
-- and the explicit reversal/correction copy contract.
-- ============================================================================

ALTER TABLE public.payroll_entries
  ADD COLUMN IF NOT EXISTS income_tax_method TEXT,
  ADD COLUMN IF NOT EXISTS income_tax_method_version TEXT,
  ADD COLUMN IF NOT EXISTS income_tax_regular_base NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS income_tax_regular_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS income_tax_bonus_base NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS income_tax_bonus_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS income_tax_overtime_base NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS income_tax_overtime_amount NUMERIC(15,2);

ALTER TABLE public.payroll_entries
  DROP CONSTRAINT IF EXISTS payroll_entries_income_tax_method_check,
  DROP CONSTRAINT IF EXISTS payroll_entries_income_tax_regular_base_check,
  DROP CONSTRAINT IF EXISTS payroll_entries_income_tax_regular_amount_check,
  DROP CONSTRAINT IF EXISTS payroll_entries_income_tax_bonus_base_check,
  DROP CONSTRAINT IF EXISTS payroll_entries_income_tax_bonus_amount_check,
  DROP CONSTRAINT IF EXISTS payroll_entries_income_tax_overtime_base_check,
  DROP CONSTRAINT IF EXISTS payroll_entries_income_tax_overtime_amount_check;

ALTER TABLE public.payroll_entries
  ADD CONSTRAINT payroll_entries_income_tax_method_check
    CHECK (
      income_tax_method IS NULL
      OR income_tax_method IN (
        'gh_resident_graduated',
        'gh_casual_flat_5',
        'gh_nonresident_split_25_20'
      )
    ),
  ADD CONSTRAINT payroll_entries_income_tax_regular_base_check
    CHECK (income_tax_regular_base IS NULL OR income_tax_regular_base >= 0),
  ADD CONSTRAINT payroll_entries_income_tax_regular_amount_check
    CHECK (income_tax_regular_amount IS NULL OR income_tax_regular_amount >= 0),
  ADD CONSTRAINT payroll_entries_income_tax_bonus_base_check
    CHECK (income_tax_bonus_base IS NULL OR income_tax_bonus_base >= 0),
  ADD CONSTRAINT payroll_entries_income_tax_bonus_amount_check
    CHECK (income_tax_bonus_amount IS NULL OR income_tax_bonus_amount >= 0),
  ADD CONSTRAINT payroll_entries_income_tax_overtime_base_check
    CHECK (income_tax_overtime_base IS NULL OR income_tax_overtime_base >= 0),
  ADD CONSTRAINT payroll_entries_income_tax_overtime_amount_check
    CHECK (income_tax_overtime_amount IS NULL OR income_tax_overtime_amount >= 0);

COMMENT ON COLUMN public.payroll_entries.income_tax_method IS
  'Frozen Ghana income-tax calculation method selected from the entry tax-profile snapshot.';
COMMENT ON COLUMN public.payroll_entries.income_tax_method_version IS
  'Frozen version of the Ghana profile-tax method used for this payroll entry.';
COMMENT ON COLUMN public.payroll_entries.income_tax_regular_base IS
  'Frozen regular-income base used by the selected Ghana profile-tax method.';
COMMENT ON COLUMN public.payroll_entries.income_tax_regular_amount IS
  'Frozen tax amount attributable to regular income.';
COMMENT ON COLUMN public.payroll_entries.income_tax_bonus_base IS
  'Frozen bonus-income base used by the selected Ghana profile-tax method.';
COMMENT ON COLUMN public.payroll_entries.income_tax_bonus_amount IS
  'Frozen tax amount attributable to bonus income.';
COMMENT ON COLUMN public.payroll_entries.income_tax_overtime_base IS
  'Frozen overtime-income base used by the selected Ghana profile-tax method.';
COMMENT ON COLUMN public.payroll_entries.income_tax_overtime_amount IS
  'Frozen tax amount attributable to overtime income.';

-- ---------------------------------------------------------------------------
-- Exact employment-type normalization and support-matrix resolution
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_ghana_canonical_employment_type(
  p_employment_type TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE LOWER(TRIM(COALESCE(p_employment_type, '')))
    WHEN 'full_time' THEN 'full_time'
    WHEN 'full-time' THEN 'full_time'
    WHEN 'full time' THEN 'full_time'
    WHEN 'part_time' THEN 'part_time'
    WHEN 'part-time' THEN 'part_time'
    WHEN 'part time' THEN 'part_time'
    WHEN 'permanent' THEN 'permanent'
    WHEN 'permanent_employee' THEN 'permanent'
    WHEN 'permanent employee' THEN 'permanent'
    WHEN 'temporary' THEN 'temporary'
    WHEN 'temporary_employee' THEN 'temporary'
    WHEN 'temporary employee' THEN 'temporary'
    WHEN 'contract' THEN 'contract'
    WHEN 'contract_employee' THEN 'contract'
    WHEN 'contract employee' THEN 'contract'
    WHEN 'contractor' THEN 'contract'
    WHEN 'casual' THEN 'casual'
    WHEN 'casual_worker' THEN 'casual'
    WHEN 'casual worker' THEN 'casual'
    ELSE NULL
  END
$fn$;

CREATE OR REPLACE FUNCTION public.payroll_ghana_resolve_income_tax_method(
  p_profile JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_resident BOOLEAN;
  v_secondary BOOLEAN;
  v_employment_type TEXT;
  v_classification TEXT;
BEGIN
  IF p_profile IS NULL
     OR jsonb_typeof(p_profile) <> 'object'
     OR NOT (p_profile ? 'staff_is_tax_resident')
     OR jsonb_typeof(p_profile->'staff_is_tax_resident') <> 'boolean'
     OR NOT (p_profile ? 'secondary_employment')
     OR jsonb_typeof(p_profile->'secondary_employment') <> 'boolean'
     OR NULLIF(TRIM(COALESCE(p_profile->>'employment_type', '')), '') IS NULL THEN
    v_classification := 'missing_tax_profile_snapshot';
  ELSE
    v_resident := (p_profile->>'staff_is_tax_resident')::BOOLEAN;
    v_secondary := (p_profile->>'secondary_employment')::BOOLEAN;
    v_employment_type :=
      public.payroll_ghana_canonical_employment_type(p_profile->>'employment_type');

    IF NOT v_resident AND v_employment_type = 'casual' THEN
      v_classification := 'nonresident_casual_worker';
    ELSIF v_secondary THEN
      v_classification := 'secondary_employment_requires_verified_withholding_method';
    ELSIF v_employment_type IS NULL THEN
      v_classification := 'unknown_employment_type';
    ELSIF NOT v_resident
          AND v_employment_type IN ('full_time', 'part_time', 'permanent', 'temporary', 'contract') THEN
      RETURN 'gh_nonresident_split_25_20';
    ELSIF v_resident AND v_employment_type = 'casual' THEN
      RETURN 'gh_casual_flat_5';
    ELSIF v_resident
          AND v_employment_type IN ('full_time', 'part_time', 'permanent', 'temporary', 'contract') THEN
      RETURN 'gh_resident_graduated';
    ELSE
      v_classification := 'unknown_employment_type';
    END IF;
  END IF;

  PERFORM public.raise_payroll_approval_error(
    'GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE',
    'Payroll entry has an unsupported Ghana tax profile.',
    jsonb_build_object(
      'code', 'GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE',
      'affectedEmployees', jsonb_build_array(
        jsonb_build_object('unsupportedClassification', v_classification)
      )
    )
  );
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.payroll_ghana_profile_tax_version_covers_period(
  p_version TEXT,
  p_period DATE
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(
    p_version = 'gh-profile-tax-2024-01'
    AND p_period BETWEEN DATE '2024-01-01' AND DATE '2026-12-31',
    FALSE
  )
$fn$;

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
  v_expected_method TEXT;
  v_classification TEXT;
  v_sum NUMERIC;
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
  ELSIF NULLIF(TRIM(COALESCE(p_entry.income_tax_method, '')), '') IS NULL
        OR NULLIF(TRIM(COALESCE(p_entry.income_tax_method_version, '')), '') IS NULL THEN
    v_classification := 'missing_income_tax_method_snapshot';
  ELSIF p_entry.income_tax_method NOT IN (
          'gh_resident_graduated',
          'gh_casual_flat_5',
          'gh_nonresident_split_25_20'
        ) THEN
    v_classification := 'unknown_income_tax_method';
  ELSIF p_entry.income_tax_method_version <> 'gh-profile-tax-2024-01' THEN
    v_classification := 'unknown_profile_tax_version';
  ELSIF NOT public.payroll_ghana_profile_tax_version_covers_period(
          p_entry.income_tax_method_version, p_period
        ) THEN
    v_classification := 'profile_tax_version_does_not_cover_period';
  ELSIF p_entry.income_tax_regular_base IS NULL
        OR p_entry.income_tax_regular_amount IS NULL
        OR p_entry.income_tax_bonus_base IS NULL
        OR p_entry.income_tax_bonus_amount IS NULL
        OR p_entry.income_tax_overtime_base IS NULL
        OR p_entry.income_tax_overtime_amount IS NULL THEN
    v_classification := 'income_tax_component_mismatch';
  ELSE
    v_expected_method :=
      public.payroll_ghana_resolve_income_tax_method(p_entry.payroll_tax_profile);
    IF p_entry.income_tax_method IS DISTINCT FROM v_expected_method THEN
      v_classification := 'income_tax_method_mismatch';
    ELSE
      v_sum :=
        p_entry.income_tax_regular_amount
        + p_entry.income_tax_bonus_amount
        + p_entry.income_tax_overtime_amount;
      IF ABS(COALESCE(p_entry.paye, 0) - v_sum) > 0.01 THEN
        v_classification := 'income_tax_component_mismatch';
      ELSIF p_entry.income_tax_method = 'gh_casual_flat_5'
            AND (
              ABS(p_entry.income_tax_regular_base - COALESCE(p_entry.gross_salary, 0)) > 0.01
              OR ABS(
                p_entry.income_tax_regular_amount
                - ROUND(COALESCE(p_entry.gross_salary, 0) * 0.05, 2)
              ) > 0.01
              OR ABS(p_entry.income_tax_bonus_base) > 0.01
              OR ABS(p_entry.income_tax_bonus_amount) > 0.01
              OR ABS(p_entry.income_tax_overtime_base) > 0.01
              OR ABS(p_entry.income_tax_overtime_amount) > 0.01
            ) THEN
        v_classification := 'income_tax_component_mismatch';
      ELSIF p_entry.income_tax_method = 'gh_nonresident_split_25_20'
            AND (
              ABS(
                p_entry.income_tax_regular_amount
                - ROUND(p_entry.income_tax_regular_base * 0.25, 2)
              ) > 0.01
              OR ABS(
                p_entry.income_tax_bonus_amount
                - ROUND(p_entry.income_tax_bonus_base * 0.20, 2)
              ) > 0.01
              OR ABS(
                p_entry.income_tax_overtime_amount
                - ROUND(p_entry.income_tax_overtime_base * 0.20, 2)
              ) > 0.01
            ) THEN
        v_classification := 'income_tax_component_mismatch';
      ELSE
        RETURN;
      END IF;
    END IF;
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

-- ---------------------------------------------------------------------------
-- Ghana approval validator. V2 classifications remain byte-for-byte compatible.
-- ---------------------------------------------------------------------------
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
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Approval-time immutable export snapshots.
-- 559 invariants are static here: source status is approved, and approval
-- timestamp/actor are transaction_timestamp()/p_actor_id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_payroll_export_snapshots_for_approval(
  p_business_id UUID,
  p_payroll_run_id UUID,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_run public.payroll_runs%ROWTYPE;
  v_business JSONB;
  v_run_json JSONB;
  v_header TEXT[] := ARRAY[
    '(3) TIN', '(2) Employee Name', '(1) Serial Number', '(4) Position',
    '(5) Non-Resident', '(6) Basic Salary', '(7) Secondary Employment',
    '(8) Social Security Fund', '(9) Third Tier Pension', '(10) Cash Allowances',
    '(11) Bonus Income', '(12) Final Tax on Bonus', '(13) Excess Bonus',
    '(14) Total Cash Emolument', '(15) Accommodation Element',
    '(16) Vehicle Element', '(17) Non Cash Benefit',
    '(18) Total Assessable Income', '(19) Deductible Reliefs',
    '(20) Total Reliefs', '(21) Chargeable Income', '(22) Tax Deductible',
    '(23) Overtime Income', '(24) Overtime Tax',
    '(25) Total Tax Payable to GRA', '(26) Severance Pay Paid', '(27) Remarks '
  ];
  v_header_hash TEXT;
  v_entry public.payroll_entries%ROWTYPE;
  v_profile JSONB;
  v_affected JSONB := '[]'::JSONB;
  v_rows JSONB := '[]'::JSONB;
  v_cells TEXT[];
  v_csv TEXT;
  v_serial INT := 0;
  v_count INT := 0;
  v_ssf NUMERIC;
  v_ot_tax NUMERIC;
  v_excess_bonus NUMERIC;
  v_control JSONB;
  v_recomputed RECORD;
  v_payload JSONB;
  v_result JSONB := '[]'::JSONB;
  v_item JSONB;
  v_period TEXT;
  v_is_ghana BOOLEAN;
BEGIN
  IF p_business_id IS NULL OR p_payroll_run_id IS NULL OR p_actor_id IS NULL THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_SNAPSHOT_VALIDATION_FAILED',
      'business_id, payroll_run_id, and actor_id are required'
    );
  END IF;

  SELECT * INTO v_run
  FROM public.payroll_runs pr
  WHERE pr.id = p_payroll_run_id
    AND pr.business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND OR v_run.deleted_at IS NOT NULL
     OR v_run.status IS DISTINCT FROM 'draft'
     OR v_run.journal_entry_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.journal_entries je
       WHERE je.id = v_run.journal_entry_id
         AND je.business_id = p_business_id
         AND je.reference_type = 'payroll'
         AND je.reference_id = p_payroll_run_id
     ) THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_SNAPSHOT_INVALID_STATE',
      'Export snapshots require a draft payroll with its approval journal already posted'
    );
  END IF;

  PERFORM 1
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE
  ORDER BY pe.id FOR UPDATE;

  SELECT COUNT(*)::INT INTO v_count
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE;
  IF v_count < 1 THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_SNAPSHOT_VALIDATION_FAILED',
      'Cannot snapshot an empty payroll run'
    );
  END IF;

  SELECT jsonb_build_object(
    'id', b.id, 'legal_name', b.legal_name, 'trading_name', b.trading_name,
    'tin', b.tin, 'default_currency', b.default_currency
  ) INTO v_business
  FROM public.businesses b WHERE b.id = p_business_id;
  IF v_business IS NULL THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_SNAPSHOT_VALIDATION_FAILED',
      'Business not found for export snapshot'
    );
  END IF;

  v_run_json := jsonb_build_object(
    'id', v_run.id, 'business_id', v_run.business_id,
    'payroll_month', v_run.payroll_month,
    'pay_period_start', v_run.pay_period_start,
    'pay_period_end', v_run.pay_period_end,
    'payroll_frequency', v_run.payroll_frequency, 'run_type', v_run.run_type,
    'source_status', 'approved', 'journal_entry_id', v_run.journal_entry_id,
    'correction_of_run_id', v_run.correction_of_run_id,
    'calculation_engine_version', v_run.calculation_engine_version,
    'paye_rate_version', v_run.paye_rate_version,
    'pension_rate_version', v_run.pension_rate_version,
    'calculation_jurisdiction', v_run.calculation_jurisdiction,
    'statutory_period_basis', v_run.statutory_period_basis,
    'approved_at', transaction_timestamp(), 'approved_by', p_actor_id
  );

  v_is_ghana :=
    LOWER(TRIM(COALESCE(v_run.calculation_engine_version, '')))
      IN ('finza-ghana-v2', 'finza-ghana-v3')
    OR UPPER(TRIM(COALESCE(v_run.calculation_jurisdiction, ''))) = 'GH';
  IF v_is_ghana THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'staffId', pe.staff_id,
      'filingEmployeeName', NULLIF(TRIM(COALESCE(pe.filing_employee_name, '')), '')
    ) ORDER BY pe.id), '[]'::JSONB)
    INTO v_affected
    FROM public.payroll_entries pe
    WHERE pe.payroll_run_id = p_payroll_run_id
      AND pe.is_included IS DISTINCT FROM FALSE
      AND (
        NULLIF(TRIM(COALESCE(pe.filing_tin, '')), '') IS NULL
        OR NULLIF(TRIM(COALESCE(pe.filing_employee_name, '')), '') IS NULL
        OR jsonb_typeof(pe.payroll_tax_profile) IS DISTINCT FROM 'object'
        OR NULLIF(TRIM(COALESCE(pe.payroll_tax_profile->>'gra_position_code', '')), '') IS NULL
      );
    IF jsonb_array_length(v_affected) > 0 THEN
      PERFORM public.raise_payroll_export_error(
        'PAYROLL_EXPORT_SNAPSHOT_VALIDATION_FAILED',
        'Ghana export snapshots require frozen filing identity and GRA position for every included employee',
        jsonb_build_object(
          'code', 'PAYROLL_EXPORT_SNAPSHOT_VALIDATION_FAILED',
          'affectedEmployees', v_affected
        )
      );
    END IF;
  END IF;

  SELECT COUNT(*)::INT included_count,
    ROUND(COALESCE(SUM(COALESCE(pe.basic_salary, 0)), 0), 2) basic,
    ROUND(COALESCE(SUM(COALESCE(pe.allowances_total, 0)), 0), 2) allowances,
    ROUND(COALESCE(SUM(COALESCE(pe.gross_salary, 0)), 0), 2) gross,
    ROUND(COALESCE(SUM(COALESCE(pe.ssnit_employee, 0)), 0), 2) ssnit_employee,
    ROUND(COALESCE(SUM(COALESCE(pe.ssnit_employer, 0)), 0), 2) ssnit_employer,
    ROUND(COALESCE(SUM(COALESCE(pe.paye, 0)), 0), 2) paye,
    ROUND(COALESCE(SUM(COALESCE(pe.deductions_total, 0)), 0), 2) deductions,
    ROUND(COALESCE(SUM(COALESCE(pe.net_salary, 0)), 0), 2) net,
    ROUND(COALESCE(SUM(COALESCE(pe.taxable_income, 0)), 0), 2) taxable,
    ROUND(COALESCE(SUM(COALESCE(pe.tier1_ssnit_remittance, 0)), 0), 2) tier1,
    ROUND(COALESCE(SUM(COALESCE(pe.tier2_pension_remittance, 0)), 0), 2) tier2
  INTO v_recomputed
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE;

  IF v_recomputed.included_count <> v_count
     OR ABS(COALESCE(v_run.total_basic_salary, 0) - v_recomputed.basic) > 0.01
     OR ABS(COALESCE(v_run.total_allowances, 0) - v_recomputed.allowances) > 0.01
     OR ABS(COALESCE(v_run.total_gross_salary, 0) - v_recomputed.gross) > 0.01
     OR ABS(COALESCE(v_run.total_ssnit_employee, 0) - v_recomputed.ssnit_employee) > 0.01
     OR ABS(COALESCE(v_run.total_ssnit_employer, 0) - v_recomputed.ssnit_employer) > 0.01
     OR ABS(COALESCE(v_run.total_paye, 0) - v_recomputed.paye) > 0.01
     OR ABS(COALESCE(v_run.total_deductions, 0) - v_recomputed.deductions) > 0.01
     OR ABS(COALESCE(v_run.total_net_salary, 0) - v_recomputed.net) > 0.01 THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_SNAPSHOT_TOTALS_MISMATCH',
      'Payroll export control totals do not reconcile to the run'
    );
  END IF;

  v_header_hash := public.payroll_sha256_hex(array_to_string(v_header, ','));
  FOR v_entry IN
    SELECT pe.* FROM public.payroll_entries pe
    WHERE pe.payroll_run_id = p_payroll_run_id
      AND pe.is_included IS DISTINCT FROM FALSE
    ORDER BY pe.id
  LOOP
    v_serial := v_serial + 1;
    v_profile := CASE WHEN jsonb_typeof(v_entry.payroll_tax_profile) = 'object'
      THEN v_entry.payroll_tax_profile ELSE '{}'::JSONB END;
    v_ssf := COALESCE(v_entry.employee_pension_contribution, v_entry.ssnit_employee, 0);
    v_ot_tax := COALESCE(v_entry.overtime_tax_5, 0)
      + COALESCE(v_entry.overtime_tax_10, 0)
      + COALESCE(v_entry.overtime_tax_graduated, 0);
    v_excess_bonus := GREATEST(0, COALESCE(v_entry.bonus_graduated_amount, 0));
    v_cells := ARRAY[
      TRIM(COALESCE(v_entry.filing_tin, '')),
      TRIM(COALESCE(v_entry.filing_employee_name, '')),
      v_serial::TEXT,
      UPPER(TRIM(COALESCE(v_profile->>'gra_position_code', ''))),
      CASE WHEN v_profile->'staff_is_tax_resident' = 'false'::JSONB THEN 'Y' ELSE 'N' END,
      public.payroll_money_text(v_entry.basic_salary),
      CASE WHEN v_profile->'secondary_employment' = 'true'::JSONB THEN 'Y' ELSE 'N' END,
      public.payroll_money_text(v_ssf), public.payroll_money_text(0),
      public.payroll_money_text(v_entry.regular_allowances_amount),
      public.payroll_money_text(v_entry.bonus_amount),
      public.payroll_money_text(v_entry.bonus_tax_5),
      public.payroll_money_text(v_excess_bonus),
      public.payroll_money_text(v_entry.gross_salary),
      public.payroll_money_text(0), public.payroll_money_text(0),
      public.payroll_money_text(0),
      public.payroll_money_text(v_entry.gross_salary),
      public.payroll_money_text(0), public.payroll_money_text(0),
      public.payroll_money_text(v_entry.taxable_income),
      public.payroll_money_text(v_entry.paye),
      public.payroll_money_text(v_entry.overtime_amount),
      public.payroll_money_text(v_ot_tax),
      public.payroll_money_text(v_entry.paye),
      public.payroll_money_text(0), ''
    ];
    IF cardinality(v_cells) <> 27 THEN
      PERFORM public.raise_payroll_export_error(
        'PAYROLL_EXPORT_SNAPSHOT_VALIDATION_FAILED',
        'DT107A row must contain exactly 27 columns'
      );
    END IF;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'staff_id', v_entry.staff_id, 'serial_number', v_serial,
      'filing_tin', TRIM(COALESCE(v_entry.filing_tin, '')),
      'filing_employee_name', TRIM(COALESCE(v_entry.filing_employee_name, '')),
      'gra_position_code', UPPER(TRIM(COALESCE(v_profile->>'gra_position_code', ''))),
      'non_resident', v_cells[5], 'secondary_employment', v_cells[7],
      'basic_salary', ROUND(COALESCE(v_entry.basic_salary, 0), 2),
      'employee_social_security', ROUND(v_ssf, 2),
      'third_tier_pension', 0,
      'cash_allowances', ROUND(COALESCE(v_entry.regular_allowances_amount, 0), 2),
      'bonus_income', ROUND(COALESCE(v_entry.bonus_amount, 0), 2),
      'final_tax_on_bonus', ROUND(COALESCE(v_entry.bonus_tax_5, 0), 2),
      'excess_bonus', ROUND(v_excess_bonus, 2),
      'total_cash_emolument', ROUND(COALESCE(v_entry.gross_salary, 0), 2),
      'accommodation_element', 0, 'vehicle_element', 0,
      'non_cash_benefit', 0,
      'total_assessable_income', ROUND(COALESCE(v_entry.gross_salary, 0), 2),
      'deductible_reliefs', 0, 'total_reliefs', 0,
      'chargeable_income', ROUND(COALESCE(v_entry.taxable_income, 0), 2),
      'tax_deductible', ROUND(COALESCE(v_entry.paye, 0), 2),
      'overtime_income', ROUND(COALESCE(v_entry.overtime_amount, 0), 2),
      'overtime_tax', ROUND(v_ot_tax, 2),
      'total_tax_payable', ROUND(COALESCE(v_entry.paye, 0), 2),
      'severance_pay', 0, 'remarks', '',
      'income_tax_method', v_entry.income_tax_method,
      'income_tax_method_version', v_entry.income_tax_method_version,
      'income_tax_regular_base', v_entry.income_tax_regular_base,
      'income_tax_regular_amount', v_entry.income_tax_regular_amount,
      'income_tax_bonus_base', v_entry.income_tax_bonus_base,
      'income_tax_bonus_amount', v_entry.income_tax_bonus_amount,
      'income_tax_overtime_base', v_entry.income_tax_overtime_base,
      'income_tax_overtime_amount', v_entry.income_tax_overtime_amount,
      'cells', to_jsonb(v_cells)
    ));
  END LOOP;

  SELECT string_agg(public.payroll_csv_escape(h), ',' ORDER BY ord) || CHR(10)
  INTO v_csv FROM unnest(v_header) WITH ORDINALITY x(h, ord);
  SELECT v_csv || COALESCE(string_agg((
    SELECT string_agg(public.payroll_csv_escape(cell.value), ',' ORDER BY cell.ordinality)
    FROM jsonb_array_elements_text(row_item.value->'cells')
      WITH ORDINALITY cell(value, ordinality)
  ), CHR(10) ORDER BY row_item.ordinality) || CHR(10), '')
  INTO v_csv
  FROM jsonb_array_elements(v_rows) WITH ORDINALITY row_item(value, ordinality);

  v_control := jsonb_build_object(
    'included_employee_count', v_recomputed.included_count,
    'total_basic_salary', v_recomputed.basic,
    'total_cash_allowances', v_recomputed.allowances,
    'total_cash_emolument', v_recomputed.gross,
    'total_chargeable_income', v_recomputed.taxable,
    'total_employee_social_security', v_recomputed.ssnit_employee,
    'total_paye', v_recomputed.paye, 'included_count', v_recomputed.included_count,
    'basic_salary', v_recomputed.basic, 'allowances', v_recomputed.allowances,
    'gross_salary', v_recomputed.gross,
    'employee_social_security', v_recomputed.ssnit_employee,
    'employer_social_security', v_recomputed.ssnit_employer,
    'taxable_income', v_recomputed.taxable, 'paye', v_recomputed.paye,
    'deductions', v_recomputed.deductions, 'net_salary', v_recomputed.net,
    'tier1_remittance', v_recomputed.tier1, 'tier2_remittance', v_recomputed.tier2
  );
  v_payload := jsonb_build_object(
    'schema', 'gra-dt107a-schema-v2', 'run', v_run_json,
    'business', v_business, 'header', to_jsonb(v_header),
    'header_hash', v_header_hash, 'expected_column_count', 27, 'rows', v_rows
  );
  v_period := to_char(COALESCE(v_run.statutory_period_basis, v_run.payroll_month), 'YYYY-MM');
  v_item := public.store_payroll_export_snapshot(
    p_business_id, p_payroll_run_id, 'gra_dt107a',
    'gra-dt107a-schema-v2', 'gra-dt107a-renderer-v2',
    'gra-dt0107a-monthly-v1',
    'GRA DT 0107A uploadable monthly PAYE employee format v1',
    'approved', v_payload, v_count, v_control, v_csv,
    'text/csv', format('dt107a-preparation-%s.csv', v_period), p_actor_id
  );
  v_result := v_result || jsonb_build_array(v_item);

  -- Register v2 freezes the complete tax-method evidence per entry.
  v_payload := jsonb_build_object(
    'schema', 'payroll-register-schema-v2', 'run', v_run_json,
    'business', v_business, 'control_totals', v_control, 'entries', v_rows
  );
  v_item := public.store_payroll_export_snapshot(
    p_business_id, p_payroll_run_id, 'payroll_register',
    'payroll-register-schema-v2', 'payroll-register-renderer-v2',
    NULL, NULL, 'approved', v_payload, v_count, v_control,
    NULL, NULL, NULL, p_actor_id
  );
  v_result := v_result || jsonb_build_array(v_item);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'staff_id', pe.staff_id,
    'filing_tin', TRIM(COALESCE(pe.filing_tin, '')),
    'filing_employee_name', TRIM(COALESCE(pe.filing_employee_name, '')),
    'taxable_income', ROUND(COALESCE(pe.taxable_income, 0), 2),
    'paye', ROUND(COALESCE(pe.paye, 0), 2),
    'income_tax_method', pe.income_tax_method,
    'income_tax_method_version', pe.income_tax_method_version,
    'income_tax_regular_base', pe.income_tax_regular_base,
    'income_tax_regular_amount', pe.income_tax_regular_amount,
    'income_tax_bonus_base', pe.income_tax_bonus_base,
    'income_tax_bonus_amount', pe.income_tax_bonus_amount,
    'income_tax_overtime_base', pe.income_tax_overtime_base,
    'income_tax_overtime_amount', pe.income_tax_overtime_amount
  ) ORDER BY pe.id), '[]'::JSONB)
  INTO v_rows FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE;
  v_control := jsonb_build_object(
    'included_count', v_count, 'taxable_income', v_recomputed.taxable,
    'paye', v_recomputed.paye
  );
  v_payload := jsonb_build_object(
    'schema', 'paye-schedule-schema-v2', 'run', v_run_json,
    'business', v_business, 'rows', v_rows
  );
  v_item := public.store_payroll_export_snapshot(
    p_business_id, p_payroll_run_id, 'paye_schedule',
    'paye-schedule-schema-v2', 'paye-schedule-renderer-v2',
    NULL, NULL, 'approved', v_payload, v_count, v_control,
    NULL, NULL, NULL, p_actor_id
  );
  v_result := v_result || jsonb_build_array(v_item);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'staff_id', pe.staff_id, 'filing_tin', TRIM(COALESCE(pe.filing_tin, '')),
    'filing_employee_name', TRIM(COALESCE(pe.filing_employee_name, '')),
    'pensionable_base', ROUND(COALESCE(pe.pensionable_base, 0), 2),
    'tier1_ssnit_remittance', ROUND(COALESCE(pe.tier1_ssnit_remittance, 0), 2)
  ) ORDER BY pe.id), '[]'::JSONB)
  INTO v_rows FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE;
  v_control := jsonb_build_object(
    'included_count', v_count, 'tier1_ssnit_remittance', v_recomputed.tier1
  );
  v_payload := jsonb_build_object(
    'schema', 'pension-tier1-schema-v1', 'run', v_run_json,
    'business', v_business, 'rows', v_rows
  );
  v_item := public.store_payroll_export_snapshot(
    p_business_id, p_payroll_run_id, 'pension_tier1',
    'pension-tier1-schema-v1', 'pension-tier1-renderer-v1',
    NULL, NULL, 'approved', v_payload, v_count, v_control,
    NULL, NULL, NULL, p_actor_id
  );
  v_result := v_result || jsonb_build_array(v_item);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'staff_id', pe.staff_id, 'filing_tin', TRIM(COALESCE(pe.filing_tin, '')),
    'filing_employee_name', TRIM(COALESCE(pe.filing_employee_name, '')),
    'pensionable_base', ROUND(COALESCE(pe.pensionable_base, 0), 2),
    'tier2_pension_remittance', ROUND(COALESCE(pe.tier2_pension_remittance, 0), 2)
  ) ORDER BY pe.id), '[]'::JSONB)
  INTO v_rows FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE;
  v_control := jsonb_build_object(
    'included_count', v_count, 'tier2_pension_remittance', v_recomputed.tier2
  );
  v_payload := jsonb_build_object(
    'schema', 'pension-tier2-schema-v1', 'run', v_run_json,
    'business', v_business, 'rows', v_rows
  );
  v_item := public.store_payroll_export_snapshot(
    p_business_id, p_payroll_run_id, 'pension_tier2',
    'pension-tier2-schema-v1', 'pension-tier2-renderer-v1',
    NULL, NULL, 'approved', v_payload, v_count, v_control,
    NULL, NULL, NULL, p_actor_id
  );
  v_result := v_result || jsonb_build_array(v_item);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'staff_id', pe.staff_id,
    'filing_employee_name', TRIM(COALESCE(pe.filing_employee_name, '')),
    'net_salary', ROUND(COALESCE(pe.net_salary, 0), 2),
    'bank_name', '', 'bank_account_name', '', 'bank_account_number', ''
  ) ORDER BY pe.id), '[]'::JSONB)
  INTO v_rows FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE;
  v_control := jsonb_build_object(
    'included_count', v_count, 'net_salary', v_recomputed.net
  );
  v_payload := jsonb_build_object(
    'schema', 'net-salary-schema-v1', 'run', v_run_json,
    'business', v_business, 'rows', v_rows
  );
  v_item := public.store_payroll_export_snapshot(
    p_business_id, p_payroll_run_id, 'net_salary',
    'net-salary-schema-v1', 'net-salary-renderer-v1',
    NULL, NULL, 'approved', v_payload, v_count, v_control,
    NULL, NULL, NULL, p_actor_id
  );
  v_result := v_result || jsonb_build_array(v_item);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', o.id, 'obligation_type', o.obligation_type, 'label', o.label,
    'amount_due', o.amount_due, 'amount_paid', o.amount_paid,
    'status', o.status, 'due_date', o.due_date,
    'liability_account_code', o.liability_account_code
  ) ORDER BY o.obligation_type, o.id), '[]'::JSONB),
  COUNT(*)::INT,
  jsonb_build_object(
    'obligation_count', COUNT(*)::INT,
    'amount_due', ROUND(COALESCE(SUM(o.amount_due), 0), 2),
    'amount_paid', ROUND(COALESCE(SUM(o.amount_paid), 0), 2),
    'amount_outstanding', ROUND(COALESCE(SUM(o.amount_due - o.amount_paid), 0), 2)
  )
  INTO v_rows, v_serial, v_control
  FROM public.payroll_obligations o
  WHERE o.business_id = p_business_id
    AND o.payroll_run_id = p_payroll_run_id
    AND o.deleted_at IS NULL;
  v_payload := jsonb_build_object(
    'schema', 'obligations-schema-v1', 'run', v_run_json,
    'business', v_business, 'rows', v_rows
  );
  v_item := public.store_payroll_export_snapshot(
    p_business_id, p_payroll_run_id, 'obligations',
    'obligations-schema-v1', 'obligations-renderer-v1',
    NULL, NULL, 'approved', v_payload, v_serial, v_control,
    NULL, NULL, NULL, p_actor_id
  );
  v_result := v_result || jsonb_build_array(v_item);

  RETURN jsonb_build_object(
    'payroll_run_id', p_payroll_run_id, 'business_id', p_business_id,
    'source_run_status', 'approved', 'snapshots', v_result
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Explicit correction-copy allowlist and drift guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_payroll_entry_correction_columns_classified()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_unknown TEXT[];
  v_allowed CONSTANT TEXT[] := ARRAY[
    'id', 'payroll_run_id', 'created_at', 'updated_at',
    'staff_id', 'is_included', 'basic_salary', 'allowances_total',
    'deductions_total', 'gross_salary', 'ssnit_employee', 'ssnit_employer',
    'taxable_income', 'paye', 'net_salary', 'regular_allowances_amount',
    'bonus_amount', 'overtime_amount', 'bonus_tax_5', 'bonus_tax_graduated',
    'overtime_tax_5', 'overtime_tax_10', 'overtime_tax_graduated',
    'is_qualifying_junior_employee', 'bonus_cap_amount',
    'overtime_threshold_amount', 'pensionable_base',
    'employee_pension_contribution', 'employer_pension_contribution',
    'total_mandatory_pension', 'tier1_ssnit_remittance',
    'tier2_pension_remittance', 'payroll_tax_profile', 'filing_tin',
    'filing_employee_name', 'bonus_concessional_amount',
    'bonus_graduated_amount', 'base_salary_snapshot', 'adjustment_amount',
    'adjustment_reason', 'exclusion_reason', 'salary_basis',
    'period_basic_pay', 'one_off_items_snapshot',
    'calculation_engine_version', 'paye_rate_version',
    'pension_rate_version', 'calculation_jurisdiction',
    'statutory_period_basis', 'advance_recoveries_snapshot',
    'income_tax_method', 'income_tax_method_version',
    'income_tax_regular_base', 'income_tax_regular_amount',
    'income_tax_bonus_base', 'income_tax_bonus_amount',
    'income_tax_overtime_base', 'income_tax_overtime_amount'
  ];
BEGIN
  SELECT array_agg(c.column_name ORDER BY c.ordinal_position)
  INTO v_unknown
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'payroll_entries'
    AND NOT (c.column_name = ANY (v_allowed));
  IF COALESCE(cardinality(v_unknown), 0) > 0 THEN
    RAISE EXCEPTION 'PAYROLL_CORRECTION_UNCLASSIFIED_ENTRY_COLUMNS: %',
      array_to_string(v_unknown, ', ')
      USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object(
          'code', 'PAYROLL_CORRECTION_UNCLASSIFIED_ENTRY_COLUMNS',
          'unknownColumns', to_jsonb(v_unknown)
        )::TEXT;
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.create_payroll_correction_draft_from_reversed(
  p_business_id UUID,
  p_original_run_id UUID,
  p_actor_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_original public.payroll_runs%ROWTYPE;
  v_correction_id UUID;
  v_entry RECORD;
  v_item JSONB;
  v_new_snapshot JSONB;
  v_old_advance NUMERIC;
  v_new_advance NUMERIC;
  v_non_advance NUMERIC;
  v_outstanding NUMERIC;
BEGIN
  PERFORM public.assert_payroll_entry_correction_columns_classified();
  SELECT * INTO v_original FROM public.payroll_runs
  WHERE id = p_original_run_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND OR v_original.status IS DISTINCT FROM 'reversed' THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_CORRECTION_INVALID_SOURCE',
      'Correction source must be a reversed payroll run'
    );
  END IF;
  IF v_original.corrected_by_run_id IS NOT NULL THEN
    SELECT id INTO v_correction_id FROM public.payroll_runs
    WHERE id = v_original.corrected_by_run_id
      AND correction_of_run_id = p_original_run_id;
    IF v_correction_id IS NULL THEN
      PERFORM public.raise_payroll_reversal_error(
        'PAYROLL_REVERSAL_ALREADY_COMPLETED',
        'Reversed run has an inconsistent correction link'
      );
    END IF;
    RETURN v_correction_id;
  END IF;
  SELECT id INTO v_correction_id FROM public.payroll_runs
  WHERE correction_of_run_id = p_original_run_id;
  IF FOUND THEN
    UPDATE public.payroll_runs SET corrected_by_run_id = v_correction_id,
      updated_at = NOW() WHERE id = p_original_run_id;
    RETURN v_correction_id;
  END IF;

  INSERT INTO public.payroll_runs (
    business_id, payroll_month, status, total_gross_salary, total_allowances,
    total_deductions, total_ssnit_employee, total_ssnit_employer, total_paye,
    total_net_salary, total_basic_salary, notes, pay_period_start,
    pay_period_end, payroll_frequency, run_type, staff_scope_fingerprint,
    corrects_payroll_run_id, calculation_engine_version, paye_rate_version,
    pension_rate_version, calculation_jurisdiction, statutory_period_basis,
    correction_of_run_id
  ) VALUES (
    v_original.business_id, v_original.payroll_month, 'draft',
    0, 0, 0, 0, 0, 0, 0, 0,
    'Correction of ' || p_original_run_id::TEXT,
    v_original.pay_period_start, v_original.pay_period_end,
    v_original.payroll_frequency, 'correction',
    v_original.staff_scope_fingerprint, p_original_run_id,
    v_original.calculation_engine_version, v_original.paye_rate_version,
    v_original.pension_rate_version, v_original.calculation_jurisdiction,
    v_original.statutory_period_basis, p_original_run_id
  ) RETURNING id INTO v_correction_id;

  INSERT INTO public.payroll_entries (
    id, payroll_run_id, staff_id, is_included, basic_salary, allowances_total,
    deductions_total, gross_salary, ssnit_employee, ssnit_employer,
    taxable_income, paye, net_salary, regular_allowances_amount, bonus_amount,
    overtime_amount, bonus_tax_5, bonus_tax_graduated, overtime_tax_5,
    overtime_tax_10, overtime_tax_graduated, is_qualifying_junior_employee,
    bonus_cap_amount, overtime_threshold_amount, pensionable_base,
    employee_pension_contribution, employer_pension_contribution,
    total_mandatory_pension, tier1_ssnit_remittance, tier2_pension_remittance,
    payroll_tax_profile, filing_tin, filing_employee_name,
    bonus_concessional_amount, bonus_graduated_amount, base_salary_snapshot,
    adjustment_amount, adjustment_reason, exclusion_reason, salary_basis,
    period_basic_pay, one_off_items_snapshot, calculation_engine_version,
    paye_rate_version, pension_rate_version, calculation_jurisdiction,
    statutory_period_basis, advance_recoveries_snapshot,
    income_tax_method, income_tax_method_version,
    income_tax_regular_base, income_tax_regular_amount,
    income_tax_bonus_base, income_tax_bonus_amount,
    income_tax_overtime_base, income_tax_overtime_amount
  )
  SELECT
    gen_random_uuid(), v_correction_id, pe.staff_id, pe.is_included,
    pe.basic_salary, pe.allowances_total, pe.deductions_total, pe.gross_salary,
    pe.ssnit_employee, pe.ssnit_employer, pe.taxable_income, pe.paye,
    pe.net_salary, pe.regular_allowances_amount, pe.bonus_amount,
    pe.overtime_amount, pe.bonus_tax_5, pe.bonus_tax_graduated,
    pe.overtime_tax_5, pe.overtime_tax_10, pe.overtime_tax_graduated,
    pe.is_qualifying_junior_employee, pe.bonus_cap_amount,
    pe.overtime_threshold_amount, pe.pensionable_base,
    pe.employee_pension_contribution, pe.employer_pension_contribution,
    pe.total_mandatory_pension, pe.tier1_ssnit_remittance,
    pe.tier2_pension_remittance, pe.payroll_tax_profile, pe.filing_tin,
    pe.filing_employee_name, pe.bonus_concessional_amount,
    pe.bonus_graduated_amount, pe.base_salary_snapshot, pe.adjustment_amount,
    pe.adjustment_reason, pe.exclusion_reason, pe.salary_basis,
    pe.period_basic_pay, pe.one_off_items_snapshot,
    pe.calculation_engine_version, pe.paye_rate_version,
    pe.pension_rate_version, pe.calculation_jurisdiction,
    pe.statutory_period_basis, pe.advance_recoveries_snapshot,
    pe.income_tax_method, pe.income_tax_method_version,
    pe.income_tax_regular_base, pe.income_tax_regular_amount,
    pe.income_tax_bonus_base, pe.income_tax_bonus_amount,
    pe.income_tax_overtime_base, pe.income_tax_overtime_amount
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_original_run_id
  ORDER BY pe.id;

  FOR v_entry IN
    SELECT n.* FROM public.payroll_entries n
    WHERE n.payroll_run_id = v_correction_id
      AND n.is_included IS DISTINCT FROM FALSE
    ORDER BY n.id
  LOOP
    v_new_snapshot := '[]'::JSONB;
    v_old_advance := 0;
    v_new_advance := 0;
    IF jsonb_typeof(COALESCE(v_entry.advance_recoveries_snapshot, '[]'::JSONB)) = 'array' THEN
      FOR v_item IN SELECT value FROM jsonb_array_elements(
        COALESCE(v_entry.advance_recoveries_snapshot, '[]'::JSONB)
      )
      LOOP
        v_old_advance := v_old_advance
          + GREATEST(0, COALESCE((v_item->>'amount')::NUMERIC, 0));
        SELECT GREATEST(
          0, ROUND(sa.amount - public.salary_advance_posted_repaid_amount(sa.id), 2)
        ) INTO v_outstanding
        FROM public.salary_advances sa
        WHERE sa.id = NULLIF(TRIM(COALESCE(
          v_item->>'advanceId', v_item->>'advance_id', ''
        )), '')::UUID
          AND sa.business_id = p_business_id;
        v_outstanding := LEAST(
          GREATEST(0, COALESCE((v_item->>'amount')::NUMERIC, 0)),
          GREATEST(0, COALESCE(v_outstanding, 0))
        );
        v_new_advance := v_new_advance + v_outstanding;
        v_new_snapshot := v_new_snapshot || jsonb_build_array(
          jsonb_set(v_item, '{amount}', to_jsonb(ROUND(v_outstanding, 2)), TRUE)
        );
      END LOOP;
    END IF;
    v_non_advance := GREATEST(
      0, COALESCE(v_entry.deductions_total, 0) - v_old_advance
    );
    UPDATE public.payroll_entries
    SET advance_recoveries_snapshot = v_new_snapshot,
      deductions_total = ROUND(v_non_advance + v_new_advance, 2),
      net_salary = ROUND(
        COALESCE(v_entry.gross_salary, 0)
        - COALESCE(v_entry.ssnit_employee, 0)
        - COALESCE(v_entry.paye, 0)
        - ROUND(v_non_advance + v_new_advance, 2), 2
      ),
      updated_at = NOW()
    WHERE id = v_entry.id;
  END LOOP;

  UPDATE public.payroll_runs pr
  SET total_basic_salary = x.basic, total_allowances = x.allowances,
    total_gross_salary = x.gross, total_ssnit_employee = x.ssnit_employee,
    total_ssnit_employer = x.ssnit_employer, total_paye = x.paye,
    total_deductions = x.deductions, total_net_salary = x.net,
    updated_at = NOW()
  FROM (
    SELECT COALESCE(SUM(COALESCE(pe.basic_salary, 0)), 0) basic,
      COALESCE(SUM(COALESCE(pe.allowances_total, 0)), 0) allowances,
      COALESCE(SUM(COALESCE(pe.gross_salary, 0)), 0) gross,
      COALESCE(SUM(COALESCE(pe.ssnit_employee, 0)), 0) ssnit_employee,
      COALESCE(SUM(COALESCE(pe.ssnit_employer, 0)), 0) ssnit_employer,
      COALESCE(SUM(COALESCE(pe.paye, 0)), 0) paye,
      COALESCE(SUM(COALESCE(pe.deductions_total, 0)), 0) deductions,
      COALESCE(SUM(COALESCE(pe.net_salary, 0)), 0) net
    FROM public.payroll_entries pe
    WHERE pe.payroll_run_id = v_correction_id
      AND pe.is_included IS DISTINCT FROM FALSE
  ) x WHERE pr.id = v_correction_id;

  UPDATE public.payroll_runs SET corrected_by_run_id = v_correction_id,
    updated_at = NOW() WHERE id = p_original_run_id;
  PERFORM public.create_audit_log(
    p_business_id, p_actor_id, 'payroll.correction_created', 'payroll_run',
    v_correction_id, NULL,
    jsonb_build_object(
      'status', 'draft', 'correction_of_run_id', p_original_run_id,
      'corrects_payroll_run_id', p_original_run_id
    ),
    NULL, NULL,
    format('Correction draft created for reversed payroll run %s', p_original_run_id)
  );
  RETURN v_correction_id;
EXCEPTION WHEN unique_violation THEN
  PERFORM public.raise_payroll_reversal_error(
    'PAYROLL_REVERSAL_INCONSISTENT_STATE',
    'A conflicting correction draft or correction audit already exists'
  );
  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION public.payroll_ghana_canonical_employment_type(TEXT) IS
  'Maps only exact known Ghana employment-type aliases to canonical values.';
COMMENT ON FUNCTION public.payroll_ghana_resolve_income_tax_method(JSONB) IS
  'Resolves the supported Ghana v3 income-tax method from an immutable profile snapshot.';
COMMENT ON FUNCTION public.payroll_ghana_profile_tax_version_covers_period(TEXT, DATE) IS
  'Reports whether a Ghana profile-tax method version covers a statutory period.';
COMMENT ON FUNCTION public.payroll_ghana_verify_income_tax_components(
  public.payroll_entries, TEXT, DATE
) IS 'Validates frozen Ghana entry income-tax method components.';
COMMENT ON FUNCTION public.create_payroll_export_snapshots_for_approval(UUID, UUID, UUID) IS
  'Internal approval helper that freezes canonical payroll export payloads with Ghana v3 tax-method evidence.';
COMMENT ON FUNCTION public.create_payroll_correction_draft_from_reversed(UUID, UUID, UUID) IS
  'Internal correction helper with an explicit payroll-entry copy allowlist and schema-drift guard.';

-- Internal-only execution boundary. The approval RPC composes these as postgres.
REVOKE ALL ON FUNCTION public.payroll_ghana_canonical_employment_type(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_ghana_resolve_income_tax_method(JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_ghana_profile_tax_version_covers_period(TEXT, DATE)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_ghana_verify_income_tax_components(
  public.payroll_entries, TEXT, DATE
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_ghana_validate_run_for_approval(
  UUID, public.payroll_runs, INT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_payroll_export_snapshots_for_approval(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_payroll_entry_correction_columns_classified()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_payroll_correction_draft_from_reversed(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.payroll_ghana_canonical_employment_type(TEXT)
  TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_resolve_income_tax_method(JSONB)
  TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_profile_tax_version_covers_period(TEXT, DATE)
  TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_verify_income_tax_components(
  public.payroll_entries, TEXT, DATE
) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_validate_run_for_approval(
  UUID, public.payroll_runs, INT
) TO postgres;
GRANT EXECUTE ON FUNCTION public.create_payroll_export_snapshots_for_approval(UUID, UUID, UUID)
  TO postgres;
GRANT EXECUTE ON FUNCTION public.assert_payroll_entry_correction_columns_classified()
  TO postgres;
GRANT EXECUTE ON FUNCTION public.create_payroll_correction_draft_from_reversed(UUID, UUID, UUID)
  TO postgres;
