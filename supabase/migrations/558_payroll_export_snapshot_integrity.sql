-- ============================================================================
-- Migration 558: Immutable payroll export snapshots and correction drift guard
-- ============================================================================
-- Staging migration. Migrations 552-557 remain unchanged. Production untouched.
-- Export snapshots are created inside atomic approval after obligations exist and
-- before the run becomes approved, so any snapshot failure rolls back approval.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Immutable export schema
-- ---------------------------------------------------------------------------
CREATE TABLE public.payroll_export_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id),
  payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id),
  export_type TEXT NOT NULL,
  snapshot_schema_version TEXT NOT NULL,
  renderer_version TEXT NOT NULL,
  template_version TEXT,
  template_reference TEXT,
  source_run_status TEXT NOT NULL,
  source_payload JSONB NOT NULL,
  source_payload_sha256 TEXT NOT NULL,
  row_count INT NOT NULL,
  control_totals JSONB NOT NULL,
  rendered_content TEXT,
  rendered_content_sha256 TEXT,
  content_type TEXT,
  filename TEXT,
  materialized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  CONSTRAINT payroll_export_snapshots_export_type_check CHECK (
    export_type IN (
      'gra_dt107a',
      'payroll_register',
      'paye_schedule',
      'pension_tier1',
      'pension_tier2',
      'net_salary',
      'obligations'
    )
  ),
  CONSTRAINT payroll_export_snapshots_row_count_check CHECK (row_count >= 0),
  CONSTRAINT payroll_export_snapshots_source_hash_check
    CHECK (source_payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT payroll_export_snapshots_rendered_hash_check
    CHECK (
      (rendered_content IS NULL AND rendered_content_sha256 IS NULL)
      OR
      (rendered_content IS NOT NULL AND rendered_content_sha256 ~ '^[0-9a-f]{64}$')
    )
);

DO $guard$
DECLARE
  v_duplicates TEXT;
BEGIN
  SELECT string_agg(
    format(
      'business=%s run=%s type=%s schema=%s count=%s',
      business_id, payroll_run_id, export_type, snapshot_schema_version, n
    ),
    '; '
  )
  INTO v_duplicates
  FROM (
    SELECT
      business_id,
      payroll_run_id,
      export_type,
      snapshot_schema_version,
      COUNT(*)::INT AS n
    FROM public.payroll_export_snapshots
    GROUP BY business_id, payroll_run_id, export_type, snapshot_schema_version
    HAVING COUNT(*) > 1
    LIMIT 50
  ) d;

  IF v_duplicates IS NOT NULL THEN
    RAISE EXCEPTION
      'PAYROLL_EXPORT_SNAPSHOT_DUPLICATES_BLOCK_INDEX: %',
      v_duplicates;
  END IF;
END;
$guard$;

CREATE UNIQUE INDEX ux_payroll_export_snapshots_identity
  ON public.payroll_export_snapshots (
    business_id,
    payroll_run_id,
    export_type,
    snapshot_schema_version
  );

CREATE INDEX idx_payroll_export_snapshots_run
  ON public.payroll_export_snapshots (business_id, payroll_run_id, export_type);

CREATE TABLE public.payroll_export_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id),
  payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id),
  snapshot_id UUID NOT NULL REFERENCES public.payroll_export_snapshots(id),
  export_type TEXT NOT NULL,
  mode TEXT NOT NULL,
  actor_id UUID REFERENCES auth.users(id),
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_sha256 TEXT NOT NULL,
  filename TEXT,
  source_run_status TEXT NOT NULL,
  CONSTRAINT payroll_export_events_export_type_check CHECK (
    export_type IN (
      'gra_dt107a',
      'payroll_register',
      'paye_schedule',
      'pension_tier1',
      'pension_tier2',
      'net_salary',
      'obligations'
    )
  ),
  CONSTRAINT payroll_export_events_mode_check
    CHECK (mode IN ('preparation', 'audit')),
  CONSTRAINT payroll_export_events_content_hash_check
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX idx_payroll_export_events_run
  ON public.payroll_export_events (business_id, payroll_run_id, downloaded_at DESC);
CREATE INDEX idx_payroll_export_events_snapshot
  ON public.payroll_export_events (snapshot_id, downloaded_at DESC);

ALTER TABLE public.payroll_export_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_export_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY payroll_export_snapshots_select_business
  ON public.payroll_export_snapshots
  FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

CREATE POLICY payroll_export_events_select_business
  ON public.payroll_export_events
  FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

