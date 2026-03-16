-- ============================================================================
-- GROUND TRUTH VERIFICATION: Active Definitions vs Expected Migrations
-- ============================================================================
-- This script extracts the EXACT active definitions to determine which
-- migration versions are actually running in the database.
-- ============================================================================

-- ============================================================================
-- SECTION 1: Complete Function Definitions for post_journal_entry()
-- ============================================================================

-- Get ALL overloads of post_journal_entry with full definitions
SELECT
  p.oid,
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.pronargs AS parameter_count,
  pg_get_functiondef(p.oid) AS full_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'post_journal_entry'
ORDER BY p.pronargs DESC, p.oid DESC;

-- ============================================================================
-- SECTION 2: Key Function Characteristics (What to Look For)
-- ============================================================================

-- Check for JSONB extraction method (critical indicator of migration 184)
SELECT
  p.oid,
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  -- Check for safe JSONB extraction (migration 184)
  CASE 
    WHEN pg_get_functiondef(p.oid) LIKE '%(line->''debit'')::NUMERIC%' THEN 'SAFE (migration 184)'
    WHEN pg_get_functiondef(p.oid) LIKE '%(line->>''debit'')::NUMERIC%' THEN 'UNSAFE (pre-184)'
    ELSE 'UNKNOWN'
  END AS debit_extraction_method,
  CASE 
    WHEN pg_get_functiondef(p.oid) LIKE '%(line->''credit'')::NUMERIC%' THEN 'SAFE (migration 184)'
    WHEN pg_get_functiondef(p.oid) LIKE '%(line->>''credit'')::NUMERIC%' THEN 'UNSAFE (pre-184)'
    ELSE 'UNKNOWN'
  END AS credit_extraction_method,
  -- Check for parameter count (migration 179 = 14 params, older = 6 or 10)
  p.pronargs AS parameter_count,
  CASE 
    WHEN p.pronargs = 14 THEN 'Likely migration 179+ (has posted_by_accountant_id)'
    WHEN p.pronargs = 10 THEN 'Likely migration 172 wrapper'
    WHEN p.pronargs = 6 THEN 'Likely migration 043 (original)'
    ELSE 'Unknown version'
  END AS version_indicator
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'post_journal_entry'
ORDER BY p.pronargs DESC, p.oid DESC;

-- ============================================================================
-- SECTION 3: Extract Critical Code Sections from Active Function
-- ============================================================================

-- For the 14-parameter version (most recent), extract key sections
DO $$
DECLARE
  func_oid OID;
  func_def TEXT;
  balance_validation TEXT;
  jsonb_extraction TEXT;
  insert_section TEXT;
BEGIN
  -- Get the 14-parameter version (migration 179+)
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
  RAISE NOTICE 'FUNCTION OID: %', func_oid;
  RAISE NOTICE '================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'BALANCE VALIDATION LOOP:';
  RAISE NOTICE '%', substring(func_def, 
    position('FOR line IN SELECT * FROM jsonb_array_elements(p_lines)' in func_def),
    200);
  RAISE NOTICE '';
  RAISE NOTICE 'JSONB EXTRACTION IN BALANCE LOOP:';
  IF func_def LIKE '%(line->''debit'')%' THEN
    RAISE NOTICE 'USES: (line->''debit'') - SAFE (migration 184)';
  ELSIF func_def LIKE '%(line->>''debit'')%' THEN
    RAISE NOTICE 'USES: (line->>''debit'') - UNSAFE (pre-migration 184)';
  ELSE
    RAISE NOTICE 'EXTRACTION METHOD NOT FOUND';
  END IF;
  RAISE NOTICE '';
  RAISE NOTICE 'INSERT LOOP:';
  RAISE NOTICE '%', substring(func_def,
    position('FOR line IN SELECT * FROM jsonb_array_elements(p_lines)' in func_def),
    position('END LOOP' in func_def) - position('FOR line IN SELECT * FROM jsonb_array_elements(p_lines)' in func_def) + 50);
  RAISE NOTICE '';
  RAISE NOTICE 'JSONB EXTRACTION IN INSERT:';
  IF func_def LIKE '%COALESCE((line->''debit'')::NUMERIC, 0)%' THEN
    RAISE NOTICE 'USES: (line->''debit'') - SAFE (migration 184)';
  ELSIF func_def LIKE '%COALESCE((line->>''debit'')::NUMERIC, 0)%' THEN
    RAISE NOTICE 'USES: (line->>''debit'') - UNSAFE (pre-migration 184)';
  ELSE
    RAISE NOTICE 'EXTRACTION METHOD NOT FOUND';
  END IF;
END $$;

-- ============================================================================
-- SECTION 4: Complete Trigger Definition
-- ============================================================================

-- Get trigger definition with all details
SELECT 
  t.trigger_name,
  t.event_manipulation,
  t.action_timing,
  t.action_orientation,
  t.action_statement,
  p.proname AS trigger_function_name,
  pg_get_functiondef(p.oid) AS trigger_function_definition
FROM information_schema.triggers t
LEFT JOIN pg_proc p ON p.proname = substring(t.action_statement from 'EXECUTE FUNCTION ([^(]+)')
LEFT JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
WHERE t.event_object_table = 'journal_entry_lines'
  AND t.trigger_name LIKE '%balance%'
ORDER BY t.trigger_name;

-- ============================================================================
-- SECTION 5: All Triggers on journal_entry_lines
-- ============================================================================

