-- ============================================================================
-- Database tests for migration 562 — payroll integrity hardening (post-563)
-- Runs inside a single transaction ending with ROLLBACK.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_biz UUID := gen_random_uuid();
  v_staff UUID := gen_random_uuid();
  v_run UUID := gen_random_uuid();
  v_run_batch UUID := gen_random_uuid();
  v_entry UUID := gen_random_uuid();
  v_entry_a UUID := gen_random_uuid();
  v_entry_b UUID := gen_random_uuid();
  v_cash UUID := gen_random_uuid();
  v_batch UUID := gen_random_uuid();
  v_item_a UUID := gen_random_uuid();
  v_item_b UUID := gen_random_uuid();
  v_month DATE := DATE '2026-06-01';
  v_pay JSONB;
  v_pay2 JSONB;
  v_status TEXT;
  v_obl_paid NUMERIC;
  v_obl_status TEXT;
  v_je_count INT;
  v_pay_count INT;
  v_err TEXT;
  v_overpay_ok BOOLEAN := FALSE;
  v_imm_ok BOOLEAN := FALSE;
  v_pay_a UUID;
  v_pay_b UUID;
BEGIN
  SELECT id INTO v_owner FROM auth.users LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'TEST_SETUP: need auth.users row';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.businesses (id, name, address_country, owner_id, created_at, updated_at)
  VALUES (v_biz, '562 Integrity Test Biz', 'Ghana', v_owner, NOW(), NOW());

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
  VALUES (v_biz, DATE '2026-06-01', DATE '2026-06-30', 'open')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.staff (id, business_id, name, basic_salary, employment_type, is_tax_resident, secondary_employment)
  VALUES (v_staff, v_biz, 'Pay Test Employee', 1000, 'full_time', true, false);

  INSERT INTO public.payroll_runs (
    id, business_id, payroll_month, pay_period_start, pay_period_end, status, payroll_frequency,
    total_basic_salary, total_gross_salary, total_allowances, total_ssnit_employee, total_ssnit_employer,
    total_paye, total_deductions, total_net_salary,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis, staff_scope_fingerprint
  ) VALUES (
    v_run, v_biz, v_month, v_month, DATE '2026-06-30', 'approved', 'monthly',
    1000, 1000, 0, 55, 130, 50, 0, 1000,
    'finza-ghana-v2', 'gh-paye-2024-01', 'gh-pension-2026-01', 'GH', v_month, '562-test'
  );

  INSERT INTO public.payroll_entries (
    id, payroll_run_id, staff_id, basic_salary, gross_salary, ssnit_employee, ssnit_employer,
    paye, net_salary, is_included, payroll_tax_profile, filing_tin, filing_employee_name
  ) VALUES (
    v_entry, v_run, v_staff, 1000, 1000, 55, 130, 50, 1000, true,
    jsonb_build_object('staff_is_tax_resident', true, 'employment_type', 'permanent'),
    'C0000000001', 'Pay Test Employee'
  );

  INSERT INTO public.payroll_obligations (
    business_id, payroll_run_id, obligation_type, label, amount_due, amount_paid, status, liability_account_code
  ) VALUES (
    v_biz, v_run, 'salary_net', 'Net salaries payable', 1000, 0, 'unpaid', '2240'
  );

  -- Batch-item atomic payment tests on separate run (two GHS 500 items)
  INSERT INTO public.payroll_runs (
    id, business_id, payroll_month, pay_period_start, pay_period_end, status, payroll_frequency,
    total_basic_salary, total_gross_salary, total_allowances, total_ssnit_employee, total_ssnit_employer,
    total_paye, total_deductions, total_net_salary,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis, staff_scope_fingerprint
  ) VALUES (
    v_run_batch, v_biz, v_month, v_month, DATE '2026-06-30', 'approved', 'monthly',
    1000, 1000, 0, 110, 260, 100, 0, 1000,
    'finza-ghana-v2', 'gh-paye-2024-01', 'gh-pension-2026-01', 'GH', v_month, '562-batch-test'
  );

  INSERT INTO public.payroll_entries (
    id, payroll_run_id, staff_id, basic_salary, gross_salary, ssnit_employee, ssnit_employer,
    paye, net_salary, is_included, payroll_tax_profile, filing_tin, filing_employee_name
  ) VALUES
    (v_entry_a, v_run_batch, v_staff, 500, 500, 55, 130, 50, 500, true,
     jsonb_build_object('staff_is_tax_resident', true), 'C0000000001', 'Pay Test Employee A'),
    (v_entry_b, v_run_batch, v_staff, 500, 500, 55, 130, 50, 500, true,
     jsonb_build_object('staff_is_tax_resident', true), 'C0000000002', 'Pay Test Employee B');

  INSERT INTO public.payroll_obligations (
    business_id, payroll_run_id, obligation_type, label, amount_due, amount_paid, status, liability_account_code
  ) VALUES (
    v_biz, v_run_batch, 'salary_net', 'Net salaries payable', 1000, 0, 'unpaid', '2240'
  );

  INSERT INTO public.payroll_payment_batches (
    id, business_id, payroll_run_id, status, currency, total_amount_snapshot, item_count, created_by
  ) VALUES (v_batch, v_biz, v_run_batch, 'ready', 'GHS', 1000, 2, v_owner);

  INSERT INTO public.payroll_payment_batch_items (
    id, business_id, batch_id, payroll_run_id, payroll_entry_id, staff_id, employee_name,
    amount, currency, status, destination_method_type, destination_bank_name, destination_account_number
  ) VALUES
    (v_item_a, v_biz, v_batch, v_run_batch, v_entry_a, v_staff, 'Pay Test Employee A',
     500, 'GHS', 'pending', 'bank', 'GCB', '1111111111'),
    (v_item_b, v_biz, v_batch, v_run_batch, v_entry_b, v_staff, 'Pay Test Employee B',
     500, 'GHS', 'pending', 'bank', 'GCB', '2222222222');

  v_imm_ok := FALSE;
  BEGIN
    UPDATE public.payroll_payment_batch_items SET status = 'paid' WHERE id = v_item_a;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err ILIKE '%PAYROLL_BATCH_ITEM_PAYMENT_REQUIRED%' THEN
      v_imm_ok := TRUE;
    END IF;
  END;
  IF NOT v_imm_ok THEN RAISE EXCEPTION '562 batch status-only unexpected: %', v_err; END IF;
  RAISE NOTICE 'PASS status-only paid rejected on pending item';

  v_pay := public.record_payroll_batch_item_payment_atomic(
    v_biz, v_run_batch, v_batch, v_item_a, DATE '2026-06-15', v_cash, 'BATCH-A', NULL, '562-batch-key-item-a'
  );
  v_pay_a := (v_pay->>'payment_id')::UUID;

  SELECT status INTO v_status FROM public.payroll_payment_batches WHERE id = v_batch;
  IF v_status <> 'partially_paid' THEN RAISE EXCEPTION '562 batch partial status=%', v_status; END IF;

  SELECT amount_paid INTO v_obl_paid FROM public.payroll_obligations
  WHERE business_id = v_biz AND payroll_run_id = v_run_batch AND obligation_type = 'salary_net';
  IF ABS(v_obl_paid - 500) > 0.01 THEN RAISE EXCEPTION '562 batch partial obl=%', v_obl_paid; END IF;
  RAISE NOTICE 'PASS batch partial payment';

  v_pay := public.record_payroll_batch_item_payment_atomic(
    v_biz, v_run_batch, v_batch, v_item_b, DATE '2026-06-16', v_cash, 'BATCH-B', NULL, '562-batch-key-item-b'
  );
  v_pay_b := (v_pay->>'payment_id')::UUID;
  IF v_pay_a = v_pay_b THEN RAISE EXCEPTION '562 batch: payments must be unique per item'; END IF;

  SELECT status INTO v_status FROM public.payroll_payment_batches WHERE id = v_batch;
  IF v_status <> 'paid' THEN RAISE EXCEPTION '562 batch full status=%', v_status; END IF;

  SELECT amount_paid INTO v_obl_paid FROM public.payroll_obligations
  WHERE business_id = v_biz AND payroll_run_id = v_run_batch AND obligation_type = 'salary_net';
  IF ABS(v_obl_paid - 1000) > 0.01 THEN RAISE EXCEPTION '562 batch full obl=%', v_obl_paid; END IF;

  SELECT COUNT(*) INTO v_je_count FROM public.payroll_payments
  WHERE business_id = v_biz AND payroll_run_id = v_run_batch AND deleted_at IS NULL AND journal_entry_id IS NOT NULL;
  IF v_je_count <> 2 THEN RAISE EXCEPTION '562 batch journal count=%', v_je_count; END IF;
  RAISE NOTICE 'PASS batch full payment unique per item';

  -- Immutability: direct total mutation blocked
  BEGIN
    UPDATE public.payroll_runs SET total_net_salary = 999 WHERE id = v_run;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err ILIKE '%PAYROLL_RUN_IMMUTABLE%' OR v_err ILIKE '%PAYROLL_RUN_%' THEN
      v_imm_ok := TRUE;
    END IF;
  END;
  IF NOT v_imm_ok THEN RAISE EXCEPTION '562 immutability total unexpected: %', v_err; END IF;
  RAISE NOTICE 'PASS immutability total blocked';

  v_imm_ok := FALSE;
  BEGIN
    UPDATE public.payroll_runs SET status = 'draft' WHERE id = v_run;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err ILIKE '%PAYROLL_RUN_INVALID_STATUS_TRANSITION%' OR v_err ILIKE '%PAYROLL_RUN_IMMUTABLE%' THEN
      v_imm_ok := TRUE;
    END IF;
  END;
  IF NOT v_imm_ok THEN RAISE EXCEPTION '562 immutability status unexpected: %', v_err; END IF;
  RAISE NOTICE 'PASS approved->draft blocked';

  -- Partial payment 600
  v_pay := public.record_payroll_payment_atomic(
    v_biz, v_run, DATE '2026-06-15', 600, v_cash, 'REF-600', NULL, '562-key-partial-600'
  );
  IF COALESCE((v_pay->>'reused')::boolean, false) IS TRUE THEN
    RAISE EXCEPTION '562 partial: first payment should not reuse';
  END IF;

  SELECT amount_paid, status INTO v_obl_paid, v_obl_status
  FROM public.payroll_obligations
  WHERE business_id = v_biz AND payroll_run_id = v_run AND obligation_type = 'salary_net';

  IF ABS(v_obl_paid - 600) > 0.01 OR v_obl_status <> 'partially_paid' THEN
    RAISE EXCEPTION '562 partial obligation paid=% status=%', v_obl_paid, v_obl_status;
  END IF;

  SELECT COUNT(*) INTO v_je_count FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  JOIN public.accounts a ON a.id = jel.account_id
  WHERE je.reference_type = 'payroll_payment' AND a.code = '2240' AND jel.debit = 600;
  IF v_je_count <> 1 THEN RAISE EXCEPTION '562 partial Dr 2240 missing'; END IF;
  RAISE NOTICE 'PASS partial payment 600';

  -- Idempotent retry
  v_pay2 := public.record_payroll_payment_atomic(
    v_biz, v_run, DATE '2026-06-15', 600, v_cash, 'REF-600', NULL, '562-key-partial-600'
  );
  IF COALESCE((v_pay2->>'reused')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION '562 idempotency: expected reused';
  END IF;
  SELECT COUNT(*) INTO v_pay_count FROM public.payroll_payments WHERE business_id = v_biz AND payroll_run_id = v_run AND deleted_at IS NULL;
  IF v_pay_count <> 1 THEN RAISE EXCEPTION '562 idempotency: payment count=%', v_pay_count; END IF;
  RAISE NOTICE 'PASS idempotent retry';

  -- Final payment 400
  v_pay := public.record_payroll_payment_atomic(
    v_biz, v_run, DATE '2026-06-20', 400, v_cash, 'REF-400', NULL, '562-key-partial-400'
  );
  SELECT amount_paid, status INTO v_obl_paid, v_obl_status
  FROM public.payroll_obligations
  WHERE business_id = v_biz AND payroll_run_id = v_run AND obligation_type = 'salary_net';
  IF ABS(v_obl_paid - 1000) > 0.01 OR v_obl_status <> 'paid' THEN
    RAISE EXCEPTION '562 full obligation paid=% status=%', v_obl_paid, v_obl_status;
  END IF;
  RAISE NOTICE 'PASS final payment 400';

  -- Overpayment blocked
  v_err := '';
  v_overpay_ok := FALSE;
  BEGIN
    PERFORM public.record_payroll_payment_atomic(
      v_biz, v_run, DATE '2026-06-21', 50, v_cash, NULL, NULL, '562-key-overpayment-x'
    );
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err ILIKE '%PAYROLL_PAYMENT_EXCEEDS_OUTSTANDING%' THEN
      v_overpay_ok := TRUE;
    END IF;
  END;
  IF NOT v_overpay_ok THEN
    RAISE EXCEPTION '562 overpay not blocked: %', COALESCE(NULLIF(v_err, ''), 'payment succeeded unexpectedly');
  END IF;
  RAISE NOTICE 'PASS overpayment blocked';

  -- Lock still works
  PERFORM public.lock_payroll_run_atomic(v_biz, v_run);
  SELECT status INTO v_status FROM public.payroll_runs WHERE id = v_run;
  IF v_status <> 'locked' THEN RAISE EXCEPTION '562 lock status=%', v_status; END IF;
  RAISE NOTICE 'PASS lock transition';

  -- Reversal blocked after posted salary payments
  v_imm_ok := FALSE;
  BEGIN
    PERFORM public.reverse_payroll_run_atomic(v_biz, v_run, DATE '2026-06-25', 'test', FALSE);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err ILIKE '%PAYROLL_RUN_HAS_POSTED_SALARY_PAYMENTS%'
       OR v_err ILIKE '%PAYROLL_REVERSAL_PAYMENTS_EXIST%'
       OR v_err ILIKE '%PAYROLL_REVERSAL_INCONSISTENT_STATE%' THEN
      v_imm_ok := TRUE;
    END IF;
  END;
  IF NOT v_imm_ok THEN
    RAISE EXCEPTION '562 reversal blocked check failed: %', COALESCE(NULLIF(v_err, ''), 'reversal succeeded unexpectedly');
  END IF;
  RAISE NOTICE 'PASS reversal blocked with posted payments';

  RAISE NOTICE 'ALL 562 CORE TESTS PASSED';
END;
$$;

ROLLBACK;
