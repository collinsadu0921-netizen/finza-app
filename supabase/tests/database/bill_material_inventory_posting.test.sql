-- ============================================================================
-- Non-production database tests for migration 548
-- (bill material inventory posting → Dr 1450 + receipt alignment)
--
-- Isolation:
--   * Entire file runs inside a single transaction that ends with ROLLBACK.
--   * Creates a fully synthetic business + supporting rows only.
--   * Never selects or mutates an existing tenant business / period / stock.
--   * No SECURITY DEFINER RPC; no GRANTs; not a numbered migration.
--
-- Run after 548 is applied (staging/local only), e.g.:
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/database/bill_material_inventory_posting.test.sql
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_business_id UUID := gen_random_uuid();
  v_owner_id UUID;
  v_material_a UUID;
  v_material_b UUID;
  v_bill_id UUID;
  v_je_id UUID;
  v_je_id_2 UUID;
  v_1450 UUID;
  v_5200 UUID;
  v_5110 UUID;
  v_2000 UUID;
  v_2150 UUID;
  v_2100 UUID;
  v_ap UUID;
  v_debit_1450 NUMERIC;
  v_debit_5200 NUMERIC;
  v_credit_ap NUMERIC;
  v_qty_before NUMERIC;
  v_qty_after NUMERIC;
  v_avg_before NUMERIC;
  v_mov_count INT;
  v_mov_qty NUMERIC;
  v_mov_unit NUMERIC;
  v_mov_value NUMERIC;
  v_value_a NUMERIC;
  v_value_b NUMERIC;
  v_err TEXT;
  v_issue DATE := DATE '2099-06-15';
  v_period_start DATE := DATE '2099-06-01';
  v_period_end DATE := DATE '2099-06-30';
  v_fn_src TEXT;
