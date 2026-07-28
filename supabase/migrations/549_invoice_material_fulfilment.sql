-- ============================================================================
-- Migration 549: Source-aware invoice material fulfilment
-- ============================================================================
-- Prevents double inventory reduction / double COGS between job material usage
-- and invoice material fulfilment.
--
-- Additive / forward-only:
--   * invoice_items.material_inventory_source + job_material_usage_id
--   * invoice_material_fulfilments (+ returns)
--   * movement types invoice_fulfilment / invoice_fulfilment_return
--   * RPCs: fulfil_invoice_material_line, return_invoice_material_fulfilment
--   * helpers for job-usage billable remaining quantity
--
-- Existing material invoice lines are classified as legacy_unclassified (not
-- direct_sale) so historical job-linked invoices cannot auto-fulfil.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Movement types
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
      'invoice_fulfilment_return'
    )
  );

-- ---------------------------------------------------------------------------
-- 2) Invoice item source classification + job-usage linkage
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS material_inventory_source TEXT,
  ADD COLUMN IF NOT EXISTS job_material_usage_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoice_items_material_inventory_source_check'
  ) THEN
    ALTER TABLE public.invoice_items
      ADD CONSTRAINT invoice_items_material_inventory_source_check
      CHECK (
        material_inventory_source IS NULL
        OR material_inventory_source IN ('direct_sale', 'job_usage', 'legacy_unclassified')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoice_items_job_material_usage_id_fkey'
  ) THEN
    ALTER TABLE public.invoice_items
      ADD CONSTRAINT invoice_items_job_material_usage_id_fkey
      FOREIGN KEY (job_material_usage_id)
      REFERENCES public.service_job_material_usage(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Existing material lines → legacy (never auto-treat as direct_sale)
UPDATE public.invoice_items
SET material_inventory_source = 'legacy_unclassified'
WHERE material_id IS NOT NULL
  AND material_inventory_source IS NULL;

COMMENT ON COLUMN public.invoice_items.material_inventory_source IS
  'direct_sale = fulfil from stock; job_usage = already consumed on job; legacy_unclassified = historical, block fulfilment until classified.';
COMMENT ON COLUMN public.invoice_items.job_material_usage_id IS
  'Required when material_inventory_source = job_usage. Links to authoritative job usage that owns stock/COGS.';

CREATE INDEX IF NOT EXISTS idx_invoice_items_job_material_usage_id
  ON public.invoice_items (job_material_usage_id)
  WHERE job_material_usage_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_items_material_source
  ON public.invoice_items (material_inventory_source)
  WHERE material_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Fulfilment + return tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_material_fulfilments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  invoice_item_id UUID NOT NULL REFERENCES public.invoice_items(id) ON DELETE RESTRICT,
  material_id UUID NOT NULL REFERENCES public.service_material_inventory(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC NOT NULL CHECK (unit_cost >= 0),
  total_cost NUMERIC NOT NULL CHECK (total_cost >= 0),
  movement_id UUID REFERENCES public.service_material_movements(id) ON DELETE RESTRICT,
  journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'fully_returned')),
  quantity_returned NUMERIC NOT NULL DEFAULT 0 CHECK (quantity_returned >= 0),
  idempotency_key TEXT NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reversed_at TIMESTAMPTZ,
  reversed_by UUID,
  CONSTRAINT invoice_material_fulfilments_qty_returned_le_qty
    CHECK (quantity_returned <= quantity)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_material_fulfilments_idempotency
  ON public.invoice_material_fulfilments (business_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_invoice_material_fulfilments_invoice_item
  ON public.invoice_material_fulfilments (invoice_item_id);

CREATE INDEX IF NOT EXISTS idx_invoice_material_fulfilments_invoice
  ON public.invoice_material_fulfilments (invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_material_fulfilments_material
  ON public.invoice_material_fulfilments (material_id);

ALTER TABLE public.invoice_material_fulfilments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view invoice_material_fulfilments for their business"
  ON public.invoice_material_fulfilments;
CREATE POLICY "Users can view invoice_material_fulfilments for their business"
  ON public.invoice_material_fulfilments FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

DROP POLICY IF EXISTS "Users can insert invoice_material_fulfilments for their business"
  ON public.invoice_material_fulfilments;
CREATE POLICY "Users can insert invoice_material_fulfilments for their business"
  ON public.invoice_material_fulfilments FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(business_id));

DROP POLICY IF EXISTS "Users can update invoice_material_fulfilments for their business"
  ON public.invoice_material_fulfilments;
CREATE POLICY "Users can update invoice_material_fulfilments for their business"
  ON public.invoice_material_fulfilments FOR UPDATE
  USING (public.finza_user_can_access_business(business_id))
  WITH CHECK (public.finza_user_can_access_business(business_id));

CREATE TABLE IF NOT EXISTS public.invoice_material_fulfilment_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  fulfilment_id UUID NOT NULL REFERENCES public.invoice_material_fulfilments(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC NOT NULL CHECK (unit_cost >= 0),
  total_cost NUMERIC NOT NULL CHECK (total_cost >= 0),
  movement_id UUID REFERENCES public.service_material_movements(id) ON DELETE RESTRICT,
  journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_material_fulfilment_returns_idempotency
  ON public.invoice_material_fulfilment_returns (business_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_invoice_material_fulfilment_returns_fulfilment
  ON public.invoice_material_fulfilment_returns (fulfilment_id);

ALTER TABLE public.invoice_material_fulfilment_returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view invoice_material_fulfilment_returns for their business"
  ON public.invoice_material_fulfilment_returns;
CREATE POLICY "Users can view invoice_material_fulfilment_returns for their business"
  ON public.invoice_material_fulfilment_returns FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

DROP POLICY IF EXISTS "Users can insert invoice_material_fulfilment_returns for their business"
  ON public.invoice_material_fulfilment_returns;
CREATE POLICY "Users can insert invoice_material_fulfilment_returns for their business"
  ON public.invoice_material_fulfilment_returns FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(business_id));

-- ---------------------------------------------------------------------------
-- 4) Helpers: active billed qty for a job usage; fulfilled qty for a line
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_job_usage_billed_quantity(
  p_usage_id UUID,
  p_exclude_invoice_id UUID DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(ii.qty), 0)
  FROM public.invoice_items ii
  JOIN public.invoices inv ON inv.id = ii.invoice_id
  WHERE ii.job_material_usage_id = p_usage_id
    AND ii.material_inventory_source = 'job_usage'
    AND ii.material_id IS NOT NULL
    AND inv.deleted_at IS NULL
    AND LOWER(COALESCE(inv.status, '')) NOT IN ('cancelled', 'void')
    AND (p_exclude_invoice_id IS NULL OR inv.id IS DISTINCT FROM p_exclude_invoice_id);
$$;

CREATE OR REPLACE FUNCTION public.invoice_item_fulfilled_quantity(p_invoice_item_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(f.quantity - f.quantity_returned), 0)
  FROM public.invoice_material_fulfilments f
  WHERE f.invoice_item_id = p_invoice_item_id
    AND f.status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.invoice_item_gross_fulfilled_quantity(p_invoice_item_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(f.quantity), 0)
  FROM public.invoice_material_fulfilments f
  WHERE f.invoice_item_id = p_invoice_item_id;
$$;

-- ---------------------------------------------------------------------------
-- 5) Invoice item source integrity trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_invoice_item_material_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
  v_usage RECORD;
  v_job RECORD;
  v_billed NUMERIC;
  v_other_billed NUMERIC;
