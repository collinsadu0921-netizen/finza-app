-- ============================================================================
-- Retail VAT classification and discount handling (migration 622, F-18)
-- Runs inside one transaction and rolls back all data.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_owner UUID;
  v_biz UUID := gen_random_uuid();
  v_ar UUID;
  v_revenue UUID;
  v_standard_cat UUID := gen_random_uuid();
  v_zero_cat UUID := gen_random_uuid();
  v_exempt_cat UUID := gen_random_uuid();
  v_standard_product UUID := gen_random_uuid();
  v_zero_product UUID := gen_random_uuid();
  v_exempt_product UUID := gen_random_uuid();
  v_sale UUID;
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
    v_biz, '622 Retail VAT Test', 'Ghana', 'GHS', 'retail', v_owner,
    'business', 'active', TRUE, NOW(), NOW()
  );

  PERFORM public.create_system_accounts(v_biz);
  PERFORM public.initialize_business_chart_of_accounts(v_biz);

  INSERT INTO public.accounting_periods (business_id, period_start, period_end, status)
  VALUES (
    v_biz,
    date_trunc('month', CURRENT_DATE)::date,
    (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date,
    'open'
  );

  SELECT id INTO v_ar FROM public.accounts
  WHERE business_id = v_biz AND code = '1100' AND deleted_at IS NULL;
  SELECT id INTO v_revenue FROM public.accounts
  WHERE business_id = v_biz AND code = '4000' AND deleted_at IS NULL;

  INSERT INTO public.categories (id, business_id, name, vat_type)
  VALUES
    (v_standard_cat, v_biz, 'Retail standard', 'standard'),
    (v_zero_cat, v_biz, 'Retail zero', 'zero'),
    (v_exempt_cat, v_biz, 'Retail exempt', 'exempt');

  INSERT INTO public.products (id, business_id, name, price, category_id)
  VALUES
    (v_standard_product, v_biz, 'Standard item', 120, v_standard_cat),
    (v_zero_product, v_biz, 'Zero item', 50, v_zero_cat),
    (v_exempt_product, v_biz, 'Exempt item', 30, v_exempt_cat);

  ALTER TABLE public.sales DISABLE TRIGGER USER;
  ALTER TABLE public.sale_items DISABLE TRIGGER USER;

  -- Standard sale: net 100, tax 20, gross 120.
  INSERT INTO public.sales (
    id, business_id, amount, payment_method, payment_status, created_at,
    tax_lines, subtotal_before_discount, subtotal_after_discount
  ) VALUES (
    gen_random_uuid(), v_biz, 120, 'cash', 'paid', NOW(),
    jsonb_build_object(
      'tax_lines', jsonb_build_array(
        jsonb_build_object('code', 'VAT', 'amount', 20, 'base', 100, 'rate', 0.2)
      ),
      'subtotal_excl_tax', 100,
      'tax_total', 20,
      'total_incl_tax', 120
    ),
    120, 120
  ) RETURNING id INTO v_sale;
  INSERT INTO public.sale_items (sale_id, product_id, name, price, qty)
  VALUES (v_sale, v_standard_product, 'Standard item', 120, 1);

  -- Zero-rated sale without tax lines.
  INSERT INTO public.sales (
    id, business_id, amount, payment_method, payment_status, created_at,
    subtotal_before_discount, subtotal_after_discount
  ) VALUES (
    gen_random_uuid(), v_biz, 50, 'cash', 'paid', NOW(), 50, 50
  ) RETURNING id INTO v_sale;
  INSERT INTO public.sale_items (sale_id, product_id, name, price, qty)
  VALUES (v_sale, v_zero_product, 'Zero item', 50, 1);

  -- Exempt sale without tax lines.
  INSERT INTO public.sales (
    id, business_id, amount, payment_method, payment_status, created_at,
    subtotal_before_discount, subtotal_after_discount
  ) VALUES (
    gen_random_uuid(), v_biz, 30, 'cash', 'paid', NOW(), 30, 30
  ) RETURNING id INTO v_sale;
  INSERT INTO public.sale_items (sale_id, product_id, name, price, qty)
  VALUES (v_sale, v_exempt_product, 'Exempt item', 30, 1);

  -- Mixed standard + zero sale. Net total 150 (standard 100 + zero 50).
  INSERT INTO public.sales (
    id, business_id, amount, payment_method, payment_status, created_at,
    tax_lines, subtotal_before_discount, subtotal_after_discount
  ) VALUES (
    gen_random_uuid(), v_biz, 170, 'cash', 'paid', NOW(),
    jsonb_build_object(
      'tax_lines', jsonb_build_array(
        jsonb_build_object('code', 'VAT', 'amount', 20, 'base', 100, 'rate', 0.2)
      ),
      'subtotal_excl_tax', 150,
      'tax_total', 20,
      'total_incl_tax', 170
    ),
    170, 170
  ) RETURNING id INTO v_sale;
  INSERT INTO public.sale_items (sale_id, product_id, name, price, qty)
  VALUES
    (v_sale, v_standard_product, 'Standard item', 120, 1),
    (v_sale, v_zero_product, 'Zero item', 50, 1);

  -- Voided, refunded and pending standard sales must not be counted.
  INSERT INTO public.sales (
    id, business_id, amount, payment_method, payment_status, created_at,
    tax_lines, subtotal_before_discount, subtotal_after_discount
  ) VALUES
    (gen_random_uuid(), v_biz, 120, 'cash', 'voided', NOW(),
      jsonb_build_object('subtotal_excl_tax', 100, 'tax_total', 20), 120, 120),
    (gen_random_uuid(), v_biz, 120, 'cash', 'refunded', NOW(),
      jsonb_build_object('subtotal_excl_tax', 100, 'tax_total', 20), 120, 120),
    (gen_random_uuid(), v_biz, 120, 'cash', 'pending', NOW(),
      jsonb_build_object('subtotal_excl_tax', 100, 'tax_total', 20), 120, 120);

  ALTER TABLE public.sale_items ENABLE TRIGGER USER;
  ALTER TABLE public.sales ENABLE TRIGGER USER;

  v_bases := public.extract_vat_taxable_bases(
    v_biz,
    date_trunc('month', CURRENT_DATE)::date,
    (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date
  );

  IF (v_bases->>'standard_rated_sales')::NUMERIC <> 200 THEN
    RAISE EXCEPTION 'TEST_FAILED: retail standard expected 200, got %',
      v_bases->>'standard_rated_sales';
  END IF;
  IF (v_bases->>'zero_rated_sales')::NUMERIC <> 100 THEN
    RAISE EXCEPTION 'TEST_FAILED: retail zero expected 100, got %',
      v_bases->>'zero_rated_sales';
  END IF;
  IF (v_bases->>'exempt_sales')::NUMERIC <> 30 THEN
    RAISE EXCEPTION 'TEST_FAILED: retail exempt expected 30, got %',
      v_bases->>'exempt_sales';
  END IF;
  IF (v_bases->>'fallback_sales_count')::INTEGER <> 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: unexpected retail fallback count %',
      v_bases->>'fallback_sales_count';
  END IF;

  RAISE NOTICE 'PASS: retail VAT classification and discount handling (622)';
END $$;

ROLLBACK;
