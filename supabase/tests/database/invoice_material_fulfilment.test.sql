-- ============================================================================
-- Non-production database tests for migration 549
-- (source-aware invoice material fulfilment)
--
-- Isolation: single transaction ending with ROLLBACK.
-- Synthetic business only. Staging/local after 549 applied.
--
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/database/invoice_material_fulfilment.test.sql
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_business_id UUID := gen_random_uuid();
  v_owner_id UUID;
  v_customer_id UUID;
  v_material_id UUID;
  v_job_id UUID;
  v_usage_id UUID;
  v_invoice_id UUID;
  v_item_direct UUID;
  v_item_job UUID;
  v_item_legacy UUID;
  v_item_mixed_svc UUID;
  v_fulfil_id UUID;
  v_fulfil_id_2 UUID;
  v_return_id UUID;
  v_je_id UUID;
  v_mov_id UUID;
  v_qty NUMERIC;
  v_avg NUMERIC;
  v_debit_5110 NUMERIC;
  v_credit_1450 NUMERIC;
  v_debit_1450 NUMERIC;
  v_credit_5110 NUMERIC;
  v_result JSONB;
  v_result2 JSONB;
  v_err TEXT;
  v_issue DATE := DATE '2099-07-15';
  v_period_start DATE := DATE '2099-07-01';
  v_period_end DATE := DATE '2099-07-31';
  v_pass INT := 0;