-- ---------------------------------------------------------------------------
-- Hashing, CSV, and structured-error helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.raise_payroll_export_error(
  p_code TEXT,
  p_message TEXT,
  p_detail JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $fn$
BEGIN
  RAISE EXCEPTION '%: %', p_code, p_message
    USING ERRCODE = 'P0001',
          DETAIL = COALESCE(
            p_detail,
            jsonb_build_object('code', p_code, 'message', p_message)
          )::TEXT;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.payroll_csv_escape(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $fn$
  SELECT CASE
    WHEN p_value IS NULL THEN ''
    WHEN POSITION('"' IN p_value) > 0
      OR POSITION(',' IN p_value) > 0
      OR POSITION(CHR(10) IN p_value) > 0
      OR POSITION(CHR(13) IN p_value) > 0
    THEN '"' || REPLACE(p_value, '"', '""') || '"'
    ELSE p_value
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.payroll_sha256_hex(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, extensions, pg_catalog
AS $fn$
  SELECT encode(digest(COALESCE(p_value, ''), 'sha256'), 'hex');
$fn$;

CREATE OR REPLACE FUNCTION public.payroll_money_text(p_value NUMERIC)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $fn$
  SELECT to_char(ROUND(COALESCE(p_value, 0), 2), 'FM999999999999990.00');
$fn$;

CREATE OR REPLACE FUNCTION public.verify_payroll_export_snapshot(
  p_snapshot_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $fn$
  SELECT COALESCE((
    SELECT
      public.payroll_sha256_hex(s.source_payload::TEXT)
        = s.source_payload_sha256
      AND (
        s.rendered_content IS NULL
        OR public.payroll_sha256_hex(s.rendered_content)
          = s.rendered_content_sha256
      )
    FROM public.payroll_export_snapshots s
    WHERE s.id = p_snapshot_id
  ), FALSE);
$fn$;

-- Internal insert-or-reuse primitive. A conflicting canonical payload fails closed.
CREATE OR REPLACE FUNCTION public.store_payroll_export_snapshot(
  p_business_id UUID,
  p_payroll_run_id UUID,
  p_export_type TEXT,
  p_snapshot_schema_version TEXT,
  p_renderer_version TEXT,
  p_template_version TEXT,
  p_template_reference TEXT,
  p_source_run_status TEXT,
  p_source_payload JSONB,
  p_row_count INT,
  p_control_totals JSONB,
  p_rendered_content TEXT,
  p_content_type TEXT,
  p_filename TEXT,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $fn$
DECLARE
  v_id UUID;
  v_source_hash TEXT := public.payroll_sha256_hex(p_source_payload::TEXT);
  v_rendered_hash TEXT := CASE
    WHEN p_rendered_content IS NULL THEN NULL
    ELSE public.payroll_sha256_hex(p_rendered_content)
  END;
  v_existing public.payroll_export_snapshots%ROWTYPE;
BEGIN
  INSERT INTO public.payroll_export_snapshots (
    business_id,
    payroll_run_id,
    export_type,
    snapshot_schema_version,
    renderer_version,
    template_version,
    template_reference,
    source_run_status,
    source_payload,
    source_payload_sha256,
    row_count,
    control_totals,
    rendered_content,
    rendered_content_sha256,
    content_type,
    filename,
    materialized_at,
    created_by
  ) VALUES (
    p_business_id,
    p_payroll_run_id,
    p_export_type,
    p_snapshot_schema_version,
    p_renderer_version,
    p_template_version,
    p_template_reference,
    p_source_run_status,
    p_source_payload,
    v_source_hash,
    p_row_count,
    p_control_totals,
    p_rendered_content,
    v_rendered_hash,
    p_content_type,
    p_filename,
    CASE WHEN p_rendered_content IS NULL THEN NULL ELSE NOW() END,
    p_actor_id
  )
  ON CONFLICT (
    business_id,
    payroll_run_id,
    export_type,
    snapshot_schema_version
  ) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT * INTO v_existing
    FROM public.payroll_export_snapshots s
    WHERE s.business_id = p_business_id
      AND s.payroll_run_id = p_payroll_run_id
      AND s.export_type = p_export_type
      AND s.snapshot_schema_version = p_snapshot_schema_version;

    IF NOT FOUND
       OR v_existing.source_payload_sha256 IS DISTINCT FROM v_source_hash
       OR v_existing.rendered_content_sha256 IS DISTINCT FROM v_rendered_hash
       OR v_existing.row_count IS DISTINCT FROM p_row_count
       OR v_existing.control_totals IS DISTINCT FROM p_control_totals THEN
      PERFORM public.raise_payroll_export_error(
        'PAYROLL_EXPORT_SNAPSHOT_CONFLICT',
        format(
          'A different %s snapshot already exists for payroll run %s',
          p_export_type,
          p_payroll_run_id
        ),
        jsonb_build_object(
          'code', 'PAYROLL_EXPORT_SNAPSHOT_CONFLICT',
          'exportType', p_export_type,
          'payrollRunId', p_payroll_run_id,
          'incomingSourceHash', v_source_hash,
          'existingSourceHash', v_existing.source_payload_sha256
        )
      );
    END IF;
    v_id := v_existing.id;
  END IF;

  RETURN jsonb_build_object(
    'export_type', p_export_type,
    'id', v_id,
    'source_payload_sha256', v_source_hash,
    'rendered_content_sha256', v_rendered_hash
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Approval-time snapshot materialization
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_payroll_export_snapshots_for_approval(
  p_business_id UUID,
  p_payroll_run_id UUID,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $fn$
DECLARE
  v_run public.payroll_runs%ROWTYPE;
  v_business JSONB;
  v_run_json JSONB;
  v_header TEXT[] := ARRAY[
    '(3) TIN',
    '(2) Employee Name',
    '(1) Serial Number',
    '(4) Position',
    '(5) Non-Resident',
    '(6) Basic Salary',
    '(7) Secondary Employment',
    '(8) Social Security Fund',
    '(9) Third Tier Pension',
    '(10) Cash Allowances',
    '(11) Bonus Income',
    '(12) Final Tax on Bonus',
    '(13) Excess Bonus',
    '(14) Total Cash Emolument',
    '(15) Accommodation Element',
    '(16) Vehicle Element',
    '(17) Non Cash Benefit',
    '(18) Total Assessable Income',
    '(19) Deductible Reliefs',
    '(20) Total Reliefs',
    '(21) Chargeable Income',
    '(22) Tax Deductible',
    '(23) Overtime Income',
    '(24) Overtime Tax',
    '(25) Total Tax Payable to GRA',
    '(26) Severance Pay Paid',
    '(27) Remarks '
  ];
  v_header_hash TEXT;
  v_entry RECORD;
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

  IF NOT FOUND
     OR v_run.deleted_at IS NOT NULL
     OR v_run.status IS DISTINCT FROM 'draft'
     OR v_run.journal_entry_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.journal_entries je
       WHERE je.id = v_run.journal_entry_id
         AND je.business_id = p_business_id
         AND je.reference_type = 'payroll'
         AND je.reference_id = p_payroll_run_id
     ) THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_SNAPSHOT_INVALID_STATE',
      'Export snapshots require a draft payroll with its approval journal already posted',
      jsonb_build_object(
        'code', 'PAYROLL_EXPORT_SNAPSHOT_INVALID_STATE',
        'payrollRunId', p_payroll_run_id,
        'status', v_run.status,
        'journalEntryId', v_run.journal_entry_id
      )
    );
  END IF;

  PERFORM 1
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE
  ORDER BY pe.id
  FOR UPDATE;

  SELECT COUNT(*)::INT
  INTO v_count
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
    'id', b.id,
    'legal_name', b.legal_name,
    'trading_name', b.trading_name,
    'tin', b.tin,
    'default_currency', b.default_currency
  )
  INTO v_business
  FROM public.businesses b
  WHERE b.id = p_business_id;

  IF v_business IS NULL THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_SNAPSHOT_VALIDATION_FAILED',
      'Business not found for export snapshot'
    );
  END IF;

  v_run_json := jsonb_build_object(
    'id', v_run.id,
    'business_id', v_run.business_id,
    'payroll_month', v_run.payroll_month,
    'pay_period_start', v_run.pay_period_start,
    'pay_period_end', v_run.pay_period_end,
    'payroll_frequency', v_run.payroll_frequency,
    'run_type', v_run.run_type,
    'source_status', v_run.status,
    'journal_entry_id', v_run.journal_entry_id,
    'correction_of_run_id', v_run.correction_of_run_id,
    'calculation_engine_version', v_run.calculation_engine_version,
    'paye_rate_version', v_run.paye_rate_version,
    'pension_rate_version', v_run.pension_rate_version,
    'calculation_jurisdiction', v_run.calculation_jurisdiction,
    'statutory_period_basis', v_run.statutory_period_basis,
    'approved_at', v_run.approved_at,
    'approved_by', v_run.approved_by
  );

  v_is_ghana :=
    LOWER(TRIM(COALESCE(v_run.calculation_engine_version, ''))) = 'finza-ghana-v2'
    OR UPPER(TRIM(COALESCE(v_run.calculation_jurisdiction, ''))) = 'GH';

  IF v_is_ghana THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'staffId', pe.staff_id,
          'filingEmployeeName', NULLIF(TRIM(COALESCE(pe.filing_employee_name, '')), ''),
          'missingFields',
          (
            SELECT jsonb_agg(field_name ORDER BY field_name)
            FROM unnest(ARRAY[
              CASE
                WHEN NULLIF(TRIM(COALESCE(pe.filing_tin, '')), '') IS NULL
                THEN 'filing_tin'
              END,
              CASE
                WHEN NULLIF(TRIM(COALESCE(pe.filing_employee_name, '')), '') IS NULL
                THEN 'filing_employee_name'
              END,
              CASE
                WHEN jsonb_typeof(pe.payroll_tax_profile) IS DISTINCT FROM 'object'
                  OR NULLIF(TRIM(COALESCE(pe.payroll_tax_profile->>'gra_position_code', '')), '') IS NULL
                THEN 'gra_position_code'
              END
            ]) AS missing(field_name)
            WHERE field_name IS NOT NULL
          )
        )
        ORDER BY pe.id
      ),
      '[]'::JSONB
    )
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

  SELECT
    COUNT(*)::INT AS included_count,
    ROUND(COALESCE(SUM(COALESCE(pe.basic_salary, 0)), 0), 2) AS basic,
    ROUND(COALESCE(SUM(COALESCE(pe.allowances_total, 0)), 0), 2) AS allowances,
    ROUND(COALESCE(SUM(COALESCE(pe.gross_salary, 0)), 0), 2) AS gross,
    ROUND(COALESCE(SUM(COALESCE(pe.ssnit_employee, 0)), 0), 2) AS ssnit_employee,
    ROUND(COALESCE(SUM(COALESCE(pe.ssnit_employer, 0)), 0), 2) AS ssnit_employer,
    ROUND(COALESCE(SUM(COALESCE(pe.paye, 0)), 0), 2) AS paye,
    ROUND(COALESCE(SUM(COALESCE(pe.deductions_total, 0)), 0), 2) AS deductions,
    ROUND(COALESCE(SUM(COALESCE(pe.net_salary, 0)), 0), 2) AS net,
    ROUND(COALESCE(SUM(COALESCE(pe.taxable_income, 0)), 0), 2) AS taxable,
    ROUND(COALESCE(SUM(COALESCE(pe.tier1_ssnit_remittance, 0)), 0), 2) AS tier1,
    ROUND(COALESCE(SUM(COALESCE(pe.tier2_pension_remittance, 0)), 0), 2) AS tier2
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
      'Payroll export control totals do not reconcile to the run',
      jsonb_build_object(
        'code', 'PAYROLL_EXPORT_SNAPSHOT_TOTALS_MISMATCH',
        'runTotals', jsonb_build_object(
          'included_count', v_count,
          'basic_salary', v_run.total_basic_salary,
          'allowances', v_run.total_allowances,
          'gross_salary', v_run.total_gross_salary,
          'ssnit_employee', v_run.total_ssnit_employee,
          'ssnit_employer', v_run.total_ssnit_employer,
          'paye', v_run.total_paye,
          'deductions', v_run.total_deductions,
          'net_salary', v_run.total_net_salary
        ),
        'entryTotals', jsonb_build_object(
          'included_count', v_recomputed.included_count,
          'basic_salary', v_recomputed.basic,
          'allowances', v_recomputed.allowances,
          'gross_salary', v_recomputed.gross,
          'ssnit_employee', v_recomputed.ssnit_employee,
          'ssnit_employer', v_recomputed.ssnit_employer,
          'paye', v_recomputed.paye,
          'deductions', v_recomputed.deductions,
          'net_salary', v_recomputed.net
        )
      )
    );
  END IF;

  v_header_hash := public.payroll_sha256_hex(array_to_string(v_header, ','));
  SELECT string_agg(public.payroll_csv_escape(h), ',' ORDER BY ord)
  INTO v_csv
  FROM unnest(v_header) WITH ORDINALITY AS x(h, ord);
  v_csv := v_csv || CHR(10);

  FOR v_entry IN
    SELECT pe.*
    FROM public.payroll_entries pe
    WHERE pe.payroll_run_id = p_payroll_run_id
      AND pe.is_included IS DISTINCT FROM FALSE
    ORDER BY pe.id
  LOOP
    v_serial := v_serial + 1;
    v_profile := CASE
      WHEN jsonb_typeof(v_entry.payroll_tax_profile) = 'object'
      THEN v_entry.payroll_tax_profile
      ELSE '{}'::JSONB
    END;
    v_ssf := COALESCE(
      v_entry.employee_pension_contribution,
      v_entry.ssnit_employee,
      0
    );
    v_ot_tax :=
      COALESCE(v_entry.overtime_tax_5, 0)
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
      public.payroll_money_text(v_ssf),
      public.payroll_money_text(0),
      public.payroll_money_text(v_entry.regular_allowances_amount),
      public.payroll_money_text(v_entry.bonus_amount),
      public.payroll_money_text(v_entry.bonus_tax_5),
      public.payroll_money_text(v_excess_bonus),
      public.payroll_money_text(v_entry.gross_salary),
      public.payroll_money_text(0),
      public.payroll_money_text(0),
      public.payroll_money_text(0),
      public.payroll_money_text(v_entry.gross_salary),
      public.payroll_money_text(0),
      public.payroll_money_text(0),
      public.payroll_money_text(v_entry.taxable_income),
      public.payroll_money_text(v_entry.paye),
      public.payroll_money_text(v_entry.overtime_amount),
      public.payroll_money_text(v_ot_tax),
      public.payroll_money_text(v_entry.paye),
      public.payroll_money_text(0),
      ''
    ];

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'staff_id', v_entry.staff_id,
      'serial_number', v_serial,
      'filing_tin', TRIM(COALESCE(v_entry.filing_tin, '')),
      'filing_employee_name', TRIM(COALESCE(v_entry.filing_employee_name, '')),
      'gra_position_code', UPPER(TRIM(COALESCE(v_profile->>'gra_position_code', ''))),
      'non_resident', v_cells[5],
      'secondary_employment', v_cells[7],
      'basic_salary', ROUND(COALESCE(v_entry.basic_salary, 0), 2),
      'employee_social_security', ROUND(v_ssf, 2),
      'third_tier_pension', 0,
      'cash_allowances', ROUND(COALESCE(v_entry.regular_allowances_amount, 0), 2),
      'bonus_income', ROUND(COALESCE(v_entry.bonus_amount, 0), 2),
      'final_tax_on_bonus', ROUND(COALESCE(v_entry.bonus_tax_5, 0), 2),
      'excess_bonus', ROUND(v_excess_bonus, 2),
      'total_cash_emolument', ROUND(COALESCE(v_entry.gross_salary, 0), 2),
      'accommodation_element', 0,
      'vehicle_element', 0,
      'non_cash_benefit', 0,
      'total_assessable_income', ROUND(COALESCE(v_entry.gross_salary, 0), 2),
      'deductible_reliefs', 0,
      'total_reliefs', 0,
      'chargeable_income', ROUND(COALESCE(v_entry.taxable_income, 0), 2),
      'tax_deductible', ROUND(COALESCE(v_entry.paye, 0), 2),
      'overtime_income', ROUND(COALESCE(v_entry.overtime_amount, 0), 2),
      'overtime_tax', ROUND(v_ot_tax, 2),
      'total_tax_payable', ROUND(COALESCE(v_entry.paye, 0), 2),
      'severance_pay', 0,
      'remarks', '',
      'cells', to_jsonb(v_cells)
    ));
  END LOOP;

  SELECT string_agg(public.payroll_csv_escape(h), ',' ORDER BY ord) || CHR(10)
  INTO v_csv
  FROM unnest(v_header) WITH ORDINALITY AS x(h, ord);

  SELECT v_csv || COALESCE(
    string_agg(
      (
        SELECT string_agg(
          public.payroll_csv_escape(cell.value),
          ','
          ORDER BY cell.ordinality
        )
        FROM jsonb_array_elements_text(row_item.value->'cells')
          WITH ORDINALITY AS cell(value, ordinality)
      ),
      CHR(10)
      ORDER BY row_item.ordinality
    ) || CHR(10),
    ''
  )
  INTO v_csv
  FROM jsonb_array_elements(v_rows)
    WITH ORDINALITY AS row_item(value, ordinality);

  v_control := jsonb_build_object(
    'included_employee_count', v_recomputed.included_count,
    'total_basic_salary', v_recomputed.basic,
    'total_cash_allowances', v_recomputed.allowances,
    'total_bonus_income', (
      SELECT ROUND(COALESCE(SUM(COALESCE(pe.bonus_amount, 0)), 0), 2)
      FROM public.payroll_entries pe
      WHERE pe.payroll_run_id = p_payroll_run_id
        AND pe.is_included IS DISTINCT FROM FALSE
    ),
    'total_overtime_income', (
      SELECT ROUND(COALESCE(SUM(COALESCE(pe.overtime_amount, 0)), 0), 2)
      FROM public.payroll_entries pe
      WHERE pe.payroll_run_id = p_payroll_run_id
        AND pe.is_included IS DISTINCT FROM FALSE
    ),
    'total_cash_emolument', v_recomputed.gross,
    'total_chargeable_income', v_recomputed.taxable,
    'total_employee_social_security', v_recomputed.ssnit_employee,
    'total_paye', v_recomputed.paye,
    'included_count', v_recomputed.included_count,
    'basic_salary', v_recomputed.basic,
    'allowances', v_recomputed.allowances,
    'gross_salary', v_recomputed.gross,
    'employee_social_security', v_recomputed.ssnit_employee,
    'employer_social_security', v_recomputed.ssnit_employer,
    'taxable_income', v_recomputed.taxable,
    'paye', v_recomputed.paye,
    'deductions', v_recomputed.deductions,
    'net_salary', v_recomputed.net,
    'tier1_remittance', v_recomputed.tier1,
    'tier2_remittance', v_recomputed.tier2
  );

  v_payload := jsonb_build_object(
    'schema', 'gra-dt107a-schema-v1',
    'run', v_run_json,
    'business', v_business,
    'header', to_jsonb(v_header),
    'header_hash', v_header_hash,
    'expected_column_count', 27,
    'rows', v_rows
  );
  v_period := to_char(COALESCE(v_run.statutory_period_basis, v_run.payroll_month), 'YYYY-MM');

  v_item := public.store_payroll_export_snapshot(
    p_business_id, p_payroll_run_id, 'gra_dt107a',
    'gra-dt107a-schema-v1', 'gra-dt107a-renderer-v1',
    'gra-dt0107a-monthly-v1',
    'GRA DT 0107A uploadable monthly PAYE employee format v1',
    v_run.status, v_payload, v_count, v_control, v_csv,
    'text/csv', format('dt107a-preparation-%s.csv', v_period), p_actor_id
  );
  v_result := v_result || jsonb_build_array(v_item);

  -- Payroll register: immutable run metadata and full control totals.
  v_payload := jsonb_build_object(
    'schema', 'payroll-register-schema-v1',
    'run', v_run_json,
    'business', v_business,
    'control_totals', v_control
  );
  v_item := public.store_payroll_export_snapshot(
    p_business_id, p_payroll_run_id, 'payroll_register',
    'payroll-register-schema-v1', 'payroll-register-renderer-v1',
    NULL, NULL, v_run.status, v_payload, v_count, v_control,
    NULL, NULL, NULL, p_actor_id
  );
  v_result := v_result || jsonb_build_array(v_item);

  -- PAYE schedule, using entry filing snapshots only.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'staff_id', pe.staff_id,
    'filing_tin', TRIM(COALESCE(pe.filing_tin, '')),
    'filing_employee_name', TRIM(COALESCE(pe.filing_employee_name, '')),
    'taxable_income', ROUND(COALESCE(pe.taxable_income, 0), 2),
    'paye', ROUND(COALESCE(pe.paye, 0), 2)
  ) ORDER BY pe.id), '[]'::JSONB)
  INTO v_rows
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE;
  v_control := jsonb_build_object(
    'included_count', v_count,
    'taxable_income', v_recomputed.taxable,
    'paye', v_recomputed.paye
  );
  v_payload := jsonb_build_object(
    'schema', 'paye-schedule-schema-v1',
    'run', v_run_json, 'business', v_business, 'rows', v_rows
  );
  v_item := public.store_payroll_export_snapshot(
    p_business_id, p_payroll_run_id, 'paye_schedule',
    'paye-schedule-schema-v1', 'paye-schedule-renderer-v1',
    NULL, NULL, v_run.status, v_payload, v_count, v_control,
    NULL, NULL, NULL, p_actor_id
  );
  v_result := v_result || jsonb_build_array(v_item);

  -- Tier 1 pension schedule.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'staff_id', pe.staff_id,
    'filing_tin', TRIM(COALESCE(pe.filing_tin, '')),
    'filing_employee_name', TRIM(COALESCE(pe.filing_employee_name, '')),
    'pensionable_base', ROUND(COALESCE(pe.pensionable_base, 0), 2),
    'tier1_ssnit_remittance', ROUND(COALESCE(pe.tier1_ssnit_remittance, 0), 2)
  ) ORDER BY pe.id), '[]'::JSONB)
  INTO v_rows
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE;
  v_control := jsonb_build_object(
    'included_count', v_count,
    'tier1_ssnit_remittance', v_recomputed.tier1
  );
  v_payload := jsonb_build_object(
    'schema', 'pension-tier1-schema-v1',
    'run', v_run_json, 'business', v_business, 'rows', v_rows
  );
  v_item := public.store_payroll_export_snapshot(
    p_business_id, p_payroll_run_id, 'pension_tier1',
    'pension-tier1-schema-v1', 'pension-tier1-renderer-v1',
    NULL, NULL, v_run.status, v_payload, v_count, v_control,
    NULL, NULL, NULL, p_actor_id
  );
  v_result := v_result || jsonb_build_array(v_item);

  -- Tier 2 pension schedule.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'staff_id', pe.staff_id,
    'filing_tin', TRIM(COALESCE(pe.filing_tin, '')),
    'filing_employee_name', TRIM(COALESCE(pe.filing_employee_name, '')),
    'pensionable_base', ROUND(COALESCE(pe.pensionable_base, 0), 2),
    'tier2_pension_remittance', ROUND(COALESCE(pe.tier2_pension_remittance, 0), 2)
  ) ORDER BY pe.id), '[]'::JSONB)
  INTO v_rows
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE;
  v_control := jsonb_build_object(
    'included_count', v_count,
    'tier2_pension_remittance', v_recomputed.tier2
  );
  v_payload := jsonb_build_object(
    'schema', 'pension-tier2-schema-v1',
    'run', v_run_json, 'business', v_business, 'rows', v_rows
  );
  v_item := public.store_payroll_export_snapshot(
    p_business_id, p_payroll_run_id, 'pension_tier2',
    'pension-tier2-schema-v1', 'pension-tier2-renderer-v1',
    NULL, NULL, v_run.status, v_payload, v_count, v_control,
    NULL, NULL, NULL, p_actor_id
  );
  v_result := v_result || jsonb_build_array(v_item);

  -- Net salary schedule deliberately freezes blank bank details.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'staff_id', pe.staff_id,
    'filing_employee_name', TRIM(COALESCE(pe.filing_employee_name, '')),
    'net_salary', ROUND(COALESCE(pe.net_salary, 0), 2),
    'bank_name', '',
    'bank_account_name', '',
    'bank_account_number', ''
  ) ORDER BY pe.id), '[]'::JSONB)
  INTO v_rows
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_payroll_run_id
    AND pe.is_included IS DISTINCT FROM FALSE;
  v_control := jsonb_build_object(
    'included_count', v_count,
    'net_salary', v_recomputed.net
  );
  v_payload := jsonb_build_object(
    'schema', 'net-salary-schema-v1',
    'run', v_run_json, 'business', v_business, 'rows', v_rows
  );
  v_item := public.store_payroll_export_snapshot(
    p_business_id, p_payroll_run_id, 'net_salary',
    'net-salary-schema-v1', 'net-salary-renderer-v1',
    NULL, NULL, v_run.status, v_payload, v_count, v_control,
    NULL, NULL, NULL, p_actor_id
  );
  v_result := v_result || jsonb_build_array(v_item);

  -- Obligations are already synchronized by the approval path at this point.
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', o.id,
      'obligation_type', o.obligation_type,
      'label', o.label,
      'amount_due', o.amount_due,
      'amount_paid', o.amount_paid,
      'status', o.status,
      'due_date', o.due_date,
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
    'schema', 'obligations-schema-v1',
    'run', v_run_json, 'business', v_business, 'rows', v_rows
  );
  v_item := public.store_payroll_export_snapshot(
    p_business_id, p_payroll_run_id, 'obligations',
    'obligations-schema-v1', 'obligations-renderer-v1',
    NULL, NULL, v_run.status, v_payload, v_serial, v_control,
    NULL, NULL, NULL, p_actor_id
  );
  v_result := v_result || jsonb_build_array(v_item);

  RETURN jsonb_build_object(
    'payroll_run_id', p_payroll_run_id,
    'business_id', p_business_id,
    'source_run_status', v_run.status,
    'snapshots', v_result
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Download verification and event recording
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_payroll_export_event(
  p_business_id UUID,
  p_payroll_run_id UUID,
  p_snapshot_id UUID,
  p_export_type TEXT,
  p_mode TEXT,
  p_content_sha256 TEXT,
  p_filename TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $fn$
DECLARE
  v_uid UUID := auth.uid();
  v_snapshot public.payroll_export_snapshots%ROWTYPE;
  v_run_status TEXT;
  v_expected_hash TEXT;
  v_id UUID;
BEGIN
  IF v_uid IS NULL
     OR NOT public.finza_user_can_access_business(p_business_id)
     OR NOT public.finza_user_has_permission(p_business_id, 'payroll.export') THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_PERMISSION_DENIED',
      'Payroll export permission required'
    );
  END IF;

  IF p_mode NOT IN ('preparation', 'audit') THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_INVALID_MODE',
      'Export mode must be preparation or audit'
    );
  END IF;

  SELECT * INTO v_snapshot
  FROM public.payroll_export_snapshots s
  WHERE s.id = p_snapshot_id
    AND s.business_id = p_business_id
    AND s.payroll_run_id = p_payroll_run_id
    AND s.export_type = p_export_type;

  IF NOT FOUND OR NOT public.verify_payroll_export_snapshot(p_snapshot_id) THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_SNAPSHOT_CORRUPTED',
      'Payroll export snapshot is missing or failed hash verification'
    );
  END IF;

  SELECT pr.status INTO v_run_status
  FROM public.payroll_runs pr
  WHERE pr.id = p_payroll_run_id
    AND pr.business_id = p_business_id;

  IF p_mode = 'preparation' AND v_run_status = 'reversed' THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_RUN_REVERSED',
      'Preparation export is unavailable because this payroll run was reversed'
    );
  END IF;

  v_expected_hash := COALESCE(
    v_snapshot.rendered_content_sha256,
    v_snapshot.source_payload_sha256
  );
  IF p_content_sha256 IS DISTINCT FROM v_expected_hash THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_SNAPSHOT_CORRUPTED',
      'Recorded content hash does not match the immutable snapshot',
      jsonb_build_object(
        'code', 'PAYROLL_EXPORT_SNAPSHOT_CORRUPTED',
        'expectedHash', v_expected_hash,
        'receivedHash', p_content_sha256
      )
    );
  END IF;

  INSERT INTO public.payroll_export_events (
    business_id,
    payroll_run_id,
    snapshot_id,
    export_type,
    mode,
    actor_id,
    content_sha256,
    filename,
    source_run_status
  ) VALUES (
    p_business_id,
    p_payroll_run_id,
    p_snapshot_id,
    p_export_type,
    p_mode,
    v_uid,
    p_content_sha256,
    COALESCE(p_filename, v_snapshot.filename),
    v_snapshot.source_run_status
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.get_payroll_export_snapshot_for_download(
  p_business_id UUID,
  p_payroll_run_id UUID,
  p_export_type TEXT,
  p_mode TEXT DEFAULT 'preparation',
  p_record BOOLEAN DEFAULT FALSE
)
RETURNS SETOF public.payroll_export_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $fn$
DECLARE
  v_uid UUID := auth.uid();
  v_snapshot public.payroll_export_snapshots%ROWTYPE;
  v_run_status TEXT;
BEGIN
  IF v_uid IS NULL
     OR NOT public.finza_user_can_access_business(p_business_id)
     OR NOT public.finza_user_has_permission(p_business_id, 'payroll.export') THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_PERMISSION_DENIED',
      'Payroll export permission required'
    );
  END IF;

  IF p_mode NOT IN ('preparation', 'audit') THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_INVALID_MODE',
      'Export mode must be preparation or audit'
    );
  END IF;

  SELECT * INTO v_snapshot
  FROM public.payroll_export_snapshots s
  WHERE s.business_id = p_business_id
    AND s.payroll_run_id = p_payroll_run_id
    AND s.export_type = p_export_type
  ORDER BY s.created_at DESC, s.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT pr.status INTO v_run_status
    FROM public.payroll_runs pr
    WHERE pr.id = p_payroll_run_id
      AND pr.business_id = p_business_id;

    IF v_run_status IN ('approved', 'locked', 'reversed') THEN
      PERFORM public.raise_payroll_export_error(
        'PAYROLL_EXPORT_LEGACY_SNAPSHOT_MISSING',
        'No approval-time export snapshot exists for this historical payroll run',
        jsonb_build_object(
          'code', 'PAYROLL_EXPORT_LEGACY_SNAPSHOT_MISSING',
          'payrollRunId', p_payroll_run_id,
          'exportType', p_export_type,
          'runStatus', v_run_status
        )
      );
    END IF;

    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_SNAPSHOT_NOT_FOUND',
      'No immutable export snapshot exists for this payroll run and export type'
    );
  END IF;

  IF NOT public.verify_payroll_export_snapshot(v_snapshot.id) THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_EXPORT_SNAPSHOT_CORRUPTED',
      'Payroll export snapshot failed hash verification',
      jsonb_build_object(
        'code', 'PAYROLL_EXPORT_SNAPSHOT_CORRUPTED',
        'snapshotId', v_snapshot.id
      )
    );
  END IF;

  SELECT pr.status INTO v_run_status
  FROM public.payroll_runs pr
  WHERE pr.id = p_payroll_run_id
    AND pr.business_id = p_business_id;

  IF p_mode = 'preparation' AND v_run_status = 'reversed' THEN
    PERFORM public.raise_payroll_export_error(
      'PAYROLL_RUN_REVERSED',
      'Preparation export is unavailable because this payroll run was reversed'
    );
  END IF;

  IF COALESCE(p_record, FALSE) THEN
    PERFORM public.record_payroll_export_event(
      p_business_id,
      p_payroll_run_id,
      v_snapshot.id,
      v_snapshot.export_type,
      p_mode,
      COALESCE(
        v_snapshot.rendered_content_sha256,
        v_snapshot.source_payload_sha256
      ),
      v_snapshot.filename
    );
  END IF;

  RETURN NEXT v_snapshot;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Explicit correction-copy allowlist and drift guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_payroll_entry_correction_columns_classified()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
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
    'statutory_period_basis', 'advance_recoveries_snapshot'
  ];
