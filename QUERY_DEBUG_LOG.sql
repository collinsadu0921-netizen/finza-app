-- ============================================================================
-- Query Retail Posting Debug Log
-- ============================================================================
-- This script queries the retail_posting_debug_log table to see evidence
-- captured before post_journal_entry() calls.
-- 
-- Use this to inspect why credit=0 in TEST A/B
-- ============================================================================

-- Query most recent debug log entries
SELECT 
  id,
  created_at,
  sale_id,
  tax_shape,
  gross_total,
  net_total,
  total_tax_amount,
  total_cogs,
  line_count,
  debit_sum,
  credit_sum,
  credit_count,
  CASE 
    WHEN credit_sum = 0 THEN '❌ FAIL: credit_sum is 0'
    WHEN credit_sum IS NULL THEN '❌ FAIL: credit_sum is NULL'
    ELSE '✅ OK: credit_sum > 0'
  END as credit_status,
  note
FROM public.retail_posting_debug_log
ORDER BY created_at DESC
LIMIT 10;

-- Query with full journal_lines for detailed inspection
SELECT 
  sale_id,
  tax_shape,
  gross_total,
  net_total,
  total_tax_amount,
  debit_sum,
  credit_sum,
  credit_count,
  journal_lines,
  tax_lines_jsonb
FROM public.retail_posting_debug_log
WHERE credit_sum = 0 OR credit_sum IS NULL
ORDER BY created_at DESC
LIMIT 5;

-- Query per-line breakdown for a specific sale
-- Replace 'YOUR_SALE_ID_HERE' with actual sale_id from test
SELECT 
  sale_id,
  line_idx + 1 as line_number,
  line->>'account_id' as account_id,
  COALESCE((line->>'debit')::numeric, 0) as debit,
  COALESCE((line->>'credit')::numeric, 0) as credit,
  line->>'description' as description
FROM public.retail_posting_debug_log,
     jsonb_array_elements(journal_lines) WITH ORDINALITY AS t(line, line_idx)
WHERE sale_id = 'YOUR_SALE_ID_HERE'  -- Replace with actual sale_id
ORDER BY created_at DESC, line_idx
LIMIT 20;

-- Summary by tax_shape (proves pattern: object/array → credit=0, null → credit>0)
SELECT 
  tax_shape,
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE credit_sum = 0 OR credit_sum IS NULL) as credit_zero_count,
  COUNT(*) FILTER (WHERE credit_sum > 0) as credit_positive_count,
  ROUND(AVG(credit_sum), 2) as avg_credit_sum,
  ROUND(AVG(debit_sum), 2) as avg_debit_sum
FROM public.retail_posting_debug_log
GROUP BY tax_shape
ORDER BY tax_shape;
