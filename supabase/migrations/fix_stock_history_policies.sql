-- Fix stock_history policies - Run this FIRST
-- This will drop existing policies and recreate them

-- Drop all existing policies on stock_history (if they exist)
DO $$ 
BEGIN
  DROP POLICY IF EXISTS "Enable read access for all users" ON stock_history;
  DROP POLICY IF EXISTS "Enable insert for authenticated users" ON stock_history;
  DROP POLICY IF EXISTS "Enable update for authenticated users" ON stock_history;
  DROP POLICY IF EXISTS "Enable delete for authenticated users" ON stock_history;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- Now create the policies fresh
CREATE POLICY "Enable read access for all users" ON stock_history FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users" ON stock_history FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Enable update for authenticated users" ON stock_history FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Enable delete for authenticated users" ON stock_history FOR DELETE USING (auth.uid() IS NOT NULL);


















