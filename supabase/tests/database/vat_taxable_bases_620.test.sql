-- ============================================================================
-- VAT taxable bases from transaction evidence (migration 620)
-- Runs inside one transaction and rolls back all data.
--
-- Usage:
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/database/vat_taxable_bases_620.test.sql
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_biz UUID := gen_random_uuid();
  v_period UUID := gen_random_uuid();
  v_ar UUID;
  v_revenue UUID;
  v_invoice UUID;
  v_credit UUID;
  v_bill UUID;
  v_expense UUID := gen_random_uuid();
  v_standard_category UUID := gen_random_uuid();
  v_zero_category UUID := gen_random_uuid();
  v_exempt_category UUID := gen_random_uuid();
  v_standard_product UUID := gen_random_uuid();
  v_zero_product UUID := gen_random_uuid();
  v_exempt_product UUID := gen_random_uuid();
  v_sale_standard UUID := gen_random_uuid();
  v_sale_zero UUID := gen_random_uuid();
  v_sale_exempt UUID := gen_random_uuid();
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
    v_biz, '620 VAT Taxable Bases Test', 'Ghana', 'GHS', 'service', v_owner,
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

  IF v_ar IS NULL OR v_revenue IS NULL THEN
    RAISE EXCEPTION 'TEST_SETUP: required accounts are missing';
  END IF;

  -- This test exercises the read-only extraction function, not the document
  -- posting triggers. Disable user triggers for deterministic fixtures; the
  -- transaction rolls back and restores them.
  ALTER TABLE public.invoices DISABLE TRIGGER USER;
  ALTER TABLE public.credit_notes DISABLE TRIGGER USER;
  ALTER TABLE public.bills DISABLE TRIGGER USER;
  ALTER TABLE public.expenses DISABLE TRIGGER USER;
  ALTER TABLE public.sales DISABLE TRIGGER USER;
  ALTER TABLE public.sale_items DISABLE TRIGGER USER;

  -- Standard-rated invoice: 100 base, 15 VAT, 2.5 NHIL, 2.5 GETFund.
  INSERT INTO public.invoices (
    business_id, subtotal, total_tax, total, issue_date, status, tax_lines,
    vat_classification
  ) VALUES (
    v_biz, 100, 20, 120, CURRENT_DATE, 'sent',
    jsonb_build_object(
      'lines', jsonb_build_array(
        jsonb_build_object('code', 'VAT', 'amount', 15, 'rate', 0.15,
          'meta', jsonb_build_object('base', 100)),
        jsonb_build_object('code', 'NHIL', 'amount', 2.5, 'rate', 0.025,
          'meta', jsonb_build_object('base', 100)),
        jsonb_build_object('code', 'GETFUND', 'amount', 2.5, 'rate', 0.025,
          'meta', jsonb_build_object('base', 100))
      ),
      'pricing_mode', 'exclusive'
    ),
    'standard'
  )
  RETURNING id INTO v_invoice;

  -- Applied credit note reduces standard-rated sales by 10.
  INSERT INTO public.credit_notes (
    business_id, invoice_id, credit_number, date, subtotal, total, status,
    tax_lines, vat_classification
  ) VALUES (
    v_biz, v_invoice, 'CN-620', CURRENT_DATE, 10, 12, 'applied',
    jsonb_build_object(
      'lines', jsonb_build_array(
        jsonb_build_object('code', 'VAT', 'amount', 1.5, 'rate', 0.15,
          'meta', jsonb_build_object('base', 10))
      )
    ),
    'standard'
  )
  RETURNING id INTO v_credit;

  -- Retail categories and products.
  INSERT INTO public.categories (id, business_id, name, vat_type)
  VALUES
    (v_standard_category, v_biz, '620 Standard', 'standard'),
    (v_zero_category, v_biz, '620 Zero', 'zero'),
    (v_exempt_category, v_biz, '620 Exempt', 'exempt');

  INSERT INTO public.products (id, business_id, name, price, category_id)
  VALUES
    (v_standard_product, v_biz, '620 Standard Product', 50, v_standard_category),
    (v_zero_product, v_biz, '620 Zero Product', 30, v_zero_category),
    (v_exempt_product, v_biz, '620 Exempt Product', 20, v_exempt_category);

  -- Retail standard-rated sale: 50 base.
  INSERT INTO public.sales (
    id, business_id, amount, created_at, payment_status, tax_lines
  ) VALUES (
    v_sale_standard, v_biz, 60, NOW(), 'paid',
    jsonb_build_object(
      'tax_lines', jsonb_build_array(
        jsonb_build_object('code', 'VAT', 'amount', 7.5, 'rate', 0.15, 'base', 50),
        jsonb_build_object('code', 'NHIL', 'amount', 1.25, 'rate', 0.025, 'base', 50),
        jsonb_build_object('code', 'GETFUND', 'amount', 1.25, 'rate', 0.025, 'base', 50)
      ),
      'subtotal_excl_tax', 50,
      'total_incl_tax', 60
    )
  );

  -- Retail zero-rated and exempt sales.
  INSERT INTO public.sales (id, business_id, amount, created_at, payment_status, tax_lines)
  VALUES
    (v_sale_zero, v_biz, 30, NOW(), 'paid', '{}'::jsonb),
    (v_sale_exempt, v_biz, 20, NOW(), 'paid', '{}'::jsonb);

  INSERT INTO public.sale_items (sale_id, product_id, name, price, qty, discount_amount)
  VALUES
    (v_sale_standard, v_standard_product, '620 Standard Product', 50, 1, 0),
    (v_sale_zero, v_zero_product, '620 Zero Product', 30, 1, 0),
    (v_sale_exempt, v_exempt_product, '620 Exempt Product', 20, 1, 0);

  -- Standard-rated bill: 40 base.
  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, due_date, status,
    subtotal, total_tax, total, bill_type, tax_lines, vat_classification
  ) VALUES (
    v_biz, '620 Supplier', 'BILL-620', CURRENT_DATE, CURRENT_DATE, 'open',
    40, 8, 48, 'standard',
    jsonb_build_object(
      'lines', jsonb_build_array(
        jsonb_build_object('code', 'VAT', 'amount', 6, 'rate', 0.15,
          'meta', jsonb_build_object('base', 40))
      )
    ),
    'standard'
  )
  RETURNING id INTO v_bill;

  -- Expense with input VAT: 50 base.
  INSERT INTO public.expenses (
    id, business_id, supplier, amount, vat, nhil, getfund, covid, total, date,
    vat_classification
  ) VALUES (
    v_expense, v_biz, '620 Expense Supplier', 50, 7.5, 0, 0, 0, 57.5, CURRENT_DATE,
    'standard'
  );

  ALTER TABLE public.invoices ENABLE TRIGGER USER;
  ALTER TABLE public.credit_notes ENABLE TRIGGER USER;
  ALTER TABLE public.bills ENABLE TRIGGER USER;
  ALTER TABLE public.expenses ENABLE TRIGGER USER;
  ALTER TABLE public.sales ENABLE TRIGGER USER;
  ALTER TABLE public.sale_items ENABLE TRIGGER USER;

  -- Ledger revenue must equal standard + zero-rated + exempt sales:
  -- 100 invoice + 50 retail - 10 credit note + 30 zero + 20 exempt = 190.
  PERFORM public.post_journal_entry(
    p_business_id => v_biz,
    p_date => CURRENT_DATE,
    p_description => '620 VAT taxable base test revenue',
    p_reference_type => 'invoice',
    p_reference_id => v_invoice,
    p_lines => jsonb_build_array(
      jsonb_build_object('account_id', v_ar, 'debit', 190),
      jsonb_build_object('account_id', v_revenue, 'credit', 190)
    ),
    p_created_by => v_owner,
    p_posting_source => 'system'
  );

  v_bases := public.extract_vat_taxable_bases(
    v_biz,
    date_trunc('month', CURRENT_DATE)::date,
    (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date
  );

  IF (v_bases->>'standard_rated_sales')::NUMERIC <> 140 THEN
    RAISE EXCEPTION 'TEST_FAILED: standard-rated sales expected 140, got %',
      v_bases->>'standard_rated_sales';
  END IF;
  IF (v_bases->>'zero_rated_sales')::NUMERIC <> 30 THEN
    RAISE EXCEPTION 'TEST_FAILED: zero-rated sales expected 30, got %',
      v_bases->>'zero_rated_sales';
  END IF;
  IF (v_bases->>'exempt_sales')::NUMERIC <> 20 THEN
    RAISE EXCEPTION 'TEST_FAILED: exempt sales expected 20, got %',
      v_bases->>'exempt_sales';
  END IF;
  IF (v_bases->>'standard_rated_purchases')::NUMERIC <> 90 THEN
    RAISE EXCEPTION 'TEST_FAILED: standard-rated purchases expected 90, got %',
      v_bases->>'standard_rated_purchases';
  END IF;
  IF (v_bases->>'ledger_revenue_credits')::NUMERIC <> 190 THEN
    RAISE EXCEPTION 'TEST_FAILED: ledger revenue expected 190, got %',
      v_bases->>'ledger_revenue_credits';
  END IF;

  -- An unclassified sale must produce a warning, not a guessed figure.
  INSERT INTO public.invoices (
    business_id, subtotal, total_tax, total, issue_date, status, tax_lines,
    vat_classification
  ) VALUES (
    v_biz, 10, 0, 10, CURRENT_DATE, 'sent', '[]'::jsonb, 'unclassified'
  );

  v_bases := public.extract_vat_taxable_bases(
    v_biz,
    date_trunc('month', CURRENT_DATE)::date,
    (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date
  );

  IF (v_bases->>'unclassified_sales_count')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: unclassified sales count expected 1, got %',
      v_bases->>'unclassified_sales_count';
  END IF;
  IF NOT (v_bases->'warnings')::TEXT LIKE '%no VAT classification%' THEN
    RAISE EXCEPTION 'TEST_FAILED: missing unclassified sales warning';
  END IF;

  -- No transaction evidence must never be replaced by VAT / 15%.
  v_bases := public.extract_vat_taxable_bases(
    v_biz,
    (date_trunc('month', CURRENT_DATE) + interval '2 months')::date,
    (date_trunc('month', CURRENT_DATE) + interval '3 months - 1 day')::date
  );

  IF (v_bases->>'standard_rated_sales')::NUMERIC <> 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: empty period derived a taxable sales base (%)',
      v_bases->>'standard_rated_sales';
  END IF;

  RAISE NOTICE 'PASS: VAT taxable bases from transaction evidence (620)';
END $$;

ROLLBACK;
