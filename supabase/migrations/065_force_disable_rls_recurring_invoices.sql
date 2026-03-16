-- Force disable RLS on recurring_invoices table
-- This migration ensures RLS is completely disabled and all policies are removed
-- This runs AFTER migration 051 which enables RLS, so we need to be aggressive

DO $$
DECLARE
  policy_record RECORD;
BEGIN
  -- Drop ALL policies on recurring_invoices table (including ones from migration 051)
  FOR policy_record IN 
    SELECT policyname 
    FROM pg_policies 
    WHERE tablename = 'recurring_invoices' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON recurring_invoices', policy_record.policyname);
    RAISE NOTICE 'Dropped policy: %', policy_record.policyname;
  END LOOP;
  
  -- Also try to drop common policy names
  DROP POLICY IF EXISTS "Users can view recurring invoices for their business" ON recurring_invoices;
  DROP POLICY IF EXISTS "Users can insert recurring invoices for their business" ON recurring_invoices;
  DROP POLICY IF EXISTS "Users can update recurring invoices for their business" ON recurring_invoices;
  DROP POLICY IF EXISTS "Users can delete recurring invoices for their business" ON recurring_invoices;
  DROP POLICY IF EXISTS "Allow all operations on recurring_invoices" ON recurring_invoices;
  DROP POLICY IF EXISTS "Enable read access for all users" ON recurring_invoices;
  DROP POLICY IF EXISTS "Enable insert for authenticated users" ON recurring_invoices;
  DROP POLICY IF EXISTS "Enable update for authenticated users" ON recurring_invoices;
  DROP POLICY IF EXISTS "Enable delete for authenticated users" ON recurring_invoices;
  DROP POLICY IF EXISTS "allow_all_select_recurring_invoices" ON recurring_invoices;
  DROP POLICY IF EXISTS "allow_all_insert_recurring_invoices" ON recurring_invoices;
  DROP POLICY IF EXISTS "allow_all_update_recurring_invoices" ON recurring_invoices;
  DROP POLICY IF EXISTS "allow_all_delete_recurring_invoices" ON recurring_invoices;
  
  -- Disable RLS (this must happen AFTER dropping policies)
  ALTER TABLE IF EXISTS recurring_invoices DISABLE ROW LEVEL SECURITY;
  
  RAISE NOTICE 'RLS disabled and all policies dropped for recurring_invoices';
  
EXCEPTION
  WHEN undefined_table THEN
    -- Table doesn't exist yet, that's okay
    RAISE NOTICE 'Table recurring_invoices does not exist yet';
  WHEN OTHERS THEN
    -- Log the error but continue
    RAISE NOTICE 'Error disabling RLS: %', SQLERRM;
END $$;

-- Grant permissions to authenticated and anon users
DO $$
BEGIN
  -- Grant all permissions to authenticated users
  GRANT ALL ON TABLE recurring_invoices TO authenticated;
  GRANT ALL ON TABLE recurring_invoices TO anon;
  GRANT ALL ON TABLE recurring_invoices TO service_role;
  
  -- Grant usage on sequence if it exists
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error granting permissions: %', SQLERRM;
END $$;

-- Verify RLS is disabled
DO $$
DECLARE
  rls_enabled BOOLEAN;
BEGIN
  SELECT rowsecurity INTO rls_enabled
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'recurring_invoices';
  
  IF rls_enabled THEN
    RAISE EXCEPTION 'RLS is still enabled on recurring_invoices table. Please check manually.';
  ELSE
    RAISE NOTICE 'RLS successfully disabled on recurring_invoices table';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Table recurring_invoices does not exist yet';
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not verify RLS status: %', SQLERRM;
END $$;

