-- ============================================================================
-- Non-production database tests for migration 561.
-- Every fixture and approval attempt is enclosed by BEGIN/ROLLBACK.
--
-- psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
--   -f supabase/tests/database/ghana_v3_tax_base_validation.test.sql
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.make_ghana_v3_valid_run(
  p_business_id UUID,
  p_period DATE,
  p_method TEXT,
  p_is_pensionable BOOLEAN DEFAULT TRUE
)
RETURNS UUID
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_run UUID := gen_random_uuid();
  v_staff UUID := gen_random_uuid();
  v_basic NUMERIC := 1000;
  v_regular NUMERIC := 200;
  v_bonus NUMERIC := 100;
  v_overtime NUMERIC := 50;
  v_allowances NUMERIC := 350;
  v_gross NUMERIC := 1350;
  v_pension_version TEXT := CASE EXTRACT(YEAR FROM p_period)::INT
    WHEN 2024 THEN 'gh-pension-2024-01'
    WHEN 2025 THEN 'gh-pension-2025-01'
    ELSE 'gh-pension-2026-01'
  END;
  v_pension JSONB;
  v_employee NUMERIC;
  v_employer NUMERIC;
  v_taxable NUMERIC;
  v_paye NUMERIC;
  v_regular_base NUMERIC;
  v_regular_tax NUMERIC;
  v_bonus_base NUMERIC;
  v_bonus_component NUMERIC;
  v_ot_base NUMERIC;
  v_ot_component NUMERIC;
  v_bonus_cap NUMERIC := 1800;
  v_bonus_concessional NUMERIC := 100;
  v_bonus_graduated NUMERIC := 0;
  v_bonus_tax_5 NUMERIC := 5;
  v_bonus_tax_graduated NUMERIC := 0;
  v_ot_threshold NUMERIC := 500;
  v_ot_tax_5 NUMERIC := 0;
  v_ot_tax_10 NUMERIC := 0;
  v_ot_tax_graduated NUMERIC := 0;
  v_net NUMERIC;
  v_resident BOOLEAN := p_method <> 'gh_nonresident_split_25_20';
  v_employment TEXT := CASE WHEN p_method = 'gh_casual_flat_5'
    THEN 'casual' ELSE 'permanent' END;
  v_profile JSONB;