BEGIN
  SELECT array_agg(c.column_name ORDER BY c.ordinal_position)
  INTO v_unknown
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'payroll_entries'
    AND NOT (c.column_name = ANY (v_allowed));

  IF COALESCE(cardinality(v_unknown), 0) > 0 THEN
    RAISE EXCEPTION
      'PAYROLL_CORRECTION_UNCLASSIFIED_ENTRY_COLUMNS: %',
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
SET search_path = public, pg_catalog
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

  SELECT * INTO v_original
  FROM public.payroll_runs
  WHERE id = p_original_run_id
    AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND OR v_original.status IS DISTINCT FROM 'reversed' THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_CORRECTION_INVALID_SOURCE',
      'Correction source must be a reversed payroll run'
    );
  END IF;

  IF v_original.corrected_by_run_id IS NOT NULL THEN
    SELECT id INTO v_correction_id
    FROM public.payroll_runs
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

  SELECT id INTO v_correction_id
  FROM public.payroll_runs
  WHERE correction_of_run_id = p_original_run_id;
  IF FOUND THEN
    UPDATE public.payroll_runs
    SET corrected_by_run_id = v_correction_id, updated_at = NOW()
    WHERE id = p_original_run_id;
    RETURN v_correction_id;
  END IF;

  INSERT INTO public.payroll_runs (
    business_id, payroll_month, status,
    total_gross_salary, total_allowances, total_deductions,
    total_ssnit_employee, total_ssnit_employer, total_paye,
    total_net_salary, total_basic_salary,
    notes, pay_period_start, pay_period_end, payroll_frequency,
    run_type, staff_scope_fingerprint, corrects_payroll_run_id,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis, correction_of_run_id
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
  )
  RETURNING id INTO v_correction_id;

  INSERT INTO public.payroll_entries (
    id,
    payroll_run_id,
    staff_id,
    is_included,
    basic_salary,
    allowances_total,
    deductions_total,
    gross_salary,
    ssnit_employee,
    ssnit_employer,
    taxable_income,
    paye,
    net_salary,
    regular_allowances_amount,
    bonus_amount,
    overtime_amount,
    bonus_tax_5,
    bonus_tax_graduated,
    overtime_tax_5,
    overtime_tax_10,
    overtime_tax_graduated,
    is_qualifying_junior_employee,
    bonus_cap_amount,
    overtime_threshold_amount,
    pensionable_base,
    employee_pension_contribution,
    employer_pension_contribution,
    total_mandatory_pension,
    tier1_ssnit_remittance,
    tier2_pension_remittance,
    payroll_tax_profile,
    filing_tin,
    filing_employee_name,
    bonus_concessional_amount,
    bonus_graduated_amount,
    base_salary_snapshot,
    adjustment_amount,
    adjustment_reason,
    exclusion_reason,
    salary_basis,
    period_basic_pay,
    one_off_items_snapshot,
    calculation_engine_version,
    paye_rate_version,
    pension_rate_version,
    calculation_jurisdiction,
    statutory_period_basis,
    advance_recoveries_snapshot
  )
  SELECT
    gen_random_uuid(),
    v_correction_id,
    pe.staff_id,
    pe.is_included,
    pe.basic_salary,
    pe.allowances_total,
    pe.deductions_total,
    pe.gross_salary,
    pe.ssnit_employee,
    pe.ssnit_employer,
    pe.taxable_income,
    pe.paye,
    pe.net_salary,
    pe.regular_allowances_amount,
    pe.bonus_amount,
    pe.overtime_amount,
    pe.bonus_tax_5,
    pe.bonus_tax_graduated,
    pe.overtime_tax_5,
    pe.overtime_tax_10,
    pe.overtime_tax_graduated,
    pe.is_qualifying_junior_employee,
    pe.bonus_cap_amount,
    pe.overtime_threshold_amount,
    pe.pensionable_base,
    pe.employee_pension_contribution,
    pe.employer_pension_contribution,
    pe.total_mandatory_pension,
    pe.tier1_ssnit_remittance,
    pe.tier2_pension_remittance,
    pe.payroll_tax_profile,
    pe.filing_tin,
    pe.filing_employee_name,
    pe.bonus_concessional_amount,
    pe.bonus_graduated_amount,
    pe.base_salary_snapshot,
    pe.adjustment_amount,
    pe.adjustment_reason,
    pe.exclusion_reason,
    pe.salary_basis,
    pe.period_basic_pay,
    pe.one_off_items_snapshot,
    pe.calculation_engine_version,
    pe.paye_rate_version,
    pe.pension_rate_version,
    pe.calculation_jurisdiction,
    pe.statutory_period_basis,
    pe.advance_recoveries_snapshot
  FROM public.payroll_entries pe
  WHERE pe.payroll_run_id = p_original_run_id
  ORDER BY pe.id;

  FOR v_entry IN
    SELECT n.*
    FROM public.payroll_entries n
    WHERE n.payroll_run_id = v_correction_id
      AND n.is_included IS DISTINCT FROM FALSE
    ORDER BY n.id
  LOOP
    v_new_snapshot := '[]'::JSONB;
    v_old_advance := 0;
    v_new_advance := 0;

    IF jsonb_typeof(COALESCE(v_entry.advance_recoveries_snapshot, '[]'::JSONB)) = 'array' THEN
      FOR v_item IN
        SELECT value
        FROM jsonb_array_elements(COALESCE(v_entry.advance_recoveries_snapshot, '[]'::JSONB))
      LOOP
        v_old_advance := v_old_advance + GREATEST(
          0, COALESCE((v_item->>'amount')::NUMERIC, 0)
        );
        SELECT GREATEST(
          0,
          ROUND(sa.amount - public.salary_advance_posted_repaid_amount(sa.id), 2)
        )
        INTO v_outstanding
        FROM public.salary_advances sa
        WHERE sa.id = NULLIF(
          TRIM(COALESCE(v_item->>'advanceId', v_item->>'advance_id', '')), ''
        )::UUID
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
          - ROUND(v_non_advance + v_new_advance, 2),
          2
        ),
        updated_at = NOW()
    WHERE id = v_entry.id;
  END LOOP;

  UPDATE public.payroll_runs pr
  SET total_basic_salary = x.basic,
      total_allowances = x.allowances,
      total_gross_salary = x.gross,
      total_ssnit_employee = x.ssnit_employee,
      total_ssnit_employer = x.ssnit_employer,
      total_paye = x.paye,
      total_deductions = x.deductions,
      total_net_salary = x.net,
      updated_at = NOW()
  FROM (
    SELECT
      COALESCE(SUM(COALESCE(pe.basic_salary, 0)), 0) basic,
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
  ) x
  WHERE pr.id = v_correction_id;

  UPDATE public.payroll_runs
  SET corrected_by_run_id = v_correction_id, updated_at = NOW()
  WHERE id = p_original_run_id;

  PERFORM public.create_audit_log(
    p_business_id, p_actor_id, 'payroll.correction_created', 'payroll_run',
    v_correction_id, NULL,
    jsonb_build_object(
      'status', 'draft',
      'correction_of_run_id', p_original_run_id,
      'corrects_payroll_run_id', p_original_run_id
    ),
    NULL, NULL,
    format('Correction draft created for reversed payroll run %s', p_original_run_id)
  );

  RETURN v_correction_id;
