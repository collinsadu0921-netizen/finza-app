-- ============================================================================
-- CHECK FUNCTION DEFINITION
-- ============================================================================
-- This shows the actual function definition in the database

-- Get the function definition
SELECT 
  'FUNCTION DEFINITION' as section,
  pg_get_functiondef(oid) as function_definition
FROM pg_proc
WHERE proname = 'post_sale_to_ledger'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY oid DESC
LIMIT 1;

-- Also check for the specific line that builds journal_lines
SELECT 
  'FUNCTION SOURCE (journal_lines build)' as section,
  CASE 
    WHEN pg_get_functiondef(oid) LIKE '%journal_lines := jsonb_build_array%' THEN 'FOUND: journal_lines build'
    ELSE 'NOT FOUND: journal_lines build'
  END as has_journal_lines_build,
  CASE 
    WHEN pg_get_functiondef(oid) LIKE '%credit%ROUND(COALESCE(net_total, 0), 2)%' THEN 'FOUND: revenue credit with net_total'
    WHEN pg_get_functiondef(oid) LIKE '%credit%COALESCE(net_total, 0)%' THEN 'FOUND: revenue credit with COALESCE'
    ELSE 'NOT FOUND: revenue credit line'
  END as has_revenue_credit
FROM pg_proc
WHERE proname = 'post_sale_to_ledger'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY oid DESC
LIMIT 1;
