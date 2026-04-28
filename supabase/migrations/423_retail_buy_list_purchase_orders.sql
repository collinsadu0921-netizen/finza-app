-- Retail buy-list / supplier order workflow (Ghana-oriented).
-- Status: planned | ordered | partially_received | received | paid | cancelled
-- Line costs optional at order time; receipt uses quantity_received + received_unit_cost for valuation.

-- ---------------------------------------------------------------------------
-- purchase_orders: note, payment tracking, expanded status
-- ---------------------------------------------------------------------------
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS supplier_order_note text;

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS payment_state text NOT NULL DEFAULT 'unpaid';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_payment_state_check'
  ) THEN
    ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_payment_state_check
      CHECK (payment_state IN ('unpaid', 'part_paid', 'paid'));
  END IF;
END $$;

COMMENT ON COLUMN purchase_orders.supplier_order_note IS 'Shown on WhatsApp/email buy list; internal restocking note.';
COMMENT ON COLUMN purchase_orders.payment_state IS 'Supplier payment tracking: unpaid | part_paid | paid (no cash journal in this flow).';

-- MUST drop old status CHECK before assigning new enum values (draft→planned would violate old check).
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;

UPDATE purchase_orders SET status = 'planned' WHERE status = 'draft';
UPDATE purchase_orders SET status = 'ordered' WHERE status = 'sent';

ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('planned', 'ordered', 'partially_received', 'received', 'paid', 'cancelled'));

ALTER TABLE purchase_orders ALTER COLUMN status SET DEFAULT 'planned';

-- ---------------------------------------------------------------------------
-- purchase_order_items: optional estimate cost; receipt columns
-- ---------------------------------------------------------------------------
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS quantity_received numeric NOT NULL DEFAULT 0;

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS received_unit_cost numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_items_quantity_received_check'
  ) THEN
    ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_quantity_received_check
      CHECK (quantity_received >= 0 AND quantity_received <= quantity);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_items_received_unit_cost_check'
  ) THEN
    ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_received_unit_cost_check
      CHECK (received_unit_cost IS NULL OR received_unit_cost >= 0);
  END IF;
END $$;

-- Drop legacy NOT NULL / CHECK on costs so orders can omit price until receipt
ALTER TABLE purchase_order_items ALTER COLUMN unit_cost DROP NOT NULL;
ALTER TABLE purchase_order_items ALTER COLUMN total_cost DROP NOT NULL;

ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_unit_cost_check;
ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_total_cost_check;
ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_unit_cost_nonneg_check;
ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_total_cost_nonneg_check;

ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_unit_cost_nonneg_check
  CHECK (unit_cost IS NULL OR unit_cost >= 0);

ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_total_cost_nonneg_check
  CHECK (total_cost IS NULL OR total_cost >= 0);

-- Backfill receipt columns for already-received POs (ledger used historical totals)
UPDATE purchase_order_items poi
SET
  quantity_received = poi.quantity,
  received_unit_cost = COALESCE(poi.unit_cost, 0)
FROM purchase_orders po
WHERE poi.purchase_order_id = po.id
  AND po.status = 'received'
  AND (poi.quantity_received IS DISTINCT FROM poi.quantity OR poi.received_unit_cost IS NULL);

COMMENT ON COLUMN purchase_order_items.quantity IS 'Quantity ordered / requested on buy list.';
COMMENT ON COLUMN purchase_order_items.unit_cost IS 'Optional estimated unit cost before supplier confirms price.';
COMMENT ON COLUMN purchase_order_items.total_cost IS 'Optional line estimate; receipt valuation uses quantity_received * received_unit_cost.';
COMMENT ON COLUMN purchase_order_items.quantity_received IS 'Cumulative quantity physically received (<= quantity).';
COMMENT ON COLUMN purchase_order_items.received_unit_cost IS 'Actual unit cost at receipt (used for inventory + AP posting).';

