-- 721_privileged_function_authorization.sql
-- Final privileged-function authorization for functions that remain callable
-- through PostgREST RPC by authenticated users.
--
-- Confirmed before this migration:
--   * process_retail_purchase_order_receipt, get_customer_sale_stats,
--     return_service_job_material_usage and reverse_service_job_cogs were
--     SECURITY DEFINER, executable by authenticated, and relied entirely on
--     API-route authorization. Any authenticated user could call them directly
--     for another tenant if they knew the identifiers.
--   * salary_advance_apply_posted_balance, salary_advance_stop_recurring_deduction
--     and salary_advance_posted_repaid_amount are backend helpers invoked only by
--     other SECURITY DEFINER payroll functions; 720 had left them callable by
--     authenticated.
--
-- This migration does not change any calculation. It only adds caller-identity
-- and business/role guards to the four client-callable functions, and restores
-- service-only execution for the three payroll helpers.


-- ---------------------------------------------------------------------------
-- process_retail_purchase_order_receipt
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_retail_purchase_order_receipt(p_business_id uuid, p_purchase_order_id uuid, p_store_id uuid, p_actor_user_id uuid, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_po RECORD;
  v_store_id UUID;
  v_line_input RECORD;
  v_item RECORD;
  v_stock RECORD;
  v_stock_id UUID;
  v_old_received_qty NUMERIC;
  v_new_received_qty NUMERIC;
  v_delta_qty NUMERIC;
  v_received_unit_cost NUMERIC;
  v_old_stock_qty NUMERIC;
  v_new_stock_qty NUMERIC;
  v_old_avg_cost NUMERIC(18,6);
  v_new_avg_cost NUMERIC(18,6);
  v_total_delta_qty NUMERIC := 0;
  v_total_delta_value NUMERIC := 0;
  v_lines_result JSONB := '[]'::JSONB;
  v_receipt_complete BOOLEAN := TRUE;
  v_receipt_value NUMERIC := 0;
  v_po_status TEXT;
  v_journal_id UUID := NULL;
  v_line_count INTEGER := 0;
  v_distinct_line_count INTEGER := 0;
  v_stock_key TEXT;
  v_movement_qty INTEGER;
BEGIN

  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT (auth.role() IS NULL AND session_user IN ('postgres','supabase_admin')) THEN
    IF auth.uid() IS NULL
       OR auth.uid() IS DISTINCT FROM p_actor_user_id
       OR NOT public.finza_user_can_access_business(p_business_id) THEN
      RAISE EXCEPTION 'Not authorized to receive purchase orders for this business'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_business_id IS NULL OR p_purchase_order_id IS NULL OR p_store_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'INVALID_INPUT',
      DETAIL = 'p_business_id, p_purchase_order_id, p_store_id, and p_actor_user_id are required';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'INVALID_LINES_PAYLOAD',
      DETAIL = 'p_lines must be a non-empty JSON array';
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT (line->>'purchase_order_item_id'))
  INTO v_line_count, v_distinct_line_count
  FROM jsonb_array_elements(p_lines) AS line;

  IF v_line_count <> v_distinct_line_count THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'DUPLICATE_LINE_IDS',
      DETAIL = 'p_lines contains duplicate purchase_order_item_id values';
  END IF;

  SELECT s.id
  INTO v_store_id
  FROM stores s
  WHERE s.id = p_store_id
    AND s.business_id = p_business_id;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'INVALID_STORE_FOR_BUSINESS',
      DETAIL = 'store_id is not valid for this business';
  END IF;

  SELECT po.id, po.business_id, po.status
  INTO v_po
  FROM purchase_orders po
  WHERE po.id = p_purchase_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'PO_NOT_FOUND',
      DETAIL = 'Purchase order not found';
  END IF;

  IF v_po.business_id IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'PO_BUSINESS_MISMATCH',
      DETAIL = 'Purchase order does not belong to business';
  END IF;

  -- Correction requested: fully received POs are never re-processed.
  IF v_po.status = 'received' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PO_ALREADY_RECEIVED',
      DETAIL = 'Cannot process receipt for a fully received purchase order';
  END IF;

  IF v_po.status NOT IN ('ordered', 'partially_received') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PO_STATUS_NOT_RECEIVABLE',
      DETAIL = format('PO status %s is not receivable', v_po.status);
  END IF;

  FOR v_line_input IN
    SELECT *
    FROM jsonb_to_recordset(p_lines) AS x(
      purchase_order_item_id UUID,
      quantity_received NUMERIC,
      received_unit_cost NUMERIC
    )
  LOOP
    IF v_line_input.purchase_order_item_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'INVALID_LINES_PAYLOAD',
        DETAIL = 'purchase_order_item_id is required for each line';
    END IF;

    IF v_line_input.quantity_received IS NULL OR v_line_input.quantity_received < 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'RECEIVED_QTY_OUT_OF_RANGE',
        DETAIL = 'quantity_received must be >= 0';
    END IF;

    SELECT poi.id, poi.product_id, poi.variant_id, poi.quantity, poi.quantity_received, poi.received_unit_cost
    INTO v_item
    FROM purchase_order_items poi
    WHERE poi.id = v_line_input.purchase_order_item_id
      AND poi.purchase_order_id = p_purchase_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0002',
        MESSAGE = 'LINE_NOT_IN_PO',
        DETAIL = format('Line %s not found in purchase order %s', v_line_input.purchase_order_item_id, p_purchase_order_id);
    END IF;

    v_old_received_qty := COALESCE(v_item.quantity_received, 0);
    v_new_received_qty := v_line_input.quantity_received;
    v_delta_qty := v_new_received_qty - v_old_received_qty;
    v_received_unit_cost := COALESCE(v_line_input.received_unit_cost, 0);

    IF v_new_received_qty > COALESCE(v_item.quantity, 0) THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'RECEIVED_QTY_OUT_OF_RANGE',
        DETAIL = format('quantity_received exceeds ordered quantity for line %s', v_item.id);
    END IF;

    IF v_delta_qty < 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'NEGATIVE_DELTA_NOT_ALLOWED',
        DETAIL = format('new quantity_received cannot be less than old quantity_received for line %s', v_item.id);
    END IF;

    IF v_new_received_qty > 0 AND v_received_unit_cost <= 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'RECEIVED_UNIT_COST_REQUIRED',
        DETAIL = format('received_unit_cost must be > 0 when quantity_received > 0 for line %s', v_item.id);
    END IF;

    v_stock_key := format(
      '%s|%s|%s|%s',
      p_business_id::TEXT,
      p_store_id::TEXT,
      v_item.product_id::TEXT,
      COALESCE(v_item.variant_id::TEXT, 'null')
    );
    PERFORM pg_advisory_xact_lock(hashtext(v_stock_key), hashtext('retail_po_receipt_avco'));

    SELECT ps.id,
           COALESCE(ps.stock_quantity, ps.stock, 0)::NUMERIC AS stock_qty,
           COALESCE(ps.average_cost, 0)::NUMERIC(18,6)       AS avg_cost
    INTO v_stock
    FROM products_stock ps
    WHERE ps.store_id = p_store_id
      AND ps.product_id = v_item.product_id
      AND ps.variant_id IS NOT DISTINCT FROM v_item.variant_id
    ORDER BY ps.created_at, ps.id
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO products_stock (
        product_id, variant_id, store_id, stock, stock_quantity, average_cost, last_cost_update_at
      ) VALUES (
        v_item.product_id, v_item.variant_id, p_store_id, 0, 0, 0, NULL
      )
      RETURNING id INTO v_stock_id;

      SELECT ps.id,
             COALESCE(ps.stock_quantity, ps.stock, 0)::NUMERIC AS stock_qty,
             COALESCE(ps.average_cost, 0)::NUMERIC(18,6)       AS avg_cost
      INTO v_stock
      FROM products_stock ps
      WHERE ps.id = v_stock_id
      FOR UPDATE;
    END IF;

    v_old_stock_qty := COALESCE(v_stock.stock_qty, 0);
    v_old_avg_cost := COALESCE(v_stock.avg_cost, 0);
    v_new_stock_qty := v_old_stock_qty + v_delta_qty;
    v_new_avg_cost := v_old_avg_cost;

    IF v_delta_qty > 0 THEN
      IF v_old_stock_qty <= 0 THEN
        v_new_avg_cost := v_received_unit_cost;
      ELSE
        v_new_avg_cost := (
          (v_old_stock_qty * v_old_avg_cost) + (v_delta_qty * v_received_unit_cost)
        ) / (v_old_stock_qty + v_delta_qty);
      END IF;
    END IF;

    UPDATE products_stock
    SET stock = v_new_stock_qty,
        stock_quantity = v_new_stock_qty,
        average_cost = v_new_avg_cost,
        last_cost_update_at = CASE WHEN v_delta_qty > 0 THEN NOW() ELSE last_cost_update_at END
    WHERE id = v_stock.id;

    UPDATE purchase_order_items
    SET quantity_received = v_new_received_qty,
        received_unit_cost = CASE WHEN v_new_received_qty > 0 THEN v_received_unit_cost ELSE NULL END
    WHERE id = v_item.id
      AND purchase_order_id = p_purchase_order_id;

    IF v_delta_qty > 0 THEN
      INSERT INTO retail_cost_updates (
        business_id,
        store_id,
        product_id,
        variant_id,
        purchase_order_id,
        purchase_order_item_id,
        delta_received_qty,
        received_unit_cost,
        old_qty,
        old_avg_cost,
        new_qty,
        new_avg_cost
      ) VALUES (
        p_business_id,
        p_store_id,
        v_item.product_id,
        v_item.variant_id,
        p_purchase_order_id,
        v_item.id,
        v_delta_qty,
        v_received_unit_cost,
        v_old_stock_qty,
        v_old_avg_cost,
        v_new_stock_qty,
        v_new_avg_cost
      );

      v_movement_qty := ROUND(v_delta_qty)::INTEGER;
      IF v_movement_qty <> 0 THEN
        INSERT INTO stock_movements (
          business_id,
          product_id,
          quantity_change,
          type,
          user_id,
          related_sale_id,
          store_id,
          note
        ) VALUES (
          p_business_id,
          v_item.product_id,
          v_movement_qty,
          'purchase_receive',
          p_actor_user_id,
          NULL,
          p_store_id,
          format(
            'purchase_order_id=%s | purchase_order_item_id=%s | received_unit_cost=%s%s',
            p_purchase_order_id::TEXT,
            v_item.id::TEXT,
            v_received_unit_cost::TEXT,
            CASE
              WHEN v_item.variant_id IS NOT NULL THEN format(' | variant_id=%s', v_item.variant_id::TEXT)
              ELSE ''
            END
          )
        );
      END IF;
    END IF;

    v_total_delta_qty := v_total_delta_qty + v_delta_qty;
    v_total_delta_value := v_total_delta_value + (v_delta_qty * v_received_unit_cost);

    v_lines_result := v_lines_result || jsonb_build_array(
      jsonb_build_object(
        'purchase_order_item_id', v_item.id,
        'product_id', v_item.product_id,
        'variant_id', v_item.variant_id,
        'old_received_qty', v_old_received_qty,
        'new_received_qty', v_new_received_qty,
        'delta_qty', v_delta_qty,
        'old_stock_qty', v_old_stock_qty,
        'new_stock_qty', v_new_stock_qty,
        'old_average_cost', v_old_avg_cost,
        'new_average_cost', v_new_avg_cost,
        'received_unit_cost', v_received_unit_cost
      )
    );
  END LOOP;

  FOR v_item IN
    SELECT quantity, quantity_received, received_unit_cost
    FROM purchase_order_items
    WHERE purchase_order_id = p_purchase_order_id
  LOOP
    IF ABS(COALESCE(v_item.quantity, 0) - COALESCE(v_item.quantity_received, 0)) > 1e-6 THEN
      v_receipt_complete := FALSE;
      EXIT;
    END IF;
    IF COALESCE(v_item.quantity_received, 0) > 0 AND COALESCE(v_item.received_unit_cost, 0) <= 0 THEN
      v_receipt_complete := FALSE;
      EXIT;
    END IF;
    v_receipt_value := v_receipt_value + (COALESCE(v_item.quantity_received, 0) * COALESCE(v_item.received_unit_cost, 0));
  END LOOP;

  IF v_total_delta_qty <= 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'NO_RECEIPT_DELTA',
      DETAIL = 'No new received quantity was provided.';
  END IF;

  IF NOT v_receipt_complete OR v_receipt_value <= 0 THEN
    v_po_status := 'partially_received';
  ELSE
    v_po_status := 'received';
  END IF;

  IF v_po_status = 'received' THEN
    UPDATE purchase_orders
    SET status = 'received',
        received_by = p_actor_user_id,
        received_at = NOW()
    WHERE id = p_purchase_order_id;

    SELECT post_purchase_order_receipt_to_ledger(p_purchase_order_id) INTO v_journal_id;
  ELSE
    UPDATE purchase_orders
    SET status = 'partially_received'
    WHERE id = p_purchase_order_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'purchase_order_id', p_purchase_order_id,
    'status', v_po_status,
    'receipt_complete', (v_po_status = 'received'),
    'journal_entry_id', v_journal_id,
    'summary', jsonb_build_object(
      'total_delta_qty', v_total_delta_qty,
      'total_delta_value', v_total_delta_value
    ),
    'lines', v_lines_result
  );
