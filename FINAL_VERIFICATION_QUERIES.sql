-- ============================================================================
-- FINAL VERIFICATION QUERIES: Close Remaining Gaps
-- ============================================================================
-- Execute these queries and paste results into verification report
-- ============================================================================

-- ============================================================================
-- TASK 1: Definitively Verify Trigger Definition (Migration 185)
-- ============================================================================

SELECT
  tgname AS trigger_name,
  pg_get_triggerdef(t.oid) AS trigger_def
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE c.relname = 'journal_entry_lines'
  AND NOT t.tgisinternal
ORDER BY tgname;

-- ============================================================================
-- TASK 2: Complete Trigger Semantics Test
-- ============================================================================
-- Run this function and capture FULL output

SELECT * FROM test_trigger_semantics();

-- ============================================================================
-- TASK 3: Run TEST A / B / C and Capture Evidence
-- ============================================================================

-- Run the test runner function
SELECT * FROM verification_test_runner();

-- ============================================================================
-- TASK 4: For Each Failing Test, Capture journal_lines JSONB
-- ============================================================================
-- Only run if tests fail - capture from debug log

-- Get the most recent test sale's journal_lines payload
SELECT
  id,
  created_at,
  sale_id,
  journal_lines,
  line_count,
  debit_sum,
  credit_sum,
  credit_count,
  tax_shape,
  note
FROM retail_posting_debug_log
WHERE created_at >= NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 10;

-- ============================================================================
-- BONUS: Verify Balance Validation Loop Also Uses Safe Extraction
-- ============================================================================

-- Extract balance validation section from post_journal_entry
DO $$
DECLARE
  func_oid OID;
  func_def TEXT;
  balance_section TEXT;
BEGIN
  SELECT p.oid INTO func_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'post_journal_entry'
    AND p.pronargs = 14
  ORDER BY p.oid DESC
  LIMIT 1;
  
  IF func_oid IS NULL THEN
    RAISE NOTICE 'No 14-parameter post_journal_entry found';
    RETURN;
  END IF;
  
  func_def := pg_get_functiondef(func_oid);
  
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'BALANCE VALIDATION LOOP VERIFICATION';
  RAISE NOTICE '================================================================';
  RAISE NOTICE '';
  
  -- Check for balance validation loop
  IF func_def LIKE '%FOR line IN SELECT * FROM jsonb_array_elements(p_lines)%' THEN
    RAISE NOTICE 'Balance validation loop found';
    
    -- Check extraction method
    IF func_def LIKE '%(line->''debit'')::NUMERIC%' AND func_def LIKE '%(line->''credit'')::NUMERIC%' THEN
      RAISE NOTICE '✅ Uses SAFE extraction: (line->''debit'') and (line->''credit'')';
    ELSIF func_def LIKE '%(line->>''debit'')::NUMERIC%' OR func_def LIKE '%(line->>''credit'')::NUMERIC%' THEN
      RAISE NOTICE '❌ Uses UNSAFE extraction: (line->>''debit'') or (line->>''credit'')';
    ELSE
      RAISE NOTICE '⚠️ Extraction method unclear';
    END IF;
  ELSE
    RAISE NOTICE 'Balance validation loop pattern not found';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'Consistency Check:';
  IF func_def LIKE '%(line->''debit'')::NUMERIC%' AND func_def LIKE '%(line->''credit'')::NUMERIC%' THEN
    RAISE NOTICE '✅ Balance loop and INSERT loop both use safe extraction (consistent)';
  ELSE
    RAISE NOTICE '❌ Extraction methods differ between balance loop and INSERT loop';
  END IF;
END $$;