-- List ALL triggers on journal_entry_lines (not just balance trigger)
SELECT 
  t.trigger_name,
  t.event_manipulation,
  t.action_timing,
  t.action_orientation AS trigger_level,
  CASE 
    WHEN t.action_orientation = 'ROW' THEN '❌ ROW-LEVEL (problematic)'
    WHEN t.action_orientation = 'STATEMENT' THEN '✅ STATEMENT-LEVEL (correct)'
    ELSE 'UNKNOWN'
  END AS level_assessment,
  t.action_statement,
  CASE
    WHEN t.trigger_name LIKE '%balance%' THEN 'Balance enforcement'
    WHEN t.trigger_name LIKE '%modification%' THEN 'Immutation enforcement'
    ELSE 'Other'
  END AS trigger_purpose
FROM information_schema.triggers t
WHERE t.event_object_table = 'journal_entry_lines'
ORDER BY t.trigger_name;

-- ============================================================================
-- SECTION 6: Trigger Function Definition (enforce_double_entry_balance)
-- ============================================================================

-- Get the exact trigger function definition
SELECT
  p.oid,
  p.proname,
  pg_get_functiondef(p.oid) AS full_definition,
  CASE 
    WHEN p.proname LIKE '%statement%' THEN '✅ Likely statement-level version (migration 185)'
    WHEN p.proname LIKE '%enforce_double_entry_balance%' THEN '⚠️ Could be row-level or statement-level (check definition)'
    ELSE 'Unknown'
  END AS version_indicator
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (p.proname LIKE '%double_entry_balance%' OR p.proname LIKE '%balance%')
ORDER BY p.oid DESC;

-- ============================================================================
-- SECTION 7: Verify Which post_journal_entry() is Called by post_sale_to_ledger()
-- ============================================================================

-- Check post_sale_to_ledger to see which post_journal_entry overload it calls
SELECT
  p.oid,
  p.proname,
  pg_get_functiondef(p.oid) AS full_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'post_sale_to_ledger'
ORDER BY p.oid DESC
LIMIT 1;

-- Extract the post_journal_entry call site from post_sale_to_ledger
DO $$
DECLARE
  func_def TEXT;
  call_site TEXT;
  param_count INT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO func_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'post_sale_to_ledger'
  ORDER BY p.oid DESC
  LIMIT 1;
  
  IF func_def IS NULL THEN
    RAISE NOTICE 'post_sale_to_ledger function not found';
    RETURN;
  END IF;
  
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'post_sale_to_ledger() CALLS post_journal_entry() WITH:';
  RAISE NOTICE '================================================================';
  
  -- Find the post_journal_entry call
  call_site := substring(func_def,
    position('SELECT post_journal_entry(' in func_def),
    500);
  
  IF call_site IS NOT NULL THEN
    RAISE NOTICE '%', call_site;
    
    -- Count parameters passed
    param_count := (length(call_site) - length(replace(call_site, ',', ''))) + 1;
    RAISE NOTICE '';
    RAISE NOTICE 'Parameter count in call: %', param_count;
    
    IF param_count = 14 THEN
      RAISE NOTICE 'Calls 14-parameter version (includes posted_by_accountant_id)';
    ELSIF param_count = 10 THEN
      RAISE NOTICE 'Calls 10-parameter version (wrapper)';
    ELSE
      RAISE NOTICE 'Calls unknown parameter count version';
    END IF;
  ELSE
    RAISE NOTICE 'post_journal_entry call not found in function definition';
  END IF;
END $$;

-- ============================================================================
-- SECTION 8: Summary - Migration Status Indicators
-- ============================================================================

SELECT 
  'post_journal_entry JSONB Extraction' AS check_item,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'post_journal_entry'
        AND p.pronargs = 14
        AND pg_get_functiondef(p.oid) LIKE '%(line->''debit'')::NUMERIC%'
        AND pg_get_functiondef(p.oid) LIKE '%(line->''credit'')::NUMERIC%'
    ) THEN '✅ Migration 184 APPLIED (safe JSONB extraction)'
    WHEN EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'post_journal_entry'
        AND p.pronargs = 14
        AND (pg_get_functiondef(p.oid) LIKE '%(line->>''debit'')::NUMERIC%'
             OR pg_get_functiondef(p.oid) LIKE '%(line->>''credit'')::NUMERIC%')
    ) THEN '❌ Migration 184 NOT APPLIED (unsafe text extraction)'
    ELSE '❓ Cannot determine'
  END AS status

UNION ALL

SELECT 
  'Balance Trigger Level' AS check_item,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM information_schema.triggers
      WHERE event_object_table = 'journal_entry_lines'
        AND trigger_name LIKE '%balance%'
        AND action_orientation = 'STATEMENT'
    ) THEN '✅ Migration 185 APPLIED (statement-level trigger)'
    WHEN EXISTS (
      SELECT 1 FROM information_schema.triggers
      WHERE event_object_table = 'journal_entry_lines'
        AND trigger_name LIKE '%balance%'
        AND action_orientation = 'ROW'
    ) THEN '❌ Migration 185 NOT APPLIED (row-level trigger)'
    ELSE '❓ Trigger not found'
  END AS status;

-- ============================================================================
-- SECTION 9: Extract Specific Code Patterns (for manual inspection)
-- ============================================================================

-- Extract the exact balance validation loop code
SELECT 
  'Balance Validation Loop' AS section,
  substring(
    pg_get_functiondef(p.oid),
    position('FOR line IN SELECT * FROM jsonb_array_elements(p_lines)' in pg_get_functiondef(p.oid)),
    300
  ) AS code_snippet
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'post_journal_entry'
  AND p.pronargs = 14
ORDER BY p.oid DESC
LIMIT 1;

-- Extract the exact INSERT loop code
SELECT 
  'INSERT Loop' AS section,
  substring(
    pg_get_functiondef(p.oid),
    position('INSERT INTO journal_entry_lines' in pg_get_functiondef(p.oid)),
    400
  ) AS code_snippet
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'post_journal_entry'
  AND p.pronargs = 14
ORDER BY p.oid DESC
LIMIT 1;
