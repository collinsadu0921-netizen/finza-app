-- ============================================================================
-- TEST: What if net_total is NULL?
-- ============================================================================
-- This tests what happens if net_total is NULL when building journal_lines

DO $$
DECLARE
  test_sale_id UUID;
  sale_record RECORD;
  gross_total NUMERIC;
  net_total NUMERIC;  -- Starts as NULL!
  total_tax_amount NUMERIC := 0;
  tax_lines_jsonb JSONB;
  revenue_account_id UUID;
  journal_lines JSONB;
  test_business_id UUID := '69278e9a-8694-4640-88d1-cbcfe7dd42f3';
BEGIN
  -- Get test sale
  SELECT * INTO sale_record
  FROM sales
  WHERE description LIKE '%ROOT CAUSE TEST%'
  ORDER BY created_at DESC
  LIMIT 1;
  
  IF sale_record.id IS NULL THEN
    RAISE EXCEPTION 'No test sale found';
  END IF;
  
  test_sale_id := sale_record.id;
  gross_total := COALESCE(sale_record.amount, 0);
  gross_total := ROUND(gross_total, 2);
  tax_lines_jsonb := sale_record.tax_lines;
  
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'TESTING: What if net_total extraction fails?';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'Initial: gross_total = %, net_total = % (NULL), tax_lines_jsonb = %', 
    gross_total, net_total, tax_lines_jsonb;
  
  -- Simulate what happens if extraction logic doesn't set net_total
  -- (e.g., if there's an exception or edge case)
  -- For this test, let's intentionally leave net_total as NULL
  
  -- Line 373: net_total := ROUND(COALESCE(net_total, gross_total), 2)
  net_total := ROUND(COALESCE(net_total, gross_total), 2);
  RAISE NOTICE 'After line 373: net_total = %', net_total;
  
  -- Line 387: net_total := COALESCE(net_total, 0)  <-- THIS IS THE BUG!
  -- If net_total is somehow NULL here, it becomes 0
  net_total := COALESCE(net_total, 0);
  RAISE NOTICE 'After line 387: net_total = %', net_total;
  
  -- Line 441: IF net_total <= 0 THEN...
  -- If net_total is NULL, this evaluates to NULL (not TRUE), so validation passes!
  IF net_total <= 0 THEN
    RAISE NOTICE 'Validation at line 441: net_total <= 0 is TRUE, would raise exception';
  ELSE
    RAISE NOTICE 'Validation at line 441: net_total <= 0 is FALSE or NULL, validation passes';
  END IF;
  
  -- Get revenue account ID
  revenue_account_id := get_account_by_code(test_business_id, '4000');
  
  -- Build journal_lines (line 575)
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', get_account_by_control_key(test_business_id, 'CASH'),
      'debit', ROUND(COALESCE(gross_total, 0), 2),
      'description', 'Sale receipt'
    ),
    jsonb_build_object(
      'account_id', revenue_account_id,
      'credit', ROUND(COALESCE(net_total, 0), 2),  -- If net_total is 0, credit is 0!
      'description', 'Sales revenue'
    )
  );
  
  RAISE NOTICE '';
  RAISE NOTICE 'journal_lines = %', journal_lines;
  RAISE NOTICE '';
  RAISE NOTICE 'Calculated totals:';
  RAISE NOTICE '  debit = %', (SELECT SUM(COALESCE((line->>'debit')::NUMERIC, 0)) FROM jsonb_array_elements(journal_lines) as line);
  RAISE NOTICE '  credit = %', (SELECT SUM(COALESCE((line->>'credit')::NUMERIC, 0)) FROM jsonb_array_elements(journal_lines) as line);
  
  IF (SELECT SUM(COALESCE((line->>'credit')::NUMERIC, 0)) FROM jsonb_array_elements(journal_lines) as line) = 0 THEN
    RAISE NOTICE '';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'ROOT CAUSE FOUND: Credits are 0 because net_total is 0!';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'The issue is that net_total becomes 0 at line 387 if it is NULL.';
    RAISE NOTICE 'The validation at line 441 does not catch NULL values (NULL <= 0 is NULL, not TRUE).';
    RAISE NOTICE '';
    RAISE NOTICE 'FIX: Change line 387 from:';
    RAISE NOTICE '  net_total := COALESCE(net_total, 0);';
    RAISE NOTICE 'To:';
    RAISE NOTICE '  net_total := COALESCE(net_total, gross_total);';
    RAISE NOTICE '';
    RAISE NOTICE 'Or better yet, ensure net_total is never NULL by fixing the extraction logic.';
  END IF;
  
END $$;
