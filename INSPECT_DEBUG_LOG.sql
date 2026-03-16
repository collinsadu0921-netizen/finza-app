-- ============================================================================
-- Inspect Debug Log for Failing Tests
-- ============================================================================
-- This queries the retail_posting_debug_log to see what journal_lines
-- were actually passed to post_journal_entry() for failing tests
-- ============================================================================

-- Most recent entries with credit_sum = 0 (failing cases)
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
  journal_lines,
  tax_lines_jsonb
FROM public.retail_posting_debug_log
WHERE credit_sum = 0 OR credit_sum IS NULL
ORDER BY created_at DESC
LIMIT 5;

-- Per-line breakdown for the most recent failing entry
SELECT 
  d.sale_id,
  d.tax_shape,
  d.gross_total,
  d.net_total,
  d.total_tax_amount,
  line_idx + 1 as line_number,
  line->>'account_id' as account_id,
  COALESCE((line->>'debit')::numeric, 0) as debit,
  COALESCE((line->>'credit')::numeric, 0) as credit,
  line->>'description' as description
FROM public.retail_posting_debug_log d,
     jsonb_array_elements(d.journal_lines) WITH ORDINALITY AS t(line, line_idx)
WHERE d.credit_sum = 0 OR d.credit_sum IS NULL
ORDER BY d.created_at DESC, line_idx
LIMIT 20;

-- Summary by tax_shape (proves the pattern)
SELECT 
  tax_shape,
  COUNT(*) as total_count,
  COUNT(*) FILTER (WHERE credit_sum = 0 OR credit_sum IS NULL) as credit_zero_count,
  COUNT(*) FILTER (WHERE credit_sum > 0) as credit_positive_count,
  ROUND(AVG(credit_sum), 2) as avg_credit_sum,
  ROUND(AVG(debit_sum), 2) as avg_debit_sum,
  ROUND(AVG(net_total), 2) as avg_net_total,
  ROUND(AVG(total_tax_amount), 2) as avg_total_tax_amount
FROM public.retail_posting_debug_log
GROUP BY tax_shape
ORDER BY tax_shape;
