-- ============================================================================
-- MIGRATION: Stock Transfers (Phase 2 - Multi-Store, Inventory-Safe)
-- ============================================================================
-- This migration creates tables and functions for inventory transfers between stores.
-- Transfers are balance-sheet movements only - no revenue, cash, or VAT impact.
--
-- GUARDRAILS:
-- - Receiving transfer posts exactly one journal entry
-- - Journal entry must have equal debit and credit
-- - Block receipt if period is locked
-- - No edits after received
-- ============================================================================

-- ============================================================================
-- STEP 1: Create stock_transfers table
-- ============================================================================
CREATE TABLE IF NOT EXISTS stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  from_store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  to_store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('draft', 'in_transit', 'received', 'cancelled')) DEFAULT 'draft',
  reference TEXT, -- Optional reference number
  initiated_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  received_by UUID REFERENCES users(id) ON DELETE SET NULL,
  initiated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  received_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT from_to_different CHECK (from_store_id != to_store_id)
);

-- Indexes for stock_transfers
CREATE INDEX IF NOT EXISTS idx_stock_transfers_business_id ON stock_transfers(business_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from_store_id ON stock_transfers(from_store_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to_store_id ON stock_transfers(to_store_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON stock_transfers(status);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_initiated_by ON stock_transfers(initiated_by);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_created_at ON stock_transfers(created_at DESC);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_stock_transfers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_stock_transfers_updated_at ON stock_transfers;
CREATE TRIGGER update_stock_transfers_updated_at
  BEFORE UPDATE ON stock_transfers
  FOR EACH ROW
  EXECUTE FUNCTION update_stock_transfers_updated_at();

-- ============================================================================
-- STEP 2: Create stock_transfer_items table
-- ============================================================================
CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_transfer_id UUID NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES products_variants(id) ON DELETE SET NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC NOT NULL CHECK (unit_cost >= 0), -- Cost at transfer time
  total_cost NUMERIC NOT NULL CHECK (total_cost >= 0), -- quantity * unit_cost
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for stock_transfer_items
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer_id ON stock_transfer_items(stock_transfer_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_product_id ON stock_transfer_items(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_variant_id ON stock_transfer_items(variant_id) WHERE variant_id IS NOT NULL;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_stock_transfer_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_stock_transfer_items_updated_at ON stock_transfer_items;
CREATE TRIGGER update_stock_transfer_items_updated_at
  BEFORE UPDATE ON stock_transfer_items
  FOR EACH ROW
  EXECUTE FUNCTION update_stock_transfer_items_updated_at();

-- ============================================================================
-- STEP 3: RLS Policies for stock_transfers
-- ============================================================================
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;

-- Users can view transfers for their business
CREATE POLICY "Users can view stock transfers for their business"
  ON stock_transfers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = stock_transfers.business_id
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  );

-- Users can create transfers for their business
CREATE POLICY "Users can create stock transfers for their business"
  ON stock_transfers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = stock_transfers.business_id
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  );

-- Users can update transfers for their business (only draft/in_transit)
CREATE POLICY "Users can update stock transfers for their business"
  ON stock_transfers FOR UPDATE
  USING (
    status IN ('draft', 'in_transit') -- Can only update draft or in_transit transfers
    AND EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = stock_transfers.business_id
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  )
  WITH CHECK (
    status IN ('draft', 'in_transit', 'received', 'cancelled') -- Can set to any status, but only if currently draft/in_transit
    AND EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = stock_transfers.business_id
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  );

-- ============================================================================
-- STEP 4: RLS Policies for stock_transfer_items
-- ============================================================================
ALTER TABLE stock_transfer_items ENABLE ROW LEVEL SECURITY;

-- Users can view transfer items for transfers in their business
CREATE POLICY "Users can view stock transfer items for their business"
  ON stock_transfer_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM stock_transfers
      JOIN businesses ON businesses.id = stock_transfers.business_id
      WHERE stock_transfers.id = stock_transfer_items.stock_transfer_id
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  );

-- Users can create transfer items for transfers in their business
CREATE POLICY "Users can create stock transfer items for their business"
  ON stock_transfer_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM stock_transfers
      JOIN businesses ON businesses.id = stock_transfers.business_id
      WHERE stock_transfers.id = stock_transfer_items.stock_transfer_id
      AND stock_transfers.status = 'draft' -- Can only add items to draft transfers
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  );

-- Users can update transfer items for draft transfers in their business
CREATE POLICY "Users can update stock transfer items for their business"
  ON stock_transfer_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM stock_transfers
      JOIN businesses ON businesses.id = stock_transfers.business_id
      WHERE stock_transfers.id = stock_transfer_items.stock_transfer_id
      AND stock_transfers.status = 'draft' -- Can only update items in draft transfers
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM stock_transfers
      JOIN businesses ON businesses.id = stock_transfers.business_id
      WHERE stock_transfers.id = stock_transfer_items.stock_transfer_id
      AND stock_transfers.status = 'draft'
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  );

