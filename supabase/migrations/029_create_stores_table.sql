-- Create stores table if it doesn't exist
-- This is a standalone migration to ensure the stores table exists

CREATE TABLE IF NOT EXISTS stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  location text,
  phone text,
  email text,
  opening_hours jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Create index
CREATE INDEX IF NOT EXISTS idx_stores_business_id ON stores(business_id);

-- Enable RLS
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Enable read access for all users" ON stores;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON stores;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON stores;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON stores;

-- Create policies for stores
CREATE POLICY "Enable read access for all users" ON stores FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users" ON stores FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Enable update for authenticated users" ON stores FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Enable delete for authenticated users" ON stores FOR DELETE USING (auth.uid() IS NOT NULL);

COMMENT ON TABLE stores IS 'Store/branch locations for multi-store support';