EXCEPTION
  WHEN unique_violation THEN
    PERFORM public.raise_payroll_reversal_error(
      'PAYROLL_REVERSAL_INCONSISTENT_STATE',
      'A conflicting correction draft or correction audit already exists'
    );
    RETURN NULL;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Patch the migration-557 approval definition without duplicating its body.
-- ---------------------------------------------------------------------------
DO $patch_approval$
DECLARE
  v_definition TEXT;
  v_needle TEXT;
  v_replacement TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.approve_payroll_run_atomic(uuid,uuid)'::regprocedure
  ) INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'approve_payroll_run_atomic not found';
  END IF;

  v_definition := replace(v_definition, E'\r\n', E'\n');
  v_definition := replace(v_definition, E'\r', E'\n');

  IF POSITION('create_payroll_export_snapshots_for_approval' IN v_definition) = 0 THEN
    v_needle := '  v_repay_dup INT := 0;' || E'\n' || 'BEGIN';
    v_replacement :=
      '  v_repay_dup INT := 0;' || E'\n' ||
      '  v_export_snapshots JSONB;' || E'\n' ||
      'BEGIN';
    IF POSITION(v_needle IN v_definition) = 0 THEN
      RAISE EXCEPTION
        'Cannot patch approve_payroll_run_atomic: declaration anchor not found';
    END IF;
    v_definition := replace(v_definition, v_needle, v_replacement);

    v_needle :=
      '      ''externalEmployeeDeductionsTotal'', v_external_total' || E'\n' ||
      '    );' || E'\n' ||
      '  END IF;';
    v_replacement :=
      '      ''externalEmployeeDeductionsTotal'', v_external_total,' || E'\n' ||
      '      ''export_snapshots'', COALESCE((' || E'\n' ||
      '        SELECT jsonb_agg(jsonb_build_object(' || E'\n' ||
      '          ''export_type'', s.export_type,' || E'\n' ||
      '          ''id'', s.id,' || E'\n' ||
      '          ''source_payload_sha256'', s.source_payload_sha256,' || E'\n' ||
      '          ''rendered_content_sha256'', s.rendered_content_sha256' || E'\n' ||
      '        ) ORDER BY s.export_type)' || E'\n' ||
      '        FROM public.payroll_export_snapshots s' || E'\n' ||
      '        WHERE s.business_id = p_business_id' || E'\n' ||
      '          AND s.payroll_run_id = p_payroll_run_id' || E'\n' ||
      '      ), ''[]''::jsonb)' || E'\n' ||
      '    );' || E'\n' ||
      '  END IF;';
    IF POSITION(v_needle IN v_definition) = 0 THEN
      RAISE EXCEPTION
        'Cannot patch approve_payroll_run_atomic: reused response anchor not found';
    END IF;
    v_definition := replace(v_definition, v_needle, v_replacement);

    v_needle :=
      '  v_external_total := COALESCE((v_obl->>''externalDeductions'')::NUMERIC, 0);' || E'\n\n' ||
      '  UPDATE public.payroll_runs';
    v_replacement :=
      '  v_external_total := COALESCE((v_obl->>''externalDeductions'')::NUMERIC, 0);' || E'\n\n' ||
      '  v_export_snapshots := public.create_payroll_export_snapshots_for_approval(' || E'\n' ||
      '    p_business_id, p_payroll_run_id, v_uid' || E'\n' ||
      '  );' || E'\n\n' ||
      '  UPDATE public.payroll_runs';
    IF POSITION(v_needle IN v_definition) = 0 THEN
      RAISE EXCEPTION
        'Cannot patch approve_payroll_run_atomic: pre-status-update anchor not found';
    END IF;
    v_definition := replace(v_definition, v_needle, v_replacement);

    v_needle :=
      '        ''externalDeductions'', v_external_total' || E'\n' ||
      '      ),';
    v_replacement :=
      '        ''externalDeductions'', v_external_total,' || E'\n' ||
      '        ''export_snapshots'', COALESCE(v_export_snapshots->''snapshots'', ''[]''::jsonb)' || E'\n' ||
      '      ),';
    IF POSITION(v_needle IN v_definition) = 0 THEN
      RAISE EXCEPTION
        'Cannot patch approve_payroll_run_atomic: audit anchor not found';
    END IF;
    v_definition := replace(v_definition, v_needle, v_replacement);

    v_needle :=
      '    ''externalEmployeeDeductionsTotal'', v_external_total,' || E'\n' ||
      '    ''obligations'', COALESCE(v_obl->''obligations'', ''[]''::jsonb),';
    v_replacement :=
      '    ''externalEmployeeDeductionsTotal'', v_external_total,' || E'\n' ||
      '    ''export_snapshots'', COALESCE(v_export_snapshots->''snapshots'', ''[]''::jsonb),' || E'\n' ||
      '    ''obligations'', COALESCE(v_obl->''obligations'', ''[]''::jsonb),';
    IF POSITION(v_needle IN v_definition) = 0 THEN
      RAISE EXCEPTION
        'Cannot patch approve_payroll_run_atomic: fresh response anchor not found';
    END IF;
    v_definition := replace(v_definition, v_needle, v_replacement);

    EXECUTE v_definition;
  END IF;