END;
$function$
;


-- ---------------------------------------------------------------------------
-- get_customer_sale_stats
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_customer_sale_stats(p_customer_id uuid, p_business_id uuid)
 RETURNS TABLE(total_sales_count bigint, total_spend numeric, average_basket_size numeric, last_purchase_date timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN

  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT (auth.role() IS NULL AND session_user IN ('postgres','supabase_admin')) THEN
    IF auth.uid() IS NULL
       OR NOT public.finza_user_can_access_business(p_business_id) THEN
      RAISE EXCEPTION 'Not authorized to read customer sales for this business'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN QUERY
  SELECT 
    COUNT(*)::BIGINT AS total_sales_count,
    COALESCE(SUM(s.amount), 0)::NUMERIC AS total_spend,
    CASE 
      WHEN COUNT(*) > 0 THEN COALESCE(AVG(s.amount), 0)::NUMERIC
      ELSE 0::NUMERIC
    END AS average_basket_size,
    MAX(s.created_at) AS last_purchase_date
  FROM sales s
  WHERE s.customer_id = p_customer_id
    AND s.business_id = p_business_id
    AND s.status = 'completed'
    AND s.deleted_at IS NULL;
END;
$function$
;


-- ---------------------------------------------------------------------------
-- return_service_job_material_usage
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.return_service_job_material_usage(p_usage_id uuid, p_business_id uuid, p_return_date date, p_idempotency_key text, p_returned_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_usage public.service_job_material_usage%ROWTYPE;
  v_job public.service_jobs%ROWTYPE;
  v_material public.service_material_inventory%ROWTYPE;
  v_qty NUMERIC;
  v_unit_cost NUMERIC;
  v_total_cost NUMERIC;
  v_new_qty NUMERIC;
  v_movement_id UUID;
  v_cogs_je_id UUID;
  v_return_je_id UUID;
  v_cost_account_id UUID;
  v_inventory_account_id UUID;
  v_journal_lines JSONB;
  v_return_date DATE;
  v_key TEXT;
  v_existing_by_key public.service_job_material_usage%ROWTYPE;
BEGIN

  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT (auth.role() IS NULL AND session_user IN ('postgres','supabase_admin')) THEN
    IF auth.uid() IS NULL
       OR NOT public.finza_user_can_access_business(p_business_id)
       OR (p_returned_by IS NOT NULL AND p_returned_by IS DISTINCT FROM auth.uid()) THEN
      RAISE EXCEPTION 'Not authorized to return service job materials for this business'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_usage_id IS NULL OR p_business_id IS NULL THEN
    RAISE EXCEPTION 'USAGE_RETURN_INVALID_ARGS: usage_id and business_id are required';
  END IF;

  v_key := NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '');
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'USAGE_RETURN_INVALID_ARGS: idempotency_key is required';
  END IF;

  v_return_date := COALESCE(p_return_date, CURRENT_DATE);

  -- Idempotent replay by key (same business)
  SELECT * INTO v_existing_by_key
  FROM service_job_material_usage
  WHERE business_id = p_business_id
    AND return_idempotency_key = v_key
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_by_key.id <> p_usage_id THEN
      RAISE EXCEPTION 'USAGE_RETURN_IDEMPOTENCY_CONFLICT: idempotency key already used for another usage';
    END IF;
    RETURN jsonb_build_object(
      'usage_id', v_existing_by_key.id,
      'status', v_existing_by_key.status,
      'quantity_restored', v_existing_by_key.quantity_used,
      'return_movement_id', v_existing_by_key.return_movement_id,
      'return_journal_entry_id', v_existing_by_key.return_journal_entry_id,
      'original_cogs_journal_entry_id', v_existing_by_key.cogs_journal_entry_id,
      'unit_cost', v_existing_by_key.unit_cost,
      'total_cost', v_existing_by_key.total_cost,
      'return_date', v_existing_by_key.return_date,
      'idempotent', TRUE
    );
  END IF;

  -- Lock usage row
  SELECT * INTO v_usage
  FROM service_job_material_usage
  WHERE id = p_usage_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USAGE_NOT_FOUND: usage record not found';
  END IF;

  IF v_usage.business_id IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION 'CROSS_TENANT: usage does not belong to business';
  END IF;

  -- Idempotent replay if already returned with this key (race after lock)
  IF v_usage.return_idempotency_key IS NOT NULL AND v_usage.return_idempotency_key = v_key THEN
    RETURN jsonb_build_object(
      'usage_id', v_usage.id,
      'status', v_usage.status,
      'quantity_restored', v_usage.quantity_used,
      'return_movement_id', v_usage.return_movement_id,
      'return_journal_entry_id', v_usage.return_journal_entry_id,
      'original_cogs_journal_entry_id', v_usage.cogs_journal_entry_id,
      'unit_cost', v_usage.unit_cost,
      'total_cost', v_usage.total_cost,
      'return_date', v_usage.return_date,
      'idempotent', TRUE
    );
  END IF;

  IF v_usage.status = 'returned'
     OR v_usage.return_movement_id IS NOT NULL
     OR v_usage.returned_at IS NOT NULL THEN
    RAISE EXCEPTION 'USAGE_ALREADY_RETURNED: usage has already been returned';
  END IF;

  IF v_usage.status NOT IN ('allocated', 'consumed') THEN
    RAISE EXCEPTION 'USAGE_RETURN_INVALID_STATUS: usage status % cannot be returned', v_usage.status;
  END IF;

  -- Lock parent job
  SELECT * INTO v_job
  FROM service_jobs
  WHERE id = v_usage.job_id
    AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND: parent job not found for business';
  END IF;

  IF v_job.materials_reversed IS TRUE THEN
    RAISE EXCEPTION 'JOB_MATERIALS_ALREADY_REVERSED: job materials were already restored on cancellation';
  END IF;

  -- Lock material
  SELECT * INTO v_material
  FROM service_material_inventory
  WHERE id = v_usage.material_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATERIAL_NOT_FOUND: material not found';
  END IF;

  IF v_material.business_id IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION 'CROSS_TENANT: material does not belong to business';
  END IF;

  v_qty := v_usage.quantity_used;
  IF v_qty IS NULL OR v_qty <= 0 THEN
    RAISE EXCEPTION 'USAGE_RETURN_INVALID_QTY: quantity_used must be positive';
  END IF;

  v_unit_cost := COALESCE(v_usage.unit_cost, 0);
  v_total_cost := COALESCE(v_usage.total_cost, ROUND(v_qty * v_unit_cost, 2));

  -- Resolve original COGS journal when consumed
  v_cogs_je_id := v_usage.cogs_journal_entry_id;
  IF v_usage.status = 'consumed' THEN
    IF v_cogs_je_id IS NULL THEN
      SELECT id INTO v_cogs_je_id
      FROM journal_entries
      WHERE reference_type = 'service_job_usage'
        AND reference_id = v_usage.id
      LIMIT 1;
    END IF;

    IF v_cogs_je_id IS NULL THEN
      RAISE EXCEPTION 'USAGE_COGS_LINK_MISSING: consumed usage has no COGS journal; refusing to guess';
    END IF;

    -- Period must be open for ledger reversal
    BEGIN
      PERFORM assert_accounting_period_is_open(p_business_id, v_return_date);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'PERIOD_LOCKED: %', SQLERRM;
    END;
  END IF;
  -- Allocated / unconsumed: quantity-only return; no period lock
  -- (matches existing manual stock-out / add-stock operational precedent).

  v_new_qty := COALESCE(v_material.quantity_on_hand, 0) + v_qty;

  UPDATE service_material_inventory
  SET quantity_on_hand = v_new_qty,
      updated_at = NOW()
  WHERE id = v_material.id
    AND business_id = p_business_id;

  INSERT INTO service_material_movements (
    business_id,
    material_id,
    movement_type,
    quantity,
    unit_cost,
    reference_id,
    movement_date,
    note
  ) VALUES (
    p_business_id,
    v_material.id,
    'return',
    v_qty,
    v_unit_cost,
    v_usage.job_id,
    v_return_date,
    'Job material usage return'
  )
  RETURNING id INTO v_movement_id;

  v_return_je_id := NULL;
  IF v_usage.status = 'consumed' THEN
    -- Idempotency for return journal
    SELECT id INTO v_return_je_id
    FROM journal_entries
    WHERE reference_type = 'service_job_usage_return'
      AND reference_id = v_usage.id
    LIMIT 1;

    IF v_return_je_id IS NULL THEN
      PERFORM assert_account_exists(p_business_id, '1450');
      PERFORM assert_account_exists(p_business_id, '5110');

      v_cost_account_id := get_account_by_code(p_business_id, '5110');
      v_inventory_account_id := get_account_by_code(p_business_id, '1450');

      IF v_cost_account_id IS NULL OR v_inventory_account_id IS NULL THEN
        RAISE EXCEPTION 'ACCOUNT_CONFIGURATION_REQUIRED: Service ledger accounts (1450, 5110) not found';
      END IF;

      v_journal_lines := jsonb_build_array(
        jsonb_build_object(
          'account_id', v_inventory_account_id,
          'debit', v_total_cost,
          'description', 'Return job material - restore inventory'
        ),
        jsonb_build_object(
          'account_id', v_cost_account_id,
          'credit', v_total_cost,
          'description', 'Return job material - reverse COGS'
        )
      );

      SELECT post_journal_entry(
        p_business_id,
        v_return_date,
        'Service job material usage return',
        'service_job_usage_return',
        v_usage.id,
        v_journal_lines,
        FALSE,
        NULL,
        NULL,
        p_returned_by,
        NULL,
        NULL,
        NULL,
        NULL,
        'system',
        FALSE,
        v_cogs_je_id
      ) INTO v_return_je_id;
    END IF;
  END IF;

  UPDATE service_job_material_usage
  SET status = 'returned',
      cogs_journal_entry_id = COALESCE(cogs_journal_entry_id, v_cogs_je_id),
      return_movement_id = v_movement_id,
      return_journal_entry_id = v_return_je_id,
      returned_at = NOW(),
      returned_by = p_returned_by,
      return_date = v_return_date,
      return_idempotency_key = v_key
  WHERE id = v_usage.id
    AND business_id = p_business_id
    AND status IN ('allocated', 'consumed')
    AND return_movement_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USAGE_ALREADY_RETURNED: concurrent return won the race';
  END IF;

  RETURN jsonb_build_object(
    'usage_id', v_usage.id,
    'status', 'returned',
    'quantity_restored', v_qty,
    'return_movement_id', v_movement_id,
    'return_journal_entry_id', v_return_je_id,
    'original_cogs_journal_entry_id', v_cogs_je_id,
    'unit_cost', v_unit_cost,
    'total_cost', v_total_cost,
    'return_date', v_return_date,
    'idempotent', FALSE
  );
END;
$function$
;


-- ---------------------------------------------------------------------------
-- reverse_service_job_cogs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_service_job_cogs(p_job_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  business_id_val UUID;
  total_reversal NUMERIC;
  cost_account_id UUID;
  inventory_account_id UUID;
  journal_lines JSONB;
  journal_id UUID;
  v_date DATE;
BEGIN

  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT (auth.role() IS NULL AND session_user IN ('postgres','supabase_admin')) THEN
    IF auth.uid() IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.service_jobs sj
         WHERE sj.id = p_job_id
           AND public.finza_rls_can_write_accounting_business(sj.business_id)
       ) THEN
      RAISE EXCEPTION 'Not authorized to reverse service job COGS for this business'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  -- Idempotency: already posted for this job cancel
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'service_job_cancel' AND reference_id = p_job_id
  LIMIT 1;
  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  SELECT business_id INTO business_id_val
  FROM service_jobs
  WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service job not found: %', p_job_id;
  END IF;

  -- Only consumed usages that still have outstanding COGS (not returned per-usage)
  SELECT COALESCE(SUM(u.total_cost), 0) INTO total_reversal
  FROM service_job_material_usage u
  WHERE u.job_id = p_job_id
    AND u.business_id = business_id_val
    AND u.status = 'consumed'
    AND u.return_movement_id IS NULL
    AND u.return_journal_entry_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM journal_entries je
      WHERE je.reference_type = 'service_job_usage'
        AND je.reference_id = u.id
    );

  IF total_reversal IS NULL OR total_reversal <= 0 THEN
    RETURN NULL;
  END IF;

  v_date := CURRENT_DATE;

  PERFORM assert_accounting_period_is_open(business_id_val, v_date);
  PERFORM assert_account_exists(business_id_val, '1450');
  PERFORM assert_account_exists(business_id_val, '5110');

  cost_account_id := get_account_by_code(business_id_val, '5110');
  inventory_account_id := get_account_by_code(business_id_val, '1450');

  IF cost_account_id IS NULL OR inventory_account_id IS NULL THEN
    RAISE EXCEPTION 'Service ledger accounts (1450, 5110) not found for business %', business_id_val;
  END IF;

  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', inventory_account_id,
      'debit', total_reversal,
      'description', 'Service job cancelled - restore materials inventory'
    ),
    jsonb_build_object(
      'account_id', cost_account_id,
      'credit', total_reversal,
      'description', 'Reverse cost of services'
    )
  );

  SELECT post_journal_entry(
    business_id_val,
    v_date,
    'Service job cancelled - reverse COGS',
    'service_job_cancel',
    p_job_id,
    journal_lines,
    FALSE,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'system'
  ) INTO journal_id;

  RETURN journal_id;
