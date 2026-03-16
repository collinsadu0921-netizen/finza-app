-- Migration: Complete Service Invoice System (Ghana-ready)
-- This migration creates all tables for the service business invoice and accounting system

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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for customers
CREATE INDEX IF NOT EXISTS idx_customers_business_id ON customers(business_id);
CREATE INDEX IF NOT EXISTS idx_customers_business_id_created_at ON customers(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_deleted_at ON customers(deleted_at) WHERE deleted_at IS NULL;

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
  description TEXT,
  tax_applicable BOOLEAN NOT NULL DEFAULT true,
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

-- ============================================================================
-- INVOICES TABLE (Enhanced)
-- ============================================================================
-- Drop existing invoices table if it exists and recreate with new structure
-- Note: This will lose existing data, so backup first if needed
DO $$ 
BEGIN
  -- Check if invoices table exists
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'invoices') THEN
    -- Add new columns if they don't exist
    ALTER TABLE invoices 
      ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS currency_code TEXT DEFAULT 'GHS',
      ADD COLUMN IF NOT EXISTS currency_symbol TEXT DEFAULT '₵',
      ADD COLUMN IF NOT EXISTS payment_terms TEXT,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
    
    -- Rename client_id to customer_id if client_id exists
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'client_id') THEN
      ALTER TABLE invoices RENAME COLUMN client_id TO customer_id;
    END IF;
    
    -- Ensure all required columns exist
    ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS nhil NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS getfund NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS covid NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS vat NUMERIC DEFAULT 0;
    
    -- Rename existing tax columns if they exist with different names
    DO $$
    BEGIN
      IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'nhil_amount') THEN
        ALTER TABLE invoices RENAME COLUMN nhil_amount TO nhil;
      END IF;
      IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'getfund_amount') THEN
        ALTER TABLE invoices RENAME COLUMN getfund_amount TO getfund;
      END IF;
      IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'covid_amount') THEN
        ALTER TABLE invoices RENAME COLUMN covid_amount TO covid;
      END IF;
      IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'vat_amount') THEN
        ALTER TABLE invoices RENAME COLUMN vat_amount TO vat;
      END IF;
    END $$;
  ELSE
    -- Create new invoices table
    CREATE TABLE invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
      invoice_number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
      subtotal NUMERIC NOT NULL DEFAULT 0,
      nhil NUMERIC NOT NULL DEFAULT 0,
      getfund NUMERIC NOT NULL DEFAULT 0,
      covid NUMERIC NOT NULL DEFAULT 0,
      vat NUMERIC NOT NULL DEFAULT 0,
      total NUMERIC NOT NULL DEFAULT 0,
      due_date DATE,
      payment_terms TEXT,
      notes TEXT,
      currency_code TEXT DEFAULT 'GHS',
      currency_symbol TEXT DEFAULT '₵',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      deleted_at TIMESTAMP WITH TIME ZONE,
      UNIQUE(business_id, invoice_number)
    );
  END IF;
END $$;

-- Indexes for invoices
CREATE INDEX IF NOT EXISTS idx_invoices_business_id ON invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_invoices_business_id_created_at ON invoices(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_deleted_at ON invoices(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- INVOICE_ITEMS TABLE (Enhanced)
-- ============================================================================
DO $$ 
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'invoice_items') THEN
    -- Add new columns if they don't exist
    ALTER TABLE invoice_items
      ADD COLUMN IF NOT EXISTS product_service_id UUID REFERENCES products_services(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS qty NUMERIC NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS unit_price NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS line_total NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    
    -- Migrate existing columns if needed
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'invoice_items' AND column_name = 'quantity') THEN
      UPDATE invoice_items SET qty = quantity WHERE qty IS NULL OR qty = 0;
    END IF;
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'invoice_items' AND column_name = 'price') THEN
      UPDATE invoice_items SET unit_price = price WHERE unit_price IS NULL OR unit_price = 0;
    END IF;
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'invoice_items' AND column_name = 'total') THEN
      UPDATE invoice_items SET line_total = total WHERE line_total IS NULL OR line_total = 0;
    END IF;
  ELSE
    -- Create new invoice_items table
    CREATE TABLE invoice_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      product_service_id UUID REFERENCES products_services(id) ON DELETE SET NULL,
      description TEXT NOT NULL,
      qty NUMERIC NOT NULL DEFAULT 1,
      unit_price NUMERIC NOT NULL DEFAULT 0,
      line_total NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  END IF;