BEGIN
  IF NEW.material_id IS NULL THEN
    IF NEW.material_inventory_source IS NOT NULL OR NEW.job_material_usage_id IS NOT NULL THEN
      RAISE EXCEPTION 'INVOICE_MATERIAL_SOURCE_INVALID: non-material lines cannot have material source or job usage link';
    END IF;
    RETURN NEW;
  END IF;

  -- Material lines must have an explicit source on write (API should set it).
  -- Allow legacy_unclassified for historical / classification-in-progress.
  IF NEW.material_inventory_source IS NULL THEN
    RAISE EXCEPTION 'INVOICE_MATERIAL_SOURCE_REQUIRED: material lines require material_inventory_source';
  END IF;

  IF NEW.material_inventory_source = 'direct_sale' THEN
    IF NEW.job_material_usage_id IS NOT NULL THEN
      RAISE EXCEPTION 'INVOICE_MATERIAL_SOURCE_INVALID: direct_sale lines cannot link job usage';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.material_inventory_source = 'legacy_unclassified' THEN
    IF NEW.job_material_usage_id IS NOT NULL THEN
      RAISE EXCEPTION 'INVOICE_MATERIAL_SOURCE_INVALID: legacy lines cannot link job usage until classified';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.material_inventory_source <> 'job_usage' THEN
    RAISE EXCEPTION 'INVOICE_MATERIAL_SOURCE_INVALID: unknown source %', NEW.material_inventory_source;
  END IF;

  IF NEW.job_material_usage_id IS NULL THEN
    RAISE EXCEPTION 'INVOICE_JOB_USAGE_REQUIRED: job_usage lines must reference service_job_material_usage';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = NEW.invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND: invoice missing for item';
  END IF;

  SELECT * INTO v_usage
  FROM public.service_job_material_usage
  WHERE id = NEW.job_material_usage_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_USAGE_NOT_FOUND: job material usage not found';
  END IF;

  IF v_usage.business_id IS DISTINCT FROM v_invoice.business_id THEN
    RAISE EXCEPTION 'CROSS_TENANT: job usage does not belong to invoice business';
  END IF;

  IF v_usage.material_id IS DISTINCT FROM NEW.material_id THEN
    RAISE EXCEPTION 'INVOICE_JOB_USAGE_MATERIAL_MISMATCH: usage material does not match invoice line material';
  END IF;

  IF v_usage.status = 'returned' THEN
    RAISE EXCEPTION 'INVOICE_JOB_USAGE_RETURNED: cannot bill a returned job usage';
  END IF;

  SELECT * INTO v_job
  FROM public.service_jobs
  WHERE id = v_usage.job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND: parent job missing for usage';
  END IF;

  IF v_job.business_id IS DISTINCT FROM v_invoice.business_id THEN
    RAISE EXCEPTION 'CROSS_TENANT: job does not belong to invoice business';
  END IF;

  IF v_job.customer_id IS NOT NULL
     AND v_invoice.customer_id IS NOT NULL
     AND v_job.customer_id IS DISTINCT FROM v_invoice.customer_id THEN
    RAISE EXCEPTION 'INVOICE_JOB_USAGE_CUSTOMER_MISMATCH: job customer does not match invoice customer';
  END IF;

  IF v_job.invoice_id IS NOT NULL AND v_job.invoice_id IS DISTINCT FROM v_invoice.id THEN
    RAISE EXCEPTION 'INVOICE_JOB_USAGE_LINKED_ELSEWHERE: job is linked to a different invoice';
  END IF;

  -- Allocation: other active invoice lines for this usage + this line qty
  SELECT COALESCE(SUM(ii.qty), 0) INTO v_other_billed
  FROM public.invoice_items ii
  JOIN public.invoices inv ON inv.id = ii.invoice_id
  WHERE ii.job_material_usage_id = NEW.job_material_usage_id
    AND ii.material_inventory_source = 'job_usage'
    AND ii.id IS DISTINCT FROM NEW.id
    AND inv.deleted_at IS NULL
    AND LOWER(COALESCE(inv.status, '')) NOT IN ('cancelled', 'void');

  v_billed := v_other_billed + COALESCE(NEW.qty, 0);
  IF v_billed > COALESCE(v_usage.quantity_used, 0) + 0.000001 THEN
    RAISE EXCEPTION
      'INVOICE_JOB_USAGE_OVER_ALLOCATED: billed % exceeds consumed % (already billed %)',
      v_billed,
      v_usage.quantity_used,
      v_other_billed;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_invoice_item_material_source ON public.invoice_items;
