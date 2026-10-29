-- ============================================================================
-- Database tests for migration 610
-- Exact two-decimal salary instructions and export-only batch permissions.
-- Runs in one transaction and rolls back.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_export_user UUID;
  v_biz UUID := gen_random_uuid();
  v_staff UUID := gen_random_uuid();
  v_run UUID := gen_random_uuid();
  v_entry UUID := gen_random_uuid();
  v_cash UUID := gen_random_uuid();
  v_batch UUID := gen_random_uuid();
  v_month DATE := DATE '2026-07-01';
  v_status TEXT;
  v_export_result JSONB;
  v_filename TEXT;
  v_count INT;
  v_err TEXT;
  v_ok BOOLEAN;
BEGIN
  SELECT u.id INTO v_owner
  FROM public.users u
  JOIN auth.users a ON a.id = u.id
  LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'TEST_SETUP: need a public.users row that also exists in auth.users';
  END IF;

  SELECT u.id INTO v_export_user
  FROM public.users u
  JOIN auth.users a ON a.id = u.id
  WHERE u.id <> v_owner
  LIMIT 1;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.businesses (id, name, address_country, owner_id, created_at, updated_at)
  VALUES (v_biz, '610 Payment Amount Test', 'Ghana', v_owner, NOW(), NOW());

  INSERT INTO public.business_users (business_id, user_id, role, created_at)
  VALUES (v_biz, v_owner, 'admin', NOW()) ON CONFLICT DO NOTHING;

  IF v_export_user IS NOT NULL THEN
    INSERT INTO public.business_users (business_id, user_id, role, custom_permissions, created_at)
    VALUES (
      v_biz, v_export_user, 'accountant',
      jsonb_build_object('granted', jsonb_build_array('payroll.export'), 'revoked', jsonb_build_array('payroll.pay')),
      NOW()
    ) ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.accounts (id, business_id, name, code, type, sub_type, is_system)
  VALUES
    (gen_random_uuid(), v_biz, 'Payroll Expense', '5600', 'expense', NULL, true),
    (gen_random_uuid(), v_biz, 'SSNIT Employer Expense', '5610', 'expense', NULL, true),
    (gen_random_uuid(), v_biz, 'PAYE Payable', '2230', 'liability', NULL, true),
    (gen_random_uuid(), v_biz, 'Tier1 Payable', '2231', 'liability', NULL, true),
    (gen_random_uuid(), v_biz, 'Tier2 Payable', '2232', 'liability', NULL, true),
    (gen_random_uuid(), v_biz, 'Net Salaries Payable', '2240', 'liability', NULL, true),
    (gen_random_uuid(), v_biz, 'Deductions Payable', '2241', 'liability', NULL, true),
    (v_cash, v_biz, 'Cash', '1000', 'asset', 'cash', true);

  INSERT INTO public.accounting_periods (business_id, period_start, period_end, status)
  VALUES (v_biz, DATE '2026-07-01', DATE '2026-07-31', 'open') ON CONFLICT DO NOTHING;

  INSERT INTO public.staff (id, business_id, name, basic_salary, employment_type, is_tax_resident, secondary_employment)
  VALUES (v_staff, v_biz, 'Amount Test Employee', 500, 'full_time', true, false);

  INSERT INTO public.payroll_runs (
    id, business_id, payroll_month, pay_period_start, pay_period_end, status, payroll_frequency,
    total_basic_salary, total_gross_salary, total_allowances, total_ssnit_employee, total_ssnit_employer,
    total_paye, total_deductions, total_net_salary,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis, staff_scope_fingerprint
  ) VALUES (
    v_run, v_biz, v_month, v_month, DATE '2026-07-31', 'approved', 'monthly',
    500, 500, 0, 55, 130, 50, 0, 500,
    'finza-ghana-v2', 'gh-paye-2024-01', 'gh-pension-2026-01', 'GH', v_month, '610-test'
  );

  INSERT INTO public.payroll_entries (
    id, payroll_run_id, staff_id, basic_salary, gross_salary, ssnit_employee, ssnit_employer,
    paye, net_salary, is_included, payroll_tax_profile, filing_tin, filing_employee_name
  ) VALUES (
    v_entry, v_run, v_staff, 500, 500, 55, 130, 50, 500, true,
    jsonb_build_object('staff_is_tax_resident', true), 'C0000000610', 'Amount Test Employee'
  );

  INSERT INTO public.payroll_obligations (
    business_id, payroll_run_id, obligation_type, label, amount_due, amount_paid, status, liability_account_code
  ) VALUES (v_biz, v_run, 'salary_net', 'Net salaries payable', 500, 0, 'unpaid', '2240');

  INSERT INTO public.payroll_payment_batches (
    id, business_id, payroll_run_id, status, currency, total_amount_snapshot, item_count, created_by
  ) VALUES (v_batch, v_biz, v_run, 'ready', 'GHS', 500, 1, v_owner);

  -- 1) A GH₵0.01 difference is rejected
  v_ok := FALSE;
  BEGIN
    INSERT INTO public.payroll_payment_batch_items (
      business_id, batch_id, payroll_run_id, payroll_entry_id, staff_id, employee_name,
      amount, currency, status, destination_method_type, destination_bank_name, destination_account_number
    ) VALUES (
      v_biz, v_batch, v_run, v_entry, v_staff, 'Amount Test Employee',
      500.01, 'GHS', 'pending', 'bank', 'GCB', '1111111111'
    );
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err ILIKE '%PAYROLL_BATCH_AMOUNT_MISMATCH%' THEN v_ok := TRUE; END IF;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '610 s1: GH₵0.01 difference accepted: %', v_err; END IF;
  RAISE NOTICE 'PASS 610 s1: GH₵0.01 difference rejected';

  -- 2) Unsupported fractional pesewas are rejected
  v_ok := FALSE;
  BEGIN
    INSERT INTO public.payroll_payment_batch_items (
      business_id, batch_id, payroll_run_id, payroll_entry_id, staff_id, employee_name,
      amount, currency, status, destination_method_type, destination_bank_name, destination_account_number
    ) VALUES (
      v_biz, v_batch, v_run, v_entry, v_staff, 'Amount Test Employee',
      500.005, 'GHS', 'pending', 'bank', 'GCB', '1111111111'
    );
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err ILIKE '%PAYROLL_BATCH_AMOUNT_PRECISION_INVALID%'
       OR v_err ILIKE '%amount_two_decimal_check%'
    THEN
      v_ok := TRUE;
    END IF;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '610 s2: fractional pesewa accepted: %', v_err; END IF;
  RAISE NOTICE 'PASS 610 s2: fractional pesewa rejected';

  -- 3) Exact two-decimal match is accepted
  INSERT INTO public.payroll_payment_batch_items (
    business_id, batch_id, payroll_run_id, payroll_entry_id, staff_id, employee_name,
    amount, currency, status, destination_method_type, destination_bank_name, destination_account_number
  ) VALUES (
    v_biz, v_batch, v_run, v_entry, v_staff, 'Amount Test Employee',
    500.00, 'GHS', 'pending', 'bank', 'GCB', '1111111111'
  );
  RAISE NOTICE 'PASS 610 s3: exact two-decimal match accepted';

  -- 4) Export-only users cannot update batch headers directly
  IF v_export_user IS NULL THEN
    RAISE NOTICE 'SKIP 610 s4-s6: no second auth/public user available';
  ELSE
    PERFORM set_config('request.jwt.claim.sub', v_export_user::text, true);
    SET LOCAL ROLE authenticated;

    UPDATE public.payroll_payment_batches
    SET notes = 'export-only tamper'
    WHERE id = v_batch;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 0 THEN
      RAISE EXCEPTION '610 s4: export-only user updated batch header';
    END IF;

    UPDATE public.payroll_payment_batches
    SET export_filename = 'tamper.csv'
    WHERE id = v_batch;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 0 THEN
      RAISE EXCEPTION '610 s4: export-only user updated export filename directly';
    END IF;
    RAISE NOTICE 'PASS 610 s4: export-only direct batch updates blocked';

    -- 5) The restricted export-recording RPC is allowed and only sets metadata
    SELECT public.record_payroll_payment_batch_export(
      v_biz, v_batch, 'payroll-batch-export.csv'
    ) INTO v_export_result;

    SELECT export_filename INTO v_filename
    FROM public.payroll_payment_batches
    WHERE id = v_batch;
    IF v_filename IS DISTINCT FROM 'payroll-batch-export.csv' THEN
      RAISE EXCEPTION '610 s5: export filename not recorded: %', v_filename;
    END IF;

    IF (SELECT status FROM public.payroll_payment_batches WHERE id = v_batch) <> 'ready' THEN
      RAISE EXCEPTION '610 s5: export RPC changed batch status';
    END IF;
    RAISE NOTICE 'PASS 610 s5: export metadata RPC allowed, batch state unchanged';

    -- 6) Export-only cannot drive controlled payment workflow
    v_ok := FALSE;
    BEGIN
      PERFORM public.transition_payroll_payment_batch_status_atomic(
        v_biz, v_run, v_batch, 'processing'
      );
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err ILIKE '%PAYROLL_PAYMENT_PERMISSION_DENIED%' THEN v_ok := TRUE; END IF;
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION '610 s6: export-only user transitioned batch: %', v_err;
    END IF;
    RAISE NOTICE 'PASS 610 s6: export-only payment workflow denied';

    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  END IF;

  -- 7) Authorized payroll owner can still manage the controlled workflow
  PERFORM public.transition_payroll_payment_batch_status_atomic(
    v_biz, v_run, v_batch, 'processing'
  );
  SELECT status INTO v_status FROM public.payroll_payment_batches WHERE id = v_batch;
  IF v_status <> 'processing' THEN
    RAISE EXCEPTION '610 s7: authorized batch transition failed: %', v_status;
  END IF;
  RAISE NOTICE 'PASS 610 s7: authorized batch workflow still works';

  RAISE NOTICE 'ALL 610 TESTS PASSED';
END;
$$;

ROLLBACK;
