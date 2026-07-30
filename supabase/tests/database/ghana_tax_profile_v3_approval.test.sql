-- ============================================================================
-- Non-production database tests for migration 560.
-- Runs entirely inside a transaction and leaves no data behind.
--
-- psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
--   -f supabase/tests/database/ghana_tax_profile_v3_approval.test.sql
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.make_ghana_v3_run(
  p_business_id UUID,
  p_period DATE,
  p_profile JSONB,
  p_method TEXT,
  p_version TEXT DEFAULT 'gh-profile-tax-2024-01',
  p_entry_engine TEXT DEFAULT 'finza-ghana-v3'
)
RETURNS UUID
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_run UUID := gen_random_uuid();
  v_staff UUID := gen_random_uuid();
  v_regular_base NUMERIC := 1000;
  v_regular_amount NUMERIC := 100;
  v_bonus_base NUMERIC := 0;
  v_bonus_amount NUMERIC := 0;
  v_overtime_base NUMERIC := 0;
  v_overtime_amount NUMERIC := 0;
  v_paye NUMERIC;
BEGIN
  IF p_method = 'gh_casual_flat_5' THEN
    v_regular_amount := 50;
  ELSIF p_method = 'gh_nonresident_split_25_20' THEN
    v_regular_base := 1000;
    v_regular_amount := 250;
    v_bonus_base := 100;
    v_bonus_amount := 20;
    v_overtime_base := 100;
    v_overtime_amount := 20;
  END IF;
  v_paye := v_regular_amount + v_bonus_amount + v_overtime_amount;

  INSERT INTO public.staff (
    id, business_id, name, basic_salary, employment_type,
    is_tax_resident, secondary_employment
  ) VALUES (
    v_staff, p_business_id, 'Migration 560 Test Employee', 1000,
    'full_time', TRUE, FALSE
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
    'draft', 'monthly', 1000,
    CASE WHEN p_method = 'gh_nonresident_split_25_20' THEN 1200 ELSE 1000 END,
    CASE WHEN p_method = 'gh_nonresident_split_25_20' THEN 200 ELSE 0 END,
    0, 0, v_paye, 0,
    CASE WHEN p_method = 'gh_nonresident_split_25_20'
      THEN 1200 - v_paye ELSE 1000 - v_paye END,
    'finza-ghana-v3', 'gh-paye-2024-01',
    CASE EXTRACT(YEAR FROM p_period)::INT
      WHEN 2024 THEN 'gh-pension-2024-01'
      WHEN 2025 THEN 'gh-pension-2025-01'
      ELSE 'gh-pension-2026-01'
    END,
    'GH', p_period, 'migration-560-test', gen_random_uuid()::TEXT
  );

  INSERT INTO public.payroll_entries (
    payroll_run_id, staff_id, basic_salary, allowances_total,
    deductions_total, gross_salary, ssnit_employee, ssnit_employer,
    taxable_income, paye, net_salary, is_included,
    tier1_ssnit_remittance, tier2_pension_remittance,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis, payroll_tax_profile,
    filing_tin, filing_employee_name, income_tax_method,
    income_tax_method_version, income_tax_regular_base,
    income_tax_regular_amount, income_tax_bonus_base,
    income_tax_bonus_amount, income_tax_overtime_base,
    income_tax_overtime_amount
  ) VALUES (
    v_run, v_staff, 1000,
    CASE WHEN p_method = 'gh_nonresident_split_25_20' THEN 200 ELSE 0 END,
    0,
    CASE WHEN p_method = 'gh_nonresident_split_25_20' THEN 1200 ELSE 1000 END,
    0, 0,
    CASE WHEN p_method = 'gh_nonresident_split_25_20' THEN 1200 ELSE 1000 END,
    v_paye,
    CASE WHEN p_method = 'gh_nonresident_split_25_20'
      THEN 1200 - v_paye ELSE 1000 - v_paye END,
    TRUE, 0, 0, p_entry_engine, 'gh-paye-2024-01',
    CASE EXTRACT(YEAR FROM p_period)::INT
      WHEN 2024 THEN 'gh-pension-2024-01'
      WHEN 2025 THEN 'gh-pension-2025-01'
      ELSE 'gh-pension-2026-01'
    END,
    'GH', p_period,
    CASE WHEN p_profile IS NULL THEN NULL
      ELSE p_profile || jsonb_build_object('gra_position_code', '001') END,
    'P0000000000', 'Migration 560 Test Employee', p_method, p_version,
    CASE WHEN p_entry_engine = 'finza-ghana-v2' THEN NULL ELSE v_regular_base END,
    CASE WHEN p_entry_engine = 'finza-ghana-v2' THEN NULL ELSE v_regular_amount END,
    CASE WHEN p_entry_engine = 'finza-ghana-v2' THEN NULL ELSE v_bonus_base END,
    CASE WHEN p_entry_engine = 'finza-ghana-v2' THEN NULL ELSE v_bonus_amount END,
    CASE WHEN p_entry_engine = 'finza-ghana-v2' THEN NULL ELSE v_overtime_base END,
    CASE WHEN p_entry_engine = 'finza-ghana-v2' THEN NULL ELSE v_overtime_amount END
  );
  RETURN v_run;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.assert_approval_rejected(
  p_business_id UUID,
  p_run_id UUID,
  p_classification TEXT DEFAULT NULL
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
    IF p_classification IS NOT NULL
       AND POSITION(p_classification IN COALESCE(v_detail, '') || COALESCE(v_message, '')) = 0 THEN
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
  v_profile JSONB;
  v_type TEXT;
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
    v_business, 'Migration 560 Test Business', 'Migration 560 Test Business',
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
  ) VALUES (
    v_business, DATE '2026-03-01', DATE '2026-03-31', 'open'
  ) ON CONFLICT DO NOTHING;

  -- Resident temporary, contract, part-time and casual are supported.
  FOREACH v_type IN ARRAY ARRAY['temporary', 'contract', 'part_time', 'casual']
  LOOP
    v_profile := jsonb_build_object(
      'staff_is_tax_resident', TRUE, 'secondary_employment', FALSE,
      'employment_type', v_type
    );
    v_run := pg_temp.make_ghana_v3_run(
      v_business, DATE '2026-03-01', v_profile,
      CASE WHEN v_type = 'casual'
        THEN 'gh_casual_flat_5' ELSE 'gh_resident_graduated' END
    );
    v_result := public.approve_payroll_run_atomic(v_business, v_run);
    IF COALESCE((v_result->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
      RAISE EXCEPTION 'Supported resident % approval failed: %', v_type, v_result;
    END IF;
  END LOOP;

  -- Supported non-resident split method.
  v_profile := jsonb_build_object(
    'staff_is_tax_resident', FALSE, 'secondary_employment', FALSE,
    'employment_type', 'contract'
  );
  v_run := pg_temp.make_ghana_v3_run(
    v_business, DATE '2026-03-01', v_profile, 'gh_nonresident_split_25_20'
  );
  v_result := public.approve_payroll_run_atomic(v_business, v_run);
  IF COALESCE((v_result->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Supported non-resident approval failed: %', v_result;
  END IF;

  -- Secondary and non-resident casual precedence/support blocks.
  v_run := pg_temp.make_ghana_v3_run(
    v_business, DATE '2026-03-01',
    jsonb_build_object(
      'staff_is_tax_resident', TRUE, 'secondary_employment', TRUE,
      'employment_type', 'permanent'
    ),
    'gh_resident_graduated'
  );
  PERFORM pg_temp.assert_approval_rejected(
    v_business, v_run,
    'secondary_employment_requires_verified_withholding_method'
  );
  v_run := pg_temp.make_ghana_v3_run(
    v_business, DATE '2026-03-01',
    jsonb_build_object(
      'staff_is_tax_resident', FALSE, 'secondary_employment', TRUE,
      'employment_type', 'casual'
    ),
    'gh_casual_flat_5'
  );
  PERFORM pg_temp.assert_approval_rejected(
    v_business, v_run, 'nonresident_casual_worker'
  );

  -- Missing profile and missing method snapshots.
  v_run := pg_temp.make_ghana_v3_run(
    v_business, DATE '2026-03-01', NULL, 'gh_resident_graduated'
  );
  PERFORM pg_temp.assert_approval_rejected(
    v_business, v_run, 'missing_tax_profile_snapshot'
  );
  v_profile := jsonb_build_object(
    'staff_is_tax_resident', TRUE, 'secondary_employment', FALSE,
    'employment_type', 'permanent'
  );
  v_run := pg_temp.make_ghana_v3_run(
    v_business, DATE '2026-03-01', v_profile, NULL
  );
  PERFORM pg_temp.assert_approval_rejected(
    v_business, v_run, 'missing_income_tax_method_snapshot'
  );

  -- Method/profile mismatch, unknown version and unsupported version period.
  v_run := pg_temp.make_ghana_v3_run(
    v_business, DATE '2026-03-01', v_profile, 'gh_casual_flat_5'
  );
  PERFORM pg_temp.assert_approval_rejected(
    v_business, v_run, 'income_tax_method_mismatch'
  );
  v_run := pg_temp.make_ghana_v3_run(
    v_business, DATE '2026-03-01', v_profile,
    'gh_resident_graduated', 'gh-profile-tax-2099-01'
  );
  PERFORM pg_temp.assert_approval_rejected(
    v_business, v_run, 'unknown_profile_tax_version'
  );
  v_run := pg_temp.make_ghana_v3_run(
    v_business, DATE '2027-01-01', v_profile, 'gh_resident_graduated'
  );
  PERFORM pg_temp.assert_approval_rejected(
    v_business, v_run, 'profile_tax_version_does_not_cover_period'
  );

  -- Component mismatch and mixed v2/v3 entry/run evidence.
  v_run := pg_temp.make_ghana_v3_run(
    v_business, DATE '2026-03-01', v_profile, 'gh_resident_graduated'
  );
  UPDATE public.payroll_entries
  SET income_tax_regular_amount = income_tax_regular_amount + 1
  WHERE payroll_run_id = v_run;
  PERFORM pg_temp.assert_approval_rejected(
    v_business, v_run, 'income_tax_component_mismatch'
  );
  v_run := pg_temp.make_ghana_v3_run(
    v_business, DATE '2026-03-01', v_profile, NULL,
    'gh-profile-tax-2024-01', 'finza-ghana-v2'
  );
  PERFORM pg_temp.assert_approval_rejected(v_business, v_run, NULL);

  -- Unknown methods are also fail-closed in the validator. The table CHECK
  -- normally prevents this state; temporarily remove it to exercise defense
  -- in depth. The outer ROLLBACK restores the constraint and all fixtures.
  ALTER TABLE public.payroll_entries
    DROP CONSTRAINT payroll_entries_income_tax_method_check;
  v_run := pg_temp.make_ghana_v3_run(
    v_business, DATE '2026-03-01', v_profile, 'gh_unknown_method'
  );
  PERFORM pg_temp.assert_approval_rejected(
    v_business, v_run, 'unknown_income_tax_method'
  );

  RAISE NOTICE 'PASS migration 560 Ghana v3 approval support matrix';
END;
$test$;

ROLLBACK;
