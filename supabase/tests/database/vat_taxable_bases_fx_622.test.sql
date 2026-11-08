-- ============================================================================
-- FX-aware VAT taxable bases (migration 622)
-- Runs inside one transaction and rolls back all data.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_biz UUID := gen_random_uuid();
  v_period UUID := gen_random_uuid();
  v_ar UUID;
  v_revenue UUID;
  v_usd_invoice UUID;
  v_eur_invoice UUID;
  v_gbp_invoice UUID;
  v_ghs_invoice UUID;
  v_exempt_invoice UUID;
  v_credit UUID;
  v_usd_bill UUID;
  v_eur_expense UUID;
  v_bases JSONB;
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
    v_biz, '622 FX VAT Bases Test', 'Ghana', 'GHS', 'service', v_owner,
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
  SELECT id INTO v_revenue FROM public.accounts
  WHERE business_id = v_biz AND code = '4000' AND deleted_at IS NULL;

  ALTER TABLE public.invoices DISABLE TRIGGER USER;
  ALTER TABLE public.credit_notes DISABLE TRIGGER USER;
  ALTER TABLE public.bills DISABLE TRIGGER USER;
  ALTER TABLE public.expenses DISABLE TRIGGER USER;

  -- USD invoice: 100 USD base, 20 USD tax, 1,200 GHS gross.
  INSERT INTO public.invoices (
    business_id, subtotal, total_tax, total, issue_date, status, tax_lines,
    vat_classification, currency_code, fx_rate, home_currency_total
  ) VALUES (
    v_biz, 100, 20, 120, CURRENT_DATE, 'sent',
    jsonb_build_object('lines', jsonb_build_array(
      jsonb_build_object('code', 'VAT', 'amount', 15, 'meta', jsonb_build_object('base', 100)),
      jsonb_build_object('code', 'NHIL', 'amount', 2.5, 'meta', jsonb_build_object('base', 100)),
      jsonb_build_object('code', 'GETFUND', 'amount', 2.5, 'meta', jsonb_build_object('base', 100))
    )),
    'standard', 'USD', 10, 1200
  ) RETURNING id INTO v_usd_invoice;

  -- EUR invoice: 200 EUR base, 40 EUR tax, 1,200 GHS gross.
  INSERT INTO public.invoices (
    business_id, subtotal, total_tax, total, issue_date, status, tax_lines,
    vat_classification, currency_code, fx_rate, home_currency_total
  ) VALUES (
    v_biz, 200, 40, 240, CURRENT_DATE, 'sent',
    jsonb_build_object('lines', jsonb_build_array(
      jsonb_build_object('code', 'VAT', 'amount', 30, 'meta', jsonb_build_object('base', 200)),
      jsonb_build_object('code', 'NHIL', 'amount', 5, 'meta', jsonb_build_object('base', 200)),
      jsonb_build_object('code', 'GETFUND', 'amount', 5, 'meta', jsonb_build_object('base', 200))
    )),
    'standard', 'EUR', 5, 1200
  ) RETURNING id INTO v_eur_invoice;

  -- GBP invoice: 50 GBP base, 10 GBP tax, 1,200 GHS gross.
  INSERT INTO public.invoices (
    business_id, subtotal, total_tax, total, issue_date, status, tax_lines,
    vat_classification, currency_code, fx_rate, home_currency_total
  ) VALUES (
    v_biz, 50, 10, 60, CURRENT_DATE, 'sent',
    jsonb_build_object('lines', jsonb_build_array(
      jsonb_build_object('code', 'VAT', 'amount', 7.5, 'meta', jsonb_build_object('base', 50)),
      jsonb_build_object('code', 'NHIL', 'amount', 1.25, 'meta', jsonb_build_object('base', 50)),
      jsonb_build_object('code', 'GETFUND', 'amount', 1.25, 'meta', jsonb_build_object('base', 50))
    )),
    'standard', 'GBP', 20, 1200
  ) RETURNING id INTO v_gbp_invoice;

  -- GHS invoice: 100 base, 20 tax, 120 gross.
  INSERT INTO public.invoices (
    business_id, subtotal, total_tax, total, issue_date, status, tax_lines,
    vat_classification
  ) VALUES (
    v_biz, 100, 20, 120, CURRENT_DATE, 'sent',
    jsonb_build_object('lines', jsonb_build_array(
      jsonb_build_object('code', 'VAT', 'amount', 15, 'meta', jsonb_build_object('base', 100)),
      jsonb_build_object('code', 'NHIL', 'amount', 2.5, 'meta', jsonb_build_object('base', 100)),
      jsonb_build_object('code', 'GETFUND', 'amount', 2.5, 'meta', jsonb_build_object('base', 100))
    )),
    'standard'
  ) RETURNING id INTO v_ghs_invoice;

  -- Zero-rated USD invoice: 300 GHS.
  INSERT INTO public.invoices (
    business_id, subtotal, total_tax, total, issue_date, status, tax_lines,
    vat_classification, currency_code, fx_rate, home_currency_total
  ) VALUES (
    v_biz, 30, 0, 30, CURRENT_DATE, 'sent', '[]'::jsonb,
    'zero', 'USD', 10, 300
  );

  -- Exempt GHS invoice: 50 GHS.
  INSERT INTO public.invoices (
    business_id, subtotal, total_tax, total, issue_date, status, tax_lines,
    vat_classification
  ) VALUES (
    v_biz, 50, 0, 50, CURRENT_DATE, 'sent', '[]'::jsonb,
    'exempt'
  ) RETURNING id INTO v_exempt_invoice;

  -- USD credit note: 10 USD base -> 100 GHS reduction.
  INSERT INTO public.credit_notes (
    business_id, invoice_id, credit_number, date, subtotal, total, status,
    tax_lines, vat_classification
  ) VALUES (
    v_biz, v_usd_invoice, 'CN-FX-622', CURRENT_DATE, 10, 12, 'applied',
    jsonb_build_object('lines', jsonb_build_array(
      jsonb_build_object('code', 'VAT', 'amount', 1.5, 'meta', jsonb_build_object('base', 10)),
      jsonb_build_object('code', 'NHIL', 'amount', 0.25, 'meta', jsonb_build_object('base', 10)),
      jsonb_build_object('code', 'GETFUND', 'amount', 0.25, 'meta', jsonb_build_object('base', 10))
    )),
    'standard'
  ) RETURNING id INTO v_credit;

  -- USD bill: 40 USD base -> 400 GHS.
  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, due_date, status,
    subtotal, total_tax, total, bill_type, tax_lines, vat_classification,
    currency_code, fx_rate, home_currency_total
  ) VALUES (
    v_biz, 'FX Supplier', 'BILL-FX-622', CURRENT_DATE, CURRENT_DATE, 'open',
    40, 8, 48, 'standard',
    jsonb_build_object('tax_lines', jsonb_build_array(
      jsonb_build_object('code', 'VAT', 'amount', 6, 'ledger_account_code', '2100', 'ledger_side', 'debit'),
      jsonb_build_object('code', 'NHIL', 'amount', 1, 'ledger_account_code', '2110', 'ledger_side', 'debit'),
      jsonb_build_object('code', 'GETFUND', 'amount', 1, 'ledger_account_code', '2120', 'ledger_side', 'debit')
    )),
    'standard', 'USD', 10, 480
  ) RETURNING id INTO v_usd_bill;

  -- EUR expense: 50 EUR -> 250 GHS.
  INSERT INTO public.expenses (
    id, business_id, supplier, amount, vat, nhil, getfund, covid, total, date,
    currency_code, fx_rate, home_currency_total, vat_classification
  ) VALUES (
    gen_random_uuid(), v_biz, 'EUR Expense Supplier', 50, 7.5, 0, 0, 0, 57.5,
    CURRENT_DATE, 'EUR', 5, 287.5, 'standard'
  ) RETURNING id INTO v_eur_expense;

  -- Exempt EUR bill: 20 EUR -> 100 GHS.
  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, due_date, status,
    subtotal, total_tax, total, bill_type, tax_lines, vat_classification,
    currency_code, fx_rate, home_currency_total
  ) VALUES (
    v_biz, 'Exempt FX Supplier', 'BILL-EX-622', CURRENT_DATE, CURRENT_DATE, 'open',
    20, 0, 20, 'standard', '[]'::jsonb, 'exempt', 'EUR', 5, 100
  );

  ALTER TABLE public.invoices ENABLE TRIGGER USER;
  ALTER TABLE public.credit_notes ENABLE TRIGGER USER;
  ALTER TABLE public.bills ENABLE TRIGGER USER;
  ALTER TABLE public.expenses ENABLE TRIGGER USER;

  -- Ledger revenue = standard 3,000 + zero 300 + exempt 50 = 3,350 GHS.
  PERFORM public.post_journal_entry(
    p_business_id => v_biz,
    p_date => CURRENT_DATE,
    p_description => '622 FX VAT base test revenue',
    p_reference_type => 'invoice',
    p_reference_id => v_ghs_invoice,
    p_lines => jsonb_build_array(
      jsonb_build_object('account_id', v_ar, 'debit', 3350),
      jsonb_build_object('account_id', v_revenue, 'credit', 3350)
    ),
    p_created_by => v_owner,
    p_posting_source => 'system'
  );

  v_bases := public.extract_vat_taxable_bases(
    v_biz,
    date_trunc('month', CURRENT_DATE)::date,
    (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date
  );

  IF (v_bases->>'standard_rated_sales')::NUMERIC <> 3000 THEN
    RAISE EXCEPTION 'TEST_FAILED: standard sales expected 3000, got %',
      v_bases->>'standard_rated_sales';
  END IF;
  IF (v_bases->>'zero_rated_sales')::NUMERIC <> 300 THEN
    RAISE EXCEPTION 'TEST_FAILED: zero sales expected 300, got %',
      v_bases->>'zero_rated_sales';
  END IF;
  IF (v_bases->>'exempt_sales')::NUMERIC <> 50 THEN
    RAISE EXCEPTION 'TEST_FAILED: exempt sales expected 50, got %',
      v_bases->>'exempt_sales';
  END IF;
  IF (v_bases->>'standard_rated_purchases')::NUMERIC <> 650 THEN
    RAISE EXCEPTION 'TEST_FAILED: standard purchases expected 650, got %',
      v_bases->>'standard_rated_purchases';
  END IF;
  IF (v_bases->>'exempt_purchases')::NUMERIC <> 100 THEN
    RAISE EXCEPTION 'TEST_FAILED: exempt purchases expected 100, got %',
      v_bases->>'exempt_purchases';
  END IF;
  IF (v_bases->>'ledger_revenue_credits')::NUMERIC <> 3350 THEN
    RAISE EXCEPTION 'TEST_FAILED: ledger revenue expected 3350, got %',
      v_bases->>'ledger_revenue_credits';
  END IF;

  -- A foreign-currency document without an FX rate is an explicit exception.
  ALTER TABLE public.invoices DISABLE TRIGGER USER;
  INSERT INTO public.invoices (
    business_id, subtotal, total_tax, total, issue_date, status, tax_lines,
    vat_classification, currency_code, fx_rate
  ) VALUES (
    v_biz, 10, 0, 10, CURRENT_DATE, 'sent', '[]'::jsonb,
    'standard', 'USD', NULL
  );
  ALTER TABLE public.invoices ENABLE TRIGGER USER;

  v_bases := public.extract_vat_taxable_bases(
    v_biz,
    date_trunc('month', CURRENT_DATE)::date,
    (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date
  );

  IF (v_bases->>'invalid_fx_count')::INTEGER < 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: missing invalid FX count';
  END IF;
  IF NOT ((v_bases->'warnings')::TEXT LIKE '%exchange rate%') THEN
    RAISE EXCEPTION 'TEST_FAILED: missing invalid FX warning';
  END IF;

  RAISE NOTICE 'PASS: FX-aware VAT taxable bases (622)';
END $$;

ROLLBACK;
