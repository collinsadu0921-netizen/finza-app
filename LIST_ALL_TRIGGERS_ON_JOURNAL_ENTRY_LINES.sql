-- ============================================================================
-- STEP 2: Enumerate ALL Triggers on journal_entry_lines
-- ============================================================================
-- This query lists all triggers (internal and external) on journal_entry_lines table
-- ============================================================================

SELECT
  tgname AS trigger_name,
  tgtype,
  CASE 
    WHEN tgtype & 2 = 2 THEN 'BEFORE'
    WHEN tgtype & 64 = 64 THEN 'INSTEAD OF'
    ELSE 'AFTER'
  END AS timing,
  CASE
    WHEN tgtype & 4 = 4 THEN 'INSERT'
    WHEN tgtype & 8 = 8 THEN 'DELETE'
    WHEN tgtype & 16 = 16 THEN 'UPDATE'
    WHEN tgtype & 4 + 8 = 12 THEN 'INSERT OR DELETE'
    WHEN tgtype & 4 + 16 = 20 THEN 'INSERT OR UPDATE'
    WHEN tgtype & 8 + 16 = 24 THEN 'DELETE OR UPDATE'
    WHEN tgtype & 4 + 8 + 16 = 28 THEN 'INSERT OR DELETE OR UPDATE'
  END AS events,
  CASE
    WHEN tgtype & 1 = 1 THEN 'ROW'
    ELSE 'STATEMENT'
  END AS level,
  CASE
    WHEN tgisinternal THEN 'INTERNAL'
    ELSE 'EXTERNAL'
  END AS trigger_type,
  pg_get_triggerdef(oid) AS trigger_definition
FROM pg_trigger
WHERE tgrelid = 'journal_entry_lines'::regclass
ORDER BY 
  CASE WHEN tgisinternal THEN 1 ELSE 0 END,  -- Internal triggers first
  tgname;
