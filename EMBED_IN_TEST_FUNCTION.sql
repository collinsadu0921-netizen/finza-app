-- ============================================================================
-- EMBED THIS IN TEST FUNCTION: Capture active function during test execution
-- ============================================================================
-- Add this block at the START of test_retail_ledger_null_credit_fix()
-- right after the DECLARE section, before any test logic
-- ============================================================================

DECLARE
  func_oid OID;
  func_schema TEXT;
  func_def TEXT;
BEGIN
  -- Capture which function would be resolved
  SELECT p.oid, n.nspname, pg_get_functiondef(p.oid)
  INTO func_oid, func_schema, func_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'post_sale_to_ledger'
    AND n.nspname = 'public'
  ORDER BY p.oid DESC
  LIMIT 1;
  
  RAISE NOTICE 'TEST CONTEXT: search_path=%, current_user=%, current_schema=%', 
    current_setting('search_path'), current_user, current_schema();
  RAISE NOTICE 'RESOLVED post_sale_to_ledger: OID=%, schema=%, definition_length=%', 
    func_oid, func_schema, length(func_def);
  
  -- Log first 500 chars of function definition to verify it's the right one
  RAISE NOTICE 'Function definition (first 500 chars): %', substring(func_def, 1, 500);
END;
