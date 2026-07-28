-- ============================================================================
-- Migration 550: Inventory-aware undo of invoice material fulfilment returns
-- ============================================================================
-- Additive / forward-only:
--   * invoice_material_fulfilment_returns.quantity_undone + status
--   * invoice_material_fulfilment_return_undos (immutable audit rows)
--   * movement type invoice_fulfilment_return_undo
--   * RPC undo_invoice_material_fulfilment_return
--   * active-fulfilled helpers use net returned (returns - undos)
--
-- Accounting for undo:
--   Stock decreases
--   Dr 5110 / Cr 1450 at original fulfilment unit cost
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Movement type
-- ---------------------------------------------------------------------------
ALTER TABLE public.service_material_movements
  DROP CONSTRAINT IF EXISTS service_material_movements_movement_type_check;

ALTER TABLE public.service_material_movements
  ADD CONSTRAINT service_material_movements_movement_type_check
  CHECK (
    movement_type IN (
      'purchase',
      'adjustment',
      'job_usage',
      'return',
      'bill_receipt',
      'setup_stock',
      'stock_in',
      'stock_out',
      'write_off',
      'supplier_return',
      'invoice_fulfilment',
      'invoice_fulfilment_return',
      'invoice_fulfilment_return_undo'
    )
  );

-- ---------------------------------------------------------------------------
-- 2) Return row: track how much has been undone
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoice_material_fulfilment_returns
  ADD COLUMN IF NOT EXISTS quantity_undone NUMERIC NOT NULL DEFAULT 0
    CHECK (quantity_undone >= 0);

ALTER TABLE public.invoice_material_fulfilment_returns
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_material_fulfilment_returns_qty_undone_le_qty'
      AND conrelid = 'public.invoice_material_fulfilment_returns'::regclass
  ) THEN
    ALTER TABLE public.invoice_material_fulfilment_returns
      ADD CONSTRAINT invoice_material_fulfilment_returns_qty_undone_le_qty
      CHECK (quantity_undone <= quantity);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_material_fulfilment_returns_status_check'
      AND conrelid = 'public.invoice_material_fulfilment_returns'::regclass
  ) THEN
    ALTER TABLE public.invoice_material_fulfilment_returns
      ADD CONSTRAINT invoice_material_fulfilment_returns_status_check
      CHECK (status IN ('active', 'partially_undone', 'fully_undone'));
  END IF;
END $$;

UPDATE public.invoice_material_fulfilment_returns
SET status = CASE
  WHEN quantity_undone <= 0 THEN 'active'
  WHEN quantity_undone >= quantity - 0.000001 THEN 'fully_undone'
  ELSE 'partially_undone'
END
WHERE status IS DISTINCT FROM CASE
  WHEN quantity_undone <= 0 THEN 'active'
  WHEN quantity_undone >= quantity - 0.000001 THEN 'fully_undone'
  ELSE 'partially_undone'
END;

-- ---------------------------------------------------------------------------
-- 3) Immutable undo-return audit table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_material_fulfilment_return_undos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  return_id UUID NOT NULL REFERENCES public.invoice_material_fulfilment_returns(id) ON DELETE RESTRICT,
  fulfilment_id UUID NOT NULL REFERENCES public.invoice_material_fulfilments(id) ON DELETE RESTRICT,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  invoice_item_id UUID NOT NULL REFERENCES public.invoice_items(id) ON DELETE RESTRICT,
  material_id UUID NOT NULL REFERENCES public.service_material_inventory(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC NOT NULL CHECK (unit_cost >= 0),
  total_cost NUMERIC NOT NULL CHECK (total_cost >= 0),
  movement_id UUID REFERENCES public.service_material_movements(id) ON DELETE RESTRICT,
  journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_material_fulfilment_return_undos_idempotency
  ON public.invoice_material_fulfilment_return_undos (business_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_invoice_material_fulfilment_return_undos_return
  ON public.invoice_material_fulfilment_return_undos (return_id);

CREATE INDEX IF NOT EXISTS idx_invoice_material_fulfilment_return_undos_fulfilment
  ON public.invoice_material_fulfilment_return_undos (fulfilment_id);

CREATE INDEX IF NOT EXISTS idx_invoice_material_fulfilment_return_undos_invoice
  ON public.invoice_material_fulfilment_return_undos (invoice_id);

ALTER TABLE public.invoice_material_fulfilment_return_undos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view invoice_material_fulfilment_return_undos for their business"
  ON public.invoice_material_fulfilment_return_undos;
CREATE POLICY "Users can view invoice_material_fulfilment_return_undos for their business"
  ON public.invoice_material_fulfilment_return_undos FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

DROP POLICY IF EXISTS "Users can insert invoice_material_fulfilment_return_undos for their business"
  ON public.invoice_material_fulfilment_return_undos;
CREATE POLICY "Users can insert invoice_material_fulfilment_return_undos for their business"
  ON public.invoice_material_fulfilment_return_undos FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(business_id));

-- ---------------------------------------------------------------------------
-- 4) Active fulfilled quantity = gross fulfilled - net returned
--    (quantity_returned on fulfilment is maintained as net after undos)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_item_fulfilled_quantity(p_invoice_item_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(f.quantity - f.quantity_returned), 0)
  FROM public.invoice_material_fulfilments f
  WHERE f.invoice_item_id = p_invoice_item_id;
