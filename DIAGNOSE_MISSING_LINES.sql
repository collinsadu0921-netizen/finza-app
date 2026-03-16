-- ============================================================================
-- DIAGNOSE MISSING JOURNAL ENTRY LINES
-- ============================================================================
-- This script checks what actually happened with the test sale and journal entry
-- ============================================================================

-- 1. Check if test sale exists
SELECT 
  '1. TEST SALE' as check_item,
  CASE 
    WHEN COUNT(*) > 0 THEN 'FOUND'
    ELSE 'NOT FOUND'
  END as status,
  COUNT(*) as count,
  STRING_AGG(id::TEXT, ', ') as sale_ids
FROM sales
WHERE description LIKE '%ROOT CAUSE TEST%';

-- 2. Show the actual test sale details
SELECT 
  '2. TEST SALE DETAILS' as check_item,
  id as sale_id,
  amount,
  payment_method,
  payment_status,
  tax_lines,
  created_at
FROM sales
WHERE description LIKE '%ROOT CAUSE TEST%'
ORDER BY created_at DESC
LIMIT 1;

-- 3. Check if ANY journal entries exist for test sales
SELECT 
  '3. JOURNAL ENTRIES FOR TEST SALES' as check_item,
  COUNT(*) as count,
  STRING_AGG(je.id::TEXT, ', ') as journal_entry_ids
FROM journal_entries je
WHERE je.reference_type = 'sale'
  AND je.reference_id IN (
    SELECT id FROM sales 
    WHERE description LIKE '%ROOT CAUSE TEST%'
  );

-- 4. Show all journal entries for test sales with details
SELECT 
  '4. JOURNAL ENTRY DETAILS' as check_item,
  je.id as journal_entry_id,
  je.date,
  je.description,
  je.reference_id as sale_id,
  je.reference_type,
  je.created_at,
  (SELECT COUNT(*) FROM journal_entry_lines jel WHERE jel.journal_entry_id = je.id) as line_count
FROM journal_entries je
WHERE je.reference_type = 'sale'
  AND je.reference_id IN (
    SELECT id FROM sales 
    WHERE description LIKE '%ROOT CAUSE TEST%'
  )
ORDER BY je.created_at DESC;

-- 5. Check ALL journal entries (not just for test sales) to see if any exist
SELECT 
  '5. ALL RECENT JOURNAL ENTRIES' as check_item,
  je.id as journal_entry_id,
  je.date,
  je.description,
  je.reference_type,
  je.reference_id,
  je.created_at,
  (SELECT COUNT(*) FROM journal_entry_lines jel WHERE jel.journal_entry_id = je.id) as line_count
FROM journal_entries je
ORDER BY je.created_at DESC
LIMIT 5;

-- 6. Check if post_sale_to_ledger actually ran (look for any recent journal entries)
SELECT 
  '6. RECENT JOURNAL ENTRIES (last 24 hours)' as check_item,
  je.id as journal_entry_id,
  je.date,
  je.description,
  je.reference_type,
  je.reference_id,
  je.created_at,
  (SELECT COUNT(*) FROM journal_entry_lines jel WHERE jel.journal_entry_id = je.id) as line_count,
  (SELECT COALESCE(SUM(debit), 0) FROM journal_entry_lines jel WHERE jel.journal_entry_id = je.id) as total_debits,
  (SELECT COALESCE(SUM(credit), 0) FROM journal_entry_lines jel WHERE jel.journal_entry_id = je.id) as total_credits
FROM journal_entries je
WHERE je.created_at >= NOW() - INTERVAL '24 hours'
ORDER BY je.created_at DESC;
