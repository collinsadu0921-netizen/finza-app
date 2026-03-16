-- ============================================================================
-- Analyze Debug Evidence - Root Cause Investigation
-- ============================================================================
-- Run this AFTER applying migration 181 and running the tests
-- This will show exactly why credit_sum is 0
-- ============================================================================

-- Check if debug table exists and has data
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'retail_posting_debug_log')
    THEN 'Table exists'
    ELSE 'Table does NOT exist - apply migration 181 first'
  END as table_status,
  COUNT(*) as total_entries
FROM public.retail_posting_debug_log;

-- Most recent failing entries (credit_sum = 0)
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
    ELSE '✅ OK'
  END as status
FROM public.retail_posting_debug_log
WHERE credit_sum = 0 OR credit_sum IS NULL
ORDER BY created_at DESC
LIMIT 10;

-- Detailed per-line breakdown for failing entries
-- This shows which lines have credit values and which don't
SELECT 
  d.id,
  d.sale_id,
  d.tax_shape,
  d.gross_total,
  d.net_total,
  d.total_tax_amount,
  d.credit_sum,
  line_idx + 1 as line_number,
  line->>'account_id' as account_id,
  COALESCE((line->>'debit')::numeric, 0) as debit,
  COALESCE((line->>'credit')::numeric, 0) as credit,
  line->>'description' as description,
  CASE 
    WHEN (line->>'account_id')::uuid IN (
      SELECT id FROM accounts WHERE code = '4000' LIMIT 1
    ) THEN 'REVENUE ACCOUNT'
    WHEN (line->>'account_id')::uuid IN (
      SELECT id FROM accounts WHERE code = '2100' LIMIT 1
    ) THEN 'TAX ACCOUNT'
    ELSE 'OTHER'
  END as account_type
FROM public.retail_posting_debug_log d,
     jsonb_array_elements(d.journal_lines) WITH ORDINALITY AS t(line, line_idx)
WHERE d.credit_sum = 0 OR d.credit_sum IS NULL
ORDER BY d.created_at DESC, line_idx
LIMIT 30;

-- Key insight: Compare net_total vs what revenue credit should be
SELECT 
  sale_id,
  tax_shape,
  gross_total,
  net_total,
  total_tax_amount,
  gross_total - total_tax_amount as expected_revenue_credit,
  net_total as actual_net_total,
  CASE 
    WHEN net_total = 0 THEN '❌ net_total is 0 (should be ' || (gross_total - total_tax_amount)::text || ')'
    WHEN net_total IS NULL THEN '❌ net_total is NULL (should be ' || (gross_total - total_tax_amount)::text || ')'
    WHEN net_total != (gross_total - total_tax_amount) THEN '⚠️ net_total mismatch: expected ' || (gross_total - total_tax_amount)::text || ', got ' || net_total::text
    ELSE '✅ net_total matches expected'
  END as net_total_analysis,
  credit_sum,
  journal_lines
FROM public.retail_posting_debug_log
WHERE credit_sum = 0 OR credit_sum IS NULL
ORDER BY created_at DESC
LIMIT 5;

-- Summary by tax_shape (proves the pattern)
SELECT 
  tax_shape,
  COUNT(*) as total_count,
  COUNT(*) FILTER (WHERE credit_sum = 0 OR credit_sum IS NULL) as credit_zero_count,
  COUNT(*) FILTER (WHERE credit_sum > 0) as credit_positive_count,
  ROUND(AVG(credit_sum), 2) as avg_credit_sum,
  ROUND(AVG(net_total), 2) as avg_net_total,
  ROUND(AVG(total_tax_amount), 2) as avg_total_tax_amount,
  ROUND(AVG(gross_total - total_tax_amount), 2) as avg_expected_revenue_credit
FROM public.retail_posting_debug_log
GROUP BY tax_shape
ORDER BY tax_shape;
