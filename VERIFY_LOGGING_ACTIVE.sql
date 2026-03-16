-- ============================================================================
-- Verify Debug Logging is Active
-- ============================================================================
-- This checks if migration 182 was applied and logging is in the function
-- ============================================================================

-- Check if debug table exists
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'retail_posting_debug_log')
    THEN '✅ Table exists'
    ELSE '❌ Table does NOT exist - apply migration 181 first'
  END as table_status;

-- Check if function contains debug logging code
SELECT 
  CASE 
    WHEN pg_get_functiondef(p.oid) LIKE '%retail_posting_debug_log%'
    THEN '✅ Function contains debug logging'
    ELSE '❌ Function does NOT contain debug logging - apply migration 182'
  END as logging_status,
  p.proname as function_name,
  n.nspname as schema_name
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'post_sale_to_ledger'
  AND n.nspname = 'public'
ORDER BY p.oid DESC
LIMIT 1;

-- Show function definition (last 200 chars to see if logging is there)
SELECT 
  RIGHT(pg_get_functiondef(p.oid), 200) as function_tail
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'post_sale_to_ledger'
  AND n.nspname = 'public'
ORDER BY p.oid DESC
LIMIT 1;