BEGIN
  SELECT id INTO v_owner_id FROM auth.users ORDER BY created_at NULLS LAST LIMIT 1;
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'setup_owner_missing';
  END IF;

  INSERT INTO public.businesses (id, owner_id, name, industry)
  VALUES (v_business_id, v_owner_id, 'InvMatFulfilTest ' || v_business_id::text, 'service');

  INSERT INTO public.accounting_periods (business_id, period_start, period_end, status)
  VALUES (v_business_id, v_period_start, v_period_end, 'open');

  INSERT INTO public.accounts (business_id, name, code, type, is_system)
  VALUES
    (v_business_id, 'Inventory Materials', '1450', 'asset', TRUE),
    (v_business_id, 'Accounts Receivable', '1200', 'asset', TRUE),
    (v_business_id, 'Cost of Services Materials', '5110', 'expense', TRUE),
    (v_business_id, 'Service Revenue', '4000', 'income', TRUE);

  INSERT INTO public.chart_of_accounts (business_id, account_code, account_name, account_type, is_active)
  VALUES
    (v_business_id, '1450', 'Inventory Materials', 'asset', TRUE),
    (v_business_id, '1200', 'Accounts Receivable', 'asset', TRUE),
    (v_business_id, '5110', 'Cost of Services Materials', 'expense', TRUE),
    (v_business_id, '4000', 'Service Revenue', 'revenue', TRUE);

  INSERT INTO public.chart_of_accounts_control_map (business_id, control_key, account_code)
  VALUES
    (v_business_id, 'AR', '1200');

  INSERT INTO public.customers (id, business_id, name)
  VALUES (gen_random_uuid(), v_business_id, 'Fulfil Test Customer')
  RETURNING id INTO v_customer_id;

  INSERT INTO public.service_material_inventory (
    id, business_id, name, unit, quantity_on_hand, average_cost, is_active, is_billable, default_selling_price
  ) VALUES (
    gen_random_uuid(), v_business_id, 'Test Cable', 'pcs', 10, 100, TRUE, TRUE, 160
  ) RETURNING id INTO v_material_id;

  -- -------------------------------------------------------------------------
  -- 1) Direct-sale full fulfilment
  -- -------------------------------------------------------------------------
  INSERT INTO public.invoices (
    id, business_id, customer_id, status, issue_date, subtotal, total, currency_code
  ) VALUES (
    gen_random_uuid(), v_business_id, v_customer_id, 'sent', v_issue, 160, 160, 'GHS'
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items (
    id, invoice_id, material_id, material_inventory_source, description, qty, unit_price, discount_amount, line_subtotal
  ) VALUES (
    gen_random_uuid(), v_invoice_id, v_material_id, 'direct_sale', 'Test Cable', 1, 160, 0, 160
  ) RETURNING id INTO v_item_direct;

  v_result := fulfil_invoice_material_line(
    v_business_id, v_item_direct, 1, 'idem-full-1', v_owner_id, v_issue
  );

  SELECT quantity_on_hand, average_cost INTO v_qty, v_avg
  FROM service_material_inventory WHERE id = v_material_id;
  IF v_qty IS DISTINCT FROM 9 THEN
    RAISE EXCEPTION 'T1_STOCK: expected 9 got %', v_qty;
  END IF;

  v_fulfil_id := (v_result->>'fulfilment_id')::UUID;
  v_je_id := (v_result->>'journal_entry_id')::UUID;

  SELECT
    COALESCE(SUM(jel.debit) FILTER (WHERE jel.account_id = get_account_by_code(v_business_id, '5110')), 0),
    COALESCE(SUM(jel.credit) FILTER (WHERE jel.account_id = get_account_by_code(v_business_id, '1450')), 0)
  INTO v_debit_5110, v_credit_1450
  FROM public.journal_entry_lines jel
  WHERE jel.journal_entry_id = v_je_id;

  IF v_debit_5110 IS DISTINCT FROM 100 OR v_credit_1450 IS DISTINCT FROM 100 THEN
    RAISE EXCEPTION 'T1_JE: expected Dr5110=100 Cr1450=100 got % / %', v_debit_5110, v_credit_1450;
  END IF;
  v_pass := v_pass + 1;

  -- -------------------------------------------------------------------------
  -- 3) Idempotent retry
  -- -------------------------------------------------------------------------
  v_result2 := fulfil_invoice_material_line(
    v_business_id, v_item_direct, 1, 'idem-full-1', v_owner_id, v_issue
  );
  IF COALESCE((v_result2->>'idempotent')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'T3_IDEMPOTENT: expected idempotent true';
  END IF;
  IF (v_result2->>'fulfilment_id') IS DISTINCT FROM (v_result->>'fulfilment_id') THEN
    RAISE EXCEPTION 'T3_IDEMPOTENT: fulfilment id changed';
  END IF;
  SELECT quantity_on_hand INTO v_qty FROM service_material_inventory WHERE id = v_material_id;
  IF v_qty IS DISTINCT FROM 9 THEN
    RAISE EXCEPTION 'T3_STOCK: expected still 9 got %', v_qty;
  END IF;
  v_pass := v_pass + 1;

  -- -------------------------------------------------------------------------
  -- 2) Partial fulfilment on new invoice qty 5
  -- -------------------------------------------------------------------------
  INSERT INTO public.invoices (
    id, business_id, customer_id, status, issue_date, subtotal, total, currency_code
  ) VALUES (
    gen_random_uuid(), v_business_id, v_customer_id, 'sent', v_issue, 800, 800, 'GHS'
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items (
    id, invoice_id, material_id, material_inventory_source, description, qty, unit_price, discount_amount, line_subtotal
  ) VALUES (
    gen_random_uuid(), v_invoice_id, v_material_id, 'direct_sale', 'Test Cable', 5, 160, 0, 800
  ) RETURNING id INTO v_item_direct;

  v_result := fulfil_invoice_material_line(
    v_business_id, v_item_direct, 2, 'idem-partial-a', v_owner_id, v_issue
  );
  IF public.invoice_item_fulfilled_quantity(v_item_direct) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'T2_REMAINING_A: fulfilled should be 2';
  END IF;

  v_result := fulfil_invoice_material_line(
    v_business_id, v_item_direct, 3, 'idem-partial-b', v_owner_id, v_issue
  );
  IF public.invoice_item_fulfilled_quantity(v_item_direct) IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'T2_REMAINING_B: fulfilled should be 5';
  END IF;

  SELECT quantity_on_hand INTO v_qty FROM service_material_inventory WHERE id = v_material_id;
  -- started 9 after T1; partial 2+3 = 5 → 4
  IF v_qty IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'T2_STOCK: expected 4 got %', v_qty;
  END IF;
  v_pass := v_pass + 1;

  -- -------------------------------------------------------------------------
  -- 4) Insufficient stock
  -- -------------------------------------------------------------------------
  INSERT INTO public.invoices (
    id, business_id, customer_id, status, issue_date, subtotal, total, currency_code
  ) VALUES (
    gen_random_uuid(), v_business_id, v_customer_id, 'sent', v_issue, 1600, 1600, 'GHS'
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items (
    id, invoice_id, material_id, material_inventory_source, description, qty, unit_price, discount_amount, line_subtotal
  ) VALUES (
    gen_random_uuid(), v_invoice_id, v_material_id, 'direct_sale', 'Test Cable', 10, 160, 0, 1600
  ) RETURNING id INTO v_item_direct;

  BEGIN
    PERFORM fulfil_invoice_material_line(
      v_business_id, v_item_direct, 10, 'idem-insuff', v_owner_id, v_issue
    );
    RAISE EXCEPTION 'T4_SHOULD_FAIL';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err NOT ILIKE '%INSUFFICIENT_STOCK%' THEN
      RAISE EXCEPTION 'T4_WRONG_ERR: %', v_err;
    END IF;
  END;
  SELECT quantity_on_hand INTO v_qty FROM service_material_inventory WHERE id = v_material_id;
  IF v_qty IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'T4_STOCK_CHANGED: %', v_qty;
  END IF;
  v_pass := v_pass + 1;

  -- -------------------------------------------------------------------------
  -- 5) Draft invoice blocked
  -- -------------------------------------------------------------------------
  INSERT INTO public.invoices (
    id, business_id, customer_id, status, issue_date, subtotal, total, currency_code
  ) VALUES (
    gen_random_uuid(), v_business_id, v_customer_id, 'draft', v_issue, 160, 160, 'GHS'
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items (
    id, invoice_id, material_id, material_inventory_source, description, qty, unit_price, discount_amount, line_subtotal
  ) VALUES (
    gen_random_uuid(), v_invoice_id, v_material_id, 'direct_sale', 'Test Cable', 1, 160, 0, 160
  ) RETURNING id INTO v_item_direct;

  BEGIN
    PERFORM fulfil_invoice_material_line(
      v_business_id, v_item_direct, 1, 'idem-draft', v_owner_id, v_issue
    );
    RAISE EXCEPTION 'T5_SHOULD_FAIL';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%INVOICE_NOT_ISSUED%' THEN
      RAISE EXCEPTION 'T5_WRONG_ERR: %', SQLERRM;
    END IF;
  END;
  v_pass := v_pass + 1;

  -- -------------------------------------------------------------------------
  -- 6 + 7) Job-sourced line + allocation limit
  -- -------------------------------------------------------------------------
  INSERT INTO public.service_jobs (id, business_id, customer_id, status)
  VALUES (gen_random_uuid(), v_business_id, v_customer_id, 'in_progress')
  RETURNING id INTO v_job_id;

  -- Simulate job consume: stock already reduced, usage consumed
  UPDATE service_material_inventory SET quantity_on_hand = quantity_on_hand - 2 WHERE id = v_material_id;
  INSERT INTO public.service_job_material_usage (
    id, business_id, job_id, material_id, quantity_used, unit_cost, total_cost, status
  ) VALUES (
    gen_random_uuid(), v_business_id, v_job_id, v_material_id, 2, 100, 200, 'consumed'
  ) RETURNING id INTO v_usage_id;

  SELECT quantity_on_hand INTO v_qty FROM service_material_inventory WHERE id = v_material_id;
  -- was 4, minus 2 = 2
  IF v_qty IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'T6_PRE_STOCK: expected 2 got %', v_qty;
  END IF;

  INSERT INTO public.invoices (
    id, business_id, customer_id, status, issue_date, subtotal, total, currency_code
  ) VALUES (
    gen_random_uuid(), v_business_id, v_customer_id, 'sent', v_issue, 320, 320, 'GHS'
  ) RETURNING id INTO v_invoice_id;

  UPDATE service_jobs SET invoice_id = v_invoice_id WHERE id = v_job_id;

  INSERT INTO public.invoice_items (
    id, invoice_id, material_id, material_inventory_source, job_material_usage_id,
    description, qty, unit_price, discount_amount, line_subtotal
  ) VALUES (
    gen_random_uuid(), v_invoice_id, v_material_id, 'job_usage', v_usage_id,
    'Test Cable (job)', 2, 160, 0, 320
  ) RETURNING id INTO v_item_job;

  BEGIN
    PERFORM fulfil_invoice_material_line(
      v_business_id, v_item_job, 1, 'idem-job-ful', v_owner_id, v_issue
    );
    RAISE EXCEPTION 'T6_SHOULD_FAIL';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%JOB_USAGE_NO_FULFIL%' THEN
      RAISE EXCEPTION 'T6_WRONG_ERR: %', SQLERRM;
    END IF;
  END;

  SELECT quantity_on_hand INTO v_qty FROM service_material_inventory WHERE id = v_material_id;
  IF v_qty IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'T6_STOCK: job invoice must not reduce stock again (got %)', v_qty;
  END IF;

  -- Over-allocation
  BEGIN
    INSERT INTO public.invoice_items (
      invoice_id, material_id, material_inventory_source, job_material_usage_id,
      description, qty, unit_price, discount_amount, line_subtotal
    ) VALUES (
      v_invoice_id, v_material_id, 'job_usage', v_usage_id,
      'Over', 1, 160, 0, 160
    );
    RAISE EXCEPTION 'T7_SHOULD_FAIL';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%INVOICE_JOB_USAGE_OVER_ALLOCATED%'
       AND SQLERRM NOT ILIKE '%T7_SHOULD_FAIL%' THEN
      -- ok if over-allocated
      NULL;
    END IF;
    IF SQLERRM ILIKE '%T7_SHOULD_FAIL%' THEN
      RAISE EXCEPTION 'T7_OVER_ALLOC_NOT_BLOCKED';
    END IF;
  END;
  v_pass := v_pass + 2;

  -- -------------------------------------------------------------------------
  -- 9) Legacy cannot fulfil
  -- -------------------------------------------------------------------------
  INSERT INTO public.invoices (
    id, business_id, customer_id, status, issue_date, subtotal, total, currency_code
  ) VALUES (
    gen_random_uuid(), v_business_id, v_customer_id, 'sent', v_issue, 160, 160, 'GHS'
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items (
    id, invoice_id, material_id, material_inventory_source, description, qty, unit_price, discount_amount, line_subtotal
  ) VALUES (
    gen_random_uuid(), v_invoice_id, v_material_id, 'legacy_unclassified', 'Legacy', 1, 160, 0, 160
  ) RETURNING id INTO v_item_legacy;

  BEGIN
    PERFORM fulfil_invoice_material_line(
      v_business_id, v_item_legacy, 1, 'idem-legacy', v_owner_id, v_issue
    );
    RAISE EXCEPTION 'T9_SHOULD_FAIL';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%LEGACY_SOURCE_REQUIRED%' THEN
      RAISE EXCEPTION 'T9_WRONG_ERR: %', SQLERRM;
    END IF;
  END;
  v_pass := v_pass + 1;

  -- -------------------------------------------------------------------------
  -- 11 + 13) Return uses snapshotted cost after avg cost change
  -- -------------------------------------------------------------------------
  INSERT INTO public.invoices (
    id, business_id, customer_id, status, issue_date, subtotal, total, currency_code
  ) VALUES (
    gen_random_uuid(), v_business_id, v_customer_id, 'sent', v_issue, 160, 160, 'GHS'
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items (
    id, invoice_id, material_id, material_inventory_source, description, qty, unit_price, discount_amount, line_subtotal
  ) VALUES (
    gen_random_uuid(), v_invoice_id, v_material_id, 'direct_sale', 'Return test', 1, 160, 0, 160
  ) RETURNING id INTO v_item_direct;

  v_result := fulfil_invoice_material_line(
    v_business_id, v_item_direct, 1, 'idem-ret-ful', v_owner_id, v_issue
  );
  v_fulfil_id := (v_result->>'fulfilment_id')::UUID;

  UPDATE service_material_inventory SET average_cost = 999 WHERE id = v_material_id;

  v_result := return_invoice_material_fulfilment(
    v_business_id, v_fulfil_id, 1, 'idem-ret-1', v_owner_id, v_issue
  );

  IF (v_result->>'unit_cost')::NUMERIC IS DISTINCT FROM 100 THEN
    RAISE EXCEPTION 'T13_COST: expected snapshot 100 got %', v_result->>'unit_cost';
  END IF;

  v_je_id := (v_result->>'journal_entry_id')::UUID;
  SELECT
    COALESCE(SUM(jel.debit) FILTER (WHERE jel.account_id = get_account_by_code(v_business_id, '1450')), 0),
    COALESCE(SUM(jel.credit) FILTER (WHERE jel.account_id = get_account_by_code(v_business_id, '5110')), 0)
  INTO v_debit_1450, v_credit_5110
  FROM public.journal_entry_lines jel
  WHERE jel.journal_entry_id = v_je_id;

  IF v_debit_1450 IS DISTINCT FROM 100 OR v_credit_5110 IS DISTINCT FROM 100 THEN
    RAISE EXCEPTION 'T11_JE: expected Dr1450=100 Cr5110=100 got % / %', v_debit_1450, v_credit_5110;
  END IF;

  -- Idempotent return
  v_result2 := return_invoice_material_fulfilment(
    v_business_id, v_fulfil_id, 1, 'idem-ret-1', v_owner_id, v_issue
  );
  IF COALESCE((v_result2->>'idempotent')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'T11_IDEMPOTENT';
  END IF;
  v_pass := v_pass + 2;

  -- -------------------------------------------------------------------------
  -- 14) Cross-tenant block
  -- -------------------------------------------------------------------------
  BEGIN
    PERFORM fulfil_invoice_material_line(
      gen_random_uuid(), v_item_direct, 1, 'idem-xt', v_owner_id, v_issue
    );
    RAISE EXCEPTION 'T14_SHOULD_FAIL';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%CROSS_TENANT%' AND SQLERRM NOT ILIKE '%not found%' THEN
      RAISE EXCEPTION 'T14_WRONG_ERR: %', SQLERRM;
    END IF;
  END;
  v_pass := v_pass + 1;

  RAISE NOTICE 'invoice_material_fulfilment tests PASS count=%', v_pass;
END $$;

ROLLBACK;
