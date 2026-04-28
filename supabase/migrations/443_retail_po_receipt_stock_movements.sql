-- ============================================================================
-- Migration 443: stock_movements for retail PO receipt (purchase_receive)
-- ============================================================================
-- Extends stock_movements.type CHECK and logs one row per positive receipt
-- delta inside process_retail_purchase_order_receipt (same transaction).
-- Does not alter AVCO math, products_stock update logic, or ledger posting.
-- ============================================================================

-- Inline CHECK from 020_stock_tracking.sql is typically named stock_movements_type_check.
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_type_check CHECK (type IN (
    'sale',
    'refund',
    'adjustment',
    'initial_import',
    'purchase_receive'
  ));

CREATE OR REPLACE FUNCTION process_retail_purchase_order_receipt(
  p_business_id UUID,
  p_purchase_order_id UUID,
  p_store_id UUID,
  p_actor_user_id UUID,
  p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

COMMENT ON FUNCTION process_retail_purchase_order_receipt IS
'Transactional retail PO receipt RPC: validates PO, updates PO lines and products_stock qty, applies store-level AVCO, writes retail_cost_updates, inserts stock_movements (type purchase_receive) per positive delta line, updates PO status, and posts ledger only when fully received. Retail inventory account remains 1200; service inventory (1450) untouched.';
