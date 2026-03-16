-- Check debug log for recent test runs
SELECT 
  sale_id,
  tax_shape,
  gross_total,
  net_total,
  total_tax_amount,
  debit_sum,
  credit_sum,
  credit_count,
  journal_lines
FROM public.retail_posting_debug_log
ORDER BY created_at DESC
LIMIT 3;
