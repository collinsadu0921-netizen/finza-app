-- ============================================================================
-- VAT return period, status and payment integrity (migration 618)
-- Runs inside one transaction and rolls back all data.
--
-- Usage:
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/database/vat_return_integrity_618.test.sql
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_biz UUID := gen_random_uuid();
  v_period UUID := gen_random_uuid();
  v_ar UUID;
  v_bank UUID;
  v_vat UUID;
  v_nhil UUID;
  v_getfund UUID;
  v_je UUID;
  v_return UUID;
  v_payment JSONB;
  v_status TEXT;
  v_journal_id UUID;
  v_count INT;
  v_debit NUMERIC;
  v_credit NUMERIC;
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
  ) VALUES (
    v_biz, '618 VAT Integrity Test', 'Ghana', 'GHS', 'service', v_owner,
    'business', 'active', TRUE, NOW(), NOW()
  );

  PERFORM public.create_system_accounts(v_biz);
  PERFORM public.initialize_business_chart_of_accounts(v_biz);

  INSERT INTO public.accounting_periods (id, business_id, period_start, period_end, status)
  VALUES (
    v_period, v_biz,
    date_trunc('month', CURRENT_DATE)::date,
    (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date,
    'open'
  );

  SELECT id INTO v_ar FROM public.accounts
  WHERE business_id = v_biz AND code = '1100' AND deleted_at IS NULL;
  SELECT id INTO v_bank FROM public.accounts
  WHERE business_id = v_biz AND code = '1010' AND deleted_at IS NULL;
  SELECT id INTO v_vat FROM public.accounts
  WHERE business_id = v_biz AND code = '2100' AND deleted_at IS NULL;
  SELECT id INTO v_nhil FROM public.accounts
  WHERE business_id = v_biz AND code = '2110' AND deleted_at IS NULL;
  SELECT id INTO v_getfund FROM public.accounts
  WHERE business_id = v_biz AND code = '2120' AND deleted_at IS NULL;

  IF v_ar IS NULL OR v_bank IS NULL OR v_vat IS NULL OR v_nhil IS NULL OR v_getfund IS NULL THEN
    RAISE EXCEPTION 'TEST_SETUP: required accounts are missing';
  END IF;

  -- Post the period's tax liability movement through the canonical posting
  -- function. The test business is on the Business tier so the direct-call
  -- guard is satisfied during setup.
  SELECT public.post_journal_entry(
    p_business_id => v_biz,
    p_date => CURRENT_DATE,
    p_description => '618 VAT test liability movement',
    p_reference_type => 'adjustment',
    p_reference_id => NULL,
    p_lines => jsonb_build_array(
      jsonb_build_object('account_id', v_ar, 'debit', 20.90),
      jsonb_build_object('account_id', v_vat, 'credit', 15.90),
      jsonb_build_object('account_id', v_nhil, 'credit', 2.50),
      jsonb_build_object('account_id', v_getfund, 'credit', 2.50)
    ),
    p_is_adjustment => TRUE,
    p_adjustment_reason => 'VAT integrity test setup',
    p_created_by => v_owner,
    p_posting_source => 'system'
  ) INTO v_je;

  INSERT INTO public.vat_returns (
    business_id, period_start_date, period_end_date, status, ledger_authority,
    total_output_nhil, total_output_getfund, total_output_covid, total_output_vat,
    total_output_tax, total_input_nhil, total_input_getfund, total_input_covid,
    total_input_vat, total_input_tax, net_vat_payable, net_vat_refund,
    output_adjustment, input_adjustment
  ) VALUES (
    v_biz,
    date_trunc('month', CURRENT_DATE)::date,
    (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date,
    'draft', TRUE,
    2.50, 2.50, 0, 15.90,
    20.90, 0, 0, 0,
    0, 0, 20.90, 0,
    0, 0
  )
  RETURNING id INTO v_return;

  UPDATE public.vat_returns SET status = 'submitted' WHERE id = v_return;

  -- Exercise the Professional-tier payment path. The setup journal above used
  -- the Business tier for the direct-call guard; the payment RPC must post for
  -- a Professional-tier VAT tenant through its internal system authority.
  UPDATE public.businesses
  SET service_subscription_tier = 'professional'
  WHERE id = v_biz;

  -- Overlapping active return is rejected without touching the existing row.
  BEGIN
    INSERT INTO public.vat_returns (
      business_id, period_start_date, period_end_date, status
    ) VALUES (
      v_biz,
      date_trunc('month', CURRENT_DATE)::date,
      (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date,
      'draft'
    );
    RAISE EXCEPTION 'TEST_FAILED: overlapping VAT return was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%VAT_RETURN_PERIOD_OVERLAP%' THEN
        RAISE;
      END IF;
  END;

  -- Atomic payment posts and links exactly one journal.
  v_payment := public.post_vat_return_payment_atomic(
    v_return, CURRENT_DATE, v_bank, 'TEST-VAT-618'
  );

  IF (v_payment ->> 'reused')::BOOLEAN IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST_FAILED: first VAT payment was not a new posting';
  END IF;

  SELECT status, payment_journal_entry_id
  INTO v_status, v_journal_id
  FROM public.vat_returns WHERE id = v_return;

  IF v_status <> 'paid' OR v_journal_id IS NULL THEN
    RAISE EXCEPTION 'TEST_FAILED: VAT return was not marked paid with a journal';
  END IF;

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_debit, v_credit
  FROM public.journal_entry_lines
  WHERE journal_entry_id = v_journal_id;

  IF v_debit <> 20.90 OR v_credit <> 20.90 THEN
    RAISE EXCEPTION 'TEST_FAILED: VAT payment journal is not balanced (% / %)', v_debit, v_credit;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.journal_entry_lines l
  JOIN public.accounts a ON a.id = l.account_id
  WHERE l.journal_entry_id = v_journal_id AND a.code = '1010' AND l.credit = 20.90;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: VAT payment did not credit the bank account';
  END IF;

  -- Retry returns the same journal and does not post twice.
  v_payment := public.post_vat_return_payment_atomic(
    v_return, CURRENT_DATE, v_bank, 'TEST-VAT-618'
  );

  IF (v_payment ->> 'reused')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_FAILED: VAT payment retry was not idempotent';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.journal_entries
  WHERE business_id = v_biz AND reference_type = 'vat_return_payment' AND reference_id = v_return;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: VAT payment retry created % journals', v_count;
  END IF;

  -- Paid returns cannot be reopened through an ordinary update.
  BEGIN
    UPDATE public.vat_returns SET status = 'draft' WHERE id = v_return;
    RAISE EXCEPTION 'TEST_FAILED: paid VAT return was reopened';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%VAT_RETURN_STATUS_TRANSITION_INVALID%' THEN
        RAISE;
      END IF;
  END;

  RAISE NOTICE 'PASS: VAT return period, status and payment integrity (618)';
END $$;

ROLLBACK;