END $$;

-- Indexes for invoice_items
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_product_service_id ON invoice_items(product_service_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_created_at ON invoice_items(created_at);

-- ============================================================================
-- ESTIMATES TABLE (Enhanced)
-- ============================================================================
DO $$ 
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'estimates') THEN
    -- Add new columns if they don't exist
    ALTER TABLE estimates
      ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS validity_date DATE,
      ADD COLUMN IF NOT EXISTS nhil NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS getfund NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS covid NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS vat NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
    
    -- Rename client_id to customer_id if it exists
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'estimates' AND column_name = 'client_id') THEN
      ALTER TABLE estimates RENAME COLUMN client_id TO customer_id;
    END IF;
    
    -- Rename expiry_date to validity_date if it exists
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'estimates' AND column_name = 'expiry_date') THEN
      ALTER TABLE estimates RENAME COLUMN expiry_date TO validity_date;
    END IF;
    
    -- Rename tax columns if they exist with different names
    DO $$
    BEGIN
      IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'estimates' AND column_name = 'nhil_amount') THEN
        ALTER TABLE estimates RENAME COLUMN nhil_amount TO nhil;
      END IF;
      IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'estimates' AND column_name = 'getfund_amount') THEN
        ALTER TABLE estimates RENAME COLUMN getfund_amount TO getfund;
      END IF;
      IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'estimates' AND column_name = 'covid_amount') THEN
        ALTER TABLE estimates RENAME COLUMN covid_amount TO covid;
      END IF;
      IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'estimates' AND column_name = 'vat_amount') THEN
        ALTER TABLE estimates RENAME COLUMN vat_amount TO vat;
      END IF;
    END $$;
  ELSE
    -- Create new estimates table
    CREATE TABLE estimates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
      estimate_number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
      subtotal NUMERIC NOT NULL DEFAULT 0,
      nhil NUMERIC NOT NULL DEFAULT 0,
      getfund NUMERIC NOT NULL DEFAULT 0,
      covid NUMERIC NOT NULL DEFAULT 0,
      vat NUMERIC NOT NULL DEFAULT 0,
      total NUMERIC NOT NULL DEFAULT 0,
      validity_date DATE,
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      deleted_at TIMESTAMP WITH TIME ZONE,
      UNIQUE(business_id, estimate_number)
    );
  END IF;
END $$;

-- Indexes for estimates
CREATE INDEX IF NOT EXISTS idx_estimates_business_id ON estimates(business_id);
CREATE INDEX IF NOT EXISTS idx_estimates_business_id_created_at ON estimates(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_estimates_customer_id ON estimates(customer_id);
CREATE INDEX IF NOT EXISTS idx_estimates_status ON estimates(status);
CREATE INDEX IF NOT EXISTS idx_estimates_deleted_at ON estimates(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- ESTIMATE_ITEMS TABLE (Enhanced)
-- ============================================================================
DO $$ 
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'estimate_items') THEN
    -- Add new columns if they don't exist
    ALTER TABLE estimate_items
      ADD COLUMN IF NOT EXISTS product_service_id UUID REFERENCES products_services(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS qty NUMERIC NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS unit_price NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS line_total NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    
    -- Migrate existing columns if needed
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'estimate_items' AND column_name = 'quantity') THEN
      UPDATE estimate_items SET qty = quantity WHERE qty IS NULL OR qty = 0;
    END IF;
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'estimate_items' AND column_name = 'price') THEN
      UPDATE estimate_items SET unit_price = price WHERE unit_price IS NULL OR unit_price = 0;
    END IF;
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'estimate_items' AND column_name = 'total') THEN
      UPDATE estimate_items SET line_total = total WHERE line_total IS NULL OR line_total = 0;
    END IF;
  ELSE
    -- Create new estimate_items table
    CREATE TABLE estimate_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
      product_service_id UUID REFERENCES products_services(id) ON DELETE SET NULL,
      description TEXT NOT NULL,
      qty NUMERIC NOT NULL DEFAULT 1,
      unit_price NUMERIC NOT NULL DEFAULT 0,
      line_total NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  END IF;