END;
$patch_approval$;

COMMENT ON TABLE public.payroll_export_snapshots IS
  'Immutable approval-time payroll export source and rendered-content snapshots.';
COMMENT ON TABLE public.payroll_export_events IS
  'Append-only audit events for verified payroll export downloads.';
COMMENT ON FUNCTION public.create_payroll_export_snapshots_for_approval(UUID, UUID, UUID) IS
  'Internal approval helper that freezes canonical payroll export payloads before run approval.';
COMMENT ON FUNCTION public.create_payroll_correction_draft_from_reversed(UUID, UUID, UUID) IS
  'Internal correction helper with an explicit payroll-entry copy allowlist and schema-drift guard.';

-- ---------------------------------------------------------------------------
-- Privileges: clients read snapshots through RLS and write events only by RPC.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.payroll_export_snapshots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.payroll_export_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.payroll_export_snapshots TO authenticated;
GRANT SELECT ON TABLE public.payroll_export_events TO authenticated;
GRANT ALL ON TABLE public.payroll_export_snapshots TO postgres, service_role;
GRANT ALL ON TABLE public.payroll_export_events TO postgres, service_role;

REVOKE ALL ON FUNCTION public.raise_payroll_export_error(TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_csv_escape(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_sha256_hex(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_money_text(NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_payroll_export_snapshot(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_payroll_export_snapshot(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, INT, JSONB,
  TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_payroll_export_snapshots_for_approval(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_payroll_entry_correction_columns_classified()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_payroll_correction_draft_from_reversed(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.raise_payroll_export_error(TEXT, TEXT, JSONB) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_csv_escape(TEXT) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_sha256_hex(TEXT) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_money_text(NUMERIC) TO postgres;
GRANT EXECUTE ON FUNCTION public.verify_payroll_export_snapshot(UUID) TO postgres;
GRANT EXECUTE ON FUNCTION public.store_payroll_export_snapshot(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, INT, JSONB,
  TEXT, TEXT, TEXT, UUID
) TO postgres;
GRANT EXECUTE ON FUNCTION public.create_payroll_export_snapshots_for_approval(UUID, UUID, UUID)
  TO postgres;
GRANT EXECUTE ON FUNCTION public.assert_payroll_entry_correction_columns_classified()
  TO postgres;
GRANT EXECUTE ON FUNCTION public.create_payroll_correction_draft_from_reversed(UUID, UUID, UUID)
  TO postgres;

REVOKE ALL ON FUNCTION public.record_payroll_export_event(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payroll_export_event(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

REVOKE ALL ON FUNCTION public.get_payroll_export_snapshot_for_download(
  UUID, UUID, TEXT, TEXT, BOOLEAN
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payroll_export_snapshot_for_download(
  UUID, UUID, TEXT, TEXT, BOOLEAN
) TO authenticated;

REVOKE ALL ON FUNCTION public.approve_payroll_run_atomic(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_payroll_run_atomic(UUID, UUID)
  TO authenticated;

-- Re-assert internal helper boundaries after replacing approval/correction.
REVOKE ALL ON FUNCTION public.sync_payroll_obligations_for_approval(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_approval_obligations_consistent(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_ghana_validate_run_for_approval(UUID, public.payroll_runs, INT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raise_payroll_approval_error(TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raise_payroll_reversal_error(TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.salary_advance_posted_repaid_amount(UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sync_payroll_obligations_for_approval(UUID, UUID) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_approval_obligations_consistent(UUID, UUID) TO postgres;
GRANT EXECUTE ON FUNCTION public.payroll_ghana_validate_run_for_approval(UUID, public.payroll_runs, INT) TO postgres;
GRANT EXECUTE ON FUNCTION public.raise_payroll_approval_error(TEXT, TEXT, JSONB) TO postgres;
GRANT EXECUTE ON FUNCTION public.raise_payroll_reversal_error(TEXT, TEXT, JSONB) TO postgres;
GRANT EXECUTE ON FUNCTION public.salary_advance_posted_repaid_amount(UUID) TO postgres;

-- finza_user_has_permission intentionally remains executable by authenticated.