$$;

CREATE OR REPLACE FUNCTION public.enforce_invoice_cancel_with_fulfilments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active NUMERIC;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF LOWER(COALESCE(NEW.status, '')) IN ('cancelled', 'void')
     AND LOWER(COALESCE(OLD.status, '')) NOT IN ('cancelled', 'void') THEN
    SELECT COALESCE(SUM(f.quantity - f.quantity_returned), 0) INTO v_active
    FROM public.invoice_material_fulfilments f
    WHERE f.invoice_id = NEW.id
      AND (f.quantity - f.quantity_returned) > 0.000001;

    IF v_active > 0 THEN
      RAISE EXCEPTION
        'INVOICE_HAS_ACTIVE_FULFILMENTS: return or reverse % fulfilled material unit(s) before cancelling this invoice',
        v_active;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Undo return RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.undo_invoice_material_fulfilment_return(
  p_business_id UUID,
  p_return_id UUID,
  p_quantity NUMERIC,
  p_idempotency_key TEXT,
  p_undone_by UUID DEFAULT NULL,
  p_undo_date DATE DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
  v_date DATE;
  v_reason TEXT;
  v_existing public.invoice_material_fulfilment_return_undos%ROWTYPE;
  v_ret public.invoice_material_fulfilment_returns%ROWTYPE;
  v_ful public.invoice_material_fulfilments%ROWTYPE;
  v_invoice RECORD;
  v_material public.service_material_inventory%ROWTYPE;
  v_qty NUMERIC;
  v_undoable NUMERIC;
  v_unit_cost NUMERIC;
  v_total_cost NUMERIC;
  v_on_hand NUMERIC;
  v_new_qty NUMERIC;
  v_movement_id UUID;
  v_journal_id UUID;
  v_cost_account_id UUID;
  v_inventory_account_id UUID;
  v_journal_lines JSONB;
  v_undo_id UUID;
  v_qty_undone_new NUMERIC;
  v_qty_returned_new NUMERIC;
BEGIN
  IF p_business_id IS NULL OR p_return_id IS NULL THEN
    RAISE EXCEPTION 'UNDO_RETURN_INVALID_ARGS: business_id and return_id are required';
  END IF;

  v_key := NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '');
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'UNDO_RETURN_INVALID_ARGS: idempotency_key is required';
  END IF;

  v_qty := ROUND(COALESCE(p_quantity, 0)::NUMERIC, 4);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'UNDO_RETURN_INVALID_QTY: quantity must be positive';
  END IF;

  v_date := COALESCE(p_undo_date, CURRENT_DATE);
  v_reason := NULLIF(BTRIM(COALESCE(p_reason, '')), '');

  SELECT * INTO v_existing
  FROM public.invoice_material_fulfilment_return_undos
  WHERE business_id = p_business_id
    AND idempotency_key = v_key
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.return_id IS DISTINCT FROM p_return_id THEN
      RAISE EXCEPTION 'UNDO_RETURN_IDEMPOTENCY_CONFLICT: idempotency key already used for another return';
    END IF;
    RETURN jsonb_build_object(
      'undo_id', v_existing.id,
      'return_id', v_existing.return_id,
      'fulfilment_id', v_existing.fulfilment_id,
      'quantity', v_existing.quantity,
      'unit_cost', v_existing.unit_cost,
      'total_cost', v_existing.total_cost,
      'movement_id', v_existing.movement_id,
      'journal_entry_id', v_existing.journal_entry_id,
      'idempotent', TRUE
    );
  END IF;

  SELECT * INTO v_ret
  FROM public.invoice_material_fulfilment_returns
  WHERE id = p_return_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RETURN_NOT_FOUND: material return not found';
  END IF;

  IF v_ret.business_id IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION 'CROSS_TENANT: return does not belong to business';
  END IF;

  SELECT * INTO v_ful
  FROM public.invoice_material_fulfilments
  WHERE id = v_ret.fulfilment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FULFILMENT_NOT_FOUND: fulfilment not found for return';
  END IF;

  IF v_ful.business_id IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION 'CROSS_TENANT: fulfilment does not belong to business';
  END IF;

  SELECT inv.id, inv.business_id, inv.status, inv.deleted_at
  INTO v_invoice
  FROM public.invoices inv
  WHERE inv.id = v_ful.invoice_id
  FOR UPDATE;

  IF NOT FOUND OR v_invoice.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND: invoice not found for return';
  END IF;

  IF v_invoice.business_id IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION 'CROSS_TENANT: invoice does not belong to business';
  END IF;

  IF LOWER(COALESCE(v_invoice.status, '')) IN ('cancelled', 'void') THEN
    RAISE EXCEPTION 'INVOICE_TERMINAL: cannot undo a material return on a cancelled or void invoice';
  END IF;

  v_undoable := COALESCE(v_ret.quantity, 0) - COALESCE(v_ret.quantity_undone, 0);
  IF v_undoable <= 0.000001 THEN
    RAISE EXCEPTION 'UNDO_RETURN_NOTHING_LEFT: this return has already been fully undone';
  END IF;

  IF v_qty > v_undoable + 0.000001 THEN
    RAISE EXCEPTION
      'UNDO_RETURN_QTY_EXCEEDS_UNDOABLE: requested % exceeds remaining undoable %',
      v_qty, v_undoable;
  END IF;

  SELECT * INTO v_material
  FROM public.service_material_inventory
  WHERE id = v_ful.material_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATERIAL_NOT_FOUND: material not found';
  END IF;

  IF v_material.business_id IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION 'CROSS_TENANT: material does not belong to business';
  END IF;

  v_on_hand := COALESCE(v_material.quantity_on_hand, 0);
  IF v_on_hand < v_qty THEN
    RAISE EXCEPTION
      'INSUFFICIENT_STOCK: material "%" — requested undo %, available stock %',
      COALESCE(v_material.name, v_material.id::text),
      v_qty,
      v_on_hand;
  END IF;

  -- Snapshot cost from original fulfilment / return — never current average_cost
  v_unit_cost := ROUND(COALESCE(v_ret.unit_cost, v_ful.unit_cost, 0)::NUMERIC, 4);
  v_total_cost := ROUND(v_qty * v_unit_cost, 2);
  v_new_qty := v_on_hand - v_qty;

  PERFORM assert_accounting_period_is_open(p_business_id, v_date);
  PERFORM assert_account_exists(p_business_id, '1450');
  PERFORM assert_account_exists(p_business_id, '5110');

  v_cost_account_id := get_account_by_code(p_business_id, '5110');
  v_inventory_account_id := get_account_by_code(p_business_id, '1450');

  IF v_cost_account_id IS NULL OR v_inventory_account_id IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_CONFIGURATION_REQUIRED: Service ledger accounts (1450, 5110) not found';
  END IF;

  UPDATE public.service_material_inventory
  SET quantity_on_hand = v_new_qty,
      updated_at = NOW()
  WHERE id = v_material.id
    AND business_id = p_business_id;

  INSERT INTO public.service_material_movements (
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
    'invoice_fulfilment_return_undo',
    v_qty,
    v_unit_cost,
    v_ful.invoice_id,
    v_date,
    COALESCE('Undo invoice material return' || CASE WHEN v_reason IS NULL THEN '' ELSE ': ' || v_reason END, 'Undo invoice material return')
  )
  RETURNING id INTO v_movement_id;

  v_journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_cost_account_id,
      'debit', v_total_cost,
      'description', 'Undo invoice material return - restore COGS'
    ),
    jsonb_build_object(
      'account_id', v_inventory_account_id,
      'credit', v_total_cost,
      'description', 'Undo invoice material return - reduce inventory'
    )
  );

  SELECT post_journal_entry(
    p_business_id,
    v_date,
    'Undo invoice material fulfilment return',
    'invoice_material_fulfilment_return_undo',
    p_return_id,
    v_journal_lines,
    FALSE,
    NULL,
    NULL,
    p_undone_by,
    NULL,
    NULL,
    NULL,
    NULL,
    'system',
    FALSE,
    v_ret.journal_entry_id
  ) INTO v_journal_id;

  INSERT INTO public.invoice_material_fulfilment_return_undos (
    business_id,
    return_id,
    fulfilment_id,
    invoice_id,
    invoice_item_id,
    material_id,
    quantity,
    unit_cost,
    total_cost,
    movement_id,
    journal_entry_id,
    idempotency_key,
    reason,
    status,
    created_by
  ) VALUES (
    p_business_id,
    p_return_id,
    v_ful.id,
    v_ful.invoice_id,
    v_ful.invoice_item_id,
    v_ful.material_id,
    v_qty,
    v_unit_cost,
    v_total_cost,
    v_movement_id,
    v_journal_id,
    v_key,
    v_reason,
    'active',
    p_undone_by
  )
  RETURNING id INTO v_undo_id;

  v_qty_undone_new := COALESCE(v_ret.quantity_undone, 0) + v_qty;

  UPDATE public.invoice_material_fulfilment_returns
  SET quantity_undone = v_qty_undone_new,
      status = CASE
        WHEN v_qty_undone_new >= quantity - 0.000001 THEN 'fully_undone'
        WHEN v_qty_undone_new > 0 THEN 'partially_undone'
        ELSE 'active'
      END
  WHERE id = p_return_id;

  v_qty_returned_new := GREATEST(0, COALESCE(v_ful.quantity_returned, 0) - v_qty);

  UPDATE public.invoice_material_fulfilments
  SET quantity_returned = v_qty_returned_new,
      status = CASE
        WHEN v_qty_returned_new <= 0.000001 THEN 'active'
        WHEN v_qty_returned_new >= quantity - 0.000001 THEN 'fully_returned'
        ELSE 'active'
      END,
      reversed_at = CASE
        WHEN v_qty_returned_new <= 0.000001 THEN NULL
        WHEN v_qty_returned_new >= quantity - 0.000001 THEN COALESCE(reversed_at, NOW())
        ELSE NULL
      END,
      reversed_by = CASE
        WHEN v_qty_returned_new <= 0.000001 THEN NULL
        WHEN v_qty_returned_new >= quantity - 0.000001 THEN COALESCE(reversed_by, p_undone_by)
        ELSE NULL
      END
  WHERE id = v_ful.id;

  RETURN jsonb_build_object(
    'undo_id', v_undo_id,
    'return_id', p_return_id,
    'fulfilment_id', v_ful.id,
    'invoice_id', v_ful.invoice_id,
    'invoice_item_id', v_ful.invoice_item_id,
    'material_id', v_ful.material_id,
    'quantity', v_qty,
    'unit_cost', v_unit_cost,
    'total_cost', v_total_cost,
    'movement_id', v_movement_id,
    'journal_entry_id', v_journal_id,
    'quantity_on_hand', v_new_qty,
    'quantity_undone_total', v_qty_undone_new,
    'quantity_returned_total', v_qty_returned_new,
    'idempotent', FALSE
  );
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_existing
    FROM public.invoice_material_fulfilment_return_undos
    WHERE business_id = p_business_id
      AND idempotency_key = v_key
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'undo_id', v_existing.id,
        'return_id', v_existing.return_id,
        'fulfilment_id', v_existing.fulfilment_id,
        'quantity', v_existing.quantity,
        'unit_cost', v_existing.unit_cost,
        'total_cost', v_existing.total_cost,
        'movement_id', v_existing.movement_id,
        'journal_entry_id', v_existing.journal_entry_id,
        'idempotent', TRUE
      );
    END IF;
    RAISE;
END;
$$;

COMMENT ON FUNCTION public.undo_invoice_material_fulfilment_return(UUID, UUID, NUMERIC, TEXT, UUID, DATE, TEXT) IS
  'Atomically undoes an invoice material return using snapshotted fulfilment unit cost. Dr 5110 / Cr 1450. Idempotent.';

GRANT EXECUTE ON FUNCTION public.undo_invoice_material_fulfilment_return(UUID, UUID, NUMERIC, TEXT, UUID, DATE, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_invoice_material_fulfilment_return(UUID, UUID, NUMERIC, TEXT, UUID, DATE, TEXT)
  TO service_role;