END $$;

-- Indexes for estimate_items
CREATE INDEX IF NOT EXISTS idx_estimate_items_estimate_id ON estimate_items(estimate_id);
CREATE INDEX IF NOT EXISTS idx_estimate_items_product_service_id ON estimate_items(product_service_id);

-- ============================================================================
-- RECURRING_INVOICES TABLE (Enhanced)
-- ============================================================================
DO $$ 
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'recurring_invoices') THEN
    -- Add new columns if they don't exist
    ALTER TABLE recurring_invoices
      ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS next_run_date DATE,
      ADD COLUMN IF NOT EXISTS template_subtotal NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS template_taxes NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS template_total NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
    
    -- Rename client_id to customer_id if it exists
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'recurring_invoices' AND column_name = 'client_id') THEN
      ALTER TABLE recurring_invoices RENAME COLUMN client_id TO customer_id;
    END IF;
    
    -- Rename next_invoice_date to next_run_date if it exists
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'recurring_invoices' AND column_name = 'next_invoice_date') THEN
      ALTER TABLE recurring_invoices RENAME COLUMN next_invoice_date TO next_run_date;
    END IF;
  ELSE
    -- Create new recurring_invoices table
    CREATE TABLE recurring_invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
      invoice_number TEXT NOT NULL,
      frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')),
      next_run_date DATE NOT NULL,
      template_subtotal NUMERIC NOT NULL DEFAULT 0,
      template_taxes NUMERIC NOT NULL DEFAULT 0,
      template_total NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled', 'completed')),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      deleted_at TIMESTAMP WITH TIME ZONE
    );
  END IF;
END $$;

-- Indexes for recurring_invoices
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_business_id ON recurring_invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_customer_id ON recurring_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_next_run_date ON recurring_invoices(next_run_date);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_status ON recurring_invoices(status);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_deleted_at ON recurring_invoices(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- EXPENSES TABLE (Enhanced)
-- ============================================================================
DO $$ 
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'expenses') THEN
    -- Add new columns if they don't exist
    ALTER TABLE expenses
      ADD COLUMN IF NOT EXISTS supplier TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS nhil NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS getfund NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS covid NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS vat NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS receipt_path TEXT,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
    
    -- Rename supplier_name to supplier if it exists
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'expenses' AND column_name = 'supplier_name') THEN
      ALTER TABLE expenses RENAME COLUMN supplier_name TO supplier;
    END IF;
    
    -- Rename expense_date to date if it exists
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'expenses' AND column_name = 'expense_date') THEN
      ALTER TABLE expenses RENAME COLUMN expense_date TO date;
    END IF;
    
    -- Rename receipt_url to receipt_path if it exists
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'expenses' AND column_name = 'receipt_url') THEN
      ALTER TABLE expenses RENAME COLUMN receipt_url TO receipt_path;
    END IF;
  ELSE
    -- Create new expenses table
    CREATE TABLE expenses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      supplier TEXT NOT NULL,
      category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
      amount NUMERIC NOT NULL DEFAULT 0,
      nhil NUMERIC NOT NULL DEFAULT 0,
      getfund NUMERIC NOT NULL DEFAULT 0,
      covid NUMERIC NOT NULL DEFAULT 0,
      vat NUMERIC NOT NULL DEFAULT 0,
      total NUMERIC NOT NULL DEFAULT 0,
      date DATE NOT NULL,
      notes TEXT,
      receipt_path TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      deleted_at TIMESTAMP WITH TIME ZONE
    );
  END IF;
