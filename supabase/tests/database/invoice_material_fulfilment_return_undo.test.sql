-- ============================================================================
-- Non-production database tests for migration 550
-- (undo invoice material fulfilment return)
--
-- Isolation: single transaction ending with ROLLBACK.
--
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/database/invoice_material_fulfilment_return_undo.test.sql
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_business_id UUID := gen_random_uuid();
  v_owner_id UUID;
  v_customer_id UUID;
  v_material_id UUID;
  v_invoice_id UUID;
  v_item_id UUID;
  v_fulfil_id UUID;
  v_return_id UUID;
  v_undo_id UUID;
  v_result JSONB;
  v_result2 JSONB;
  v_qty NUMERIC;
  v_avg NUMERIC;
  v_debit_5110 NUMERIC;
  v_credit_1450 NUMERIC;
  v_err TEXT;
  v_issue DATE := DATE '2099-08-15';
  v_period_start DATE := DATE '2099-08-01';
  v_period_end DATE := DATE '2099-08-31';
  v_pass INT := 0;
BEGIN
  SELECT id INTO v_owner_id FROM auth.users ORDER BY created_at NULLS LAST LIMIT 1;
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'setup_owner_missing';
  END IF;

  INSERT INTO public.businesses (id, owner_id, name, industry)
  VALUES (v_business_id, v_owner_id, 'InvMatUndoTest ' || v_business_id::text, 'service');

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
  VALUES (gen_random_uuid(), v_business_id, 'Undo Test Customer')
  RETURNING id INTO v_customer_id;

  INSERT INTO public.service_material_inventory (
    id, business_id, name, unit, quantity_on_hand, average_cost, is_active, is_billable, default_selling_price
  ) VALUES (
    gen_random_uuid(), v_business_id, 'Undo Test Material', 'unit', 10, 9.89, TRUE, TRUE, 20
  ) RETURNING id, quantity_on_hand, average_cost INTO v_material_id, v_qty, v_avg;

  INSERT INTO public.invoices (
    id, business_id, customer_id, invoice_number, status, issue_date, due_date,
    subtotal, total, currency_code
  ) VALUES (
    gen_random_uuid(), v_business_id, v_customer_id, 'UNDO-TEST-1', 'sent',
    v_issue, v_issue + 14, 100, 100, 'GHS'
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items (
    id, invoice_id, description, qty, unit_price, line_subtotal,
    material_id, material_inventory_source
  ) VALUES (
    gen_random_uuid(), v_invoice_id, 'Undo Test Material', 5, 20, 100,
    v_material_id, 'direct_sale'
  ) RETURNING id INTO v_item_id;

  -- Fulfil 5
  v_result := public.fulfil_invoice_material_line(
    v_business_id, v_item_id, 5, 'undo-test-fulfil-1', v_owner_id, v_issue
  );
  v_fulfil_id := (v_result->>'fulfilment_id')::UUID;
  SELECT quantity_on_hand INTO v_qty FROM public.service_material_inventory WHERE id = v_material_id;
  IF v_qty <> 5 THEN RAISE EXCEPTION 'fulfil_stock_expected_5 got %', v_qty; END IF;
  v_pass := v_pass + 1;

  -- Cancel blocked while active
  BEGIN
    UPDATE public.invoices SET status = 'cancelled' WHERE id = v_invoice_id;
    RAISE EXCEPTION 'cancel_should_have_been_blocked';
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err NOT LIKE '%INVOICE_HAS_ACTIVE_FULFILMENTS%' THEN
        RAISE EXCEPTION 'cancel_block_unexpected: %', v_err;
      END IF;
  END;
  v_pass := v_pass + 1;

  -- Return 5
  v_result := public.return_invoice_material_fulfilment(
    v_business_id, v_fulfil_id, 5, 'undo-test-return-1', v_owner_id, v_issue
  );
  v_return_id := (v_result->>'return_id')::UUID;
  SELECT quantity_on_hand INTO v_qty FROM public.service_material_inventory WHERE id = v_material_id;
  IF v_qty <> 10 THEN RAISE EXCEPTION 'return_stock_expected_10 got %', v_qty; END IF;
  v_pass := v_pass + 1;

  -- Cancel allowed after full return
  UPDATE public.invoices SET status = 'cancelled' WHERE id = v_invoice_id;
  UPDATE public.invoices SET status = 'sent' WHERE id = v_invoice_id;
  v_pass := v_pass + 1;

  -- Change average cost so undo must ignore it
  UPDATE public.service_material_inventory SET average_cost = 99.99 WHERE id = v_material_id;

  -- Partial undo 2
  v_result := public.undo_invoice_material_fulfilment_return(
    v_business_id, v_return_id, 2, 'undo-test-undo-partial', v_owner_id, v_issue, 'partial'
  );
  v_undo_id := (v_result->>'undo_id')::UUID;
  SELECT quantity_on_hand INTO v_qty FROM public.service_material_inventory WHERE id = v_material_id;
  IF v_qty <> 8 THEN RAISE EXCEPTION 'partial_undo_stock_expected_8 got %', v_qty; END IF;
  IF (v_result->>'total_cost')::NUMERIC <> 19.78 THEN
    RAISE EXCEPTION 'partial_undo_cost_expected_19.78 got %', v_result->>'total_cost';
  END IF;

  SELECT COALESCE(SUM(jl.debit), 0), COALESCE(SUM(jl.credit), 0)
  INTO v_debit_5110, v_credit_1450
  FROM public.journal_entry_lines jl
  JOIN public.accounts a ON a.id = jl.account_id
  WHERE jl.journal_entry_id = (v_result->>'journal_entry_id')::UUID
    AND a.code IN ('5110', '1450');

  SELECT COALESCE(SUM(CASE WHEN a.code = '5110' THEN jl.debit ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN a.code = '1450' THEN jl.credit ELSE 0 END), 0)
  INTO v_debit_5110, v_credit_1450
  FROM public.journal_entry_lines jl
  JOIN public.accounts a ON a.id = jl.account_id
  WHERE jl.journal_entry_id = (v_result->>'journal_entry_id')::UUID;

  IF v_debit_5110 <> 19.78 OR v_credit_1450 <> 19.78 THEN
    RAISE EXCEPTION 'partial_undo_je_mismatch debit_5110=% credit_1450=%', v_debit_5110, v_credit_1450;
  END IF;
  v_pass := v_pass + 1;

  -- Remaining undoable = 3; over-undo rejected
  BEGIN
    PERFORM public.undo_invoice_material_fulfilment_return(
      v_business_id, v_return_id, 4, 'undo-test-over', v_owner_id, v_issue, NULL
    );
    RAISE EXCEPTION 'over_undo_should_fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%UNDO_RETURN_QTY_EXCEEDS_UNDOABLE%' THEN
        RAISE EXCEPTION 'over_undo_unexpected: %', SQLERRM;
      END IF;
  END;
  SELECT quantity_on_hand INTO v_qty FROM public.service_material_inventory WHERE id = v_material_id;
  IF v_qty <> 8 THEN RAISE EXCEPTION 'over_undo_mutated_stock %', v_qty; END IF;
  v_pass := v_pass + 1;

  -- Undo remaining 3
  v_result := public.undo_invoice_material_fulfilment_return(
    v_business_id, v_return_id, 3, 'undo-test-undo-rest', v_owner_id, v_issue, NULL
  );
  SELECT quantity_on_hand INTO v_qty FROM public.service_material_inventory WHERE id = v_material_id;
  IF v_qty <> 5 THEN RAISE EXCEPTION 'full_undo_stock_expected_5 got %', v_qty; END IF;
  v_pass := v_pass + 1;

  -- Cancel blocked again after undo
  BEGIN
    UPDATE public.invoices SET status = 'cancelled' WHERE id = v_invoice_id;
    RAISE EXCEPTION 'cancel_after_undo_should_block';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INVOICE_HAS_ACTIVE_FULFILMENTS%' THEN
        RAISE EXCEPTION 'cancel_after_undo_unexpected: %', SQLERRM;
      END IF;
  END;
  v_pass := v_pass + 1;

  -- Idempotency
  v_result2 := public.undo_invoice_material_fulfilment_return(
    v_business_id, v_return_id, 3, 'undo-test-undo-rest', v_owner_id, v_issue, NULL
  );
  IF COALESCE((v_result2->>'idempotent')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'idempotent_expected';
  END IF;
  IF (v_result2->>'undo_id')::UUID IS DISTINCT FROM (v_result->>'undo_id')::UUID THEN
    RAISE EXCEPTION 'idempotent_id_mismatch';
  END IF;
  SELECT quantity_on_hand INTO v_qty FROM public.service_material_inventory WHERE id = v_material_id;
  IF v_qty <> 5 THEN RAISE EXCEPTION 'idempotent_stock_changed %', v_qty; END IF;
  v_pass := v_pass + 1;

  -- Nothing left
  BEGIN
    PERFORM public.undo_invoice_material_fulfilment_return(
      v_business_id, v_return_id, 1, 'undo-test-nothing', v_owner_id, v_issue, NULL
    );
    RAISE EXCEPTION 'nothing_left_should_fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%UNDO_RETURN_NOTHING_LEFT%' THEN
        RAISE EXCEPTION 'nothing_left_unexpected: %', SQLERRM;
      END IF;
  END;
  v_pass := v_pass + 1;

  -- Insufficient stock
  UPDATE public.service_material_inventory SET quantity_on_hand = 0 WHERE id = v_material_id;
  -- Re-seed a fresh returnable path: return then try undo with zero stock
  -- First restore stock and return again from a new fulfilment on another item would be heavy;
  -- instead create a second fulfilment/return pair.
  UPDATE public.service_material_inventory SET quantity_on_hand = 2 WHERE id = v_material_id;
  INSERT INTO public.invoice_items (
    id, invoice_id, description, qty, unit_price, line_subtotal,
    material_id, material_inventory_source
  ) VALUES (
    gen_random_uuid(), v_invoice_id, 'Undo Stock Gate', 2, 20, 40,
    v_material_id, 'direct_sale'
  ) RETURNING id INTO v_item_id;

  v_result := public.fulfil_invoice_material_line(
    v_business_id, v_item_id, 2, 'undo-test-fulfil-2', v_owner_id, v_issue
  );
  v_fulfil_id := (v_result->>'fulfilment_id')::UUID;
  v_result := public.return_invoice_material_fulfilment(
    v_business_id, v_fulfil_id, 2, 'undo-test-return-2', v_owner_id, v_issue
  );
  v_return_id := (v_result->>'return_id')::UUID;
  UPDATE public.service_material_inventory SET quantity_on_hand = 0 WHERE id = v_material_id;

  BEGIN
    PERFORM public.undo_invoice_material_fulfilment_return(
      v_business_id, v_return_id, 1, 'undo-test-insuff', v_owner_id, v_issue, NULL
    );
    RAISE EXCEPTION 'insufficient_stock_should_fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INSUFFICIENT_STOCK%' THEN
        RAISE EXCEPTION 'insufficient_stock_unexpected: %', SQLERRM;
      END IF;
  END;
  v_pass := v_pass + 1;

  RAISE NOTICE 'invoice_material_fulfilment_return_undo.test.sql PASS count=%', v_pass;
END $$;

ROLLBACK;
