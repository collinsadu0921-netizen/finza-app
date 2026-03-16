-- Migration: Supplier Bills (Accounts Payable) System
-- Adds supplier bills, bill items, and bill payments for service businesses

-- ============================================================================
-- BILLS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_name TEXT NOT NULL,
  supplier_phone TEXT,
  supplier_email TEXT,
  bill_number TEXT NOT NULL,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'partially_paid', 'paid', 'overdue')),
  subtotal NUMERIC NOT NULL DEFAULT 0,
  nhil NUMERIC DEFAULT 0,
  getfund NUMERIC DEFAULT 0,
  covid NUMERIC DEFAULT 0,
  vat NUMERIC DEFAULT 0,
  total_tax NUMERIC DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  attachment_path TEXT,
  paid_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for bills
CREATE INDEX IF NOT EXISTS idx_bills_business_id ON bills(business_id);
CREATE INDEX IF NOT EXISTS idx_bills_supplier_name ON bills(supplier_name);
CREATE INDEX IF NOT EXISTS idx_bills_bill_number ON bills(bill_number);
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_due_date ON bills(due_date);
CREATE INDEX IF NOT EXISTS idx_bills_deleted_at ON bills(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- BILL_ITEMS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS bill_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  discount_amount NUMERIC DEFAULT 0,
  line_subtotal NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for bill_items
CREATE INDEX IF NOT EXISTS idx_bill_items_bill_id ON bill_items(bill_id);

-- ============================================================================
-- BILL_PAYMENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS bill_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  method TEXT NOT NULL CHECK (method IN ('cash', 'bank', 'momo', 'cheque', 'card', 'other')),
  reference TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for bill_payments
CREATE INDEX IF NOT EXISTS idx_bill_payments_bill_id ON bill_payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_business_id ON bill_payments(business_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_date ON bill_payments(date);
CREATE INDEX IF NOT EXISTS idx_bill_payments_deleted_at ON bill_payments(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- FUNCTION: Calculate bill balance
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_bill_balance(bill_uuid UUID)
RETURNS NUMERIC AS $$
DECLARE
  bill_total NUMERIC;
  payments_sum NUMERIC := 0;
  balance NUMERIC;
BEGIN
  -- Get bill total
  SELECT total INTO bill_total
  FROM bills
  WHERE id = bill_uuid
    AND deleted_at IS NULL;

  IF bill_total IS NULL THEN
    RETURN 0;
  END IF;

  -- Sum all payments
  SELECT COALESCE(SUM(amount), 0) INTO payments_sum
  FROM bill_payments
  WHERE bill_id = bill_uuid
    AND deleted_at IS NULL;

  -- Calculate balance
  balance := bill_total - payments_sum;

  RETURN GREATEST(0, balance); -- Never return negative
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Update bill status based on payments
-- ============================================================================
CREATE OR REPLACE FUNCTION update_bill_status()
RETURNS TRIGGER AS $$
DECLARE
  bill_total NUMERIC;
  total_paid NUMERIC;
  bill_status TEXT;
  bill_due_date DATE;
  new_balance NUMERIC;
BEGIN
  SELECT total, status, due_date INTO bill_total, bill_status, bill_due_date
  FROM bills
  WHERE id = NEW.bill_id;
  
  -- Sum all payments
  SELECT COALESCE(SUM(amount), 0) INTO total_paid
  FROM bill_payments
  WHERE bill_id = NEW.bill_id
    AND deleted_at IS NULL;
  
  new_balance := bill_total - total_paid;
  
  -- Determine status
  IF new_balance <= 0 THEN
    bill_status := 'paid';
  ELSIF total_paid > 0 THEN
    bill_status := 'partially_paid';
  ELSIF bill_status = 'draft' THEN
    bill_status := 'draft';
  ELSE
    bill_status := 'open';
  END IF;
  
  -- Check if overdue
  IF bill_status != 'paid' AND bill_due_date IS NOT NULL THEN
    IF CURRENT_DATE > bill_due_date THEN
      bill_status := 'overdue';
    END IF;
  END IF;
  
  UPDATE bills
  SET 
    status = bill_status,
    paid_at = CASE WHEN bill_status = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
    updated_at = NOW()
  WHERE id = NEW.bill_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Trigger to update bill status when payment is created/updated
DROP TRIGGER IF EXISTS trigger_update_bill_status ON bill_payments;
CREATE TRIGGER trigger_update_bill_status
  AFTER INSERT OR UPDATE ON bill_payments
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NULL)
  EXECUTE FUNCTION update_bill_status();

-- Auto-update updated_at for bills
DROP TRIGGER IF EXISTS update_bills_updated_at ON bills;
CREATE TRIGGER update_bills_updated_at
  BEFORE UPDATE ON bills
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at for bill_items
DROP TRIGGER IF EXISTS update_bill_items_updated_at ON bill_items;
CREATE TRIGGER update_bill_items_updated_at
  BEFORE UPDATE ON bill_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at for bill_payments
DROP TRIGGER IF EXISTS update_bill_payments_updated_at ON bill_payments;
CREATE TRIGGER update_bill_payments_updated_at
  BEFORE UPDATE ON bill_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on bills
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view bills for their business"
  ON bills FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = bills.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert bills for their business"
  ON bills FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = bills.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update bills for their business"
  ON bills FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = bills.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete bills for their business"
  ON bills FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = bills.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- Enable RLS on bill_items
ALTER TABLE bill_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view bill items for their business"
  ON bill_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM bills
      JOIN businesses ON businesses.id = bills.business_id
      WHERE bills.id = bill_items.bill_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert bill items for their business"
  ON bill_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bills
      JOIN businesses ON businesses.id = bills.business_id
      WHERE bills.id = bill_items.bill_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update bill items for their business"
  ON bill_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM bills
      JOIN businesses ON businesses.id = bills.business_id
      WHERE bills.id = bill_items.bill_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete bill items for their business"
  ON bill_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM bills
      JOIN businesses ON businesses.id = bills.business_id
      WHERE bills.id = bill_items.bill_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- Enable RLS on bill_payments
ALTER TABLE bill_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view bill payments for their business"
  ON bill_payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = bill_payments.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert bill payments for their business"
  ON bill_payments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = bill_payments.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update bill payments for their business"
  ON bill_payments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = bill_payments.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete bill payments for their business"
  ON bill_payments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = bill_payments.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

