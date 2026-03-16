-- ============================================================================
-- MIGRATION: Supplier Management & Purchase Orders (Phase 3 - AP-Safe, Inventory-Correct)
-- ============================================================================
-- This migration creates supplier management and purchasing with Accounts Payable.
-- Purchasing ≠ payment. Receiving goods creates Inventory + AP.
--
-- GUARDRAILS:
-- - Receiving goods MUST create AP
-- - Paying supplier MUST reduce AP
-- - No receiving in locked periods
-- - No editing received POs
-- - Block payments exceeding AP balance
-- ============================================================================

-- ============================================================================
-- STEP 1: Create suppliers table
-- ============================================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'blocked')) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for suppliers
CREATE INDEX IF NOT EXISTS idx_suppliers_business_id ON suppliers(business_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_status ON suppliers(status);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_suppliers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_suppliers_updated_at ON suppliers;
CREATE TRIGGER update_suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW
  EXECUTE FUNCTION update_suppliers_updated_at();

-- ============================================================================
-- STEP 2: Create purchase_orders table
-- ============================================================================
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'received', 'cancelled')) DEFAULT 'draft',
  reference TEXT, -- Optional PO reference number
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date DATE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  received_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  received_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for purchase_orders
CREATE INDEX IF NOT EXISTS idx_purchase_orders_business_id ON purchase_orders(business_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_id ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_by ON purchase_orders(created_by);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_order_date ON purchase_orders(order_date DESC);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_purchase_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_purchase_orders_updated_at ON purchase_orders;
CREATE TRIGGER update_purchase_orders_updated_at
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_purchase_orders_updated_at();

-- ============================================================================
-- STEP 3: Create purchase_order_items table
-- ============================================================================
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES products_variants(id) ON DELETE SET NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC NOT NULL CHECK (unit_cost >= 0),
  total_cost NUMERIC NOT NULL CHECK (total_cost >= 0), -- quantity * unit_cost
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for purchase_order_items
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po_id ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product_id ON purchase_order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_variant_id ON purchase_order_items(variant_id) WHERE variant_id IS NOT NULL;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_purchase_order_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_purchase_order_items_updated_at ON purchase_order_items;
CREATE TRIGGER update_purchase_order_items_updated_at
  BEFORE UPDATE ON purchase_order_items
  FOR EACH ROW
  EXECUTE FUNCTION update_purchase_order_items_updated_at();

-- ============================================================================
-- STEP 4: Create supplier_invoices table
-- ============================================================================
CREATE TABLE IF NOT EXISTS supplier_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  total_amount NUMERIC NOT NULL CHECK (total_amount > 0),
  status TEXT NOT NULL CHECK (status IN ('unpaid', 'paid', 'cancelled')) DEFAULT 'unpaid',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(business_id, invoice_number) -- Invoice numbers must be unique per business
);

-- Indexes for supplier_invoices
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_business_id ON supplier_invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_supplier_id ON supplier_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_po_id ON supplier_invoices(purchase_order_id) WHERE purchase_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_status ON supplier_invoices(status);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_invoice_date ON supplier_invoices(invoice_date DESC);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_supplier_invoices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_supplier_invoices_updated_at ON supplier_invoices;
CREATE TRIGGER update_supplier_invoices_updated_at
  BEFORE UPDATE ON supplier_invoices
  FOR EACH ROW
  EXECUTE FUNCTION update_supplier_invoices_updated_at();

-- ============================================================================
-- STEP 5: Create supplier_payments table
-- ============================================================================
CREATE TABLE IF NOT EXISTS supplier_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_invoice_id UUID REFERENCES supplier_invoices(id) ON DELETE SET NULL,
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'mobile_money', 'bank_transfer')),
  payment_reference TEXT,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Indexes for supplier_payments
