-- ============================================================================
-- VAT payment mapping, negative components and adjustments (migration 624)
-- Runs inside one transaction and rolls back all data.
--
-- Covers F-12 (negative NHIL/GETFund net payable), F-13 (adjustment reason and
-- control-account reconciliation) and F-16 (explicit control mapping).
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_biz UUID := gen_random_uuid();
  v_ar UUID;
  v_bank UUID;
  v_vat UUID;
  v_nhil UUID;
  v_return UUID;
  v_payment JSONB;
  v_journal UUID;
  v_count INT;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_vat_debit NUMERIC;
  v_nhil_credit NUMERIC;
  v_bank_credit NUMERIC;
  v_net NUMERIC;
  v_next_start DATE := (date_trunc('month', CURRENT_DATE) + interval '1 month')::date;
  v_next_end DATE := (date_trunc('month', CURRENT_DATE) + interval '2 months - 1 day')::date;
  v_later_start DATE := (date_trunc('month', CURRENT_DATE) + interval '2 months')::date;
  v_later_end DATE := (date_trunc('month', CURRENT_DATE) + interval '3 months - 1 day')::date;
  v_custom UUID;
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
    v_biz, '624 VAT Payment Test', 'Ghana', 'GHS', 'service', v_owner,
    'business', 'active', TRUE, NOW(), NOW()
  );

  PERFORM public.create_system_accounts(v_biz);
  PERFORM public.initialize_business_chart_of_accounts(v_biz);

  INSERT INTO public.accounting_periods (business_id, period_start, period_end, status)
  VALUES
    (v_biz, date_trunc('month', CURRENT_DATE)::date,
      (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date, 'open'),
    (v_biz, v_next_start, v_next_end, 'open'),
    (v_biz, v_later_start, v_later_end, 'open');

  SELECT id INTO v_ar FROM public.accounts
  WHERE business_id = v_biz AND code = '1100' AND deleted_at IS NULL;
  SELECT id INTO v_bank FROM public.accounts
  WHERE business_id = v_biz AND code = '1010' AND deleted_at IS NULL;
  SELECT id INTO v_vat FROM public.accounts
  WHERE business_id = v_biz AND code = '2100' AND deleted_at IS NULL;
  SELECT id INTO v_nhil FROM public.accounts
  WHERE business_id = v_biz AND code = '2110' AND deleted_at IS NULL;

  -- --------------------------------------------------------------------------
  -- 1) Negative NHIL component nets against a positive VAT component.
  --    Ledger: VAT credit 100, input VAT debit 20, input NHIL debit 10.
  -- --------------------------------------------------------------------------
  PERFORM public.post_journal_entry(
    p_business_id => v_biz,
    p_date => CURRENT_DATE,
    p_description => '624 negative component fixture',
    p_reference_type => 'adjustment',
    p_reference_id => NULL,
    p_lines => jsonb_build_array(
      jsonb_build_object('account_id', v_ar, 'debit', 70),
      jsonb_build_object('account_id', v_vat, 'debit', 20),
      jsonb_build_object('account_id', v_nhil, 'debit', 10),
      jsonb_build_object('account_id', v_vat, 'credit', 100)
    ),
    p_is_adjustment => TRUE,
    p_adjustment_reason => '624 negative component fixture',
    p_created_by => v_owner,
    p_posting_source => 'system'
  );

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
    0, 0, 0, 100,
    100, 10, 0, 0,
    20, 30, 70, 0,
    0, 0
  ) RETURNING id INTO v_return;

  UPDATE public.vat_returns SET status = 'submitted' WHERE id = v_return;

  v_payment := public.post_vat_return_payment_atomic(
    v_return, CURRENT_DATE, v_bank, 'TEST-VAT-624-NEG'
  );
  v_journal := (v_payment ->> 'journal_entry_id')::UUID;

  IF (v_payment ->> 'payment_amount')::NUMERIC <> 70 THEN
    RAISE EXCEPTION 'TEST_FAILED: negative component payment amount was %',
      v_payment ->> 'payment_amount';
  END IF;

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_debit, v_credit
  FROM public.journal_entry_lines WHERE journal_entry_id = v_journal;
  IF v_debit <> 80 OR v_credit <> 80 THEN
    RAISE EXCEPTION 'TEST_FAILED: negative component journal is not balanced (% / %)',
      v_debit, v_credit;
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN a.code = '2100' THEN l.debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.code = '2110' THEN l.credit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.code = '1010' THEN l.credit ELSE 0 END), 0)
  INTO v_vat_debit, v_nhil_credit, v_bank_credit
  FROM public.journal_entry_lines l
  JOIN public.accounts a ON a.id = l.account_id
  WHERE l.journal_entry_id = v_journal;

  IF v_vat_debit <> 80 OR v_nhil_credit <> 10 OR v_bank_credit <> 70 THEN
    RAISE EXCEPTION 'TEST_FAILED: unexpected payment split (% / % / %)',
      v_vat_debit, v_nhil_credit, v_bank_credit;
  END IF;

  SELECT COALESCE(SUM(l.credit - l.debit), 0)
  INTO v_net
  FROM public.journal_entry_lines l
  JOIN public.journal_entries je ON je.id = l.journal_entry_id
  JOIN public.accounts a ON a.id = l.account_id
  WHERE je.business_id = v_biz
    AND a.code = '2110'
    AND je.date BETWEEN date_trunc('month', CURRENT_DATE)::date
                    AND (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date;

  IF v_net <> 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: NHIL control account left a % balance', v_net;
  END IF;

  -- --------------------------------------------------------------------------
  -- 2) A non-zero adjustment requires a reason and is reconciled through 2100.
  -- --------------------------------------------------------------------------
  INSERT INTO public.vat_returns (
    business_id, period_start_date, period_end_date, status, ledger_authority,
    total_output_nhil, total_output_getfund, total_output_covid, total_output_vat,
    total_output_tax, total_input_nhil, total_input_getfund, total_input_covid,
    total_input_vat, total_input_tax, net_vat_payable, net_vat_refund,
    output_adjustment, input_adjustment
  ) VALUES (
    v_biz, v_next_start, v_next_end, 'draft', TRUE,
    0, 0, 0, 10,
    10, 0, 0, 0,
    0, 0, 15, 0,
    5, 0
  ) RETURNING id INTO v_return;

  UPDATE public.vat_returns SET status = 'submitted' WHERE id = v_return;

  BEGIN
    PERFORM public.post_vat_return_payment_atomic(
      v_return, v_next_start, v_bank, 'TEST-VAT-624-ADJ'
    );
    RAISE EXCEPTION 'TEST_FAILED: adjustment without a reason was paid';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%VAT_PAYMENT_ADJUSTMENT_REASON_REQUIRED%' THEN
        RAISE;
      END IF;
  END;

  UPDATE public.vat_returns
  SET adjustment_reason = 'Approved prior-period rounding adjustment'
  WHERE id = v_return;

  PERFORM public.post_journal_entry(
    p_business_id => v_biz,
    p_date => v_next_start,
    p_description => '624 adjustment fixture',
    p_reference_type => 'adjustment',
    p_reference_id => NULL,
    p_lines => jsonb_build_array(
      jsonb_build_object('account_id', v_ar, 'debit', 15),
      jsonb_build_object('account_id', v_vat, 'credit', 15)
    ),
    p_is_adjustment => TRUE,
    p_adjustment_reason => 'Approved prior-period rounding adjustment',
    p_created_by => v_owner,
    p_posting_source => 'system'
  );

  v_payment := public.post_vat_return_payment_atomic(
    v_return, v_next_start, v_bank, 'TEST-VAT-624-ADJ'
  );

  IF (v_payment ->> 'payment_amount')::NUMERIC <> 15 THEN
    RAISE EXCEPTION 'TEST_FAILED: adjusted payment amount was %',
      v_payment ->> 'payment_amount';
  END IF;

  -- --------------------------------------------------------------------------
  -- 3) An explicit mapping to a custom liability account is respected.
  -- --------------------------------------------------------------------------
  INSERT INTO public.accounts (business_id, name, code, type, sub_type)
  VALUES (v_biz, 'Custom VAT Control', '2199', 'liability', 'tax')
  RETURNING id INTO v_custom;

  INSERT INTO public.chart_of_accounts (
    id, business_id, account_code, account_name, account_type, is_active
  ) VALUES (
    gen_random_uuid(), v_biz, '2199', 'Custom VAT Control', 'liability', TRUE
  );

  INSERT INTO public.chart_of_accounts_control_map (
    business_id, control_key, account_code
  ) VALUES (
    v_biz, 'VAT_PAYABLE', '2199'
  )
  ON CONFLICT (business_id, control_key)
  DO UPDATE SET account_code = EXCLUDED.account_code;

  IF public.finza_tax_control_account_code(v_biz, 'VAT_PAYABLE', '2100') <> '2199' THEN
    RAISE EXCEPTION 'TEST_FAILED: explicit VAT control mapping was not resolved';
  END IF;

  INSERT INTO public.vat_returns (
    business_id, period_start_date, period_end_date, status, ledger_authority,
    total_output_nhil, total_output_getfund, total_output_covid, total_output_vat,
    total_output_tax, total_input_nhil, total_input_getfund, total_input_covid,
    total_input_vat, total_input_tax, net_vat_payable, net_vat_refund,
    output_adjustment, input_adjustment
  ) VALUES (
    v_biz, v_later_start, v_later_end, 'draft', TRUE,
    0, 0, 0, 5,
    5, 0, 0, 0,
    0, 0, 5, 0,
    0, 0
  ) RETURNING id INTO v_return;

  UPDATE public.vat_returns SET status = 'submitted' WHERE id = v_return;

  PERFORM public.post_journal_entry(
    p_business_id => v_biz,
    p_date => v_later_start,
    p_description => '624 mapping fixture',
    p_reference_type => 'adjustment',
    p_reference_id => NULL,
    p_lines => jsonb_build_array(
      jsonb_build_object('account_id', v_ar, 'debit', 5),
      jsonb_build_object('account_id', v_custom, 'credit', 5)
    ),
    p_is_adjustment => TRUE,
    p_adjustment_reason => '624 mapping fixture',
    p_created_by => v_owner,
    p_posting_source => 'system'
  );

  v_payment := public.post_vat_return_payment_atomic(
    v_return, v_later_start, v_bank, 'TEST-VAT-624-MAP'
  );
  v_journal := (v_payment ->> 'journal_entry_id')::UUID;

  SELECT COUNT(*) INTO v_count
  FROM public.journal_entry_lines l
  JOIN public.accounts a ON a.id = l.account_id
  WHERE l.journal_entry_id = v_journal AND a.code = '2199' AND l.debit = 5;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: mapped VAT control account was not debited';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.journal_entry_lines l
  JOIN public.accounts a ON a.id = l.account_id
  WHERE l.journal_entry_id = v_journal AND a.code = '2100';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: mapped payment also touched the default 2100 account';
  END IF;

  -- An invalid explicit mapping (non-liability) must not silently fall back.
  UPDATE public.chart_of_accounts_control_map
  SET account_code = '1100'
  WHERE business_id = v_biz AND control_key = 'VAT_PAYABLE';

  IF public.finza_tax_control_account_code(v_biz, 'VAT_PAYABLE', '2100') IS NOT NULL THEN
    RAISE EXCEPTION 'TEST_FAILED: invalid explicit mapping silently fell back';
  END IF;

  RAISE NOTICE 'PASS: VAT payment mapping, negative components and adjustments (624)';
END $$;

ROLLBACK;
