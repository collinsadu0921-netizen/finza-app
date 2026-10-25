-- ============================================================================
-- Database tests for migration 587 - Service VAT return payments
-- Runs inside one transaction and rolls back all data.
--
-- psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
--   -f supabase/tests/database/vat_return_payment_587.test.sql
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_other UUID := gen_random_uuid();
  v_biz UUID := gen_random_uuid();
  v_biz2 UUID := gen_random_uuid();
  v_period_open UUID := gen_random_uuid();
  v_period_mismatch UUID := gen_random_uuid();
  v_period_locked UUID := gen_random_uuid();
  v_period_legacy UUID := gen_random_uuid();
  v_vat UUID := gen_random_uuid();
  v_nhil UUID := gen_random_uuid();
  v_getfund UUID := gen_random_uuid();
  v_covid UUID := gen_random_uuid();
  v_bank UUID := gen_random_uuid();
  v_expense UUID := gen_random_uuid();
  v_vat2 UUID := gen_random_uuid();
  v_bank2 UUID := gen_random_uuid();
  v_expense2 UUID := gen_random_uuid();
  v_clean_return UUID := gen_random_uuid();
  v_mismatch_return UUID := gen_random_uuid();
  v_locked_return UUID := gen_random_uuid();
  v_legacy_return UUID := gen_random_uuid();
  v_clean_je UUID := gen_random_uuid();
  v_mismatch_je UUID := gen_random_uuid();
  v_locked_je UUID := gen_random_uuid();
  v_legacy_je UUID := gen_random_uuid();
  v_result JSONB;
  v_payment_je UUID;
  v_retry_result JSONB;
  v_count INT;
  v_dr NUMERIC;
  v_cr NUMERIC;
  v_balance NUMERIC;
  v_status TEXT;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'TEST_SETUP: need an auth.users row';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  INSERT INTO public.businesses (
    id, name, address_country, default_currency, industry, owner_id,
    service_subscription_tier, service_subscription_status, billing_exempt,
    created_at, updated_at
  ) VALUES
    (v_biz, '587 VAT Payment Test', 'Ghana', 'GHS', 'service', v_owner,
     'professional', 'active', TRUE, NOW(), NOW()),
    (v_biz2, '587 Other VAT Business', 'Ghana', 'GHS', 'service', v_owner,
     'professional', 'active', TRUE, NOW(), NOW());

  INSERT INTO public.accounts (id, business_id, name, code, type, sub_type, is_system)
  VALUES
    (v_vat, v_biz, 'VAT Payable', '2100', 'liability', NULL, TRUE),
    (v_nhil, v_biz, 'NHIL Payable', '2110', 'liability', NULL, TRUE),
    (v_getfund, v_biz, 'GETFund Payable', '2120', 'liability', NULL, TRUE),
    (v_covid, v_biz, 'COVID Levy Payable', '2130', 'liability', NULL, TRUE),
    (v_bank, v_biz, 'Bank', '1010', 'asset', 'bank', TRUE),
    (v_expense, v_biz, 'Operating Expenses', '5100', 'expense', NULL, TRUE),
    (v_vat2, v_biz2, 'VAT Payable', '2100', 'liability', NULL, TRUE),
    (v_bank2, v_biz2, 'Bank', '1010', 'asset', 'bank', TRUE),
    (v_expense2, v_biz2, 'Operating Expenses', '5100', 'expense', NULL, TRUE);

  INSERT INTO public.accounting_periods (id, business_id, period_start, period_end, status)
  VALUES
    (v_period_open, v_biz, DATE '2026-08-01', DATE '2026-08-31', 'open'),
    (v_period_mismatch, v_biz, DATE '2026-09-01', DATE '2026-09-30', 'open'),
    (v_period_locked, v_biz, DATE '2026-11-01', DATE '2026-11-30', 'locked'),
    (v_period_legacy, v_biz, DATE '2026-10-01', DATE '2026-10-31', 'open');

  -- Clean filing: ledger accrual is 120 (VAT 100, NHIL 10, GETFund 10).
  INSERT INTO public.journal_entries
    (id, business_id, date, description, reference_type, reference_id, posting_source)
  VALUES
    (v_clean_je, v_biz, TIMESTAMPTZ '2026-08-15 00:00:00+00',
     'Test VAT accrual 587', 'test_vat_accrual', v_clean_return, 'system');

  INSERT INTO public.journal_entry_lines
    (journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_clean_je, v_expense, 120, 0, 'Test VAT accrual expense'),
    (v_clean_je, v_vat, 0, 100, 'Test VAT accrual VAT'),
    (v_clean_je, v_nhil, 0, 10, 'Test VAT accrual NHIL'),
    (v_clean_je, v_getfund, 0, 10, 'Test VAT accrual GETFund');

  INSERT INTO public.vat_returns (
    id, business_id, period_start_date, period_end_date, status,
    total_output_vat, total_input_vat,
    total_output_nhil, total_input_nhil,
    total_output_getfund, total_input_getfund,
    total_output_covid, total_input_covid,
    total_output_tax, total_input_tax, net_vat_payable
  ) VALUES (
    v_clean_return, v_biz,
    TIMESTAMPTZ '2026-08-01 00:00:00+00',
    TIMESTAMPTZ '2026-08-31 23:59:59+00',
    'submitted',
    100, 0, 10, 0, 10, 0, 0, 0, 120, 0, 120
  );

  -- Mismatch filing: ledger accrual is only 80 while the filing says 100.
  INSERT INTO public.journal_entries
    (id, business_id, date, description, reference_type, reference_id, posting_source)
  VALUES
    (v_mismatch_je, v_biz, TIMESTAMPTZ '2026-09-15 00:00:00+00',
     'Test VAT mismatch accrual 587', 'test_vat_accrual', v_mismatch_return, 'system');

  INSERT INTO public.journal_entry_lines
    (journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_mismatch_je, v_expense, 80, 0, 'Test VAT mismatch expense'),
    (v_mismatch_je, v_vat, 0, 80, 'Test VAT mismatch VAT');

  INSERT INTO public.vat_returns (
    id, business_id, period_start_date, period_end_date, status,
    total_output_vat, total_input_vat,
    total_output_nhil, total_input_nhil,
    total_output_getfund, total_input_getfund,
    total_output_covid, total_input_covid,
    total_output_tax, total_input_tax, net_vat_payable
  ) VALUES (
    v_mismatch_return, v_biz,
    TIMESTAMPTZ '2026-09-01 00:00:00+00',
    TIMESTAMPTZ '2026-09-30 23:59:59+00',
    'submitted',
    100, 0, 0, 0, 0, 0, 0, 0, 100, 0, 100
  );

  -- Locked period filing. No accrual is needed: the RPC checks the period
  -- lock before reconciliation.
  INSERT INTO public.vat_returns (
    id, business_id, period_start_date, period_end_date, status,
    total_output_vat, total_input_vat,
    total_output_nhil, total_input_nhil,
    total_output_getfund, total_input_getfund,
    total_output_covid, total_input_covid,
    total_output_tax, total_input_tax, net_vat_payable
  ) VALUES (
    v_locked_return, v_biz,
    TIMESTAMPTZ '2026-11-01 00:00:00+00',
    TIMESTAMPTZ '2026-11-30 23:59:59+00',
    'submitted',
    50, 0, 0, 0, 0, 0, 0, 0, 50, 0, 50
  );

  -- Legacy paid filing without a journal. Disable the new guard only to seed
  -- this historical fixture; the guard is re-enabled before the RPC tests.
  ALTER TABLE public.vat_returns DISABLE TRIGGER trg_prevent_vat_paid_without_journal;

  INSERT INTO public.vat_returns (
    id, business_id, period_start_date, period_end_date, status,
    total_output_vat, total_input_vat,
    total_output_nhil, total_input_nhil,
    total_output_getfund, total_input_getfund,
    total_output_covid, total_input_covid,
    total_output_tax, total_input_tax, net_vat_payable,
    payment_date
  ) VALUES (
    v_legacy_return, v_biz,
    TIMESTAMPTZ '2026-10-01 00:00:00+00',
    TIMESTAMPTZ '2026-10-31 23:59:59+00',
    'paid',
    50, 0, 0, 0, 0, 0, 0, 0, 50, 0, 50,
    TIMESTAMPTZ '2026-10-20 00:00:00+00'
  );

  ALTER TABLE public.vat_returns ENABLE TRIGGER trg_prevent_vat_paid_without_journal;

  -- 0) The database guard blocks a status-only transition into paid.
  BEGIN
    UPDATE public.vat_returns
    SET status = 'paid'
    WHERE id = v_clean_return;
    RAISE EXCEPTION 'TEST_FAILED: status-only paid update was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'VAT_PAYMENT_JOURNAL_REQUIRED' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong status-only guard error: %', SQLERRM;
    END IF;
  END;

  SELECT status, payment_journal_entry_id
  INTO v_status, v_payment_je
  FROM public.vat_returns
  WHERE id = v_clean_return;

  IF v_status <> 'submitted' OR v_payment_je IS NOT NULL THEN
    RAISE EXCEPTION 'TEST_FAILED: status-only guard changed the filing';
  END IF;

  -- 1) Clean payment posts and links exactly once.
  v_result := public.post_vat_return_payment_atomic(
    v_clean_return,
    DATE '2026-08-20',
    v_bank,
    'TEST-587-CLEAN'
  );

  v_payment_je := (v_result ->> 'journal_entry_id')::UUID;
  IF v_payment_je IS NULL THEN
    RAISE EXCEPTION 'TEST_FAILED: clean payment returned no journal entry';
  END IF;
  IF (v_result ->> 'reused')::BOOLEAN IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST_FAILED: first clean payment was marked reused';
  END IF;

  SELECT status, payment_journal_entry_id, payment_amount
  INTO v_status, v_payment_je, v_balance
  FROM public.vat_returns
  WHERE id = v_clean_return;

  IF v_status <> 'paid' THEN
    RAISE EXCEPTION 'TEST_FAILED: clean filing status is %, expected paid', v_status;
  END IF;
  IF v_payment_je IS NULL OR v_balance <> 120 THEN
    RAISE EXCEPTION 'TEST_FAILED: clean filing link/amount incorrect (% / %)', v_payment_je, v_balance;
  END IF;

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_dr, v_cr
  FROM public.journal_entry_lines
  WHERE journal_entry_id = v_payment_je;

  IF v_dr <> 120 OR v_cr <> 120 THEN
    RAISE EXCEPTION 'TEST_FAILED: clean payment not balanced (% / %)', v_dr, v_cr;
  END IF;

  SELECT COALESCE(SUM(l.credit - l.debit), 0)
  INTO v_balance
  FROM public.journal_entry_lines l
  JOIN public.accounts a ON a.id = l.account_id
  JOIN public.journal_entries je ON je.id = l.journal_entry_id
  WHERE a.business_id = v_biz
    AND a.code IN ('2100', '2110', '2120', '2130')
    AND je.date >= TIMESTAMPTZ '2026-08-01 00:00:00+00'
    AND je.date <= TIMESTAMPTZ '2026-08-31 23:59:59+00';

  IF v_balance <> 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: clean-period tax liabilities not cleared after payment (%)', v_balance;
  END IF;

  SELECT COALESCE(SUM(l.debit - l.credit), 0)
  INTO v_balance
  FROM public.journal_entry_lines l
  JOIN public.accounts a ON a.id = l.account_id
  WHERE a.id = v_bank;

  IF v_balance <> -120 THEN
    RAISE EXCEPTION 'TEST_FAILED: bank account not credited by payment (debit balance %)', v_balance;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.journal_entries
  WHERE reference_type = 'vat_return_payment'
    AND reference_id = v_clean_return;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: clean payment posted % journals, expected 1', v_count;
  END IF;

  -- 2) Retry returns the same journal and never posts twice.
  v_retry_result := public.post_vat_return_payment_atomic(
    v_clean_return,
    DATE '2026-08-20',
    v_bank,
    'TEST-587-CLEAN'
  );

  IF (v_retry_result ->> 'reused')::BOOLEAN IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST_FAILED: retry was not marked reused';
  END IF;
  IF (v_retry_result ->> 'journal_entry_id')::UUID <> v_payment_je THEN
    RAISE EXCEPTION 'TEST_FAILED: retry returned a different journal';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.journal_entries
  WHERE reference_type = 'vat_return_payment'
    AND reference_id = v_clean_return;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: retry created a duplicate journal (%)', v_count;
  END IF;

  -- 3) Mismatch is rejected before any journal is written and status is intact.
  BEGIN
    PERFORM public.post_vat_return_payment_atomic(
      v_mismatch_return,
      DATE '2026-09-20',
      v_bank,
      'TEST-587-MISMATCH'
    );
    RAISE EXCEPTION 'TEST_FAILED: mismatch payment was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'VAT_PAYMENT_RECONCILIATION_MISMATCH' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong mismatch error: %', SQLERRM;
    END IF;
  END;

  SELECT status, payment_journal_entry_id
  INTO v_status, v_payment_je
  FROM public.vat_returns
  WHERE id = v_mismatch_return;

  IF v_status <> 'submitted' OR v_payment_je IS NOT NULL THEN
    RAISE EXCEPTION 'TEST_FAILED: mismatch changed filing status/link';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.journal_entries
  WHERE reference_type = 'vat_return_payment'
    AND reference_id = v_mismatch_return;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: mismatch wrote a journal';
  END IF;

  -- 4) Locked period is rejected and writes nothing.
  BEGIN
    PERFORM public.post_vat_return_payment_atomic(
      v_locked_return,
      DATE '2026-11-20',
      v_bank,
      'TEST-587-LOCKED'
    );
    RAISE EXCEPTION 'TEST_FAILED: locked-period payment was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'VAT_PAYMENT_PERIOD_LOCKED' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong locked-period error: %', SQLERRM;
    END IF;
  END;

  -- 5) Legacy paid-without-journal is refused, not repaired.
  BEGIN
    PERFORM public.post_vat_return_payment_atomic(
      v_legacy_return,
      DATE '2026-10-20',
      v_bank,
      'TEST-587-LEGACY'
    );
    RAISE EXCEPTION 'TEST_FAILED: legacy paid filing was silently repaired';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'VAT_PAYMENT_LEGACY_PAID_WITHOUT_JOURNAL' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong legacy error: %', SQLERRM;
    END IF;
  END;

  SELECT COUNT(*) INTO v_count
  FROM public.journal_entries
  WHERE reference_type = 'vat_return_payment'
    AND reference_id = v_legacy_return;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: legacy filing was posted';
  END IF;

  -- 6) Access control: an unrelated identity cannot post.
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  BEGIN
    PERFORM public.post_vat_return_payment_atomic(
      v_clean_return,
      DATE '2026-08-20',
      v_bank,
      'TEST-587-NOAUTH'
    );
    RAISE EXCEPTION 'TEST_FAILED: unauthorized identity was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'VAT_PAYMENT_NOT_AUTHORIZED' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong authorization error: %', SQLERRM;
    END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  -- 7) A foreign payment account is rejected.
  BEGIN
    PERFORM public.post_vat_return_payment_atomic(
      v_mismatch_return,
      DATE '2026-09-20',
      v_bank2,
      'TEST-587-FOREIGN-BANK'
    );
    RAISE EXCEPTION 'TEST_FAILED: foreign bank account was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'VAT_PAYMENT_INVALID_ACCOUNT' THEN
      RAISE EXCEPTION 'TEST_FAILED: wrong foreign-account error: %', SQLERRM;
    END IF;
  END;

  RAISE NOTICE 'VAT return payment 587 tests passed';
END;
$$;

ROLLBACK;
