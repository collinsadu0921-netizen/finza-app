-- ============================================================================
-- VAT return amendment and payment reversal (migration 625)
-- Runs inside one transaction and rolls back all data.
--
-- Covers F-08: paid filings cannot be reopened as drafts, but an authorized
-- user can reverse the payment with a new journal and create an auditable
-- amendment draft linked to the original filing.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_biz UUID := gen_random_uuid();
  v_ar UUID;
  v_bank UUID;
  v_vat UUID;
  v_return UUID;
  v_second UUID;
  v_payment JSONB;
  v_reversal JSONB;
  v_reversal_retry JSONB;
  v_amendment JSONB;
  v_original_journal UUID;
  v_reversal_journal UUID;
  v_new_return UUID;
  v_status TEXT;
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
    v_biz, '625 VAT Amendment Test', 'Ghana', 'GHS', 'service', v_owner,
    'business', 'active', TRUE, NOW(), NOW()
  );

  PERFORM public.create_system_accounts(v_biz);
  PERFORM public.initialize_business_chart_of_accounts(v_biz);

  INSERT INTO public.accounting_periods (business_id, period_start, period_end, status)
  VALUES
    (v_biz, date_trunc('month', CURRENT_DATE)::date,
      (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date, 'open'),
    (v_biz, (date_trunc('month', CURRENT_DATE) + interval '1 month')::date,
      (date_trunc('month', CURRENT_DATE) + interval '2 months - 1 day')::date, 'open');

  SELECT id INTO v_ar FROM public.accounts
  WHERE business_id = v_biz AND code = '1100' AND deleted_at IS NULL;
  SELECT id INTO v_bank FROM public.accounts
  WHERE business_id = v_biz AND code = '1010' AND deleted_at IS NULL;
  SELECT id INTO v_vat FROM public.accounts
  WHERE business_id = v_biz AND code = '2100' AND deleted_at IS NULL;

  -- Submitted filing with a matching ledger liability.
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
    0, 0, 0, 10,
    10, 0, 0, 0,
    0, 0, 10, 0,
    0, 0
  ) RETURNING id INTO v_return;

  UPDATE public.vat_returns SET status = 'submitted' WHERE id = v_return;

  PERFORM public.post_journal_entry(
    p_business_id => v_biz,
    p_date => CURRENT_DATE,
    p_description => '625 VAT liability fixture',
    p_reference_type => 'adjustment',
    p_reference_id => NULL,
    p_lines => jsonb_build_array(
      jsonb_build_object('account_id', v_ar, 'debit', 10),
      jsonb_build_object('account_id', v_vat, 'credit', 10)
    ),
    p_is_adjustment => TRUE,
    p_adjustment_reason => '625 VAT liability fixture',
    p_created_by => v_owner,
    p_posting_source => 'system'
  );

  v_payment := public.post_vat_return_payment_atomic(
    v_return, CURRENT_DATE, v_bank, 'TEST-VAT-625'
  );
  v_original_journal := (v_payment ->> 'journal_entry_id')::UUID;

  -- --------------------------------------------------------------------------
  -- 1) Paid filings cannot be reopened as drafts.
  -- --------------------------------------------------------------------------
  BEGIN
    UPDATE public.vat_returns SET status = 'draft' WHERE id = v_return;
    RAISE EXCEPTION 'TEST_FAILED: paid VAT return was reopened as draft';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%VAT_RETURN_STATUS_TRANSITION_INVALID%' THEN
        RAISE;
      END IF;
  END;

  -- --------------------------------------------------------------------------
  -- 2) A paid filing cannot be amended before its payment is reversed.
  -- --------------------------------------------------------------------------
  BEGIN
    PERFORM public.create_vat_return_amendment(
      v_return, 'Correct period classification', 'Supporting schedule A'
    );
    RAISE EXCEPTION 'TEST_FAILED: paid filing was amended without a payment reversal';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%VAT_AMENDMENT_PAYMENT_REVERSAL_REQUIRED%' THEN
        RAISE;
      END IF;
  END;

  -- --------------------------------------------------------------------------
  -- 3) Reversal posts a new journal and returns the filing to submitted.
  -- --------------------------------------------------------------------------
  v_reversal := public.reverse_vat_return_payment(
    v_return, CURRENT_DATE, 'Payment posted to the wrong bank account', 'Bank statement B'
  );
  v_reversal_journal := (v_reversal ->> 'reversal_journal_entry_id')::UUID;

  IF v_reversal_journal IS NULL OR v_reversal_journal = v_original_journal THEN
    RAISE EXCEPTION 'TEST_FAILED: reversal did not create a distinct journal';
  END IF;

  SELECT status, payment_journal_entry_id
  INTO v_status, v_original_journal
  FROM public.vat_returns WHERE id = v_return;

  IF v_status <> 'submitted' OR v_original_journal IS NOT NULL THEN
    RAISE EXCEPTION 'TEST_FAILED: paid filing was not returned to submitted after reversal';
  END IF;

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_debit, v_credit
  FROM public.journal_entry_lines WHERE journal_entry_id = v_reversal_journal;
  IF v_debit <> 10 OR v_credit <> 10 THEN
    RAISE EXCEPTION 'TEST_FAILED: reversal journal is not balanced (% / %)',
      v_debit, v_credit;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.journal_entry_lines l
  JOIN public.accounts a ON a.id = l.account_id
  WHERE l.journal_entry_id = v_reversal_journal
    AND a.code = '2100' AND l.credit = 10;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: reversal did not credit the VAT control account';
  END IF;

  -- Reversal is idempotent.
  v_reversal_retry := public.reverse_vat_return_payment(
    v_return, CURRENT_DATE, 'Payment posted to the wrong bank account', 'Bank statement B'
  );
  IF (v_reversal_retry ->> 'reused')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_FAILED: reversal retry was not idempotent';
  END IF;

  -- --------------------------------------------------------------------------
  -- 4) Amendment creates an auditable linked draft.
  -- --------------------------------------------------------------------------
  v_amendment := public.create_vat_return_amendment(
    v_return, 'Correct period classification', 'Supporting schedule A'
  );
  v_new_return := (v_amendment ->> 'amendment_return_id')::UUID;

  IF v_new_return IS NULL THEN
    RAISE EXCEPTION 'TEST_FAILED: amendment did not create a replacement draft';
  END IF;

  SELECT status INTO v_status FROM public.vat_returns WHERE id = v_return;
  IF v_status <> 'amended' THEN
    RAISE EXCEPTION 'TEST_FAILED: original filing status is %, expected amended', v_status;
  END IF;

  SELECT status INTO v_status FROM public.vat_returns WHERE id = v_new_return;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'TEST_FAILED: amendment replacement status is %, expected draft', v_status;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.vat_return_amendments
  WHERE original_return_id = v_return
    AND amendment_return_id = v_new_return
    AND business_id = v_biz
    AND reason = 'Correct period classification'
    AND evidence = 'Supporting schedule A'
    AND reversal_journal_entry_id = v_reversal_journal;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: amendment audit record is missing or incomplete';
  END IF;

  -- --------------------------------------------------------------------------
  -- 5) Amendment reason is mandatory.
  -- --------------------------------------------------------------------------
  INSERT INTO public.vat_returns (
    business_id, period_start_date, period_end_date, status, ledger_authority
  ) VALUES (
    v_biz,
    (date_trunc('month', CURRENT_DATE) + interval '1 month')::date,
    (date_trunc('month', CURRENT_DATE) + interval '2 months - 1 day')::date,
    'draft', TRUE
  ) RETURNING id INTO v_second;

  UPDATE public.vat_returns SET status = 'submitted' WHERE id = v_second;

  BEGIN
    PERFORM public.create_vat_return_amendment(v_second, '   ', NULL);
    RAISE EXCEPTION 'TEST_FAILED: amendment without a reason was accepted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%VAT_AMENDMENT_REASON_REQUIRED%' THEN
        RAISE;
      END IF;
  END;

  RAISE NOTICE 'PASS: VAT return amendment and payment reversal (625)';
END $$;

ROLLBACK;