BEGIN
  v_pension := public.payroll_ghana_expected_pension(
    v_basic, v_pension_version, p_is_pensionable
  );
  v_employee := (v_pension->>'employee')::NUMERIC;
  v_employer := (v_pension->>'employer')::NUMERIC;

  IF p_method = 'gh_casual_flat_5' THEN
    v_taxable := v_gross;
    v_regular_base := v_gross;
    v_regular_tax := ROUND(v_gross * 0.05, 2);
    v_bonus_base := 0;
    v_bonus_component := 0;
    v_ot_base := 0;
    v_ot_component := 0;
    v_bonus_tax_5 := 0;
    v_ot_threshold := 500;
    v_paye := v_regular_tax;
  ELSIF p_method = 'gh_nonresident_split_25_20' THEN
    v_regular_base := ROUND(GREATEST(0, v_basic + v_regular - v_employee), 2);
    v_regular_tax := ROUND(v_regular_base * 0.25, 2);
    v_bonus_base := v_bonus;
    v_bonus_component := ROUND(v_bonus * 0.20, 2);
    v_ot_base := v_overtime;
    v_ot_component := ROUND(v_overtime * 0.20, 2);
    v_bonus_tax_5 := 0;
    v_bonus_tax_graduated := v_bonus_component;
    v_ot_tax_graduated := v_ot_component;
    v_taxable := v_regular_base;
    v_paye := ROUND(v_regular_tax + v_bonus_component + v_ot_component, 2);
  ELSE
    v_taxable := ROUND(GREATEST(0, v_gross - v_employee), 2);
    v_regular_base := ROUND(GREATEST(0, v_taxable - v_bonus - v_overtime), 2);
    v_ot_tax_graduated := ROUND(
      GREATEST(
        0,
        public.payroll_ghana_calculate_paye_from_bands(v_taxable - v_bonus_concessional)
        - public.payroll_ghana_calculate_paye_from_bands(v_regular_base)
      ),
      2
    );
    v_paye := ROUND(
      public.payroll_ghana_calculate_paye_from_bands(v_taxable - v_bonus_concessional)
      + v_bonus_tax_5,
      2
    );
    v_bonus_base := v_bonus;
    v_bonus_component := v_bonus_tax_5;
    v_ot_base := v_overtime;
    v_ot_component := v_ot_tax_graduated;
    v_regular_tax := ROUND(v_paye - v_bonus_component - v_ot_component, 2);
  END IF;

  v_net := ROUND(v_gross - v_employee - v_paye, 2);
  v_profile := jsonb_build_object(
    'staff_is_tax_resident', v_resident,
    'staff_is_pensionable', p_is_pensionable,
    'secondary_employment', FALSE,
    'employment_type', v_employment,
    'income_tax_method', p_method,
    'income_tax_method_version', 'gh-profile-tax-2024-01',
    'gra_position_code', 'OTHR'
  );
  IF p_method = 'gh_casual_flat_5' THEN
    v_profile := v_profile || jsonb_build_object(
      'casual_worker_flat_tax_applied', TRUE
    );
  END IF;

  INSERT INTO public.staff (
    id, business_id, name, basic_salary, employment_type,
    is_tax_resident, is_pensionable, secondary_employment
  ) VALUES (
    v_staff, p_business_id, 'Migration 561 Test Employee', v_basic,
    CASE WHEN v_employment = 'casual' THEN 'casual' ELSE 'full_time' END,
    v_resident, p_is_pensionable, FALSE
  );

  INSERT INTO public.payroll_runs (
    id, business_id, payroll_month, pay_period_start, pay_period_end,
    status, payroll_frequency, total_basic_salary, total_gross_salary,
    total_allowances, total_ssnit_employee, total_ssnit_employer,
    total_paye, total_deductions, total_net_salary,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis, notes,
    staff_scope_fingerprint
  ) VALUES (
    v_run, p_business_id, date_trunc('month', p_period)::DATE,
    date_trunc('month', p_period)::DATE,
    (date_trunc('month', p_period) + INTERVAL '1 month - 1 day')::DATE,
    'draft', 'monthly', v_basic, v_gross, v_allowances,
    v_employee, v_employer, v_paye, 0, v_net,
    'finza-ghana-v3', 'gh-paye-2024-01', v_pension_version,
    'GH', p_period, 'migration-561-test', gen_random_uuid()::TEXT
  );

  INSERT INTO public.payroll_entries (
    payroll_run_id, staff_id, basic_salary, allowances_total,
    regular_allowances_amount, bonus_amount, overtime_amount,
    deductions_total, gross_salary, ssnit_employee, ssnit_employer,
    taxable_income, paye, net_salary, is_included,
    bonus_tax_5, bonus_tax_graduated, overtime_tax_5,
    overtime_tax_10, overtime_tax_graduated,
    is_qualifying_junior_employee, bonus_cap_amount,
    overtime_threshold_amount, bonus_concessional_amount,
    bonus_graduated_amount, pensionable_base,
    employee_pension_contribution, employer_pension_contribution,
    total_mandatory_pension, tier1_ssnit_remittance,
    tier2_pension_remittance, calculation_engine_version,
    paye_rate_version, pension_rate_version, calculation_jurisdiction,
    statutory_period_basis, payroll_tax_profile, filing_tin,
    filing_employee_name, income_tax_method, income_tax_method_version,
    income_tax_regular_base, income_tax_regular_amount,
    income_tax_bonus_base, income_tax_bonus_amount,
    income_tax_overtime_base, income_tax_overtime_amount
  ) VALUES (
    v_run, v_staff, v_basic, v_allowances,
    v_regular, v_bonus, v_overtime, 0, v_gross, v_employee, v_employer,
    v_taxable, v_paye, v_net, TRUE,
    v_bonus_tax_5, v_bonus_tax_graduated, v_ot_tax_5,
    v_ot_tax_10, v_ot_tax_graduated,
    FALSE, v_bonus_cap, v_ot_threshold, v_bonus_concessional,
    v_bonus_graduated, (v_pension->>'pensionable_base')::NUMERIC,
    v_employee, v_employer, (v_pension->>'total_mandatory')::NUMERIC,
    (v_pension->>'tier1')::NUMERIC, (v_pension->>'tier2')::NUMERIC,
    'finza-ghana-v3', 'gh-paye-2024-01', v_pension_version, 'GH',
    p_period, v_profile, 'P5610000000', 'Migration 561 Test Employee',
    p_method, 'gh-profile-tax-2024-01',
    v_regular_base, v_regular_tax, v_bonus_base, v_bonus_component,
    v_ot_base, v_ot_component
  );

  RETURN v_run;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.assert_approval_rejected_without_mutations(
  p_business_id UUID,
  p_run_id UUID,
  p_classification TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_detail TEXT;
  v_message TEXT;
  v_status TEXT;
  v_mutations INT;
BEGIN
  BEGIN
    PERFORM public.approve_payroll_run_atomic(p_business_id, p_run_id);
    RAISE EXCEPTION 'TEST_EXPECTED_REJECTION: run % approved', p_run_id;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_detail = PG_EXCEPTION_DETAIL,
      v_message = MESSAGE_TEXT;
    IF v_message LIKE 'TEST_EXPECTED_REJECTION:%' THEN RAISE; END IF;
    IF POSITION(
      p_classification IN COALESCE(v_detail, '') || COALESCE(v_message, '')
    ) = 0 THEN
      RAISE EXCEPTION 'Expected classification %, message=%, detail=%',
        p_classification, v_message, v_detail;
    END IF;
  END;

  SELECT status INTO v_status FROM public.payroll_runs WHERE id = p_run_id;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Rejected run mutated status to %', v_status;
  END IF;

  SELECT
    (SELECT COUNT(*) FROM public.journal_entries
      WHERE reference_type = 'payroll' AND reference_id = p_run_id)
    + (SELECT COUNT(*) FROM public.payroll_obligations
      WHERE payroll_run_id = p_run_id)
    + (SELECT COUNT(*) FROM public.payroll_export_snapshots
      WHERE payroll_run_id = p_run_id)
    + (SELECT COUNT(*) FROM public.audit_logs
      WHERE entity_id = p_run_id AND action_type = 'payroll.run_approved')
  INTO v_mutations;
  IF v_mutations <> 0 THEN
    RAISE EXCEPTION 'Rejected run left % approval mutations', v_mutations;
  END IF;
END;
$fn$;

DO $test$
DECLARE
  v_owner UUID;
  v_business UUID := gen_random_uuid();
  v_run UUID;
  v_result JSONB;
BEGIN
  SELECT id INTO v_owner FROM auth.users LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'TEST_SETUP: need at least one auth.users row';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_owner::TEXT, TRUE);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);

  INSERT INTO public.businesses (
    id, name, legal_name, address_country, owner_id, created_at, updated_at
  ) VALUES (
    v_business, 'Migration 561 Test Business', 'Migration 561 Test Business',
    'Ghana', v_owner, NOW(), NOW()
  );
  INSERT INTO public.business_users (business_id, user_id, role, created_at)
  VALUES (v_business, v_owner, 'admin', NOW()) ON CONFLICT DO NOTHING;
  INSERT INTO public.accounts (business_id, name, code, type, is_system)
  VALUES
    (v_business, 'Payroll Expense', '5600', 'expense', TRUE),
    (v_business, 'SSNIT Employer Expense', '5610', 'expense', TRUE),
    (v_business, 'PAYE Payable', '2230', 'liability', TRUE),
    (v_business, 'Tier1 Payable', '2231', 'liability', TRUE),
    (v_business, 'Tier2 Payable', '2232', 'liability', TRUE),
    (v_business, 'Net Salaries Payable', '2240', 'liability', TRUE),
    (v_business, 'Deductions Payable', '2241', 'liability', TRUE),
    (v_business, 'Staff Advances', '1110', 'asset', TRUE)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.accounting_periods (
    business_id, period_start, period_end, status
  )
  SELECT
    v_business, month_start::DATE,
    (month_start + INTERVAL '1 month - 1 day')::DATE, 'open'
  FROM generate_series(
    DATE '2025-01-01', DATE '2026-03-01', INTERVAL '1 month'
  ) month_start
  ON CONFLICT DO NOTHING;

  -- Missing frozen pensionability.
  v_run := pg_temp.make_ghana_v3_valid_run(
    v_business, DATE '2025-01-01', 'gh_resident_graduated'
  );
  UPDATE public.payroll_entries
  SET payroll_tax_profile = payroll_tax_profile - 'staff_is_pensionable'
  WHERE payroll_run_id = v_run;
  PERFORM pg_temp.assert_approval_rejected_without_mutations(
    v_business, v_run, 'missing_pensionability_snapshot'
  );

  -- Profile method mismatch and profile method-version mismatch.
  v_run := pg_temp.make_ghana_v3_valid_run(
    v_business, DATE '2025-02-01', 'gh_resident_graduated'
  );
  UPDATE public.payroll_entries
  SET payroll_tax_profile = jsonb_set(
    payroll_tax_profile, '{income_tax_method}', '"gh_casual_flat_5"'
  ) WHERE payroll_run_id = v_run;
  PERFORM pg_temp.assert_approval_rejected_without_mutations(
    v_business, v_run, 'income_tax_method_snapshot_mismatch'
  );

  v_run := pg_temp.make_ghana_v3_valid_run(
    v_business, DATE '2025-03-01', 'gh_resident_graduated'
  );
  UPDATE public.payroll_entries
  SET payroll_tax_profile = jsonb_set(
    payroll_tax_profile, '{income_tax_method_version}',
    '"gh-profile-tax-tampered"'
  ) WHERE payroll_run_id = v_run;
  PERFORM pg_temp.assert_approval_rejected_without_mutations(
    v_business, v_run, 'income_tax_method_snapshot_mismatch'
  );

  -- Non-resident regular base remains self-consistent at 25%, but is not the
  -- independently expected basic + regular allowances - expected pension.
  v_run := pg_temp.make_ghana_v3_valid_run(
    v_business, DATE '2025-04-01', 'gh_nonresident_split_25_20'
  );
  UPDATE public.payroll_entries
  SET income_tax_regular_base = income_tax_regular_base + 100,
      income_tax_regular_amount = ROUND((income_tax_regular_base + 100) * 0.25, 2),
      taxable_income = taxable_income + 100,
      paye = paye + 25,
      net_salary = net_salary - 25
  WHERE payroll_run_id = v_run;
  UPDATE public.payroll_runs
  SET total_paye = total_paye + 25, total_net_salary = total_net_salary - 25
  WHERE id = v_run;
  PERFORM pg_temp.assert_approval_rejected_without_mutations(
    v_business, v_run, 'income_tax_base_mismatch'
  );

  -- Bonus and overtime base tampering with matching flat-rate amounts.
  v_run := pg_temp.make_ghana_v3_valid_run(
    v_business, DATE '2025-05-01', 'gh_nonresident_split_25_20'
  );
  UPDATE public.payroll_entries
  SET income_tax_bonus_base = income_tax_bonus_base + 100,
      income_tax_bonus_amount = income_tax_bonus_amount + 20,
      bonus_tax_graduated = bonus_tax_graduated + 20,
      paye = paye + 20,
      net_salary = net_salary - 20
  WHERE payroll_run_id = v_run;
  UPDATE public.payroll_runs
  SET total_paye = total_paye + 20, total_net_salary = total_net_salary - 20
  WHERE id = v_run;
  PERFORM pg_temp.assert_approval_rejected_without_mutations(
    v_business, v_run, 'income_tax_base_mismatch'
  );

  v_run := pg_temp.make_ghana_v3_valid_run(
    v_business, DATE '2025-06-01', 'gh_nonresident_split_25_20'
  );
  UPDATE public.payroll_entries
  SET income_tax_overtime_base = income_tax_overtime_base + 100,
      income_tax_overtime_amount = income_tax_overtime_amount + 20,
      overtime_tax_graduated = overtime_tax_graduated + 20,
      paye = paye + 20,
      net_salary = net_salary - 20
  WHERE payroll_run_id = v_run;
  UPDATE public.payroll_runs
  SET total_paye = total_paye + 20, total_net_salary = total_net_salary - 20
  WHERE id = v_run;
  PERFORM pg_temp.assert_approval_rejected_without_mutations(
    v_business, v_run, 'income_tax_base_mismatch'
  );

  -- Pension tamper accompanied by adjusted non-resident tax evidence.
  v_run := pg_temp.make_ghana_v3_valid_run(
    v_business, DATE '2025-07-01', 'gh_nonresident_split_25_20'
  );
  UPDATE public.payroll_entries
  SET employee_pension_contribution = employee_pension_contribution + 4,
      ssnit_employee = ssnit_employee + 4,
      total_mandatory_pension = total_mandatory_pension + 4,
      tier2_pension_remittance = tier2_pension_remittance + 4,
      income_tax_regular_base = income_tax_regular_base - 4,
      income_tax_regular_amount = ROUND((income_tax_regular_base - 4) * 0.25, 2),
      taxable_income = taxable_income - 4,
      paye = paye - 1,
      net_salary = net_salary - 3
  WHERE payroll_run_id = v_run;
  UPDATE public.payroll_runs
  SET total_ssnit_employee = total_ssnit_employee + 4,
      total_paye = total_paye - 1,
      total_net_salary = total_net_salary - 3
  WHERE id = v_run;
  PERFORM pg_temp.assert_approval_rejected_without_mutations(
    v_business, v_run, 'pension_snapshot_mismatch'
  );

  -- A frozen non-pensionable profile must have zero pension snapshots.
  v_run := pg_temp.make_ghana_v3_valid_run(
    v_business, DATE '2025-08-01', 'gh_nonresident_split_25_20', FALSE
  );
  UPDATE public.payroll_entries
  SET pensionable_base = 1000, employee_pension_contribution = 55,
      employer_pension_contribution = 130, total_mandatory_pension = 185,
      tier1_ssnit_remittance = 135, tier2_pension_remittance = 50,
      ssnit_employee = 55, ssnit_employer = 130
  WHERE payroll_run_id = v_run;
  UPDATE public.payroll_runs
  SET total_ssnit_employee = 55, total_ssnit_employer = 130
  WHERE id = v_run;
  PERFORM pg_temp.assert_approval_rejected_without_mutations(
    v_business, v_run, 'pension_snapshot_mismatch'
  );

  -- Resident PAYE tamper where the three v3 components still sum to PAYE.
  v_run := pg_temp.make_ghana_v3_valid_run(
    v_business, DATE '2025-09-01', 'gh_resident_graduated'
  );
  UPDATE public.payroll_entries
  SET income_tax_regular_amount = income_tax_regular_amount + 1,
      paye = paye + 1, net_salary = net_salary - 1
  WHERE payroll_run_id = v_run;
  UPDATE public.payroll_runs
  SET total_paye = total_paye + 1, total_net_salary = total_net_salary - 1
  WHERE id = v_run;
  PERFORM pg_temp.assert_approval_rejected_without_mutations(
    v_business, v_run, 'resident_tax_amount_mismatch'
  );

  -- Casual tax is made self-consistent with a tampered gross; earnings must
  -- reject before the casual tax validator can trust that gross.
  v_run := pg_temp.make_ghana_v3_valid_run(
    v_business, DATE '2025-10-01', 'gh_casual_flat_5'
  );
  UPDATE public.payroll_entries
  SET gross_salary = gross_salary + 100,
      taxable_income = taxable_income + 100,
      income_tax_regular_base = income_tax_regular_base + 100,
      income_tax_regular_amount = income_tax_regular_amount + 5,
      paye = paye + 5, net_salary = net_salary + 95
  WHERE payroll_run_id = v_run;
  UPDATE public.payroll_runs
  SET total_gross_salary = total_gross_salary + 100,
      total_paye = total_paye + 5, total_net_salary = total_net_salary + 95
  WHERE id = v_run;
  PERFORM pg_temp.assert_approval_rejected_without_mutations(
    v_business, v_run, 'earnings_component_mismatch'
  );

  -- Net salary must be independently recomputed, even if the run total agrees.
  v_run := pg_temp.make_ghana_v3_valid_run(
    v_business, DATE '2025-11-01', 'gh_resident_graduated'
  );
  UPDATE public.payroll_entries SET net_salary = net_salary + 10
  WHERE payroll_run_id = v_run;
  UPDATE public.payroll_runs SET total_net_salary = total_net_salary + 10
  WHERE id = v_run;
  PERFORM pg_temp.assert_approval_rejected_without_mutations(
    v_business, v_run, 'net_salary_mismatch'
  );

  -- Run-level PAYE reconciliation cannot be bypassed with valid entries.
  v_run := pg_temp.make_ghana_v3_valid_run(
    v_business, DATE '2025-12-01', 'gh_resident_graduated'
  );
  UPDATE public.payroll_runs SET total_paye = total_paye + 1 WHERE id = v_run;
  PERFORM pg_temp.assert_approval_rejected_without_mutations(
    v_business, v_run, 'paye_totals_mismatch'
  );

  -- Valid graduated, casual, and non-resident approvals.
  v_run := pg_temp.make_ghana_v3_valid_run(
    v_business, DATE '2026-01-01', 'gh_resident_graduated'
  );
  v_result := public.approve_payroll_run_atomic(v_business, v_run);
  IF COALESCE((v_result->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Valid graduated approval failed: %', v_result;
  END IF;

  v_run := pg_temp.make_ghana_v3_valid_run(
    v_business, DATE '2026-02-01', 'gh_casual_flat_5'
  );
  v_result := public.approve_payroll_run_atomic(v_business, v_run);
  IF COALESCE((v_result->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Valid casual approval failed: %', v_result;
  END IF;

  v_run := pg_temp.make_ghana_v3_valid_run(
    v_business, DATE '2026-03-01', 'gh_nonresident_split_25_20'
  );
  v_result := public.approve_payroll_run_atomic(v_business, v_run);
  IF COALESCE((v_result->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Valid non-resident approval failed: %', v_result;
  END IF;

  RAISE NOTICE 'PASS migration 561 Ghana v3 independent tax-base validation';
END;
$test$;

ROLLBACK;