CREATE TRIGGER trg_enforce_invoice_item_material_source
  BEFORE INSERT OR UPDATE OF material_id, material_inventory_source, job_material_usage_id, qty
  ON public.invoice_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_invoice_item_material_source();

-- ---------------------------------------------------------------------------
-- 6) Block unsafe invoice cancel/void while active fulfilments exist
-- ---------------------------------------------------------------------------
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
      AND f.status = 'active'
      AND (f.quantity - f.quantity_returned) > 0;

    IF v_active > 0 THEN
      RAISE EXCEPTION
        'INVOICE_HAS_ACTIVE_FULFILMENTS: return or reverse % fulfilled material unit(s) before cancelling this invoice',
        v_active;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_invoice_cancel_with_fulfilments ON public.invoices;
CREATE TRIGGER trg_enforce_invoice_cancel_with_fulfilments
  BEFORE UPDATE OF status ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_invoice_cancel_with_fulfilments();

-- ---------------------------------------------------------------------------
-- 7) Authoritative fulfilment RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fulfil_invoice_material_line(
  p_business_id UUID,
  p_invoice_item_id UUID,
  p_quantity NUMERIC,
  p_idempotency_key TEXT,
  p_created_by UUID DEFAULT NULL,
  p_fulfilment_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
  v_date DATE;
  v_existing public.invoice_material_fulfilments%ROWTYPE;
  v_item RECORD;
  v_invoice RECORD;
  v_material public.service_material_inventory%ROWTYPE;
  v_qty NUMERIC;
  v_fulfilled NUMERIC;
  v_remaining NUMERIC;
  v_on_hand NUMERIC;
  v_unit_cost NUMERIC;
  v_total_cost NUMERIC;
  v_new_qty NUMERIC;
  v_movement_id UUID;
  v_journal_id UUID;
  v_cost_account_id UUID;
  v_inventory_account_id UUID;
  v_journal_lines JSONB;
  v_fulfilment_id UUID;
BEGIN
  IF p_business_id IS NULL OR p_invoice_item_id IS NULL THEN
    RAISE EXCEPTION 'FULFIL_INVALID_ARGS: business_id and invoice_item_id are required';
  END IF;

  v_key := NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '');
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'FULFIL_INVALID_ARGS: idempotency_key is required';
  END IF;

  v_qty := ROUND(COALESCE(p_quantity, 0)::NUMERIC, 4);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'FULFIL_INVALID_QTY: quantity must be positive';
  END IF;

  v_date := COALESCE(p_fulfilment_date, CURRENT_DATE);

  -- Idempotent replay
  SELECT * INTO v_existing
  FROM public.invoice_material_fulfilments
  WHERE business_id = p_business_id
    AND idempotency_key = v_key
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.invoice_item_id IS DISTINCT FROM p_invoice_item_id THEN
      RAISE EXCEPTION 'FULFIL_IDEMPOTENCY_CONFLICT: idempotency key already used for another line';
    END IF;
    RETURN jsonb_build_object(
      'fulfilment_id', v_existing.id,
      'invoice_item_id', v_existing.invoice_item_id,
      'invoice_id', v_existing.invoice_id,
      'material_id', v_existing.material_id,
      'quantity', v_existing.quantity,
      'unit_cost', v_existing.unit_cost,
      'total_cost', v_existing.total_cost,
      'movement_id', v_existing.movement_id,
      'journal_entry_id', v_existing.journal_entry_id,
      'status', v_existing.status,
      'idempotent', TRUE
    );
  END IF;

  SELECT ii.id, ii.invoice_id, ii.material_id, ii.qty, ii.material_inventory_source,
         ii.job_material_usage_id
  INTO v_item
  FROM public.invoice_items ii
  WHERE ii.id = p_invoice_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_ITEM_NOT_FOUND: invoice item not found';
  END IF;

  SELECT inv.id, inv.business_id, inv.status, inv.deleted_at
  INTO v_invoice
  FROM public.invoices inv
  WHERE inv.id = v_item.invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND: invoice missing for item';
  END IF;

  IF v_invoice.business_id IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION 'CROSS_TENANT: invoice item does not belong to business';
  END IF;

  IF v_invoice.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'INVOICE_DELETED: cannot fulfil materials on a deleted invoice';
  END IF;

  IF LOWER(COALESCE(v_invoice.status, '')) = 'draft' THEN
    RAISE EXCEPTION 'INVOICE_NOT_ISSUED: fulfil materials only after the invoice is issued';
  END IF;

  IF LOWER(COALESCE(v_invoice.status, '')) IN ('cancelled', 'void') THEN
    RAISE EXCEPTION 'INVOICE_TERMINAL: cannot fulfil materials on a cancelled or void invoice';
  END IF;

  IF v_item.material_id IS NULL THEN
    RAISE EXCEPTION 'NOT_MATERIAL_LINE: invoice item is not a material line';
  END IF;

  IF COALESCE(v_item.material_inventory_source, '') = 'job_usage' THEN
    RAISE EXCEPTION 'JOB_USAGE_NO_FULFIL: job-sourced material lines cannot be fulfilled from stock';
  END IF;

  IF COALESCE(v_item.material_inventory_source, '') = 'legacy_unclassified'
     OR v_item.material_inventory_source IS NULL THEN
    RAISE EXCEPTION 'LEGACY_SOURCE_REQUIRED: classify material source before fulfilment';
  END IF;

  IF v_item.material_inventory_source IS DISTINCT FROM 'direct_sale' THEN
    RAISE EXCEPTION 'FULFIL_SOURCE_INVALID: only direct_sale lines can be fulfilled';
  END IF;

  v_fulfilled := public.invoice_item_fulfilled_quantity(p_invoice_item_id);
  v_remaining := COALESCE(v_item.qty, 0) - v_fulfilled;
  IF v_qty > v_remaining + 0.000001 THEN
    RAISE EXCEPTION
      'FULFIL_QTY_EXCEEDS_REMAINING: requested % exceeds remaining unfulfilled % (ordered %, fulfilled %)',
      v_qty, v_remaining, v_item.qty, v_fulfilled;
  END IF;

  SELECT * INTO v_material
  FROM public.service_material_inventory
  WHERE id = v_item.material_id
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
      'INSUFFICIENT_STOCK: material "%" — requested %, remaining unfulfilled %, available stock %',
      COALESCE(v_material.name, v_material.id::text),
      v_qty,
      v_remaining,
      v_on_hand;
  END IF;

  v_unit_cost := ROUND(COALESCE(v_material.average_cost, 0)::NUMERIC, 4);
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

  -- Reserve fulfilment row first so journal/movement can reference it
  INSERT INTO public.invoice_material_fulfilments (
    business_id,
    invoice_id,
    invoice_item_id,
    material_id,
    quantity,
    unit_cost,
    total_cost,
    movement_id,
    journal_entry_id,
    status,
    quantity_returned,
    idempotency_key,
    created_by
  ) VALUES (
    p_business_id,
    v_item.invoice_id,
    p_invoice_item_id,
    v_material.id,
    v_qty,
    v_unit_cost,
    v_total_cost,
    NULL,
    NULL,
    'active',
    0,
    v_key,
    p_created_by
  )
  RETURNING id INTO v_fulfilment_id;

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
    'invoice_fulfilment',
    v_qty,
    v_unit_cost,
    v_fulfilment_id,
    v_date,
    'Invoice material fulfilment'
  )
  RETURNING id INTO v_movement_id;

  v_journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_cost_account_id,
      'debit', v_total_cost,
      'description', 'Cost of materials - invoice fulfilment'
    ),
    jsonb_build_object(
      'account_id', v_inventory_account_id,
      'credit', v_total_cost,
      'description', 'Service materials inventory'
    )
  );

  SELECT post_journal_entry(
    p_business_id,
    v_date,
    'Invoice material fulfilment',
    'invoice_material_fulfilment',
    v_fulfilment_id,
    v_journal_lines,
    FALSE,
    NULL,
    NULL,
    p_created_by,
    NULL,
    NULL,
    NULL,
    NULL,
    'system',
    FALSE
  ) INTO v_journal_id;

  UPDATE public.invoice_material_fulfilments
  SET movement_id = v_movement_id,
      journal_entry_id = v_journal_id
  WHERE id = v_fulfilment_id;

  RETURN jsonb_build_object(
    'fulfilment_id', v_fulfilment_id,
    'invoice_item_id', p_invoice_item_id,
    'invoice_id', v_item.invoice_id,
    'material_id', v_material.id,
    'material_name', v_material.name,
    'quantity', v_qty,
    'unit_cost', v_unit_cost,
    'total_cost', v_total_cost,
    'movement_id', v_movement_id,
    'journal_entry_id', v_journal_id,
    'quantity_on_hand', v_new_qty,
    'remaining_unfulfilled', ROUND(v_remaining - v_qty, 4),
    'status', 'active',
    'idempotent', FALSE
  );
