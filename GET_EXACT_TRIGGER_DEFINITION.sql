-- ============================================================================
-- STEP 2: LOCATE THE LEGACY BLOCK PRECISELY
-- ============================================================================
-- Get the exact trigger definition currently active in the database
-- ============================================================================

-- Query 1: Get all triggers on journal_entry_lines with their definitions
SELECT
  t.tgname AS trigger_name,
  pg_get_triggerdef(t.oid) AS trigger_definition,
  p.proname AS function_name,
  n.nspname AS schema_name,
  CASE 
    WHEN t.tgtype & 2 = 2 THEN 'BEFORE'
    WHEN t.tgtype & 64 = 64 THEN 'INSTEAD OF'
    ELSE 'AFTER'
  END AS timing,
  CASE
    WHEN t.tgtype & 4 = 4 THEN 'INSERT'
    WHEN t.tgtype & 8 = 8 THEN 'DELETE'
    WHEN t.tgtype & 16 = 16 THEN 'UPDATE'
    WHEN t.tgtype & 4 + 8 = 12 THEN 'INSERT OR DELETE'
    WHEN t.tgtype & 4 + 16 = 20 THEN 'INSERT OR UPDATE'
    WHEN t.tgtype & 8 + 16 = 24 THEN 'DELETE OR UPDATE'
    WHEN t.tgtype & 4 + 8 + 16 = 28 THEN 'INSERT OR DELETE OR UPDATE'
  END AS events,
  CASE
    WHEN t.tgtype & 1 = 1 THEN 'ROW'
    ELSE 'STATEMENT'
  END AS level
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE t.tgrelid = 'public.journal_entry_lines'::regclass
  AND NOT t.tgisinternal
ORDER BY t.tgname;

-- Query 2: Get the exact function definition for enforce_double_entry_balance
SELECT pg_get_functiondef('public.enforce_double_entry_balance()'::regprocedure) AS function_definition;

-- Query 3: Get function source code directly
SELECT
  p.proname AS function_name,
  n.nspname AS schema_name,
  p.prosrc AS function_source_code,
  pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'enforce_double_entry_balance'
  AND n.nspname = 'public';