-- Users can delete transfer items from draft transfers in their business
CREATE POLICY "Users can delete stock transfer items for their business"
  ON stock_transfer_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM stock_transfers
      JOIN businesses ON businesses.id = stock_transfers.business_id
      WHERE stock_transfers.id = stock_transfer_items.stock_transfer_id
      AND stock_transfers.status = 'draft' -- Can only delete items from draft transfers
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  );

-- ============================================================================
-- STEP 5: Add comments documenting transfer constraints
-- ============================================================================
COMMENT ON TABLE stock_transfers IS 
'Stock Transfers (Phase 2 - Multi-Store, Inventory-Safe).
Balance-sheet movements only - no revenue, cash, or VAT impact.
Transfers move inventory between stores with ledger posting on receipt.';

COMMENT ON COLUMN stock_transfers.status IS 
'Transfer status: draft (editable), in_transit (sent, awaiting receipt), 
received (completed, ledger posted), cancelled (aborted).';

COMMENT ON COLUMN stock_transfers.from_store_id IS 
'Source store - inventory decreases here on receipt.';

COMMENT ON COLUMN stock_transfers.to_store_id IS 
'Destination store - inventory increases here on receipt.';

COMMENT ON COLUMN stock_transfer_items.unit_cost IS 
'Cost per unit at transfer initiation time (snapshot for valuation).
Used for ledger posting - same cost on both debit and credit.';

COMMENT ON COLUMN stock_transfer_items.total_cost IS 
'Total cost = quantity * unit_cost (computed, immutable after posting).';

-- ============================================================================
-- STEP 6: Ledger Posting Function for Stock Transfers
-- ============================================================================
-- Posts balance-sheet movement only: Inventory debit (to_store) and credit (from_store)
-- No revenue, cash, or VAT impact
-- ============================================================================
CREATE OR REPLACE FUNCTION post_stock_transfer_to_ledger(p_stock_transfer_id UUID)
RETURNS UUID AS $$
DECLARE
  transfer_record RECORD;
  business_id_val UUID;
  inventory_account_id UUID;
  journal_id UUID;
  total_transfer_cost NUMERIC := 0;
  journal_lines JSONB;
  from_store_name TEXT;
  to_store_name TEXT;
