-- ============================================================================
-- Quick Debug Check - See Most Recent Evidence
-- ============================================================================
-- Run this immediately after running the tests to see what was captured
-- ============================================================================

-- Most recent 3 entries (should show TEST A, B, C)
SELECT 
  id,
  created_at,
  sale_id,
  tax_shape,
  gross_total,
  net_total,
  total_tax_amount,
  line_count,
  debit_sum,
  credit_sum,
  credit_count,
  CASE 
    WHEN credit_sum = 0 THEN '❌ FAIL: credit_sum is 0'
    WHEN credit_sum IS NULL THEN '❌ FAIL: credit_sum is NULL'
    WHEN ABS(debit_sum - credit_sum) > 0.01 THEN '⚠️ IMBALANCED: debit=' || debit_sum::text || ', credit=' || credit_sum::text
    ELSE '✅ BALANCED'
  END as status
FROM public.retail_posting_debug_log
ORDER BY created_at DESC
LIMIT 3;

-- Per-line breakdown for most recent entry
SELECT 
  d.sale_id,
  d.tax_shape,
  d.gross_total,
  d.net_total,
  d.total_tax_amount,
  d.debit_sum,
  d.credit_sum,
  line_idx + 1 as line_number,
  line->>'account_id' as account_id,
  COALESCE((line->>'debit')::numeric, 0) as debit,
  COALESCE((line->>'credit')::numeric, 0) as credit,
  line->>'description' as description
FROM public.retail_posting_debug_log d,
     jsonb_array_elements(d.journal_lines) WITH ORDINALITY AS t(line, line_idx)
ORDER BY d.created_at DESC, line_idx
LIMIT 15;