-- ---------------------------------------------------------------------------
-- Ledger: value receipt from received columns; allow RPC after status = received
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION post_purchase_order_receipt_to_ledger(p_purchase_order_id UUID)
RETURNS UUID AS $$
DECLARE
  po_record RECORD;
  business_id_val UUID;
  inventory_account_id UUID;
  ap_account_id UUID;
  journal_id UUID;
  total_cost NUMERIC := 0;
  journal_lines JSONB;
  supplier_name TEXT;
BEGIN
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'purchase_order'
    AND reference_id = p_purchase_order_id
  LIMIT 1;

  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  SELECT
    po.business_id,
    po.supplier_id,
    po.status,
    po.order_date,
    po.reference,
    s.name AS supplier_name
  INTO po_record
  FROM purchase_orders po
  JOIN suppliers s ON s.id = po.supplier_id
  WHERE po.id = p_purchase_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order not found: %', p_purchase_order_id;
  END IF;

  IF po_record.status IS DISTINCT FROM 'received' THEN
    RAISE EXCEPTION 'Purchase order % must be status received before posting (current: %).',
      p_purchase_order_id, po_record.status;
  END IF;

  business_id_val := po_record.business_id;
  supplier_name := po_record.supplier_name;

  PERFORM assert_accounting_period_is_open(business_id_val, po_record.order_date);

  SELECT COALESCE(SUM(quantity_received * received_unit_cost), 0)
  INTO total_cost
  FROM purchase_order_items
  WHERE purchase_order_id = p_purchase_order_id
    AND quantity_received > 0
    AND received_unit_cost IS NOT NULL;

  IF total_cost <= 0 THEN
    RAISE EXCEPTION 'Purchase order % has no positive receipt value (sum of quantity_received * received_unit_cost).',
      p_purchase_order_id;
  END IF;

  -- Retail inventory policy: use 1200 for retail inventory asset postings.
  -- Service materials inventory is separate and uses 1450 in service-only flows.
  inventory_account_id := get_account_by_code(business_id_val, '1200');
  ap_account_id := get_account_by_code(business_id_val, '2000');

  IF inventory_account_id IS NULL THEN
    RAISE EXCEPTION 'Inventory account (1200) not found for business: %', business_id_val;
  END IF;

  IF ap_account_id IS NULL THEN
    RAISE EXCEPTION 'Accounts Payable account (2000) not found for business: %', business_id_val;
  END IF;

  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', inventory_account_id,
      'debit', total_cost,
      'description', 'Supplier order receipt: inventory from ' || supplier_name ||
                     COALESCE(' (ref: ' || po_record.reference || ')', '')
    ),
    jsonb_build_object(
      'account_id', ap_account_id,
      'credit', total_cost,
      'description', 'Supplier order receipt: AP for ' || supplier_name ||
                     COALESCE(' (ref: ' || po_record.reference || ')', '')
    )
  );

  IF (
    (SELECT SUM(COALESCE((line->>'debit')::NUMERIC, 0)) FROM jsonb_array_elements(journal_lines) AS line) !=
    (SELECT SUM(COALESCE((line->>'credit')::NUMERIC, 0)) FROM jsonb_array_elements(journal_lines) AS line)
  ) THEN
    RAISE EXCEPTION 'Purchase order journal entry imbalance for PO %', p_purchase_order_id;
  END IF;

  SELECT post_journal_entry(
    business_id_val,
    po_record.order_date,
    'Supplier order: ' || supplier_name ||
    COALESCE(' (ref: ' || po_record.reference || ')', ''),
    'purchase_order',
    p_purchase_order_id,
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

  IF journal_id IS NULL THEN
    RAISE EXCEPTION 'Failed to create journal entry for purchase order %', p_purchase_order_id;
  END IF;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_purchase_order_receipt_to_ledger IS
'Posts supplier order receipt (Inventory DR / AP CR) using sum(quantity_received * received_unit_cost). PO status must be received.';
