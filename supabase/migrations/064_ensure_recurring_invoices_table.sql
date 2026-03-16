-- Ensure recurring_invoices table exists with correct structure
-- This migration ensures the recurring_invoices table is created even if previous migrations failed

-- Create recurring_invoices table if it doesn't exist
-- Use DO block to handle foreign keys conditionally
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'recurring_invoices') THEN
    -- Create table without foreign keys first
    CREATE TABLE recurring_invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL,
      client_id UUID,
      customer_id UUID,
      invoice_number TEXT,
      frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
      next_run_date DATE,
      next_invoice_date DATE,
      last_run_date DATE,
      auto_send BOOLEAN DEFAULT false,
      auto_whatsapp BOOLEAN DEFAULT false,
      invoice_template_data JSONB DEFAULT '{}',
      total_amount NUMERIC DEFAULT 0,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      deleted_at TIMESTAMP WITH TIME ZONE
    );

    -- Add foreign key to businesses (should always exist)
    ALTER TABLE recurring_invoices
      ADD CONSTRAINT recurring_invoices_business_id_fkey 
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

    -- Add foreign key to clients if table exists
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'clients') THEN
      ALTER TABLE recurring_invoices
        ADD CONSTRAINT recurring_invoices_client_id_fkey 
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
    END IF;

    -- Add foreign key to customers if table exists
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'customers') THEN
      ALTER TABLE recurring_invoices
        ADD CONSTRAINT recurring_invoices_customer_id_fkey 
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- Add any missing columns (without foreign keys to avoid errors if tables don't exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recurring_invoices' AND column_name = 'client_id') THEN
    ALTER TABLE recurring_invoices ADD COLUMN client_id UUID;
    -- Add foreign key if clients table exists
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'clients') THEN
      ALTER TABLE recurring_invoices
        ADD CONSTRAINT recurring_invoices_client_id_fkey 
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recurring_invoices' AND column_name = 'customer_id') THEN
    ALTER TABLE recurring_invoices ADD COLUMN customer_id UUID;
    -- Add foreign key if customers table exists
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'customers') THEN
      ALTER TABLE recurring_invoices
        ADD CONSTRAINT recurring_invoices_customer_id_fkey 
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recurring_invoices' AND column_name = 'invoice_number') THEN
    ALTER TABLE recurring_invoices ADD COLUMN invoice_number TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recurring_invoices' AND column_name = 'total_amount') THEN
    ALTER TABLE recurring_invoices ADD COLUMN total_amount NUMERIC DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recurring_invoices' AND column_name = 'next_run_date') THEN
    ALTER TABLE recurring_invoices ADD COLUMN next_run_date DATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recurring_invoices' AND column_name = 'next_invoice_date') THEN
    ALTER TABLE recurring_invoices ADD COLUMN next_invoice_date DATE;
  END IF;
END $$;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_business_id ON recurring_invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_client_id ON recurring_invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_customer_id ON recurring_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_next_run_date ON recurring_invoices(next_run_date);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_status ON recurring_invoices(status);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_deleted_at ON recurring_invoices(deleted_at) WHERE deleted_at IS NULL;

-- Disable RLS for development (as per user's request to disable all permission checks)
ALTER TABLE recurring_invoices DISABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view recurring invoices for their business" ON recurring_invoices;
DROP POLICY IF EXISTS "Users can insert recurring invoices for their business" ON recurring_invoices;
DROP POLICY IF EXISTS "Users can update recurring invoices for their business" ON recurring_invoices;
DROP POLICY IF EXISTS "Users can delete recurring invoices for their business" ON recurring_invoices;
DROP POLICY IF EXISTS "Allow all operations on recurring_invoices" ON recurring_invoices;

-- Ensure RLS is disabled (in case it was re-enabled)
DO $$
BEGIN
  ALTER TABLE recurring_invoices DISABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN OTHERS THEN
    -- Table might not exist yet, ignore error
    NULL;
END $$;

