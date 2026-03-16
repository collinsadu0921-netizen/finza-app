-- ============================================================================
-- FIND JOURNAL ENTRY FOR TEST SALE (check all reference_types)
-- ============================================================================

-- First, get the test sale ID
WITH test_sale AS (
  SELECT id, amount, created_at
  FROM sales
  WHERE description LIKE '%ROOT CAUSE TEST%'
  ORDER BY created_at DESC
  LIMIT 1
)
-- Check for journal entries with ANY reference_type for this sale
SELECT 
  'JOURNAL ENTRIES FOR TEST SALE' as check_item,
  je.id as journal_entry_id,
  je.date,
  je.description,
  je.reference_type,
  je.reference_id as sale_id,
  je.created_at,
  (SELECT COUNT(*) FROM journal_entry_lines jel WHERE jel.journal_entry_id = je.id) as line_count,
  (SELECT COALESCE(SUM(debit), 0) FROM journal_entry_lines jel WHERE jel.journal_entry_id = je.id) as total_debits,
  (SELECT COALESCE(SUM(credit), 0) FROM journal_entry_lines jel WHERE jel.journal_entry_id = je.id) as total_credits
FROM journal_entries je
CROSS JOIN test_sale ts
WHERE je.reference_id = ts.id
ORDER BY je.created_at DESC;

-- Also check the test sale itself
SELECT 
  'TEST SALE INFO' as check_item,
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

-- Check if there are ANY journal entries created around the same time as the test sale
WITH test_sale AS (
  SELECT id, created_at
  FROM sales
  WHERE description LIKE '%ROOT CAUSE TEST%'
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT 
  'JOURNAL ENTRIES CREATED WITHIN 5 MINUTES OF TEST SALE' as check_item,
  je.id as journal_entry_id,
  je.date,
  je.description,
  je.reference_type,
  je.reference_id,
  je.created_at,
  ABS(EXTRACT(EPOCH FROM (je.created_at - ts.created_at))) as seconds_after_sale,
  (SELECT COUNT(*) FROM journal_entry_lines jel WHERE jel.journal_entry_id = je.id) as line_count
FROM journal_entries je
CROSS JOIN test_sale ts
WHERE je.created_at BETWEEN ts.created_at - INTERVAL '5 minutes' AND ts.created_at + INTERVAL '5 minutes'
ORDER BY je.created_at DESC;
