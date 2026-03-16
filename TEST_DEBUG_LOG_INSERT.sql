-- ============================================================================
-- Test Debug Log INSERT Directly
-- ============================================================================
-- This tests if the INSERT statement works when called directly
-- ============================================================================

-- Test INSERT with sample data
BEGIN;
  INSERT INTO public.retail_posting_debug_log (
    sale_id,
    business_id,
    gross_total,
    net_total,
    total_tax_amount,
    total_cogs,
    tax_lines_jsonb,
    journal_lines,
    line_count,
    debit_sum,
    credit_sum,
    credit_count,
    tax_shape,
    note
  ) VALUES (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    100.00,
    83.34,
    16.66,
    0.00,
    '{"test": "data"}'::jsonb,
    '[{"test": "line"}]'::jsonb,
    1,
    100.00,
    83.34,
    1,
    'object',
    'Manual test insert'
  );
  
  SELECT '✅ INSERT succeeded' as result;
ROLLBACK;

-- Check table structure
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'retail_posting_debug_log'
ORDER BY ordinal_position;
