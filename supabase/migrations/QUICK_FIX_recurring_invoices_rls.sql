-- QUICK FIX: Disable RLS on recurring_invoices
-- Run this directly in Supabase SQL Editor if you're getting 401 errors

-- Drop ALL policies
DO $$
DECLARE
  policy_record RECORD;
BEGIN
  FOR policy_record IN 
    SELECT policyname 
    FROM pg_policies 
    WHERE tablename = 'recurring_invoices' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON recurring_invoices', policy_record.policyname);
  END LOOP;
END $$;

-- Disable RLS
ALTER TABLE recurring_invoices DISABLE ROW LEVEL SECURITY;

-- Grant ALL permissions explicitly (SELECT, INSERT, UPDATE, DELETE)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE recurring_invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE recurring_invoices TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE recurring_invoices TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE recurring_invoices TO postgres;

-- Grant usage on sequences (for auto-increment IDs if any)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Verify RLS is disabled and permissions are granted
SELECT 
  tablename, 
  rowsecurity as rls_enabled,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'recurring_invoices') as policy_count
FROM pg_tables 
WHERE schemaname = 'public' AND tablename = 'recurring_invoices';

-- Verify permissions
SELECT 
  grantee, 
  privilege_type 
FROM information_schema.role_table_grants 
WHERE table_name = 'recurring_invoices' 
  AND table_schema = 'public'
ORDER BY grantee, privilege_type;

-- Should show: rls_enabled = false, policy_count = 0
-- And permissions for authenticated, anon, service_role, postgres

