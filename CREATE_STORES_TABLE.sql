-- ============================================
-- CREATE STORES TABLE - Run this in Supabase SQL Editor
-- ============================================
-- Copy and paste this entire script into Supabase Dashboard > SQL Editor > New Query
-- Then click "Run" to execute

-- Step 1: Create stores table
CREATE TABLE IF NOT EXISTS public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  location text,
  phone text,
  email text,
  opening_hours jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Step 2: Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_stores_business_id ON public.stores(business_id);

-- Step 3: Enable Row Level Security
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

-- Step 4: Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Enable read access for all users" ON public.stores;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.stores;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.stores;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON public.stores;

-- Step 5: Create RLS policies
CREATE POLICY "Enable read access for all users" 
  ON public.stores FOR SELECT 
  USING (true);

CREATE POLICY "Enable insert for authenticated users" 
  ON public.stores FOR INSERT 
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Enable update for authenticated users" 
  ON public.stores FOR UPDATE 
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Enable delete for authenticated users" 
  ON public.stores FOR DELETE 
  USING (auth.uid() IS NOT NULL);

-- Step 6: Add comment
COMMENT ON TABLE public.stores IS 'Store/branch locations for multi-store support';

-- ============================================
-- VERIFICATION: Check if table was created
-- ============================================
-- Run this query to verify:
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stores';







