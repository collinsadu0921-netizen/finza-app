-- Ensure clients table exists with correct structure
-- This migration ensures the clients table is created even if previous migrations failed

-- Create clients table if it doesn't exist
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

-- Add any missing columns (skip id as it's the primary key)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'business_id') THEN
    ALTER TABLE clients ADD COLUMN business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'name') THEN
    ALTER TABLE clients ADD COLUMN name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'email') THEN
    ALTER TABLE clients ADD COLUMN email TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'phone') THEN
    ALTER TABLE clients ADD COLUMN phone TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'address') THEN
    ALTER TABLE clients ADD COLUMN address TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'created_at') THEN
    ALTER TABLE clients ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'updated_at') THEN
    ALTER TABLE clients ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
  END IF;
END $$;

-- Create index if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_clients_business_id ON clients(business_id);

-- Disable RLS for development (as per user's request to disable all permission checks)
ALTER TABLE clients DISABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view clients for their business" ON clients;
DROP POLICY IF EXISTS "Users can insert clients for their business" ON clients;
DROP POLICY IF EXISTS "Users can update clients for their business" ON clients;
DROP POLICY IF EXISTS "Users can delete clients for their business" ON clients;
DROP POLICY IF EXISTS "Allow all operations on clients" ON clients;

