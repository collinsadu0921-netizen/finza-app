-- ============================================================================
-- TEMPORARY DIAGNOSTIC: Add RAISE NOTICE to Capture journal_lines JSONB
-- ============================================================================
-- Purpose: Capture journal_lines JSONB even when transaction rolls back
-- RAISE NOTICE output survives transaction rollback for debugging
-- ============================================================================
-- 
-- This is TEMPORARY diagnostic code only - remove after root cause analysis
-- ============================================================================

-- Check current function definition first
SELECT 
  p.oid,
  p.proname,
  p.pronargs,
  CASE 
    WHEN pg_get_functiondef(p.oid) LIKE '%INSERT INTO public.retail_posting_debug_log%' THEN 'HAS DEBUG LOG'
    ELSE 'NO DEBUG LOG'
  END AS has_debug_log
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'post_sale_to_ledger'
ORDER BY p.oid DESC
LIMIT 1;

-- ============================================================================
-- Add RAISE NOTICE right before post_journal_entry() call
-- ============================================================================
-- This will output journal_lines JSONB to client even if transaction rolls back
-- ============================================================================
--
-- We need to modify the function to add RAISE NOTICE with journal_lines
-- Since we can't easily do that without seeing the full function, the user
-- should run the tests and check PostgreSQL logs/console output for NOTICE messages
--
-- Alternatively, we can try to extract where in the function the INSERT happens
-- and add a RAISE NOTICE right after building journal_lines
-- ============================================================================

-- For now, let's check if there are any RAISE NOTICE statements already
SELECT
  CASE 
    WHEN pg_get_functiondef(p.oid) LIKE '%RAISE NOTICE%journal_lines%' THEN 'HAS NOTICE FOR journal_lines'
    WHEN pg_get_functiondef(p.oid) LIKE '%RAISE NOTICE%' THEN 'HAS OTHER NOTICES'
    ELSE 'NO NOTICES'
  END AS notice_status
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'post_sale_to_ledger'
ORDER BY p.oid DESC
LIMIT 1;
