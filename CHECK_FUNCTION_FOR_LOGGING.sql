-- ============================================================================
-- Check if Function Contains Debug Logging
-- ============================================================================

-- Get full function definition and search for logging
SELECT 
  CASE 
    WHEN pg_get_functiondef(p.oid) LIKE '%retail_posting_debug_log%'
    THEN '✅ LOGGING FOUND'
    ELSE '❌ LOGGING NOT FOUND'
  END as has_logging,
  CASE 
    WHEN pg_get_functiondef(p.oid) LIKE '%DEBUG LOG%'
    THEN '✅ DEBUG LOG COMMENT FOUND'
    ELSE '❌ DEBUG LOG COMMENT NOT FOUND'
  END as has_debug_comment,
  LENGTH(pg_get_functiondef(p.oid)) as function_length,
  p.oid as function_oid
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'post_sale_to_ledger'
  AND n.nspname = 'public'
ORDER BY p.oid DESC
LIMIT 1;

-- Extract the section around post_journal_entry call to see if logging is before it
SELECT 
  SUBSTRING(
    pg_get_functiondef(p.oid),
    POSITION('post_journal_entry' IN pg_get_functiondef(p.oid)) - 500,
    1000
  ) as code_before_post_journal_entry
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'post_sale_to_ledger'
  AND n.nspname = 'public'
ORDER BY p.oid DESC
LIMIT 1;