EXCEPTION
  WHEN unique_violation THEN
    -- Concurrent idempotent insert won the race — return existing
    SELECT * INTO v_existing
    FROM public.invoice_material_fulfilments
    WHERE business_id = p_business_id
      AND idempotency_key = v_key
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'fulfilment_id', v_existing.id,
        'invoice_item_id', v_existing.invoice_item_id,
        'invoice_id', v_existing.invoice_id,
        'material_id', v_existing.material_id,
        'quantity', v_existing.quantity,
        'unit_cost', v_existing.unit_cost,
        'total_cost', v_existing.total_cost,
        'movement_id', v_existing.movement_id,
        'journal_entry_id', v_existing.journal_entry_id,
        'status', v_existing.status,
        'idempotent', TRUE
      );
    END IF;
    RAISE;
END;
$$;

COMMENT ON FUNCTION public.fulfil_invoice_material_line(UUID, UUID, NUMERIC, TEXT, UUID, DATE) IS
  'Atomically fulfils a direct_sale invoice material line: stock ↓, movement, Dr 5110 / Cr 1450, fulfilment row. Idempotent.';

GRANT EXECUTE ON FUNCTION public.fulfil_invoice_material_line(UUID, UUID, NUMERIC, TEXT, UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fulfil_invoice_material_line(UUID, UUID, NUMERIC, TEXT, UUID, DATE) TO service_role;

-- ---------------------------------------------------------------------------
-- 8) Authoritative return RPC (uses snapshotted fulfilment unit_cost)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.return_invoice_material_fulfilment(
  p_business_id UUID,
  p_fulfilment_id UUID,
  p_quantity NUMERIC,
  p_idempotency_key TEXT,
  p_returned_by UUID DEFAULT NULL,
  p_return_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
  v_date DATE;
  v_existing_ret public.invoice_material_fulfilment_returns%ROWTYPE;
  v_ful public.invoice_material_fulfilments%ROWTYPE;
  v_material public.service_material_inventory%ROWTYPE;
  v_qty NUMERIC;
  v_unreturned NUMERIC;
  v_unit_cost NUMERIC;
  v_total_cost NUMERIC;
  v_new_qty NUMERIC;
  v_movement_id UUID;
  v_journal_id UUID;
  v_cost_account_id UUID;
  v_inventory_account_id UUID;
  v_journal_lines JSONB;
  v_return_id UUID;
  v_qty_returned_new NUMERIC;
BEGIN
  IF p_business_id IS NULL OR p_fulfilment_id IS NULL THEN
    RAISE EXCEPTION 'RETURN_INVALID_ARGS: business_id and fulfilment_id are required';
  END IF;

  v_key := NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '');
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'RETURN_INVALID_ARGS: idempotency_key is required';
  END IF;

  v_qty := ROUND(COALESCE(p_quantity, 0)::NUMERIC, 4);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'RETURN_INVALID_QTY: quantity must be positive';
  END IF;

  v_date := COALESCE(p_return_date, CURRENT_DATE);

  SELECT * INTO v_existing_ret
  FROM public.invoice_material_fulfilment_returns
  WHERE business_id = p_business_id
    AND idempotency_key = v_key
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_ret.fulfilment_id IS DISTINCT FROM p_fulfilment_id THEN
      RAISE EXCEPTION 'RETURN_IDEMPOTENCY_CONFLICT: idempotency key already used for another fulfilment';
    END IF;
    RETURN jsonb_build_object(
      'return_id', v_existing_ret.id,
      'fulfilment_id', v_existing_ret.fulfilment_id,
      'quantity', v_existing_ret.quantity,
      'unit_cost', v_existing_ret.unit_cost,
      'total_cost', v_existing_ret.total_cost,
      'movement_id', v_existing_ret.movement_id,
      'journal_entry_id', v_existing_ret.journal_entry_id,
      'idempotent', TRUE
    );
  END IF;

  SELECT * INTO v_ful
  FROM public.invoice_material_fulfilments
  WHERE id = p_fulfilment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FULFILMENT_NOT_FOUND: fulfilment not found';
  END IF;

  IF v_ful.business_id IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION 'CROSS_TENANT: fulfilment does not belong to business';
  END IF;

  v_unreturned := COALESCE(v_ful.quantity, 0) - COALESCE(v_ful.quantity_returned, 0);
  IF v_qty > v_unreturned + 0.000001 THEN
    RAISE EXCEPTION
      'RETURN_QTY_EXCEEDS_UNRETURNED: requested % exceeds unreturned %',
      v_qty, v_unreturned;
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

  -- Snapshot cost from original fulfilment — never current average_cost
  v_unit_cost := ROUND(COALESCE(v_ful.unit_cost, 0)::NUMERIC, 4);
  v_total_cost := ROUND(v_qty * v_unit_cost, 2);
  v_new_qty := COALESCE(v_material.quantity_on_hand, 0) + v_qty;

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
    'invoice_fulfilment_return',
    v_qty,
    v_unit_cost,
    v_ful.invoice_id,
    v_date,
    'Invoice material fulfilment return'
  )
  RETURNING id INTO v_movement_id;

  v_journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_inventory_account_id,
      'debit', v_total_cost,
      'description', 'Return invoice material - restore inventory'
    ),
    jsonb_build_object(
      'account_id', v_cost_account_id,
      'credit', v_total_cost,
      'description', 'Return invoice material - reverse COGS'
    )
  );

  SELECT post_journal_entry(
    p_business_id,
    v_date,
    'Invoice material fulfilment return',
    'invoice_material_fulfilment_return',
    p_fulfilment_id,
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
    v_ful.journal_entry_id
  ) INTO v_journal_id;

  INSERT INTO public.invoice_material_fulfilment_returns (
    business_id,
    fulfilment_id,
    quantity,
    unit_cost,
    total_cost,
    movement_id,
    journal_entry_id,
    idempotency_key,
    created_by
  ) VALUES (
    p_business_id,
    p_fulfilment_id,
    v_qty,
    v_unit_cost,
    v_total_cost,
    v_movement_id,
    v_journal_id,
    v_key,
    p_returned_by
  )
  RETURNING id INTO v_return_id;

  v_qty_returned_new := COALESCE(v_ful.quantity_returned, 0) + v_qty;

  UPDATE public.invoice_material_fulfilments
  SET quantity_returned = v_qty_returned_new,
      status = CASE
        WHEN v_qty_returned_new >= quantity - 0.000001 THEN 'fully_returned'
        ELSE 'active'
      END,
      reversed_at = CASE
        WHEN v_qty_returned_new >= quantity - 0.000001 THEN NOW()
        ELSE reversed_at
      END,
      reversed_by = CASE
        WHEN v_qty_returned_new >= quantity - 0.000001 THEN p_returned_by
        ELSE reversed_by
      END
  WHERE id = p_fulfilment_id;

  RETURN jsonb_build_object(
    'return_id', v_return_id,
    'fulfilment_id', p_fulfilment_id,
    'quantity', v_qty,
    'unit_cost', v_unit_cost,
    'total_cost', v_total_cost,
    'movement_id', v_movement_id,
    'journal_entry_id', v_journal_id,
    'quantity_on_hand', v_new_qty,
    'quantity_returned_total', v_qty_returned_new,
    'idempotent', FALSE
  );
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_existing_ret
    FROM public.invoice_material_fulfilment_returns
    WHERE business_id = p_business_id
      AND idempotency_key = v_key
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'return_id', v_existing_ret.id,
        'fulfilment_id', v_existing_ret.fulfilment_id,
        'quantity', v_existing_ret.quantity,
        'unit_cost', v_existing_ret.unit_cost,
        'total_cost', v_existing_ret.total_cost,
        'movement_id', v_existing_ret.movement_id,
        'journal_entry_id', v_existing_ret.journal_entry_id,
        'idempotent', TRUE
      );
    END IF;
    RAISE;
END;
$$;

COMMENT ON FUNCTION public.return_invoice_material_fulfilment(UUID, UUID, NUMERIC, TEXT, UUID, DATE) IS
  'Atomically returns fulfilled invoice material using snapshotted unit cost. Dr 1450 / Cr 5110. Idempotent.';

GRANT EXECUTE ON FUNCTION public.return_invoice_material_fulfilment(UUID, UUID, NUMERIC, TEXT, UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_invoice_material_fulfilment(UUID, UUID, NUMERIC, TEXT, UUID, DATE) TO service_role;

GRANT EXECUTE ON FUNCTION public.invoice_job_usage_billed_quantity(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_job_usage_billed_quantity(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.invoice_item_fulfilled_quantity(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_item_fulfilled_quantity(UUID) TO service_role;
