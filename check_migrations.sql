-- Simple query to check if migrations were applied
-- Run this in Supabase SQL Editor

-- Check Migration 072: Should have payment_amount variable
SELECT 
  'Migration 072 (post_payment_to_ledger)' as migration_name,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
      AND p.proname = 'post_payment_to_ledger'
    ) THEN (
      SELECT CASE 
        WHEN pg_get_functiondef(p.oid) LIKE '%payment_amount NUMERIC%' 
        THEN '✓ Applied'
        ELSE '✗ Function exists but missing payment_amount'
      END
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
      AND p.proname = 'post_payment_to_ledger'
      LIMIT 1
    )
    ELSE '✗ Function not found'
  END as status;

-- Check Migration 073: Should have exception handling
SELECT 
  'Migration 073 (trigger_post_payment)' as migration_name,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
      AND p.proname = 'trigger_post_payment'
    ) THEN (
      SELECT CASE 
        WHEN pg_get_functiondef(p.oid) LIKE '%EXCEPTION WHEN OTHERS%' 
        THEN '✓ Applied'
        ELSE '✗ Function exists but missing exception handling'
      END
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
      AND p.proname = 'trigger_post_payment'
      LIMIT 1
    )
    ELSE '✗ Function not found'
  END as status;



















