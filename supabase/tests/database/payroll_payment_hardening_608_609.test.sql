-- ============================================================================
-- Database tests for migrations 608 and 609
-- Payment security, frozen batch instructions, settlement-path exclusion and
-- controlled salary-payment reversal. Runs in one transaction and rolls back.
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
  v_run_manual UUID := gen_random_uuid();
  v_entry_manual UUID := gen_random_uuid();
  v_batch_manual UUID := gen_random_uuid();
  v_cash UUID := gen_random_uuid();
  v_batch UUID := gen_random_uuid();
  v_item_a UUID := gen_random_uuid();
  v_item_b UUID := gen_random_uuid();
  v_pay JSONB;
  v_pay_a UUID;
  v_pay_manual JSONB;
  v_manual_payment UUID;
  v_manual_item_id UUID;
  v_manual_item_payment UUID;
  v_rev JSONB;
  v_rev2 JSONB;
  v_status TEXT;
  v_paid NUMERIC;
  v_count INT;
  v_err TEXT;
  v_ok BOOLEAN;
  v_month DATE := DATE '2026-07-01';
  v_key TEXT := 'phase1-hardening-key-a1';
BEGIN
  SELECT u.id INTO v_owner
  FROM public.users u
  JOIN auth.users a ON a.id = u.id
  LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'TEST_SETUP: need a public.users row that also exists in auth.users';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.businesses (id, name, address_country, owner_id, created_at, updated_at)
  VALUES (v_biz, 'Phase1 Payroll Hardening Test', 'Ghana', v_owner, NOW(), NOW());

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
  VALUES (v_biz, DATE '2026-07-01', DATE '2026-07-31', 'open') ON CONFLICT DO NOTHING;

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
    v_run, v_biz, v_month, v_month, DATE '2026-07-31', 'approved', 'monthly',
    1000, 1000, 0, 110, 260, 100, 0, 1000,
    'finza-ghana-v2', 'gh-paye-2024-01', 'gh-pension-2026-01', 'GH', v_month, 'phase1-test'
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

  INSERT INTO public.payroll_runs (
    id, business_id, payroll_month, pay_period_start, pay_period_end, status, payroll_frequency,
    total_basic_salary, total_gross_salary, total_allowances, total_ssnit_employee, total_ssnit_employer,
    total_paye, total_deductions, total_net_salary,
    calculation_engine_version, paye_rate_version, pension_rate_version,
    calculation_jurisdiction, statutory_period_basis, staff_scope_fingerprint
  ) VALUES (
    v_run_manual, v_biz, v_month, v_month, DATE '2026-07-31', 'approved', 'monthly',
    500, 500, 0, 55, 130, 50, 0, 500,
    'finza-ghana-v2', 'gh-paye-2024-01', 'gh-pension-2026-01', 'GH', v_month, 'phase1-manual-test'
  );

  INSERT INTO public.payroll_entries (
    id, payroll_run_id, staff_id, basic_salary, gross_salary, ssnit_employee, ssnit_employer,
    paye, net_salary, is_included, payroll_tax_profile, filing_tin, filing_employee_name
  ) VALUES (
    v_entry_manual, v_run_manual, v_staff_a, 500, 500, 55, 130, 50, 500, true,
    jsonb_build_object('staff_is_tax_resident', true), 'C0000000001', 'Employee A'
  );

  INSERT INTO public.payroll_obligations (
    business_id, payroll_run_id, obligation_type, label, amount_due, amount_paid, status, liability_account_code
  ) VALUES (v_biz, v_run_manual, 'salary_net', 'Net salaries payable', 500, 0, 'unpaid', '2240');

  INSERT INTO public.payroll_payment_batches (
    id, business_id, payroll_run_id, status, currency, total_amount_snapshot, item_count, created_by
  ) VALUES (v_batch, v_biz, v_run, 'ready', 'GHS', 1000, 2, v_owner);

  INSERT INTO public.payroll_payment_batch_items (
    id, business_id, batch_id, payroll_run_id, payroll_entry_id, staff_id, employee_name,
    amount, currency, status, destination_method_type, destination_bank_name, destination_account_number
  ) VALUES
    (v_item_a, v_biz, v_batch, v_run, v_entry_a, v_staff_a, 'Employee A',
     500, 'GHS', 'pending', 'bank', 'GCB', '1111111111'),
    (v_item_b, v_biz, v_batch, v_run, v_entry_b, v_staff_b, 'Employee B',
     500, 'GHS', 'pending', 'bank', 'GCB', '2222222222');

  INSERT INTO public.staff_payment_methods (
    business_id, staff_id, method_type, bank_name, account_number, is_default
  ) VALUES (v_biz, v_staff_a, 'bank', 'GCB', '1111111111', true);

  -- 0) Non-members cannot read or mutate payroll payout instructions
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO v_count FROM public.payroll_payment_batch_items;
  IF v_count <> 0 THEN RAISE EXCEPTION '608 s0: non-member read batch items'; END IF;
  SELECT COUNT(*) INTO v_count FROM public.staff_payment_methods;
  IF v_count <> 0 THEN RAISE EXCEPTION '608 s0: non-member read staff payment methods'; END IF;
  UPDATE public.payroll_payment_batch_items SET status = 'failed' WHERE id = v_item_a;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION '608 s0: non-member updated batch item'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  RAISE NOTICE 'PASS 608 s0: non-member read/write isolation';

  -- 1) Direct payroll journal posting is not executable by authenticated users
  v_ok := FALSE;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.post_payroll_to_ledger(v_run);
  EXCEPTION WHEN insufficient_privilege THEN
    v_ok := TRUE;
  WHEN OTHERS THEN
    IF SQLERRM ILIKE '%permission denied%' OR SQLERRM ILIKE '%42501%' THEN v_ok := TRUE; END IF;
  END;
  RESET ROLE;
  IF NOT v_ok THEN RAISE EXCEPTION '608 s1: authenticated executed post_payroll_to_ledger'; END IF;
  RAISE NOTICE 'PASS 608 s1: direct payroll journal posting denied';

  -- 2) Batch item amount is frozen
  v_ok := FALSE;
  BEGIN
    UPDATE public.payroll_payment_batch_items SET amount = 600 WHERE id = v_item_a;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err ILIKE '%PAYROLL_BATCH_INSTRUCTION_IMMUTABLE%' THEN v_ok := TRUE; END IF;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '608 s2: batch amount mutation not blocked: %', v_err; END IF;
  RAISE NOTICE 'PASS 608 s2: batch amount frozen';

  -- 3) Destination is frozen
  v_ok := FALSE;
  BEGIN
    UPDATE public.payroll_payment_batch_items
    SET destination_account_number = '9999999999'
    WHERE id = v_item_a;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err ILIKE '%PAYROLL_BATCH_INSTRUCTION_IMMUTABLE%' THEN v_ok := TRUE; END IF;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '608 s3: destination mutation not blocked: %', v_err; END IF;
  RAISE NOTICE 'PASS 608 s3: payout destination frozen';

  -- 4) A full batch cannot accept another instruction
  v_ok := FALSE;
  BEGIN
    INSERT INTO public.payroll_payment_batch_items (
      business_id, batch_id, payroll_run_id, payroll_entry_id, staff_id, employee_name,
      amount, currency, status, destination_method_type, destination_bank_name, destination_account_number
    ) VALUES (
      v_biz, v_batch, v_run, v_entry_a, v_staff_a, 'Employee A duplicate',
      500, 'GHS', 'pending', 'bank', 'GCB', '1111111111'
    );
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err ILIKE '%PAYROLL_BATCH_INSTRUCTION_IMMUTABLE%' THEN v_ok := TRUE; END IF;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '608 s4: extra batch instruction not blocked: %', v_err; END IF;
  RAISE NOTICE 'PASS 608 s4: full batch instruction set frozen';

  -- 5) Pay one employee item
  v_pay := public.record_payroll_batch_item_payment_atomic(
    v_biz, v_run, v_batch, v_item_a, DATE '2026-07-15', v_cash, 'REF-A', NULL, v_key
  );
  v_pay_a := (v_pay->>'payment_id')::UUID;
  IF v_pay_a IS NULL THEN RAISE EXCEPTION '608 s5: item payment missing'; END IF;

  -- 6) Aggregate manual payment cannot overlap an active batch
  v_ok := FALSE;
  BEGIN
    PERFORM public.record_payroll_payment_atomic(
      v_biz, v_run, DATE '2026-07-16', 100, v_cash, 'AGG-1', NULL, 'phase1-hardening-key-agg'
    );
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err ILIKE '%PAYROLL_PAYMENT_BATCH_SETTLEMENT_ACTIVE%' THEN v_ok := TRUE; END IF;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '608 s6: aggregate overlap not blocked: %', v_err; END IF;
  RAISE NOTICE 'PASS 608 s6: aggregate/batch overlap blocked';

  -- 6b) Manual payment still works on a run with no batch
  v_pay_manual := public.record_payroll_payment_atomic(
    v_biz, v_run_manual, DATE '2026-07-16', 500, v_cash, 'MAN-1', NULL, 'phase1-manual-key-1'
  );
  v_manual_payment := (v_pay_manual->>'payment_id')::UUID;
  IF v_manual_payment IS NULL THEN RAISE EXCEPTION '608 s6b: manual payment missing'; END IF;

  v_ok := FALSE;
  BEGIN
    INSERT INTO public.payroll_payment_batches (
      id, business_id, payroll_run_id, status, currency, total_amount_snapshot, item_count, created_by
    ) VALUES (v_batch_manual, v_biz, v_run_manual, 'ready', 'GHS', 500, 1, v_owner);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err ILIKE '%PAYROLL_PAYMENT_AGGREGATE_RECONCILIATION_REQUIRED%' THEN v_ok := TRUE; END IF;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION '608 s6b: batch over aggregate payment not blocked: %', v_err;
  END IF;

  PERFORM public.reverse_payroll_payment_atomic(
    v_biz, v_manual_payment, DATE '2026-07-20', 'Reconcile aggregate to employee batch'
  );

  INSERT INTO public.payroll_payment_batches (
    id, business_id, payroll_run_id, status, currency, total_amount_snapshot, item_count, created_by
  ) VALUES (v_batch_manual, v_biz, v_run_manual, 'ready', 'GHS', 500, 1, v_owner);

  INSERT INTO public.payroll_payment_batch_items (
    business_id, batch_id, payroll_run_id, payroll_entry_id, staff_id, employee_name,
    amount, currency, status, destination_method_type, destination_bank_name, destination_account_number
  ) VALUES (
    v_biz, v_batch_manual, v_run_manual, v_entry_manual, v_staff_a, 'Employee A',
    500, 'GHS', 'pending', 'bank', 'GCB', '1111111111'
  );
  RAISE NOTICE 'PASS 608 s6b: manual reversal reconciles before batch creation';

  -- 7) Reverse the item payment
  v_rev := public.reverse_payroll_payment_atomic(
    v_biz, v_pay_a, DATE '2026-07-20', 'Employee payment reversed in test'
  );
  IF COALESCE((v_rev->>'reused')::boolean, false) IS TRUE THEN
    RAISE EXCEPTION '609 s7: first reversal should not reuse';
  END IF;
  IF (v_rev->>'reversal_journal_id') IS NULL THEN
    RAISE EXCEPTION '609 s7: reversal journal missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.payroll_payments
    WHERE id = v_pay_a AND reversed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION '609 s7: payment not marked reversed';
  END IF;

  SELECT amount_paid INTO v_paid
  FROM public.payroll_obligations
  WHERE business_id = v_biz AND payroll_run_id = v_run AND obligation_type = 'salary_net';
  IF ABS(v_paid) > 0.01 THEN RAISE EXCEPTION '609 s7: obligation not restored, paid=%', v_paid; END IF;

  SELECT status INTO v_status FROM public.payroll_payment_batch_items WHERE id = v_item_a;
  IF v_status <> 'pending' THEN RAISE EXCEPTION '609 s7: batch item status=%', v_status; END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  WHERE je.reference_type = 'payroll_payment_reversal'
    AND je.reference_id = v_pay_a
    AND jel.account_id = v_cash
    AND jel.debit = 500;
  IF v_count <> 1 THEN RAISE EXCEPTION '609 s7: reversal Dr asset missing'; END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  JOIN public.accounts a ON a.id = jel.account_id
  WHERE je.reference_type = 'payroll_payment_reversal'
    AND je.reference_id = v_pay_a
    AND a.code = '2240'
    AND jel.credit = 500;
  IF v_count <> 1 THEN RAISE EXCEPTION '609 s7: reversal Cr 2240 missing'; END IF;
  RAISE NOTICE 'PASS 609 s7: balanced reversal and liability restored';

  -- 8) Duplicate reversal is idempotent
  v_rev2 := public.reverse_payroll_payment_atomic(
    v_biz, v_pay_a, DATE '2026-07-20', 'Employee payment reversed in test'
  );
  IF COALESCE((v_rev2->>'reused')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION '609 s8: duplicate reversal should reuse';
  END IF;
  IF (v_rev2->>'reversal_journal_id') IS DISTINCT FROM (v_rev->>'reversal_journal_id') THEN
    RAISE EXCEPTION '609 s8: duplicate reversal changed journal';
  END IF;
  RAISE NOTICE 'PASS 609 s8: duplicate reversal prevented';

  -- 8b) The retired idempotency key cannot masquerade as a new payment
  v_ok := FALSE;
  BEGIN
    PERFORM public.record_payroll_payment_atomic(
      v_biz, v_run, DATE '2026-07-21', 500, v_cash, 'REF-A', NULL, v_key
    );
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err ILIKE '%PAYROLL_PAYMENT_IDEMPOTENCY_CONFLICT%' THEN v_ok := TRUE; END IF;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION '609 s8b: retired idempotency key was not rejected: %', v_err;
  END IF;
  RAISE NOTICE 'PASS 609 s8b: retired idempotency key rejected';

  -- 9) Replacement payment is allowed after reversal (new key)
  PERFORM public.record_payroll_batch_item_payment_atomic(
    v_biz, v_run, v_batch, v_item_a, DATE '2026-07-21', v_cash, 'REF-A2', NULL,
    'phase1-hardening-key-a2'
  );
  SELECT status INTO v_status FROM public.payroll_payment_batch_items WHERE id = v_item_a;
  IF v_status <> 'paid' THEN RAISE EXCEPTION '609 s9: replacement payment failed, status=%', v_status; END IF;

  SELECT amount_paid INTO v_paid
  FROM public.payroll_obligations
  WHERE business_id = v_biz AND payroll_run_id = v_run AND obligation_type = 'salary_net';
  IF ABS(v_paid - 500) > 0.01 THEN RAISE EXCEPTION '609 s9: obligation after replacement=%', v_paid; END IF;
  RAISE NOTICE 'PASS 609 s9: replacement payment without duplicate settlement';

  -- 9b) Closed original period uses a current open-period reversal date
  SELECT id INTO v_manual_item_id
  FROM public.payroll_payment_batch_items
  WHERE batch_id = v_batch_manual AND payroll_run_id = v_run_manual;

  v_pay_manual := public.record_payroll_batch_item_payment_atomic(
    v_biz, v_run_manual, v_batch_manual, v_manual_item_id, DATE '2026-07-22', v_cash,
    'MAN-ITEM', NULL, 'phase1-manual-item-key'
  );
  v_manual_item_payment := (v_pay_manual->>'payment_id')::UUID;

  UPDATE public.accounting_periods
  SET status = 'soft_closed'
  WHERE business_id = v_biz AND period_start = DATE '2026-07-01';

  v_ok := FALSE;
  BEGIN
    PERFORM public.reverse_payroll_payment_atomic(
      v_biz, v_manual_item_payment, DATE '2026-07-23', 'Closed period reversal attempt'
    );
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err ILIKE '%PAYROLL_PAYMENT_REVERSAL_PERIOD_CLOSED%' THEN v_ok := TRUE; END IF;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION '609 s9b: closed-period reversal not rejected: %', v_err;
  END IF;

  INSERT INTO public.accounting_periods (business_id, period_start, period_end, status)
  VALUES (v_biz, DATE '2026-10-01', DATE '2026-10-31', 'open')
  ON CONFLICT DO NOTHING;

  PERFORM public.reverse_payroll_payment_atomic(
    v_biz, v_manual_item_payment, DATE '2026-10-29', 'Current-period correction for closed original period'
  );
  RAISE NOTICE 'PASS 609 s9b: closed-period correction posts to current open period';

  -- 10) Unauthorized reversal is rejected
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  v_ok := FALSE;
  BEGIN
    PERFORM public.reverse_payroll_payment_atomic(
      v_biz, v_pay_a, DATE '2026-07-22', 'Unauthorized attempt'
    );
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err ILIKE '%PAYROLL_PAYMENT_REVERSAL_PERMISSION_DENIED%' THEN v_ok := TRUE; END IF;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '609 s10: unauthorized reversal not rejected: %', v_err; END IF;
  RAISE NOTICE 'PASS 609 s10: unauthorized reversal rejected';

  RAISE NOTICE 'ALL 608/609 TESTS PASSED';
END;
$$;

ROLLBACK;
