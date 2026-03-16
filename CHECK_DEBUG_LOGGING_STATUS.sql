-- ============================================================================
-- CHECK: Why is Debug Log Empty?
-- ============================================================================

-- Step 1: Verify function has debug logging code
SELECT
  p.oid,
  p.proname,
  CASE 
    WHEN pg_get_functiondef(p.oid) LIKE '%INSERT INTO public.retail_posting_debug_log%' THEN '✅ HAS DEBUG LOGGING'
    WHEN pg_get_functiondef(p.oid) LIKE '%retail_posting_debug_log%' THEN '⚠️ MENTIONS DEBUG LOG (but no INSERT)'
    ELSE '❌ NO DEBUG LOGGING'
  END AS logging_status,
  -- Check parameter count to identify function version
  p.pronargs AS parameter_count
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'post_sale_to_ledger'
ORDER BY p.oid DESC;

-- Step 2: Check if function execution is reaching debug log point
-- If function fails BEFORE debug log INSERT, we won't see entries
-- This would happen if:
-- - NULL tax_lines validation fails early (TEST C might do this)
-- - Account validation fails
-- - Other early exits

-- Step 3: Check if any sales exist for the test business
SELECT 
  COUNT(*) as total_sales,
  COUNT(CASE WHEN created_at >= NOW() - INTERVAL '10 minutes' THEN 1 END) as recent_sales,
  COUNT(CASE WHEN tax_lines IS NULL THEN 1 END) as null_tax_lines_sales
FROM sales
WHERE business_id = '69278e9a-8694-4640-88d1-cbcfe7dd42f3';

-- Step 4: Verify debug log table exists and is accessible
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'retail_posting_debug_log') 
    THEN 'EXISTS' 
    ELSE 'MISSING' 
  END AS table_status,
  CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'retail_posting_debug_log')
    THEN (SELECT COUNT(*) FROM retail_posting_debug_log)
    ELSE -1
  END AS total_records;