END;
$function$
;


-- ---------------------------------------------------------------------------
-- Backend-only payroll helpers: remove client execution.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.salary_advance_apply_posted_balance(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.salary_advance_stop_recurring_deduction(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.salary_advance_posted_repaid_amount(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.salary_advance_apply_posted_balance(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.salary_advance_stop_recurring_deduction(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.salary_advance_posted_repaid_amount(uuid) TO service_role;

-- Client-callable functions keep authenticated execution; PUBLIC and anon stay closed.
REVOKE ALL ON FUNCTION public.process_retail_purchase_order_receipt(uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_customer_sale_stats(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.return_service_job_material_usage(uuid, uuid, date, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_service_job_cogs(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.process_retail_purchase_order_receipt(uuid, uuid, uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_sale_stats(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.return_service_job_material_usage(uuid, uuid, date, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reverse_service_job_cogs(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.process_retail_purchase_order_receipt(uuid, uuid, uuid, uuid, jsonb) IS
  'Retail PO receipt. 721: caller must be the acting user and a member of the business; service role bypasses.';
COMMENT ON FUNCTION public.get_customer_sale_stats(uuid, uuid) IS
  'Customer sales aggregate. 721: caller must be a member of the business; service role bypasses.';
COMMENT ON FUNCTION public.return_service_job_material_usage(uuid, uuid, date, text, uuid) IS
  'Service material return. 721: caller must be a member of the business and must match p_returned_by when supplied.';
COMMENT ON FUNCTION public.reverse_service_job_cogs(uuid) IS
  'Service job COGS reversal. 721: caller must hold accounting-write authority on the job business.';
