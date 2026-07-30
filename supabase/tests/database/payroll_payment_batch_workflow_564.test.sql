-- ============================================================================
-- Database tests for migration 564 — batch workflow integration
-- Runs inside a single transaction ending with ROLLBACK.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_biz UUID := gen_random_uuid();
  v_staff_a UUID := gen_random_uuid();
  v_staff_b UUID := gen_random_uuid();
  v_run UUID := gen_random_uuid();
  v_entry_a UUID := gen_random_uuid();
  v_entry_b UUID := gen_random_uuid();
  v_cash UUID := gen_random_uuid();
  v_batch UUID := gen_random_uuid();
  v_item_a UUID := gen_random_uuid();
  v_item_b UUID := gen_random_uuid();
  v_month DATE := DATE '2026-08-01';
  v_pay UUID;
  v_status TEXT;
  v_err TEXT;
  v_ok BOOLEAN;
BEGIN
  SELECT id INTO v_owner FROM auth.users LIMIT 1;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'TEST_SETUP: need auth.users row'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.businesses (id, name, address_country, owner_id, created_at, updated_at)
  VALUES (v_biz, '564 Workflow Test Biz', 'Ghana', v_owner, NOW(), NOW());

  INSERT INTO public.business_users (business_id, user_id, role, created_at)
  VALUES (v_biz, v_owner, 'admin', NOW()) ON CONFLICT DO NOTHING;

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
  VALUES (v_biz, DATE '2026-08-01', DATE '2026-08-31', 'open') ON CONFLICT DO NOTHING;

  INSERT INTO public.staff (id, business_id, name, basic_salary, employment_type, is_tax_resident, secondary_employment)
  VALUES
    (v_staff_a, v_biz, 'Employee A', 500, 'full_time', true, false),
    (v_staff_b, v_biz, 'Employee B', 500, 'full_time', true, false);

  INSERT INTO public.payroll_runs (
    id, business_id, payroll_month, pay_period_start, pay_period_end, status, payroll_frequency,
    total_basic_salary, total_gross_salary, total_allowances, total_ssnit_employee, total_ssnit_employer,
    total_paye, total_deductions, total_net_salary,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis, staff_scope_fingerprint
  ) VALUES (
    v_run, v_biz, v_month, v_month, DATE '2026-08-31', 'approved', 'monthly',
    1000, 1000, 0, 110, 260, 100, 0, 1000,
    'finza-ghana-v2', 'gh-paye-2024-01', 'gh-pension-2026-01', 'GH', v_month, '564-test'
  );

  INSERT INTO public.payroll_entries (
    id, payroll_run_id, staff_id, basic_salary, gross_salary, ssnit_employee, ssnit_employer,
    paye, net_salary, is_included, payroll_tax_profile, filing_tin, filing_employee_name
  ) VALUES
    (v_entry_a, v_run, v_staff_a, 500, 500, 55, 130, 50, 500, true,
     jsonb_build_object('staff_is_tax_resident', true), 'C0000000001', 'Employee A'),
    (v_entry_b, v_run, v_staff_b, 500, 500, 55, 130, 50, 500, true,
     jsonb_build_object('staff_is_tax_resident', true), 'C0000000002', 'Employee B');

  INSERT INTO public.payroll_obligations (
    business_id, payroll_run_id, obligation_type, label, amount_due, amount_paid, status, liability_account_code
  ) VALUES (v_biz, v_run, 'salary_net', 'Net salaries payable', 1000, 0, 'unpaid', '2240');

  INSERT INTO public.payroll_payment_batches (
    id, business_id, payroll_run_id, status, currency, total_amount_snapshot, item_count, created_by
  ) VALUES (v_batch, v_biz, v_run, 'draft', 'GHS', 1000, 2, v_owner);

  INSERT INTO public.payroll_payment_batch_items (
    id, business_id, batch_id, payroll_run_id, payroll_entry_id, staff_id, employee_name,
    amount, currency, status, destination_method_type, destination_bank_name, destination_account_number
  ) VALUES
    (v_item_a, v_biz, v_batch, v_run, v_entry_a, v_staff_a, 'Employee A',
     500, 'GHS', 'pending', 'bank', 'GCB', '1111111111'),
    (v_item_b, v_biz, v_batch, v_run, v_entry_b, v_staff_b, 'Employee B',
     500, 'GHS', 'pending', 'bank', 'GCB', '2222222222');

  -- Draft to ready
  PERFORM public.transition_payroll_payment_batch_status_atomic(v_biz, v_run, v_batch, 'ready');
  SELECT status INTO v_status FROM public.payroll_payment_batches WHERE id = v_batch;
  IF v_status <> 'ready' THEN RAISE EXCEPTION '564 draft->ready failed: %', v_status; END IF;
  RAISE NOTICE 'PASS draft to ready';

  -- Ready to processing (no payment/journal)
  PERFORM public.transition_payroll_payment_batch_status_atomic(v_biz, v_run, v_batch, 'processing');
  SELECT status INTO v_status FROM public.payroll_payment_batches WHERE id = v_batch;
  IF v_status <> 'processing' THEN RAISE EXCEPTION '564 ready->processing failed: %', v_status; END IF;
  IF (SELECT COUNT(*) FROM public.payroll_payments WHERE business_id = v_biz AND payroll_run_id = v_run) <> 0 THEN
    RAISE EXCEPTION '564 processing should not create payments';
  END IF;
  RAISE NOTICE 'PASS ready to processing';

  -- Return to draft blocked after we'll pay item - first pay one item on copy batch
  -- Pending -> failed atomically updates batch
  PERFORM public.transition_payroll_payment_batch_item_status_atomic(v_biz, v_run, v_batch, v_item_a, 'failed', 'test fail');
  SELECT status INTO v_status FROM public.payroll_payment_batch_items WHERE id = v_item_a;
  IF v_status <> 'failed' THEN RAISE EXCEPTION '564 item failed status=%', v_status; END IF;
  SELECT status INTO v_status FROM public.payroll_payment_batches WHERE id = v_batch;
  IF v_status NOT IN ('processing', 'failed', 'partially_paid', 'draft') THEN
    RAISE EXCEPTION '564 batch after item fail unexpected: %', v_status;
  END IF;
  RAISE NOTICE 'PASS pending to failed with batch sync';

  -- Failed -> pending
  PERFORM public.transition_payroll_payment_batch_item_status_atomic(v_biz, v_run, v_batch, v_item_a, 'pending', NULL);
  SELECT status INTO v_status FROM public.payroll_payment_batch_items WHERE id = v_item_a;
  IF v_status <> 'pending' THEN RAISE EXCEPTION '564 failed->pending failed'; END IF;
  RAISE NOTICE 'PASS failed to pending';

  -- Pay item A via atomic payment
  PERFORM public.record_payroll_batch_item_payment_atomic(
    v_biz, v_run, v_batch, v_item_a, DATE '2026-08-15', v_cash, 'A', NULL, '564-batch-key-item-a-xx'
  );
  SELECT status INTO v_status FROM public.payroll_payment_batches WHERE id = v_batch;
  IF v_status <> 'partially_paid' THEN RAISE EXCEPTION '564 partial batch status=%', v_status; END IF;

  -- Cancel blocked with posted payment
  v_ok := FALSE;
  BEGIN
    PERFORM public.transition_payroll_payment_batch_status_atomic(v_biz, v_run, v_batch, 'cancelled');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err ILIKE '%PAYROLL_BATCH_HAS_POSTED_PAYMENTS%' THEN v_ok := TRUE; END IF;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '564 cancel with payment not blocked: %', v_err; END IF;
  RAISE NOTICE 'PASS cancel blocked with posted payment';

  -- Pay item B
  PERFORM public.record_payroll_batch_item_payment_atomic(
    v_biz, v_run, v_batch, v_item_b, DATE '2026-08-16', v_cash, 'B', NULL, '564-batch-key-item-b-xx'
  );
  SELECT status INTO v_status FROM public.payroll_payment_batches WHERE id = v_batch;
  IF v_status <> 'paid' THEN RAISE EXCEPTION '564 full batch status=%', v_status; END IF;
  RAISE NOTICE 'PASS full batch paid';

  -- Direct table mutation blocked
  v_ok := FALSE;
  BEGIN
    UPDATE public.payroll_payment_batches SET status = 'draft' WHERE id = v_batch;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err ILIKE '%PAYROLL_BATCH_%' THEN v_ok := TRUE; END IF;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '564 direct batch mutation not blocked: %', COALESCE(v_err, 'succeeded'); END IF;
  RAISE NOTICE 'PASS direct batch mutation blocked';

  -- Item paid immutable
  v_ok := FALSE;
  BEGIN
    PERFORM public.transition_payroll_payment_batch_item_status_atomic(v_biz, v_run, v_batch, v_item_a, 'failed', NULL);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err ILIKE '%PAYROLL_BATCH_ITEM_%' THEN v_ok := TRUE; END IF;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '564 paid item mutation not blocked: %', v_err; END IF;
  RAISE NOTICE 'PASS paid item immutable';

  -- Unpaid batch cancel on fresh batch (new run — paid batch above still occupies active slot on v_run)
  v_run := gen_random_uuid();
  INSERT INTO public.payroll_runs (
    id, business_id, payroll_month, pay_period_start, pay_period_end, status, payroll_frequency,
    total_basic_salary, total_gross_salary, total_allowances, total_ssnit_employee, total_ssnit_employer,
    total_paye, total_deductions, total_net_salary,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis, staff_scope_fingerprint
  ) VALUES (
    v_run, v_biz, v_month, v_month, DATE '2026-08-31', 'approved', 'monthly',
    500, 500, 0, 55, 130, 50, 0, 500,
    'finza-ghana-v2', 'gh-paye-2024-01', 'gh-pension-2026-01', 'GH', v_month, '564-test-cancel'
  );
  INSERT INTO public.payroll_obligations (
    business_id, payroll_run_id, obligation_type, label, amount_due, amount_paid, status, liability_account_code
  ) VALUES (v_biz, v_run, 'salary_net', 'Net salaries payable', 500, 0, 'unpaid', '2240');

  v_batch := gen_random_uuid();
  v_item_a := gen_random_uuid();
  INSERT INTO public.payroll_payment_batches (
    id, business_id, payroll_run_id, status, currency, total_amount_snapshot, item_count, created_by
  ) VALUES (v_batch, v_biz, v_run, 'draft', 'GHS', 500, 1, v_owner);
  INSERT INTO public.payroll_payment_batch_items (
    id, business_id, batch_id, payroll_run_id, payroll_entry_id, staff_id, employee_name,
    amount, currency, status, destination_method_type, destination_bank_name, destination_account_number
  ) VALUES (
    v_item_a, v_biz, v_batch, v_run, v_entry_a, v_staff_a, 'Employee A',
    500, 'GHS', 'pending', 'bank', 'GCB', '1111111111'
  );
  PERFORM public.transition_payroll_payment_batch_status_atomic(v_biz, v_run, v_batch, 'ready');
  PERFORM public.transition_payroll_payment_batch_status_atomic(v_biz, v_run, v_batch, 'cancelled');
  SELECT status INTO v_status FROM public.payroll_payment_batches WHERE id = v_batch;
  IF v_status <> 'cancelled' THEN RAISE EXCEPTION '564 unpaid cancel failed'; END IF;
  RAISE NOTICE 'PASS unpaid batch cancel';

  RAISE NOTICE 'ALL 564 WORKFLOW TESTS PASSED';
END;
$$;

ROLLBACK;
