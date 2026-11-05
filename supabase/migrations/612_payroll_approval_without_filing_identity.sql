-- ============================================================================
-- Migration 612: Allow payroll approval without frozen GRA filing identity
-- ============================================================================
-- Payroll calculation, approval, the payroll journal and statutory obligations
-- must not depend on employee TIN or GRA position details.
--
-- Approval snapshots are still created for every payroll export. The GRA
-- DT 107A preparation snapshot is created only when every included employee has
-- the filing identity required for that submission. GRA filing validation in
-- the export route still requires those details.
-- ============================================================================

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
  v_filing_identity_complete BOOLEAN := TRUE;
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
    v_filing_identity_complete := (jsonb_array_length(v_affected) = 0);
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
  IF v_filing_identity_complete THEN
  v_item := public.store_payroll_export_snapshot(
    p_business_id, p_payroll_run_id, 'gra_dt107a',
    'gra-dt107a-schema-v2', 'gra-dt107a-renderer-v2',
    'gra-dt0107a-monthly-v1',
    'GRA DT 0107A uploadable monthly PAYE employee format v1',
    'approved', v_payload, v_count, v_control, v_csv,
    'text/csv', format('dt107a-preparation-%s.csv', v_period), p_actor_id
  );
  v_result := v_result || jsonb_build_array(v_item);
  END IF;

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

COMMENT ON FUNCTION public.create_payroll_export_snapshots_for_approval(UUID, UUID, UUID) IS
  'Creates approval-time payroll snapshots. The GRA DT 107A snapshot is created only when every included employee has a filing TIN and GRA position; payroll approval itself does not require those filing details.';
