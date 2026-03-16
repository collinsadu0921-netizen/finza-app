-- Complete Invoice System Setup for Ghana
-- Run this migration to set up the entire invoice system from scratch
-- This combines base tables creation with enhancements

-- ============================================================================
-- CUSTOMERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT,
  whatsapp_phone TEXT,
  tin TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for customers
CREATE INDEX IF NOT EXISTS idx_customers_business_id ON customers(business_id);
CREATE INDEX IF NOT EXISTS idx_customers_business_id_created_at ON customers(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_deleted_at ON customers(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_whatsapp_phone ON customers(whatsapp_phone) WHERE whatsapp_phone IS NOT NULL;

-- ============================================================================
-- CATEGORIES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(business_id, name)
);

-- Ensure deleted_at column exists (in case table was created without it)
ALTER TABLE categories ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Indexes for categories
CREATE INDEX IF NOT EXISTS idx_categories_business_id ON categories(business_id);
CREATE INDEX IF NOT EXISTS idx_categories_business_id_created_at ON categories(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_categories_deleted_at ON categories(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- PRODUCTS_SERVICES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS products_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('service', 'product')),
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  default_price NUMERIC DEFAULT 0,
  description TEXT,
  tax_applicable BOOLEAN NOT NULL DEFAULT true,
  default_apply_taxes BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for products_services
CREATE INDEX IF NOT EXISTS idx_products_services_business_id ON products_services(business_id);
CREATE INDEX IF NOT EXISTS idx_products_services_business_id_created_at ON products_services(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_products_services_category_id ON products_services(category_id);
CREATE INDEX IF NOT EXISTS idx_products_services_type ON products_services(type);
CREATE INDEX IF NOT EXISTS idx_products_services_deleted_at ON products_services(deleted_at) WHERE deleted_at IS NULL;

-- Copy unit_price to default_price if needed
UPDATE products_services SET default_price = unit_price WHERE default_price = 0 AND unit_price > 0;

-- ============================================================================
-- INVOICES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  invoice_number TEXT,
  issue_date DATE,
  due_date DATE,
  payment_terms TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled')),
  currency_code TEXT DEFAULT 'GHS',
  currency_symbol TEXT DEFAULT '₵',
  subtotal NUMERIC DEFAULT 0,
  nhil NUMERIC DEFAULT 0,
  getfund NUMERIC DEFAULT 0,
  covid NUMERIC DEFAULT 0,
  vat NUMERIC DEFAULT 0,
  total_tax NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  notes TEXT,
  footer_message TEXT,
  apply_taxes BOOLEAN DEFAULT true,
  public_token TEXT UNIQUE,
  paid_at TIMESTAMP WITH TIME ZONE,
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for invoices
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_business_invoice_number 
  ON invoices(business_id, invoice_number) 
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_business_id ON invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_public_token ON invoices(public_token) WHERE public_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_deleted_at ON invoices(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- INVOICE_ITEMS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_service_id UUID REFERENCES products_services(id) ON DELETE SET NULL,
  description TEXT,
  qty NUMERIC DEFAULT 0,
  unit_price NUMERIC DEFAULT 0,
  discount_amount NUMERIC DEFAULT 0,
  line_subtotal NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for invoice_items
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_product_service_id ON invoice_items(product_service_id);

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
  e_levy_amount NUMERIC DEFAULT 0,
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
-- FUNCTIONS
-- ============================================================================

-- Generate next invoice number
CREATE OR REPLACE FUNCTION generate_invoice_number(business_uuid UUID)
RETURNS TEXT AS $$
DECLARE
  last_number INTEGER;
  new_number TEXT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM '[0-9]+$') AS INTEGER)), 0)
  INTO last_number
  FROM invoices
  WHERE business_id = business_uuid
    AND invoice_number ~ '^INV-[0-9]+$'
    AND deleted_at IS NULL;
  
  new_number := 'INV-' || LPAD((last_number + 1)::TEXT, 6, '0');
  RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- Generate public token
CREATE OR REPLACE FUNCTION generate_public_token()
RETURNS TEXT AS $$
BEGIN
  RETURN encode(gen_random_bytes(32), 'base64url');
END;
$$ LANGUAGE plpgsql;

-- Update invoice status based on payments
CREATE OR REPLACE FUNCTION update_invoice_status()
RETURNS TRIGGER AS $$
DECLARE
  invoice_total NUMERIC;
  total_paid NUMERIC;
  invoice_status TEXT;
BEGIN
  SELECT total, status INTO invoice_total, invoice_status
  FROM invoices
  WHERE id = NEW.invoice_id;
  
  SELECT COALESCE(SUM(amount), 0) INTO total_paid
  FROM payments
  WHERE invoice_id = NEW.invoice_id
    AND deleted_at IS NULL;
  
  IF total_paid >= invoice_total THEN
    invoice_status := 'paid';
  ELSIF total_paid > 0 THEN
    invoice_status := 'partially_paid';
  ELSE
    invoice_status := 'sent';
  END IF;
  
  UPDATE invoices
  SET 
    status = invoice_status,
    paid_at = CASE WHEN invoice_status = 'paid' THEN NOW() ELSE paid_at END,
    updated_at = NOW()
  WHERE id = NEW.invoice_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Trigger to update invoice status when payment is created/updated
DROP TRIGGER IF EXISTS trigger_update_invoice_status ON payments;
CREATE TRIGGER trigger_update_invoice_status
  AFTER INSERT OR UPDATE ON payments
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NULL)
  EXECUTE FUNCTION update_invoice_status();

-- Auto-update updated_at for payments
DROP TRIGGER IF EXISTS update_payments_updated_at ON payments;
CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on payments
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view payments for their business" ON payments;
DROP POLICY IF EXISTS "Users can insert payments for their business" ON payments;
DROP POLICY IF EXISTS "Users can update payments for their business" ON payments;
DROP POLICY IF EXISTS "Users can delete payments for their business" ON payments;

-- Create RLS policies for payments
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

