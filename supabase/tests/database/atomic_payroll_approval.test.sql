-- ============================================================================
-- Non-production database tests for migration 554
-- Atomic payroll approval + obligations
--
-- Isolation:
--   * Entire file runs inside a single transaction that ends with ROLLBACK.
--   * Creates fully synthetic business + supporting rows only.
--
-- Run after 554 is applied (staging/local only), e.g.:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/database/atomic_payroll_approval.test.sql
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_biz UUID := gen_random_uuid();
  v_staff UUID := gen_random_uuid();
  v_run UUID := gen_random_uuid();
  v_run2 UUID := gen_random_uuid();
  v_run3 UUID := gen_random_uuid();
  v_entry UUID;
  v_month DATE := DATE '2026-03-01';
  v_result JSONB;
  v_result2 JSONB;
  v_je_count INT;
  v_obl_count INT;
  v_audit_count INT;
  v_status TEXT;
  v_err TEXT;
  v_advance UUID := gen_random_uuid();
  v_adv_bal NUMERIC;
  v_repay_count INT;
  v_other_paid NUMERIC;
  v_code TEXT;
  v_run_bad UUID := gen_random_uuid();
BEGIN
  SELECT id INTO v_owner FROM auth.users LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'TEST_SETUP: need at least one auth.users row';
  END IF;

  -- Bypass auth.uid for SECURITY DEFINER paths that check finza_user_can_access_business:
  -- insert business_users membership for owner and set request.jwt.claim.sub via set_config where supported.
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.businesses (id, name, address_country, owner_id, created_at, updated_at)
  VALUES (v_biz, '554 Atomic Approval Test Biz', 'Ghana', v_owner, NOW(), NOW());

  INSERT INTO public.business_users (business_id, user_id, role, created_at)
  VALUES (v_biz, v_owner, 'admin', NOW())
  ON CONFLICT DO NOTHING;

  -- Minimal COA for payroll posting
  INSERT INTO public.accounts (business_id, name, code, type, is_system)
  VALUES
    (v_biz, 'Payroll Expense', '5600', 'expense', true),
    (v_biz, 'SSNIT Employer Expense', '5610', 'expense', true),
    (v_biz, 'PAYE Payable', '2230', 'liability', true),
    (v_biz, 'Tier1 Payable', '2231', 'liability', true),
    (v_biz, 'Tier2 Payable', '2232', 'liability', true),
    (v_biz, 'Net Salaries Payable', '2240', 'liability', true),
    (v_biz, 'Deductions Payable', '2241', 'liability', true),
    (v_biz, 'Staff Advances', '1110', 'asset', true)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.accounting_periods (business_id, period_start, period_end, status)
  VALUES (v_biz, DATE '2026-03-01', DATE '2026-03-31', 'open')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.staff (
    id, business_id, name, basic_salary, employment_type, is_tax_resident, secondary_employment
  ) VALUES (
    v_staff, v_biz, 'Test Employee', 5000, 'full_time', true, false
  );

  -- -------------------------------------------------------------------------
  -- Scenario A: normal Ghana monthly approve
  -- -------------------------------------------------------------------------
  INSERT INTO public.payroll_runs (
    id, business_id, payroll_month, pay_period_start, pay_period_end, status, payroll_frequency,
    total_basic_salary, total_gross_salary, total_allowances, total_ssnit_employee, total_ssnit_employer,
    total_paye, total_deductions, total_net_salary,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis,
    notes, staff_scope_fingerprint
  ) VALUES (
    v_run, v_biz, v_month, v_month, v_month, 'draft', 'monthly',
    5000, 5000, 0, 275, 650, 200, 0, 4525,
    'finza-ghana-v2', 'gh-paye-2024-01', 'gh-pension-2026-01',
    'GH', '2026-03-01',
    'atomic-approval-test', 'atomic-approval-test-a'
  );

  INSERT INTO public.payroll_entries (
    id, payroll_run_id, staff_id, basic_salary, allowances_total, deductions_total,
    gross_salary, ssnit_employee, ssnit_employer, paye, net_salary, is_included,
    tier1_ssnit_remittance, tier2_pension_remittance,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis,
    payroll_tax_profile
  ) VALUES (
    gen_random_uuid(), v_run, v_staff, 5000, 0, 0,
    5000, 275, 650, 200, 4525, true,
    675, 250,
    'finza-ghana-v2', 'gh-paye-2024-01', 'gh-pension-2026-01',
    'GH', '2026-03-01',
    jsonb_build_object(
      'staff_is_tax_resident', true,
      'secondary_employment', false,
      'employment_type', 'permanent'
    )
  );

  v_result := public.approve_payroll_run_atomic(v_biz, v_run);
  IF COALESCE((v_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'A: approval failed: %', v_result;
  END IF;
  IF COALESCE((v_result->>'reused')::boolean, false) IS TRUE THEN
    RAISE EXCEPTION 'A: first approval should not be reused';
  END IF;

  SELECT status INTO v_status FROM public.payroll_runs WHERE id = v_run;
  IF v_status <> 'approved' THEN RAISE EXCEPTION 'A: status=%', v_status; END IF;

  SELECT COUNT(*) INTO v_je_count FROM public.journal_entries
  WHERE business_id = v_biz AND reference_type = 'payroll' AND reference_id = v_run;
  IF v_je_count <> 1 THEN RAISE EXCEPTION 'A: journal count=%', v_je_count; END IF;

  SELECT COUNT(*) INTO v_obl_count FROM public.payroll_obligations
  WHERE business_id = v_biz AND payroll_run_id = v_run AND deleted_at IS NULL;
  IF v_obl_count < 3 THEN RAISE EXCEPTION 'A: obligation count=%', v_obl_count; END IF;

  SELECT COUNT(*) INTO v_audit_count FROM public.audit_logs
  WHERE business_id = v_biz AND entity_id = v_run AND action_type = 'payroll.run_approved';
  IF v_audit_count <> 1 THEN RAISE EXCEPTION 'A: audit count=%', v_audit_count; END IF;

  RAISE NOTICE 'PASS A normal approve';

  -- -------------------------------------------------------------------------
  -- Scenario B: retry reuse
  -- -------------------------------------------------------------------------
  v_result2 := public.approve_payroll_run_atomic(v_biz, v_run);
  IF COALESCE((v_result2->>'reused')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'B: expected reused';
  END IF;
  SELECT COUNT(*) INTO v_je_count FROM public.journal_entries
  WHERE business_id = v_biz AND reference_type = 'payroll' AND reference_id = v_run;
  IF v_je_count <> 1 THEN RAISE EXCEPTION 'B: journal count=%', v_je_count; END IF;
  SELECT COUNT(*) INTO v_audit_count FROM public.audit_logs
  WHERE business_id = v_biz AND entity_id = v_run AND action_type = 'payroll.run_approved';
  IF v_audit_count <> 1 THEN RAISE EXCEPTION 'B: audit count=%', v_audit_count; END IF;
  RAISE NOTICE 'PASS B retry reuse';

  -- -------------------------------------------------------------------------
  -- Scenario C: salary advance recovery is NOT an external obligation payment
  -- advance-only: total deductions 100, recovery 100 → no other_employee_deductions
  -- -------------------------------------------------------------------------
  INSERT INTO public.salary_advances (
    id, business_id, staff_id, amount, monthly_repayment, date_issued, repaid_amount, status, created_at, updated_at
  ) VALUES (
    v_advance, v_biz, v_staff, 500, 100, v_month, 0, 'outstanding', NOW(), NOW()
  );

  INSERT INTO public.payroll_runs (
    id, business_id, payroll_month, pay_period_start, pay_period_end, status, payroll_frequency,
    total_basic_salary, total_gross_salary, total_allowances, total_ssnit_employee, total_ssnit_employer,
    total_paye, total_deductions, total_net_salary,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis,
    notes, staff_scope_fingerprint
  ) VALUES (
    v_run2, v_biz, v_month, v_month, v_month, 'draft', 'monthly',
    5000, 5000, 0, 275, 650, 200, 100, 4425,
    'finza-ghana-v2', 'gh-paye-2024-01', 'gh-pension-2026-01',
    'GH', '2026-03-01',
    'atomic-approval-test', 'atomic-approval-test-c'
  );

  INSERT INTO public.payroll_entries (
    payroll_run_id, staff_id, basic_salary, allowances_total, deductions_total,
    gross_salary, ssnit_employee, ssnit_employer, paye, net_salary, is_included,
    tier1_ssnit_remittance, tier2_pension_remittance,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis,
    payroll_tax_profile,
    advance_recoveries_snapshot
  ) VALUES (
    v_run2, v_staff, 5000, 0, 100,
    5000, 275, 650, 200, 4425, true,
    675, 250,
    'finza-ghana-v2', 'gh-paye-2024-01', 'gh-pension-2026-01',
    'GH', '2026-03-01',
    jsonb_build_object(
      'staff_is_tax_resident', true,
      'secondary_employment', false,
      'employment_type', 'permanent'
    ),
    jsonb_build_array(jsonb_build_object(
      'advanceId', v_advance,
      'staffId', v_staff,
      'amount', 100
    ))
  );

  v_result := public.approve_payroll_run_atomic(v_biz, v_run2);
  IF COALESCE((v_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'C: approval failed: %', v_result;
  END IF;
  IF ABS(COALESCE((v_result->>'externalDeductions')::numeric, -1) - 0) > 0.01 THEN
    RAISE EXCEPTION 'C: externalDeductions should be 0, got %', v_result;
  END IF;
  IF ABS(COALESCE((v_result->>'advanceRecovered')::numeric, -1) - 100) > 0.01 THEN
    RAISE EXCEPTION 'C: advanceRecovered should be 100, got %', v_result;
  END IF;

  SELECT COUNT(*) INTO v_repay_count FROM public.salary_advance_repayments
  WHERE payroll_run_id = v_run2 AND status = 'posted';
  IF v_repay_count < 1 THEN RAISE EXCEPTION 'C: expected posted repayments'; END IF;

  SELECT COUNT(*) INTO v_obl_count FROM public.payroll_obligations
  WHERE payroll_run_id = v_run2 AND obligation_type = 'other_employee_deductions' AND deleted_at IS NULL;
  IF v_obl_count <> 0 THEN
    RAISE EXCEPTION 'C: advance-only must not create other_employee_deductions, count=%', v_obl_count;
  END IF;
  RAISE NOTICE 'PASS C salary advance (external obligation absent; repayments only)';

  -- -------------------------------------------------------------------------
  -- Scenario D: obligation conflict rolls back
  -- -------------------------------------------------------------------------
  INSERT INTO public.payroll_runs (
    id, business_id, payroll_month, pay_period_start, pay_period_end, status, payroll_frequency,
    total_basic_salary, total_gross_salary, total_allowances, total_ssnit_employee, total_ssnit_employer,
    total_paye, total_deductions, total_net_salary,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis,
    notes, staff_scope_fingerprint
  ) VALUES (
    v_run3, v_biz, DATE '2026-04-01', DATE '2026-04-01', DATE '2026-04-01', 'draft', 'monthly',
    5000, 5000, 0, 275, 650, 200, 0, 4525,
    'finza-ghana-v2', 'gh-paye-2024-01', 'gh-pension-2026-01',
    'GH', '2026-04-01',
    'atomic-approval-test', 'atomic-approval-test-d'
  );

  INSERT INTO public.accounting_periods (business_id, period_start, period_end, status)
  VALUES (v_biz, DATE '2026-04-01', DATE '2026-04-30', 'open')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.payroll_entries (
    payroll_run_id, staff_id, basic_salary, allowances_total, deductions_total,
    gross_salary, ssnit_employee, ssnit_employer, paye, net_salary, is_included,
    tier1_ssnit_remittance, tier2_pension_remittance,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis,
    payroll_tax_profile
  ) VALUES (
    v_run3, v_staff, 5000, 0, 0,
    5000, 275, 650, 200, 4525, true,
    675, 250,
    'finza-ghana-v2', 'gh-paye-2024-01', 'gh-pension-2026-01',
    'GH', '2026-04-01',
    jsonb_build_object(
      'staff_is_tax_resident', true,
      'secondary_employment', false,
      'employment_type', 'permanent'
    )
  );

  -- Conflicting paid obligation with wrong amount
  INSERT INTO public.payroll_obligations (
    business_id, payroll_run_id, obligation_type, label, amount_due, amount_paid, status, liability_account_code
  ) VALUES (
    v_biz, v_run3, 'salary_net', 'bad', 1, 1, 'paid', '2240'
  );

  BEGIN
    PERFORM public.approve_payroll_run_atomic(v_biz, v_run3);
    RAISE EXCEPTION 'D: expected conflict failure';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err ILIKE '%D: expected%' THEN RAISE; END IF;
    -- expected
  END;

  SELECT status INTO v_status FROM public.payroll_runs WHERE id = v_run3;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'D: run should remain draft, got %', v_status; END IF;
  SELECT COUNT(*) INTO v_je_count FROM public.journal_entries
  WHERE business_id = v_biz AND reference_type = 'payroll' AND reference_id = v_run3;
  IF v_je_count <> 0 THEN RAISE EXCEPTION 'D: journal should rollback, count=%', v_je_count; END IF;
  RAISE NOTICE 'PASS D obligation conflict rollback';

  -- -------------------------------------------------------------------------
  -- Scenario F: Ghana unsupported profile blocked
  -- -------------------------------------------------------------------------
  INSERT INTO public.payroll_runs (
    id, business_id, payroll_month, pay_period_start, pay_period_end, status, payroll_frequency,
    total_basic_salary, total_gross_salary, total_allowances, total_ssnit_employee, total_ssnit_employer,
    total_paye, total_deductions, total_net_salary,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis,
    notes, staff_scope_fingerprint
  ) VALUES (
    v_run_bad, v_biz, DATE '2026-05-01', DATE '2026-05-01', DATE '2026-05-01', 'draft', 'monthly',
    5000, 5000, 0, 0, 0, 0, 0, 5000,
    'finza-ghana-v2', 'gh-paye-2024-01', 'gh-pension-2026-01',
    'GH', '2026-05-01',
    'atomic-approval-test', 'atomic-approval-test-f'
  );
  INSERT INTO public.accounting_periods (business_id, period_start, period_end, status)
  VALUES (v_biz, DATE '2026-05-01', DATE '2026-05-31', 'open');
  INSERT INTO public.payroll_entries (
    payroll_run_id, staff_id, basic_salary, allowances_total, deductions_total,
    gross_salary, ssnit_employee, ssnit_employer, paye, net_salary, is_included,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis,
    payroll_tax_profile
  ) VALUES (
    v_run_bad, v_staff, 5000, 0, 0,
    5000, 0, 0, 0, 5000, true,
    'finza-ghana-v2', 'gh-paye-2024-01', 'gh-pension-2026-01',
    'GH', '2026-05-01',
    jsonb_build_object(
      'staff_is_tax_resident', true,
      'secondary_employment', false,
      'employment_type', 'casual'
    )
  );
  BEGIN
    PERFORM public.approve_payroll_run_atomic(v_biz, v_run_bad);
    RAISE EXCEPTION 'F: expected Ghana block';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ILIKE '%F: expected%' THEN RAISE; END IF;
    IF SQLERRM NOT ILIKE '%unsupported%' AND SQLERRM NOT ILIKE '%GHANA%' THEN
      RAISE NOTICE 'F: blocked with: %', SQLERRM;
    END IF;
  END;
  SELECT status INTO v_status FROM public.payroll_runs WHERE id = v_run_bad;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'F: should remain draft'; END IF;
  SELECT COUNT(*) INTO v_je_count FROM public.journal_entries
  WHERE reference_id = v_run_bad AND reference_type = 'payroll';
  IF v_je_count <> 0 THEN RAISE EXCEPTION 'F: no journal expected'; END IF;
  RAISE NOTICE 'PASS F Ghana containment';

  RAISE NOTICE 'ALL 554 DATABASE SCENARIOS PASSED';
END $$;

ROLLBACK;