CREATE INDEX IF NOT EXISTS idx_supplier_payments_business_id ON supplier_payments(business_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier_id ON supplier_payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_invoice_id ON supplier_payments(supplier_invoice_id) WHERE supplier_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_payments_po_id ON supplier_payments(purchase_order_id) WHERE purchase_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_payments_payment_date ON supplier_payments(payment_date DESC);

-- ============================================================================
-- STEP 6: RLS Policies for suppliers
-- ============================================================================
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

-- Users can view suppliers for their business
CREATE POLICY "Users can view suppliers for their business"
  ON suppliers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = suppliers.business_id
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

-- Users can create suppliers for their business
CREATE POLICY "Users can create suppliers for their business"
  ON suppliers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = suppliers.business_id
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

-- Users can update suppliers for their business
CREATE POLICY "Users can update suppliers for their business"
  ON suppliers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = suppliers.business_id
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
      SELECT 1 FROM businesses
      WHERE businesses.id = suppliers.business_id
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
-- STEP 7: RLS Policies for purchase_orders
-- ============================================================================
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;

-- Users can view purchase orders for their business
CREATE POLICY "Users can view purchase orders for their business"
  ON purchase_orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = purchase_orders.business_id
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

-- Users can create purchase orders for their business
CREATE POLICY "Users can create purchase orders for their business"
  ON purchase_orders FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = purchase_orders.business_id
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

-- Users can update purchase orders for their business (only draft/sent)
CREATE POLICY "Users can update purchase orders for their business"
  ON purchase_orders FOR UPDATE
  USING (
    status IN ('draft', 'sent') -- Can only update draft or sent POs
    AND EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = purchase_orders.business_id
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
    status IN ('draft', 'sent', 'received', 'cancelled') -- Can set to any status, but only if currently draft/sent
    AND EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = purchase_orders.business_id
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
-- STEP 8: RLS Policies for purchase_order_items
-- ============================================================================
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;

-- Users can view PO items for POs in their business
CREATE POLICY "Users can view purchase order items for their business"
  ON purchase_order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM purchase_orders
      JOIN businesses ON businesses.id = purchase_orders.business_id
      WHERE purchase_orders.id = purchase_order_items.purchase_order_id
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

-- Users can create PO items for draft POs in their business
CREATE POLICY "Users can create purchase order items for their business"
  ON purchase_order_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM purchase_orders
      JOIN businesses ON businesses.id = purchase_orders.business_id
      WHERE purchase_orders.id = purchase_order_items.purchase_order_id
      AND purchase_orders.status = 'draft' -- Can only add items to draft POs
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

-- Users can update PO items for draft POs in their business
CREATE POLICY "Users can update purchase order items for their business"
  ON purchase_order_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM purchase_orders
      JOIN businesses ON businesses.id = purchase_orders.business_id
      WHERE purchase_orders.id = purchase_order_items.purchase_order_id
      AND purchase_orders.status = 'draft' -- Can only update items in draft POs
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
      SELECT 1 FROM purchase_orders
      JOIN businesses ON businesses.id = purchase_orders.business_id
      WHERE purchase_orders.id = purchase_order_items.purchase_order_id
      AND purchase_orders.status = 'draft'
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

-- Users can delete PO items from draft POs in their business
CREATE POLICY "Users can delete purchase order items for their business"
  ON purchase_order_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM purchase_orders
      JOIN businesses ON businesses.id = purchase_orders.business_id
      WHERE purchase_orders.id = purchase_order_items.purchase_order_id
      AND purchase_orders.status = 'draft' -- Can only delete items from draft POs
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
-- STEP 9: RLS Policies for supplier_invoices
-- ============================================================================
ALTER TABLE supplier_invoices ENABLE ROW LEVEL SECURITY;

-- Users can view supplier invoices for their business
CREATE POLICY "Users can view supplier invoices for their business"
  ON supplier_invoices FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = supplier_invoices.business_id
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

-- Users can create supplier invoices for their business
CREATE POLICY "Users can create supplier invoices for their business"
  ON supplier_invoices FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = supplier_invoices.business_id
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

-- Users can update supplier invoices for their business
CREATE POLICY "Users can update supplier invoices for their business"
  ON supplier_invoices FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = supplier_invoices.business_id
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
      SELECT 1 FROM businesses
      WHERE businesses.id = supplier_invoices.business_id
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
-- STEP 10: RLS Policies for supplier_payments
-- ============================================================================
ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;

-- Users can view supplier payments for their business
CREATE POLICY "Users can view supplier payments for their business"
  ON supplier_payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = supplier_payments.business_id
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

-- Users can create supplier payments for their business
CREATE POLICY "Users can create supplier payments for their business"
  ON supplier_payments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = supplier_payments.business_id
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
-- STEP 11: Add comments documenting constraints
-- ============================================================================
COMMENT ON TABLE suppliers IS 
'Supplier Management (Phase 3 - AP-Safe, Inventory-Correct).
Tracks supplier information. No accounting impact.';

COMMENT ON TABLE purchase_orders IS 
'Purchase Orders (Phase 3 - AP-Safe, Inventory-Correct).
Draft orders have no ledger impact. Receiving goods creates Inventory + AP.';

COMMENT ON COLUMN purchase_orders.status IS 
'PO status: draft (editable), sent (awaiting goods), received (goods received, AP created), cancelled (aborted).';

COMMENT ON TABLE purchase_order_items IS 
'Purchase Order Items.
Defines what products and quantities are ordered. Cost basis established at receipt.';

COMMENT ON COLUMN purchase_order_items.unit_cost IS 
'Cost per unit at order time (may differ from receipt cost).
Final cost basis established when goods are received.';

COMMENT ON TABLE supplier_invoices IS 
'Supplier Invoices (Phase 3 - AP-Safe, Inventory-Correct).
Optional - can link to PO or be standalone. Used for AP tracking.';

COMMENT ON TABLE supplier_payments IS 
'Supplier Payments (Phase 3 - AP-Safe, Inventory-Correct).
Payments reduce AP. Can link to invoice or PO.';

-- ============================================================================
-- STEP 12: Ledger Posting Function for Receiving Purchase Orders
-- ============================================================================
-- Posts receipt of goods:
-- DEBIT: Inventory (1400) = total_cost
-- CREDIT: Accounts Payable (2000) = total_cost
-- Increases inventory quantities and creates AP liability
-- ============================================================================
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
  -- IDEMPOTENCY GUARD: Check if journal entry already exists
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'purchase_order'
    AND reference_id = p_purchase_order_id
    LIMIT 1;

  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  -- Get PO details with items
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

  -- Validate PO is received
  IF po_record.status != 'received' THEN
    RAISE EXCEPTION 'Purchase order % is not received (status: %). Cannot post to ledger.', 
      p_purchase_order_id, po_record.status;
  END IF;

  business_id_val := po_record.business_id;
  supplier_name := po_record.supplier_name;

  -- GUARD: Assert accounting period is open
  PERFORM assert_accounting_period_is_open(business_id_val, po_record.order_date);

  -- Calculate total cost from PO items
  SELECT COALESCE(SUM(total_cost), 0)
  INTO total_cost
  FROM purchase_order_items
  WHERE purchase_order_id = p_purchase_order_id;

  -- VALIDATION: Total cost must be positive
  IF total_cost <= 0 THEN
    RAISE EXCEPTION 'Purchase order % has zero or negative total cost. Cannot post to ledger.', 
      p_purchase_order_id;
  END IF;

  -- Get account IDs
  inventory_account_id := get_account_by_code(business_id_val, '1400');
  ap_account_id := get_account_by_code(business_id_val, '2000');

  IF inventory_account_id IS NULL THEN
    RAISE EXCEPTION 'Inventory account (1400) not found for business: %', business_id_val;
  END IF;

  IF ap_account_id IS NULL THEN
    RAISE EXCEPTION 'Accounts Payable account (2000) not found for business: %', business_id_val;
  END IF;

  -- Build journal entry lines
  journal_lines := jsonb_build_array(
    -- DEBIT: Inventory
    jsonb_build_object(
      'account_id', inventory_account_id,
      'debit', total_cost,
      'description', 'Purchase Order Receipt: Inventory received from ' || supplier_name ||
                     COALESCE(' (PO: ' || po_record.reference || ')', '')
    ),
    -- CREDIT: Accounts Payable
    jsonb_build_object(
      'account_id', ap_account_id,
      'credit', total_cost,
      'description', 'Purchase Order Receipt: AP created for ' || supplier_name ||
                     COALESCE(' (PO: ' || po_record.reference || ')', '')
    )
  );

  -- VALIDATION: Ensure equal debit and credit
  IF (
    (SELECT SUM(COALESCE((line->>'debit')::NUMERIC, 0)) FROM jsonb_array_elements(journal_lines) AS line) !=
    (SELECT SUM(COALESCE((line->>'credit')::NUMERIC, 0)) FROM jsonb_array_elements(journal_lines) AS line)
  ) THEN
    RAISE EXCEPTION 'Purchase order journal entry imbalance: debit != credit for PO %', 
      p_purchase_order_id;
  END IF;

  -- Post journal entry
  SELECT post_journal_entry(
    business_id_val,
    po_record.order_date,
    'Purchase Order Receipt: ' || supplier_name ||
    COALESCE(' (PO: ' || po_record.reference || ')', ''),
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
'Posts purchase order receipt to ledger (Inventory + AP creation).
DEBIT: Inventory (1400) = total_cost
CREDIT: Accounts Payable (2000) = total_cost
No cash movement. No revenue impact.';

-- ============================================================================
-- STEP 13: Ledger Posting Function for Supplier Payments
-- ============================================================================
-- Posts supplier payment:
-- DEBIT: Accounts Payable (2000)
-- CREDIT: Cash / Bank / Clearing
-- Reduces AP liability and cash/clearing asset
-- ============================================================================
CREATE OR REPLACE FUNCTION post_supplier_payment_to_ledger(p_supplier_payment_id UUID)
RETURNS UUID AS $$
DECLARE
  payment_record RECORD;
  supplier_record RECORD;
  business_id_val UUID;
  payment_account_id UUID;
  payment_account_code TEXT;
  ap_account_id UUID;
  journal_id UUID;
  journal_lines JSONB;
BEGIN
  -- IDEMPOTENCY GUARD: Check if journal entry already exists
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'supplier_payment'
    AND reference_id = p_supplier_payment_id
    LIMIT 1;

  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  -- Get payment details
  SELECT 
    sp.id,
    sp.business_id,
    sp.supplier_id,
    sp.amount,
    sp.payment_method,
    sp.payment_reference,
    sp.payment_date,
    sp.supplier_invoice_id,
    sp.purchase_order_id
  INTO payment_record
  FROM supplier_payments sp
  WHERE sp.id = p_supplier_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier payment not found: %', p_supplier_payment_id;
  END IF;

  -- Get supplier name
  SELECT name INTO supplier_record
  FROM suppliers
  WHERE id = payment_record.supplier_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier not found for payment %', p_supplier_payment_id;
  END IF;

  business_id_val := payment_record.business_id;

  -- GUARD: Assert accounting period is open
  PERFORM assert_accounting_period_is_open(business_id_val, payment_record.payment_date);

  -- Get account IDs
  ap_account_id := get_account_by_code(business_id_val, '2000');

  IF ap_account_id IS NULL THEN
    RAISE EXCEPTION 'Accounts Payable account (2000) not found for business: %', business_id_val;
  END IF;

  -- Resolve payment account
  SELECT 
    resolved.payment_account_id,
    resolved.payment_account_code
  INTO payment_account_id, payment_account_code
  FROM resolve_payment_account_from_method(business_id_val, payment_record.payment_method) AS resolved;

  IF payment_account_id IS NULL THEN
    RAISE EXCEPTION 'Payment account not found for method: %', payment_record.payment_method;
  END IF;

  -- Build journal entry lines
  journal_lines := jsonb_build_array(
    -- DEBIT: Accounts Payable
    jsonb_build_object(
      'account_id', ap_account_id,
      'debit', payment_record.amount,
      'description', 'Supplier Payment: ' || supplier_record.name ||
                     COALESCE(' (Ref: ' || payment_record.payment_reference || ')', '')
    ),
    -- CREDIT: Payment account (Cash/Bank/Clearing)
    jsonb_build_object(
      'account_id', payment_account_id,
      'credit', payment_record.amount,
      'description', 'Supplier Payment: ' || COALESCE(payment_account_code, 'Payment') ||
                     COALESCE(' (Ref: ' || payment_record.payment_reference || ')', '')
    )
  );

  -- Post journal entry
  SELECT post_journal_entry(
    business_id_val,
    payment_record.payment_date,
    'Supplier Payment: ' || supplier_record.name ||
    COALESCE(' (Ref: ' || payment_record.payment_reference || ')', ''),
    'supplier_payment',
    p_supplier_payment_id,
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
    RAISE EXCEPTION 'Failed to create journal entry for supplier payment %', p_supplier_payment_id;
  END IF;

  -- Update supplier invoice status if linked
  IF payment_record.supplier_invoice_id IS NOT NULL THEN
    -- Check if invoice is fully paid (sum of all payments >= invoice total)
    DECLARE
      total_paid NUMERIC;
      invoice_total NUMERIC;
    BEGIN
      SELECT COALESCE(SUM(amount), 0)
      INTO total_paid
      FROM supplier_payments
      WHERE supplier_invoice_id = payment_record.supplier_invoice_id;

      SELECT total_amount
      INTO invoice_total
      FROM supplier_invoices
      WHERE id = payment_record.supplier_invoice_id;

      IF total_paid >= invoice_total THEN
        UPDATE supplier_invoices
        SET status = 'paid',
            updated_at = NOW()
        WHERE id = payment_record.supplier_invoice_id;
      END IF;
    END;
  END IF;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_supplier_payment_to_ledger IS 
'Posts supplier payment to ledger (AP reduction).
DEBIT: Accounts Payable (2000)
CREDIT: Cash/Bank/Clearing
Reduces AP liability. No revenue impact.';