BEGIN
  SELECT id INTO v_owner_id FROM auth.users ORDER BY created_at NULLS LAST LIMIT 1;
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'setup_owner_missing: need at least one auth.users row for journal posting';
  END IF;

  -- Synthetic tenant only (no existing-business lookup)
  INSERT INTO public.businesses (id, owner_id, name, industry)
  VALUES (v_business_id, v_owner_id, 'BillMatInvTest ' || v_business_id::text, 'service');

  INSERT INTO public.accounting_periods (business_id, period_start, period_end, status)
  VALUES (v_business_id, v_period_start, v_period_end, 'open');

  INSERT INTO public.accounts (business_id, name, code, type, is_system)
  VALUES
    (v_business_id, 'Inventory Materials', '1450', 'asset', TRUE),
    (v_business_id, 'Accounts Payable', '2000', 'liability', TRUE),
    (v_business_id, 'VAT Input', '2100', 'asset', TRUE),
    (v_business_id, 'WHT Payable', '2150', 'liability', TRUE),
    (v_business_id, 'Cost of Services Materials', '5110', 'expense', TRUE),
    (v_business_id, 'Operating Expenses', '5200', 'expense', TRUE);

  INSERT INTO public.chart_of_accounts (business_id, account_code, account_name, account_type, is_active)
  VALUES
    (v_business_id, '1450', 'Inventory Materials', 'asset', TRUE),
    (v_business_id, '2000', 'Accounts Payable', 'liability', TRUE),
    (v_business_id, '2100', 'VAT Input', 'asset', TRUE),
    (v_business_id, '2150', 'WHT Payable', 'liability', TRUE),
    (v_business_id, '5110', 'Cost of Services Materials', 'expense', TRUE),
    (v_business_id, '5200', 'Operating Expenses', 'expense', TRUE);

  INSERT INTO public.chart_of_accounts_control_map (business_id, control_key, account_code)
  VALUES (v_business_id, 'AP', '2000');

  v_1450 := get_account_by_code(v_business_id, '1450');
  v_5200 := get_account_by_code(v_business_id, '5200');
  v_5110 := get_account_by_code(v_business_id, '5110');
  v_2000 := get_account_by_code(v_business_id, '2000');
  v_2150 := get_account_by_code(v_business_id, '2150');
  v_2100 := get_account_by_code(v_business_id, '2100');
  v_ap := get_account_by_control_key(v_business_id, 'AP');

  IF v_1450 IS NULL OR v_5200 IS NULL OR v_5110 IS NULL
     OR v_2000 IS NULL OR v_2150 IS NULL OR v_2100 IS NULL
     OR v_ap IS NULL OR v_ap IS DISTINCT FROM v_2000 THEN
    RAISE EXCEPTION 'setup_accounts failed for synthetic business %', v_business_id;
  END IF;

  SELECT pg_get_functiondef('post_bill_to_ledger(uuid,text,text,text)'::regprocedure)
  INTO v_fn_src;
  IF v_fn_src IS NULL OR v_fn_src NOT ILIKE '%unsupported_bill_level_discount%' THEN
    RAISE EXCEPTION 'function_has_unsupported_header_discount_guard failed';
  END IF;
  IF v_fn_src NOT ILIKE '%material_inventory_value_mismatch%' THEN
    RAISE EXCEPTION 'function_missing_material_inventory_value_mismatch_invariant';
  END IF;
  IF v_fn_src NOT ILIKE '%material_inventory_account_missing%' THEN
    RAISE EXCEPTION 'function_missing_material_inventory_account_missing_guard';
  END IF;

  INSERT INTO public.service_material_inventory (
    business_id, name, unit, quantity_on_hand, average_cost, reorder_level, is_active
  ) VALUES (
    v_business_id, 'MatA ' || gen_random_uuid()::text, 'pcs', 10, 5, 0, TRUE
  ) RETURNING id INTO v_material_a;

  INSERT INTO public.service_material_inventory (
    business_id, name, unit, quantity_on_hand, average_cost, reorder_level, is_active
  ) VALUES (
    v_business_id, 'MatB ' || gen_random_uuid()::text, 'pcs', 0, 0, 0, TRUE
  ) RETURNING id INTO v_material_b;

  -- ----- Material-only → Dr 1450 / Cr AP -----
  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, status,
    subtotal, total_tax, vat, nhil, getfund, covid, total, bill_type
  ) VALUES (
    v_business_id, 'Vendor Mat', 'T-MAT-' || substr(gen_random_uuid()::text, 1, 8),
    v_issue, 'draft', 100, 0, 0, 0, 0, 0, 100, 'standard'
  ) RETURNING id INTO v_bill_id;

  INSERT INTO public.bill_items (
    bill_id, description, qty, unit_price, discount_amount, line_subtotal, material_id, account_id
  ) VALUES (v_bill_id, 'Cement', 4, 25, 0, 100, v_material_a, NULL);

  SELECT quantity_on_hand, average_cost INTO v_qty_before, v_avg_before
  FROM public.service_material_inventory WHERE id = v_material_a;

  UPDATE public.bills SET status = 'open' WHERE id = v_bill_id;

  SELECT id INTO v_je_id
  FROM public.journal_entries
  WHERE reference_type = 'bill' AND reference_id = v_bill_id
  LIMIT 1;

  SELECT
    COALESCE(SUM(jel.debit) FILTER (WHERE jel.account_id = v_1450), 0),
    COALESCE(SUM(jel.debit) FILTER (WHERE jel.account_id = v_5200), 0),
    COALESCE(SUM(jel.credit) FILTER (WHERE jel.account_id = v_ap), 0)
  INTO v_debit_1450, v_debit_5200, v_credit_ap
  FROM public.journal_entry_lines jel
  WHERE jel.journal_entry_id = v_je_id;

  IF v_je_id IS NULL OR v_debit_1450 <> 100 OR v_debit_5200 <> 0 OR v_credit_ap <> 100 THEN
    RAISE EXCEPTION 'material_only_dr_1450_cr_ap failed: je=% d1450=% d5200=% cap=%',
      v_je_id, v_debit_1450, v_debit_5200, v_credit_ap;
  END IF;

  SELECT quantity_on_hand INTO v_qty_after
  FROM public.service_material_inventory WHERE id = v_material_a;

  SELECT COUNT(*), MAX(quantity), MAX(unit_cost)
  INTO v_mov_count, v_mov_qty, v_mov_unit
  FROM public.service_material_movements
  WHERE reference_id = v_bill_id
    AND material_id = v_material_a
    AND movement_type = 'bill_receipt';

  v_mov_value := ROUND(COALESCE(v_mov_qty, 0) * COALESCE(v_mov_unit, 0), 2);

  IF v_qty_after <> v_qty_before + 4
     OR v_mov_count <> 1
     OR ROUND(v_mov_value, 2) <> ROUND(v_debit_1450, 2) THEN
    RAISE EXCEPTION 'stock_value_equals_1450_debit failed: qty %→% mov=% value=% debit=%',
      v_qty_before, v_qty_after, v_mov_count, v_mov_value, v_debit_1450;
  END IF;

  v_je_id_2 := post_bill_to_ledger(v_bill_id);
  SELECT COUNT(*) INTO v_mov_count
  FROM public.service_material_movements
  WHERE reference_id = v_bill_id
    AND material_id = v_material_a
    AND movement_type = 'bill_receipt';

  IF v_je_id_2 IS DISTINCT FROM v_je_id OR v_mov_count <> 1 THEN
    RAISE EXCEPTION 'repost_no_duplicate_je_or_receipt failed';
  END IF;

  -- ----- Expense-only → 5200 not 1450 -----
  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, status,
    subtotal, total_tax, vat, nhil, getfund, covid, total, bill_type
  ) VALUES (
    v_business_id, 'Vendor Exp', 'T-EXP-' || substr(gen_random_uuid()::text, 1, 8),
    v_issue, 'draft', 50, 0, 0, 0, 0, 0, 50, 'standard'
  ) RETURNING id INTO v_bill_id;

  INSERT INTO public.bill_items (
    bill_id, description, qty, unit_price, discount_amount, line_subtotal, material_id, account_id
  ) VALUES (v_bill_id, 'Office', 1, 50, 0, 50, NULL, NULL);

  UPDATE public.bills SET status = 'open' WHERE id = v_bill_id;
  SELECT id INTO v_je_id
  FROM public.journal_entries
  WHERE reference_type = 'bill' AND reference_id = v_bill_id
  LIMIT 1;

  SELECT
    COALESCE(SUM(jel.debit) FILTER (WHERE jel.account_id = v_1450), 0),
    COALESCE(SUM(jel.debit) FILTER (WHERE jel.account_id = v_5200), 0)
  INTO v_debit_1450, v_debit_5200
  FROM public.journal_entry_lines jel
  WHERE jel.journal_entry_id = v_je_id;

  IF v_debit_5200 <> 50 OR v_debit_1450 <> 0 THEN
    RAISE EXCEPTION 'expense_only_5200_not_1450 failed: d5200=% d1450=%', v_debit_5200, v_debit_1450;
  END IF;

  -- ----- Line discount (valid) -----
  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, status,
    subtotal, total_tax, vat, nhil, getfund, covid, total, bill_type
  ) VALUES (
    v_business_id, 'Vendor Disc', 'T-DISC-' || substr(gen_random_uuid()::text, 1, 8),
    v_issue, 'draft', 90, 0, 0, 0, 0, 0, 90, 'standard'
  ) RETURNING id INTO v_bill_id;

  INSERT INTO public.bill_items (
    bill_id, description, qty, unit_price, discount_amount, line_subtotal, material_id
  ) VALUES (v_bill_id, 'Paint', 2, 50, 10, 90, v_material_a);

  UPDATE public.bills SET status = 'open' WHERE id = v_bill_id;
  SELECT id INTO v_je_id
  FROM public.journal_entries
  WHERE reference_type = 'bill' AND reference_id = v_bill_id
  LIMIT 1;

  SELECT COALESCE(SUM(jel.debit) FILTER (WHERE jel.account_id = v_1450), 0)
  INTO v_debit_1450
  FROM public.journal_entry_lines jel
  WHERE jel.journal_entry_id = v_je_id;

  SELECT quantity, unit_cost INTO v_mov_qty, v_mov_unit
  FROM public.service_material_movements
  WHERE reference_id = v_bill_id
    AND material_id = v_material_a
    AND movement_type = 'bill_receipt'
  LIMIT 1;
  v_mov_value := ROUND(COALESCE(v_mov_qty, 0) * COALESCE(v_mov_unit, 0), 2);

  IF v_debit_1450 <> 90 OR ROUND(v_mov_value, 2) <> 90 THEN
    RAISE EXCEPTION 'line_discount_1450_equals_receipt failed: d1450=% mov=%', v_debit_1450, v_mov_value;
  END IF;

  -- ----- Mixed bill -----
  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, status,
    subtotal, total_tax, vat, nhil, getfund, covid, total, bill_type
  ) VALUES (
    v_business_id, 'Vendor Mix', 'T-MIX-' || substr(gen_random_uuid()::text, 1, 8),
    v_issue, 'draft', 150, 0, 0, 0, 0, 0, 150, 'standard'
  ) RETURNING id INTO v_bill_id;

  INSERT INTO public.bill_items (
    bill_id, description, qty, unit_price, discount_amount, line_subtotal, material_id
  ) VALUES
    (v_bill_id, 'Mat', 2, 50, 0, 100, v_material_a),
    (v_bill_id, 'Exp', 1, 50, 0, 50, NULL);

  UPDATE public.bills SET status = 'open' WHERE id = v_bill_id;
  SELECT id INTO v_je_id
  FROM public.journal_entries
  WHERE reference_type = 'bill' AND reference_id = v_bill_id
  LIMIT 1;

  SELECT
    COALESCE(SUM(jel.debit) FILTER (WHERE jel.account_id = v_1450), 0),
    COALESCE(SUM(jel.debit) FILTER (WHERE jel.account_id = v_5200), 0),
    COALESCE(SUM(jel.credit) FILTER (WHERE jel.account_id = v_ap), 0)
  INTO v_debit_1450, v_debit_5200, v_credit_ap
  FROM public.journal_entry_lines jel
  WHERE jel.journal_entry_id = v_je_id;

  IF v_debit_1450 <> 100 OR v_debit_5200 <> 50 OR v_credit_ap <> 150 THEN
    RAISE EXCEPTION 'mixed_bill_1450_and_5200 failed: d1450=% d5200=% cap=%',
      v_debit_1450, v_debit_5200, v_credit_ap;
  END IF;

  -- ----- Same material multi-line → one receipt -----
  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, status,
    subtotal, total_tax, vat, nhil, getfund, covid, total, bill_type
  ) VALUES (
    v_business_id, 'Vendor Multi', 'T-MULTI-' || substr(gen_random_uuid()::text, 1, 8),
    v_issue, 'draft', 130, 0, 0, 0, 0, 0, 130, 'standard'
  ) RETURNING id INTO v_bill_id;

  INSERT INTO public.bill_items (
    bill_id, description, qty, unit_price, discount_amount, line_subtotal, material_id
  ) VALUES
    (v_bill_id, 'Lot A', 2, 40, 0, 80, v_material_b),
    (v_bill_id, 'Lot B', 1, 50, 0, 50, v_material_b);

  UPDATE public.bills SET status = 'open' WHERE id = v_bill_id;
  SELECT id INTO v_je_id
  FROM public.journal_entries
  WHERE reference_type = 'bill' AND reference_id = v_bill_id
  LIMIT 1;

  SELECT COALESCE(SUM(jel.debit) FILTER (WHERE jel.account_id = v_1450), 0)
  INTO v_debit_1450
  FROM public.journal_entry_lines jel
  WHERE jel.journal_entry_id = v_je_id;

  SELECT COUNT(*), MAX(quantity), MAX(unit_cost)
  INTO v_mov_count, v_mov_qty, v_mov_unit
  FROM public.service_material_movements
  WHERE reference_id = v_bill_id
    AND material_id = v_material_b
    AND movement_type = 'bill_receipt';
  v_mov_value := ROUND(COALESCE(v_mov_qty, 0) * COALESCE(v_mov_unit, 0), 2);

  IF v_mov_count <> 1 OR v_mov_qty <> 3
     OR ROUND(v_mov_value, 2) <> ROUND(v_debit_1450, 2)
     OR v_debit_1450 <> 130 THEN
    RAISE EXCEPTION 'same_material_multi_line_one_receipt failed';
  END IF;

  -- ----- Empty items refuse -----
  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, status,
    subtotal, total_tax, vat, nhil, getfund, covid, total, bill_type
  ) VALUES (
    v_business_id, 'Vendor Empty', 'T-EMPTY-' || substr(gen_random_uuid()::text, 1, 8),
    v_issue, 'draft', 40, 0, 0, 0, 0, 0, 40, 'standard'
  ) RETURNING id INTO v_bill_id;

  BEGIN
    PERFORM post_bill_to_ledger(v_bill_id);
    RAISE EXCEPTION 'empty_items_refuse_posting expected exception';
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err NOT ILIKE '%no bill_items%' AND v_err NOT ILIKE '%refuse posting%' THEN
        RAISE EXCEPTION 'empty_items_refuse_posting unexpected: %', left(v_err, 160);
      END IF;
  END;

  -- ----- FX home currency -----
  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, status,
    subtotal, total_tax, vat, nhil, getfund, covid, total, bill_type,
    currency_code, fx_rate, home_currency_total
  ) VALUES (
    v_business_id, 'Vendor FX', 'T-FX-' || substr(gen_random_uuid()::text, 1, 8),
    v_issue, 'draft', 10, 0, 0, 0, 0, 0, 10, 'standard',
    'USD', 2, 20
  ) RETURNING id INTO v_bill_id;

  INSERT INTO public.bill_items (
    bill_id, description, qty, unit_price, discount_amount, line_subtotal, material_id
  ) VALUES (v_bill_id, 'FX mat', 1, 10, 0, 10, v_material_a);

  UPDATE public.bills SET status = 'open' WHERE id = v_bill_id;
  SELECT id INTO v_je_id
  FROM public.journal_entries
  WHERE reference_type = 'bill' AND reference_id = v_bill_id
  LIMIT 1;

  SELECT COALESCE(SUM(jel.debit) FILTER (WHERE jel.account_id = v_1450), 0)
  INTO v_debit_1450
  FROM public.journal_entry_lines jel
  WHERE jel.journal_entry_id = v_je_id;

  SELECT ROUND(quantity * unit_cost, 2) INTO v_mov_value
  FROM public.service_material_movements
  WHERE reference_id = v_bill_id
    AND material_id = v_material_a
    AND movement_type = 'bill_receipt'
  LIMIT 1;

  IF v_je_id IS NULL OR ROUND(v_debit_1450, 2) <> 20 OR ROUND(COALESCE(v_mov_value, 0), 2) <> 20 THEN
    RAISE EXCEPTION 'fx_material_home_currency_1450 failed: d1450=% mov=%', v_debit_1450, v_mov_value;
  END IF;

  -- ----- VAT outside inventory -----
  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, status,
    subtotal, total_tax, vat, nhil, getfund, covid, total, bill_type
  ) VALUES (
    v_business_id, 'Vendor VAT', 'T-VAT-' || substr(gen_random_uuid()::text, 1, 8),
    v_issue, 'draft', 90, 13.5, 13.5, 0, 0, 0, 103.5, 'standard'
  ) RETURNING id INTO v_bill_id;

  INSERT INTO public.bill_items (
    bill_id, description, qty, unit_price, discount_amount, line_subtotal, material_id
  ) VALUES (v_bill_id, 'VAT mat', 2, 50, 10, 90, v_material_a);

  UPDATE public.bills SET status = 'open' WHERE id = v_bill_id;
  SELECT id INTO v_je_id
  FROM public.journal_entries
  WHERE reference_type = 'bill' AND reference_id = v_bill_id
  LIMIT 1;

  SELECT COALESCE(SUM(jel.debit) FILTER (WHERE jel.account_id = v_1450), 0)
  INTO v_debit_1450
  FROM public.journal_entry_lines jel
  WHERE jel.journal_entry_id = v_je_id;

  SELECT ROUND(quantity * unit_cost, 2) INTO v_mov_value
  FROM public.service_material_movements
  WHERE reference_id = v_bill_id
    AND material_id = v_material_a
    AND movement_type = 'bill_receipt'
  LIMIT 1;

  IF ROUND(v_debit_1450, 2) <> 90 OR ROUND(COALESCE(v_mov_value, 0), 2) <> 90 THEN
    RAISE EXCEPTION 'vat_plus_discount_tax_outside_inventory failed: d1450=% mov=%',
      v_debit_1450, v_mov_value;
  END IF;

  -- ----- +0.01 correction lands on last material; both materials stay aligned -----
  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, status,
    subtotal, total_tax, vat, nhil, getfund, covid, total, bill_type
  ) VALUES (
    v_business_id, 'Vendor Round+', 'T-RPLUS-' || substr(gen_random_uuid()::text, 1, 8),
    v_issue, 'draft', 100, 0, 0, 0, 0, 0, 100.01, 'standard'
  ) RETURNING id INTO v_bill_id;

  INSERT INTO public.bill_items (
    bill_id, description, qty, unit_price, discount_amount, line_subtotal, material_id
  ) VALUES
    (v_bill_id, 'A', 1, 60, 0, 60, v_material_a),
    (v_bill_id, 'B', 1, 40, 0, 40, v_material_b);

  UPDATE public.bills SET status = 'open' WHERE id = v_bill_id;
  SELECT id INTO v_je_id
  FROM public.journal_entries
  WHERE reference_type = 'bill' AND reference_id = v_bill_id
  LIMIT 1;

  SELECT COALESCE(SUM(jel.debit) FILTER (WHERE jel.account_id = v_1450), 0),
         COALESCE(SUM(jel.credit) FILTER (WHERE jel.account_id = v_ap), 0)
  INTO v_debit_1450, v_credit_ap
  FROM public.journal_entry_lines jel
  WHERE jel.journal_entry_id = v_je_id;

  SELECT ROUND(quantity * unit_cost, 2) INTO v_value_a
  FROM public.service_material_movements
  WHERE reference_id = v_bill_id AND material_id = v_material_a AND movement_type = 'bill_receipt';

  SELECT ROUND(quantity * unit_cost, 2) INTO v_value_b
  FROM public.service_material_movements
  WHERE reference_id = v_bill_id AND material_id = v_material_b AND movement_type = 'bill_receipt';

  IF ROUND(v_credit_ap, 2) <> 100.01
     OR ROUND(v_debit_1450, 2) <> 100.01
     OR ROUND(COALESCE(v_value_a, 0) + COALESCE(v_value_b, 0), 2) <> ROUND(v_debit_1450, 2)
     OR NOT (
       (ROUND(COALESCE(v_value_a, 0), 2) = 60.00 AND ROUND(COALESCE(v_value_b, 0), 2) = 40.01)
       OR
       (ROUND(COALESCE(v_value_a, 0), 2) = 60.01 AND ROUND(COALESCE(v_value_b, 0), 2) = 40.00)
     ) THEN
    RAISE EXCEPTION
      'rounding_plus_0_01_multi_material failed: ap=% d1450=% a=% b=%',
      v_credit_ap, v_debit_1450, v_value_a, v_value_b;
  END IF;

  -- ----- -0.01 correction on last material -----
  INSERT INTO public.bills (
    business_id, supplier_name, bill_number, issue_date, status,
    subtotal, total_tax, vat, nhil, getfund, covid, total, bill_type
  ) VALUES (
    v_business_id, 'Vendor Round-', 'T-RMINUS-' || substr(gen_random_uuid()::text, 1, 8),
    v_issue, 'draft', 100, 0, 0, 0, 0, 0, 99.99, 'standard'
  ) RETURNING id INTO v_bill_id;

  INSERT INTO public.bill_items (
    bill_id, description, qty, unit_price, discount_amount, line_subtotal, material_id
  ) VALUES
    (v_bill_id, 'A', 1, 60, 0, 60, v_material_a),
    (v_bill_id, 'B', 1, 40, 0, 40, v_material_b);

  UPDATE public.bills SET status = 'open' WHERE id = v_bill_id;
  SELECT id INTO v_je_id
  FROM public.journal_entries
  WHERE reference_type = 'bill' AND reference_id = v_bill_id
  LIMIT 1;

  SELECT COALESCE(SUM(jel.debit) FILTER (WHERE jel.account_id = v_1450), 0),
         COALESCE(SUM(jel.credit) FILTER (WHERE jel.account_id = v_ap), 0)
  INTO v_debit_1450, v_credit_ap
  FROM public.journal_entry_lines jel
  WHERE jel.journal_entry_id = v_je_id;

  SELECT ROUND(quantity * unit_cost, 2) INTO v_value_a
  FROM public.service_material_movements
  WHERE reference_id = v_bill_id AND material_id = v_material_a AND movement_type = 'bill_receipt';

  SELECT ROUND(quantity * unit_cost, 2) INTO v_value_b
  FROM public.service_material_movements
  WHERE reference_id = v_bill_id AND material_id = v_material_b AND movement_type = 'bill_receipt';

  IF ROUND(v_credit_ap, 2) <> 99.99
     OR ROUND(v_debit_1450, 2) <> 99.99
     OR ROUND(COALESCE(v_value_a, 0) + COALESCE(v_value_b, 0), 2) <> ROUND(v_debit_1450, 2)
     OR NOT (
       (ROUND(COALESCE(v_value_a, 0), 2) = 60.00 AND ROUND(COALESCE(v_value_b, 0), 2) = 39.99)
       OR
       (ROUND(COALESCE(v_value_a, 0), 2) = 59.99 AND ROUND(COALESCE(v_value_b, 0), 2) = 40.00)
     ) THEN
    RAISE EXCEPTION
      'rounding_minus_0_01_multi_material failed: ap=% d1450=% a=% b=%',
      v_credit_ap, v_debit_1450, v_value_a, v_value_b;
  END IF;

  RAISE NOTICE 'bill_material_inventory_posting.test.sql: all assertions passed (synthetic business %)',
    v_business_id;
END $$;

ROLLBACK;