END $$;

-- Indexes for expenses
CREATE INDEX IF NOT EXISTS idx_expenses_business_id ON expenses(business_id);
CREATE INDEX IF NOT EXISTS idx_expenses_business_id_created_at ON expenses(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_expenses_category_id ON expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_deleted_at ON expenses(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- ACCOUNTING_BALANCES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS accounting_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  assets NUMERIC NOT NULL DEFAULT 0,
  liabilities NUMERIC NOT NULL DEFAULT 0,
  equity NUMERIC NOT NULL DEFAULT 0,
  retained_earnings NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(business_id)
);

-- Indexes for accounting_balances
CREATE INDEX IF NOT EXISTS idx_accounting_balances_business_id ON accounting_balances(business_id);
CREATE INDEX IF NOT EXISTS idx_accounting_balances_updated_at ON accounting_balances(updated_at);

-- ============================================================================
-- LEDGER_ENTRIES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('invoice', 'payment', 'expense', 'adjustment')),
  reference_id UUID, -- References invoice, expense, etc.
  debit NUMERIC NOT NULL DEFAULT 0,
  credit NUMERIC NOT NULL DEFAULT 0,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for ledger_entries
CREATE INDEX IF NOT EXISTS idx_ledger_entries_business_id ON ledger_entries(business_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_business_id_created_at ON ledger_entries(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_type ON ledger_entries(type);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_reference_id ON ledger_entries(reference_id);

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES - CUSTOMERS
-- ============================================================================
DROP POLICY IF EXISTS "Users can view customers for their business" ON customers;
DROP POLICY IF EXISTS "Users can insert customers for their business" ON customers;
DROP POLICY IF EXISTS "Users can update customers for their business" ON customers;
DROP POLICY IF EXISTS "Users can delete customers for their business" ON customers;

CREATE POLICY "Users can view customers for their business" ON customers
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
    AND (deleted_at IS NULL)
  );

CREATE POLICY "Users can insert customers for their business" ON customers
  FOR INSERT WITH CHECK (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update customers for their business" ON customers
  FOR UPDATE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete customers for their business" ON customers
  FOR DELETE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

-- ============================================================================
-- RLS POLICIES - CATEGORIES
-- ============================================================================
DROP POLICY IF EXISTS "Users can view categories for their business" ON categories;
DROP POLICY IF EXISTS "Users can insert categories for their business" ON categories;
DROP POLICY IF EXISTS "Users can update categories for their business" ON categories;
DROP POLICY IF EXISTS "Users can delete categories for their business" ON categories;

CREATE POLICY "Users can view categories for their business" ON categories
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
    AND (deleted_at IS NULL)
  );

CREATE POLICY "Users can insert categories for their business" ON categories
  FOR INSERT WITH CHECK (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update categories for their business" ON categories
  FOR UPDATE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete categories for their business" ON categories
  FOR DELETE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

-- ============================================================================
-- RLS POLICIES - PRODUCTS_SERVICES
-- ============================================================================
DROP POLICY IF EXISTS "Users can view products_services for their business" ON products_services;
DROP POLICY IF EXISTS "Users can insert products_services for their business" ON products_services;
DROP POLICY IF EXISTS "Users can update products_services for their business" ON products_services;
DROP POLICY IF EXISTS "Users can delete products_services for their business" ON products_services;

CREATE POLICY "Users can view products_services for their business" ON products_services
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
    AND (deleted_at IS NULL)
  );

CREATE POLICY "Users can insert products_services for their business" ON products_services
  FOR INSERT WITH CHECK (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update products_services for their business" ON products_services
  FOR UPDATE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete products_services for their business" ON products_services
  FOR DELETE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

-- ============================================================================
-- RLS POLICIES - INVOICES
-- ============================================================================
DROP POLICY IF EXISTS "Users can view invoices for their business" ON invoices;
DROP POLICY IF EXISTS "Users can insert invoices for their business" ON invoices;
DROP POLICY IF EXISTS "Users can update invoices for their business" ON invoices;
DROP POLICY IF EXISTS "Users can delete invoices for their business" ON invoices;

CREATE POLICY "Users can view invoices for their business" ON invoices
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
    AND (deleted_at IS NULL)
  );

CREATE POLICY "Users can insert invoices for their business" ON invoices
  FOR INSERT WITH CHECK (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update invoices for their business" ON invoices
  FOR UPDATE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete invoices for their business" ON invoices
  FOR DELETE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

-- ============================================================================
-- RLS POLICIES - INVOICE_ITEMS
-- ============================================================================
DROP POLICY IF EXISTS "Users can view invoice items for their business invoices" ON invoice_items;
DROP POLICY IF EXISTS "Users can insert invoice items for their business invoices" ON invoice_items;
DROP POLICY IF EXISTS "Users can update invoice items for their business invoices" ON invoice_items;
DROP POLICY IF EXISTS "Users can delete invoice items for their business invoices" ON invoice_items;

CREATE POLICY "Users can view invoice items for their business invoices" ON invoice_items
  FOR SELECT USING (
    invoice_id IN (
      SELECT id FROM invoices 
      WHERE business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Users can insert invoice items for their business invoices" ON invoice_items
  FOR INSERT WITH CHECK (
    invoice_id IN (
      SELECT id FROM invoices 
      WHERE business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Users can update invoice items for their business invoices" ON invoice_items
  FOR UPDATE USING (
    invoice_id IN (
      SELECT id FROM invoices 
      WHERE business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Users can delete invoice items for their business invoices" ON invoice_items
  FOR DELETE USING (
    invoice_id IN (
      SELECT id FROM invoices 
      WHERE business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
    )
  );

-- ============================================================================
-- RLS POLICIES - ESTIMATES
-- ============================================================================
DROP POLICY IF EXISTS "Users can view estimates for their business" ON estimates;
DROP POLICY IF EXISTS "Users can insert estimates for their business" ON estimates;
DROP POLICY IF EXISTS "Users can update estimates for their business" ON estimates;
DROP POLICY IF EXISTS "Users can delete estimates for their business" ON estimates;

CREATE POLICY "Users can view estimates for their business" ON estimates
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
    AND (deleted_at IS NULL)
  );

CREATE POLICY "Users can insert estimates for their business" ON estimates
  FOR INSERT WITH CHECK (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update estimates for their business" ON estimates
  FOR UPDATE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete estimates for their business" ON estimates
  FOR DELETE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

-- ============================================================================
-- RLS POLICIES - ESTIMATE_ITEMS
-- ============================================================================
DROP POLICY IF EXISTS "Users can view estimate items for their business estimates" ON estimate_items;
DROP POLICY IF EXISTS "Users can insert estimate items for their business estimates" ON estimate_items;
DROP POLICY IF EXISTS "Users can update estimate items for their business estimates" ON estimate_items;
DROP POLICY IF EXISTS "Users can delete estimate items for their business estimates" ON estimate_items;

CREATE POLICY "Users can view estimate items for their business estimates" ON estimate_items
  FOR SELECT USING (
    estimate_id IN (
      SELECT id FROM estimates 
      WHERE business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Users can insert estimate items for their business estimates" ON estimate_items
  FOR INSERT WITH CHECK (
    estimate_id IN (
      SELECT id FROM estimates 
      WHERE business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Users can update estimate items for their business estimates" ON estimate_items
  FOR UPDATE USING (
    estimate_id IN (
      SELECT id FROM estimates 
      WHERE business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Users can delete estimate items for their business estimates" ON estimate_items
  FOR DELETE USING (
    estimate_id IN (
      SELECT id FROM estimates 
      WHERE business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
    )
  );

-- ============================================================================
-- RLS POLICIES - RECURRING_INVOICES
-- ============================================================================
DROP POLICY IF EXISTS "Users can view recurring invoices for their business" ON recurring_invoices;
DROP POLICY IF EXISTS "Users can insert recurring invoices for their business" ON recurring_invoices;
DROP POLICY IF EXISTS "Users can update recurring invoices for their business" ON recurring_invoices;
DROP POLICY IF EXISTS "Users can delete recurring invoices for their business" ON recurring_invoices;

CREATE POLICY "Users can view recurring invoices for their business" ON recurring_invoices
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
    AND (deleted_at IS NULL)
  );

CREATE POLICY "Users can insert recurring invoices for their business" ON recurring_invoices
  FOR INSERT WITH CHECK (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update recurring invoices for their business" ON recurring_invoices
  FOR UPDATE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete recurring invoices for their business" ON recurring_invoices
  FOR DELETE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

-- ============================================================================
-- RLS POLICIES - EXPENSES
-- ============================================================================
DROP POLICY IF EXISTS "Users can view expenses for their business" ON expenses;
DROP POLICY IF EXISTS "Users can insert expenses for their business" ON expenses;
DROP POLICY IF EXISTS "Users can update expenses for their business" ON expenses;
DROP POLICY IF EXISTS "Users can delete expenses for their business" ON expenses;

CREATE POLICY "Users can view expenses for their business" ON expenses
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
    AND (deleted_at IS NULL)
  );

CREATE POLICY "Users can insert expenses for their business" ON expenses
  FOR INSERT WITH CHECK (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update expenses for their business" ON expenses
  FOR UPDATE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete expenses for their business" ON expenses
  FOR DELETE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

-- ============================================================================
-- RLS POLICIES - ACCOUNTING_BALANCES
-- ============================================================================
DROP POLICY IF EXISTS "Users can view accounting balances for their business" ON accounting_balances;
DROP POLICY IF EXISTS "Users can insert accounting balances for their business" ON accounting_balances;
DROP POLICY IF EXISTS "Users can update accounting balances for their business" ON accounting_balances;

CREATE POLICY "Users can view accounting balances for their business" ON accounting_balances
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert accounting balances for their business" ON accounting_balances
  FOR INSERT WITH CHECK (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update accounting balances for their business" ON accounting_balances
  FOR UPDATE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

-- ============================================================================
-- RLS POLICIES - LEDGER_ENTRIES
-- ============================================================================
DROP POLICY IF EXISTS "Users can view ledger entries for their business" ON ledger_entries;
DROP POLICY IF EXISTS "Users can insert ledger entries for their business" ON ledger_entries;
DROP POLICY IF EXISTS "Users can update ledger entries for their business" ON ledger_entries;

CREATE POLICY "Users can view ledger entries for their business" ON ledger_entries
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert ledger entries for their business" ON ledger_entries
  FOR INSERT WITH CHECK (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update ledger entries for their business" ON ledger_entries
  FOR UPDATE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_customers_updated_at ON customers;
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_categories_updated_at ON categories;
CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_products_services_updated_at ON products_services;
CREATE TRIGGER update_products_services_updated_at BEFORE UPDATE ON products_services FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_invoices_updated_at ON invoices;
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_invoice_items_updated_at ON invoice_items;
CREATE TRIGGER update_invoice_items_updated_at BEFORE UPDATE ON invoice_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_estimates_updated_at ON estimates;
CREATE TRIGGER update_estimates_updated_at BEFORE UPDATE ON estimates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_estimate_items_updated_at ON estimate_items;
CREATE TRIGGER update_estimate_items_updated_at BEFORE UPDATE ON estimate_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_recurring_invoices_updated_at ON recurring_invoices;
CREATE TRIGGER update_recurring_invoices_updated_at BEFORE UPDATE ON recurring_invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_expenses_updated_at ON expenses;
CREATE TRIGGER update_expenses_updated_at BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_accounting_balances_updated_at ON accounting_balances;
CREATE TRIGGER update_accounting_balances_updated_at BEFORE UPDATE ON accounting_balances FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

