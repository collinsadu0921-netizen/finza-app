-- Migration: Create invoice, client, and estimate tables for service businesses
-- This migration creates the necessary tables for invoice management

-- Create clients table
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  tax NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create invoice_items table
CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  price NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create estimates table
CREATE TABLE IF NOT EXISTS estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  estimate_number TEXT NOT NULL,
  issue_date DATE NOT NULL,
  expiry_date DATE,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  tax NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create estimate_items table
CREATE TABLE IF NOT EXISTS estimate_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  price NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create recurring_invoices table
CREATE TABLE IF NOT EXISTS recurring_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_invoice_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_clients_business_id ON clients(business_id);
CREATE INDEX IF NOT EXISTS idx_invoices_business_id ON invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_estimates_business_id ON estimates(business_id);
CREATE INDEX IF NOT EXISTS idx_estimates_client_id ON estimates(client_id);
CREATE INDEX IF NOT EXISTS idx_estimates_status ON estimates(status);
CREATE INDEX IF NOT EXISTS idx_estimate_items_estimate_id ON estimate_items(estimate_id);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_business_id ON recurring_invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_client_id ON recurring_invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_status ON recurring_invoices(status);

-- Enable RLS
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_invoices ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for clients
CREATE POLICY "Users can view clients for their business" ON clients
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert clients for their business" ON clients
  FOR INSERT WITH CHECK (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update clients for their business" ON clients
  FOR UPDATE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete clients for their business" ON clients
  FOR DELETE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

-- Create RLS policies for invoices
CREATE POLICY "Users can view invoices for their business" ON invoices
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
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

-- Create RLS policies for invoice_items
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

-- Create RLS policies for estimates
CREATE POLICY "Users can view estimates for their business" ON estimates
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
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

-- Create RLS policies for estimate_items
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

-- Create RLS policies for recurring_invoices
CREATE POLICY "Users can view recurring invoices for their business" ON recurring_invoices
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
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

-- Add unique constraint on invoice_number per business
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_business_invoice_number 
  ON invoices(business_id, invoice_number);

-- Add unique constraint on estimate_number per business
CREATE UNIQUE INDEX IF NOT EXISTS idx_estimates_business_estimate_number 
  ON estimates(business_id, estimate_number);

