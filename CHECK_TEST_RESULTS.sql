-- ============================================================================
-- CHECK TEST RESULTS: Inspect what happened with the test sale
-- ============================================================================
-- This script queries the database to see:
-- 1. The test sale that was created
-- 2. Any journal entries created for it
-- 3. The journal entry lines and their balance
-- ============================================================================

-- Find the most recent test sale
SELECT 
  '=== TEST SALE ===' as section,
  id as sale_id,
  amount,
  payment_method,
  payment_status,
  description,
  tax_lines,
  created_at
FROM sales
WHERE description LIKE '%ROOT CAUSE TEST%'
ORDER BY created_at DESC
LIMIT 1;

-- Find journal entries for the test sale
SELECT 
  '=== JOURNAL ENTRIES ===' as section,
  je.id as journal_entry_id,
  je.date,
  je.description,
  je.reference_id as sale_id,
  je.created_at
FROM journal_entries je
WHERE je.reference_type = 'sale'
  AND je.reference_id IN (
    SELECT id FROM sales 
    WHERE description LIKE '%ROOT CAUSE TEST%'
    ORDER BY created_at DESC
    LIMIT 1
  )
ORDER BY je.created_at DESC;

-- Check journal entry lines and balance
WITH latest_sale AS (
  SELECT id FROM sales 
  WHERE description LIKE '%ROOT CAUSE TEST%'
  ORDER BY created_at DESC
  LIMIT 1
),
latest_journal_entry AS (
  SELECT je.id
  FROM journal_entries je
  WHERE je.reference_type = 'sale'
    AND je.reference_id = (SELECT id FROM latest_sale)
  ORDER BY je.created_at DESC
  LIMIT 1
)
SELECT 
  '=== JOURNAL ENTRY LINES ===' as section,
  jel.id as line_id,
  jel.account_id,
  coa.account_code,
  coa.account_name,
  jel.debit,
  jel.credit,
  jel.description,
  CASE 
    WHEN jel.debit > 0 THEN 'DEBIT'
    WHEN jel.credit > 0 THEN 'CREDIT'
    ELSE 'ZERO'
  END as line_type
FROM journal_entry_lines jel
LEFT JOIN chart_of_accounts coa ON coa.id = jel.account_id
WHERE jel.journal_entry_id = (SELECT id FROM latest_journal_entry)
ORDER BY jel.debit DESC NULLS LAST, jel.credit DESC NULLS LAST;

-- Summary: Check if journal entry balances
WITH latest_sale AS (
  SELECT id FROM sales 
  WHERE description LIKE '%ROOT CAUSE TEST%'
  ORDER BY created_at DESC
  LIMIT 1
),
latest_journal_entry AS (
  SELECT je.id
  FROM journal_entries je
  WHERE je.reference_type = 'sale'
    AND je.reference_id = (SELECT id FROM latest_sale)
  ORDER BY je.created_at DESC
  LIMIT 1
)
SELECT 
  '=== BALANCE SUMMARY ===' as section,
  COUNT(*) as total_lines,
  COUNT(CASE WHEN debit > 0 THEN 1 END) as debit_lines,
  COUNT(CASE WHEN credit > 0 THEN 1 END) as credit_lines,
  COALESCE(SUM(debit), 0) as total_debits,
  COALESCE(SUM(credit), 0) as total_credits,
  ABS(COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0)) as balance_difference,
  CASE 
    WHEN ABS(COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0)) <= 0.01 THEN 'BALANCED'
    ELSE 'UNBALANCED'
  END as status
FROM journal_entry_lines
WHERE journal_entry_id = (SELECT id FROM latest_journal_entry);