BEGIN
  -- IDEMPOTENCY GUARD: Check if journal entry already exists
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'stock_transfer'
    AND reference_id = p_stock_transfer_id
    LIMIT 1;

  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  -- Get transfer details
  SELECT 
    st.business_id,
    st.from_store_id,
    st.to_store_id,
    st.status,
    st.initiated_at,
    st.reference,
    fs.name AS from_store_name,
    ts.name AS to_store_name
  INTO transfer_record
  FROM stock_transfers st
  JOIN stores fs ON fs.id = st.from_store_id
  JOIN stores ts ON ts.id = st.to_store_id
  WHERE st.id = p_stock_transfer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock transfer not found: %', p_stock_transfer_id;
  END IF;

  -- Validate transfer is received
  IF transfer_record.status != 'received' THEN
    RAISE EXCEPTION 'Stock transfer % is not received (status: %). Cannot post to ledger.', 
      p_stock_transfer_id, transfer_record.status;
  END IF;

  business_id_val := transfer_record.business_id;
  from_store_name := transfer_record.from_store_name;
  to_store_name := transfer_record.to_store_name;

  -- GUARD: Assert accounting period is open
  PERFORM assert_accounting_period_is_open(business_id_val, transfer_record.initiated_at::DATE);

  -- Retail inventory policy: store-to-store retail transfers post to 1200.
  -- Service materials inventory is separate and uses 1450 in service-only flows.
  inventory_account_id := get_account_by_code(business_id_val, '1200');

  IF inventory_account_id IS NULL THEN
    RAISE EXCEPTION 'Inventory account (1200) not found for business: %', business_id_val;
  END IF;

  -- Calculate total transfer cost
  SELECT COALESCE(SUM(total_cost), 0)
  INTO total_transfer_cost
  FROM stock_transfer_items
  WHERE stock_transfer_id = p_stock_transfer_id;

  -- VALIDATION: Total cost must be positive
  IF total_transfer_cost <= 0 THEN
    RAISE EXCEPTION 'Stock transfer % has zero or negative total cost. Cannot post to ledger.', 
      p_stock_transfer_id;
  END IF;

  -- Build journal entry lines (balance-sheet movement only)
  -- DEBIT: Inventory at to_store (destination)
  -- CREDIT: Inventory at from_store (source)
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', inventory_account_id,
      'debit', total_transfer_cost,
      'description', 'Stock Transfer: Inventory received at ' || to_store_name || 
                     COALESCE(' (Ref: ' || transfer_record.reference || ')', '')
    ),
    jsonb_build_object(
      'account_id', inventory_account_id,
      'credit', total_transfer_cost,
      'description', 'Stock Transfer: Inventory sent from ' || from_store_name ||
                     COALESCE(' (Ref: ' || transfer_record.reference || ')', '')
    )
  );

  -- VALIDATION: Ensure equal debit and credit
  -- This is enforced by construction, but verify for safety
  IF (
    (SELECT SUM(COALESCE((line->>'debit')::NUMERIC, 0)) FROM jsonb_array_elements(journal_lines) AS line) !=
    (SELECT SUM(COALESCE((line->>'credit')::NUMERIC, 0)) FROM jsonb_array_elements(journal_lines) AS line)
  ) THEN
    RAISE EXCEPTION 'Stock transfer journal entry imbalance: debit != credit for transfer %', 
      p_stock_transfer_id;
  END IF;

  -- Post journal entry
  SELECT post_journal_entry(
    business_id_val,
    transfer_record.initiated_at::DATE,
    'Stock Transfer: ' || from_store_name || ' → ' || to_store_name ||
    COALESCE(' (Ref: ' || transfer_record.reference || ')', ''),
    'stock_transfer',
    p_stock_transfer_id,
    journal_lines,
    FALSE, -- is_adjustment
    NULL, -- adjustment_type
    NULL, -- adjustment_reason
    NULL, -- adjustment_approved_by
    NULL, -- adjustment_approved_at
    NULL, -- source
    NULL, -- source_id
    'system' -- posting_source
  ) INTO journal_id;

  IF journal_id IS NULL THEN
    RAISE EXCEPTION 'Failed to create journal entry for stock transfer %', p_stock_transfer_id;
  END IF;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_stock_transfer_to_ledger IS 
'Posts stock transfer to ledger (balance-sheet movement only).
DEBIT: Inventory at to_store (destination)
CREDIT: Inventory at from_store (source)
Amount = SUM(total_cost) from transfer items.
No revenue, cash, or VAT impact.';
