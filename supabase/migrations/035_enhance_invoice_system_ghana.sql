-- Migration: Enhance Invoice System for Ghana (Complete)
-- Adds payments, public tokens, WhatsApp fields, and enhances existing tables

-- ============================================================================
-- ENHANCE CUSTOMERS TABLE (Add WhatsApp and TIN)
-- ============================================================================
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT,
  ADD COLUMN IF NOT EXISTS tin TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_whatsapp_phone ON customers(whatsapp_phone) WHERE whatsapp_phone IS NOT NULL;

-- ============================================================================
-- ENHANCE INVOICES TABLE
-- ============================================================================
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS issue_date DATE,
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS payment_terms TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled')),
  ADD COLUMN IF NOT EXISTS currency_code TEXT DEFAULT 'GHS',
  ADD COLUMN IF NOT EXISTS currency_symbol TEXT DEFAULT '₵',
  ADD COLUMN IF NOT EXISTS subtotal NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nhil NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS getfund NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS covid NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_tax NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS footer_message TEXT,
  ADD COLUMN IF NOT EXISTS apply_taxes BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS public_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE;

-- Create unique index on invoice_number per business
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_business_invoice_number 
  ON invoices(business_id, invoice_number) 
  WHERE deleted_at IS NULL;

-- Indexes for invoices
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_public_token ON invoices(public_token) WHERE public_token IS NOT NULL;

-- ============================================================================
-- ENHANCE INVOICE_ITEMS TABLE
-- ============================================================================
ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS product_service_id UUID REFERENCES products_services(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS qty NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_subtotal NUMERIC DEFAULT 0;

-- Rename existing columns if they exist with different names
DO $$
BEGIN
  -- Rename quantity to qty if quantity exists
  IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'invoice_items' AND column_name = 'quantity') THEN
    ALTER TABLE invoice_items RENAME COLUMN quantity TO qty;
  END IF;
  
  -- Rename price to unit_price if price exists
  IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'invoice_items' AND column_name = 'price') THEN
    ALTER TABLE invoice_items RENAME COLUMN price TO unit_price;
  END IF;
  
  -- Rename total to line_subtotal if total exists
  IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'invoice_items' AND column_name = 'total') THEN
    ALTER TABLE invoice_items RENAME COLUMN total TO line_subtotal;
  END IF;
  
  -- Rename product_id to product_service_id if product_id exists
  IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'invoice_items' AND column_name = 'product_id') THEN
    ALTER TABLE invoice_items RENAME COLUMN product_id TO product_service_id;
  END IF;
END $$;

-- ============================================================================
-- PAYMENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  date DATE NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash', 'bank', 'momo', 'card', 'other')),
  reference TEXT,
  notes TEXT,
  e_levy_amount NUMERIC DEFAULT 0, -- Informational only for mobile money
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for payments
CREATE INDEX IF NOT EXISTS idx_payments_business_id ON payments(business_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);
CREATE INDEX IF NOT EXISTS idx_payments_method ON payments(method);
CREATE INDEX IF NOT EXISTS idx_payments_deleted_at ON payments(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- ENHANCE PRODUCTS_SERVICES TABLE
-- ============================================================================
ALTER TABLE products_services
  ADD COLUMN IF NOT EXISTS default_price NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_apply_taxes BOOLEAN DEFAULT true;

-- Rename unit_price to default_price if needed (keep both for compatibility)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'products_services' AND column_name = 'unit_price' AND column_name != 'default_price') THEN
    -- Copy unit_price to default_price if default_price doesn't exist
    UPDATE products_services SET default_price = unit_price WHERE default_price = 0;
  END IF;
END $$;

-- ============================================================================
-- FUNCTION: Generate next invoice number
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_invoice_number(business_uuid UUID)
RETURNS TEXT AS $$
DECLARE
  last_number INTEGER;
  new_number TEXT;
BEGIN
  -- Get the last invoice number for this business
  SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM '[0-9]+$') AS INTEGER)), 0)
  INTO last_number
  FROM invoices
  WHERE business_id = business_uuid
    AND invoice_number ~ '^INV-[0-9]+$'
    AND deleted_at IS NULL;
  
  -- Generate new number
  new_number := 'INV-' || LPAD((last_number + 1)::TEXT, 6, '0');
  
  RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Generate public token for invoice
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_public_token()
RETURNS TEXT AS $$
BEGIN
  RETURN encode(gen_random_bytes(32), 'base64url');
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Update invoice status based on payments
-- ============================================================================
CREATE OR REPLACE FUNCTION update_invoice_status()
RETURNS TRIGGER AS $$
DECLARE
  invoice_total NUMERIC;
  total_paid NUMERIC;
  invoice_status TEXT;
BEGIN
  -- Get invoice total and current status
  SELECT total, status INTO invoice_total, invoice_status
  FROM invoices
  WHERE id = NEW.invoice_id;
  
  -- Calculate total paid
  SELECT COALESCE(SUM(amount), 0) INTO total_paid
  FROM payments
  WHERE invoice_id = NEW.invoice_id
    AND deleted_at IS NULL;
  
  -- Update invoice status
  IF total_paid >= invoice_total THEN
    invoice_status := 'paid';
  ELSIF total_paid > 0 THEN
    invoice_status := 'partially_paid';
  ELSE
    invoice_status := 'sent';
  END IF;
  
  -- Update invoice
  UPDATE invoices
  SET 
    status = invoice_status,
    paid_at = CASE WHEN invoice_status = 'paid' THEN NOW() ELSE paid_at END,
    updated_at = NOW()
  WHERE id = NEW.invoice_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update invoice status when payment is created/updated
DROP TRIGGER IF EXISTS trigger_update_invoice_status ON payments;
CREATE TRIGGER trigger_update_invoice_status
  AFTER INSERT OR UPDATE ON payments
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NULL)
  EXECUTE FUNCTION update_invoice_status();

-- ============================================================================
-- FUNCTION: Check and mark overdue invoices
-- ============================================================================
CREATE OR REPLACE FUNCTION check_overdue_invoices()
RETURNS void AS $$
BEGIN
  UPDATE invoices
  SET status = 'overdue'
  WHERE status IN ('sent', 'partially_paid')
    AND due_date < CURRENT_DATE
    AND deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Payments RLS
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view payments for their business"
  ON payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = payments.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert payments for their business"
  ON payments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = payments.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update payments for their business"
  ON payments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = payments.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete payments for their business"
  ON payments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = payments.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- ============================================================================
-- UPDATE TRIGGERS
-- ============================================================================

-- Auto-update updated_at for payments
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_payments_updated_at ON payments;
CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

