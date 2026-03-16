-- ============================================================================
-- SIMULATE FUNCTION LOGIC
-- ============================================================================
-- This simulates the exact logic from post_sale_to_ledger to see where net_total becomes 0

DO $$
DECLARE
  test_sale_id UUID;
  sale_record RECORD;
  business_id_val UUID;
  gross_total NUMERIC;
  net_total NUMERIC;  -- Starts as NULL!
  total_tax_amount NUMERIC := 0;
  tax_lines_jsonb JSONB;
  revenue_account_id UUID;
  journal_lines JSONB;
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
  business_id_val := sale_record.business_id;
  gross_total := COALESCE(sale_record.amount, 0);
  gross_total := ROUND(gross_total, 2);
  tax_lines_jsonb := sale_record.tax_lines;
  
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'SIMULATING FUNCTION LOGIC';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'Initial: gross_total = %, net_total = % (NULL), tax_lines_jsonb = %', 
    gross_total, net_total, tax_lines_jsonb;
  
  -- Simulate extraction logic (lines 302-368)
  IF tax_lines_jsonb IS NOT NULL AND jsonb_typeof(tax_lines_jsonb) = 'object' THEN
    IF tax_lines_jsonb ? 'subtotal_excl_tax' THEN
      BEGIN
        net_total := (tax_lines_jsonb->>'subtotal_excl_tax')::numeric;
        RAISE NOTICE 'Extracted subtotal_excl_tax: %', net_total;
        IF net_total IS NULL OR net_total < 0 THEN
          RAISE NOTICE '  net_total is NULL or < 0, recalculating...';
          IF tax_lines_jsonb ? 'tax_total' THEN
            BEGIN
              total_tax_amount := (tax_lines_jsonb->>'tax_total')::numeric;
              IF total_tax_amount IS NULL OR total_tax_amount < 0 THEN
                total_tax_amount := 0;
              END IF;
            EXCEPTION
              WHEN OTHERS THEN
                total_tax_amount := 0;
            END;
            net_total := gross_total - total_tax_amount;
            RAISE NOTICE '  Recalculated: net_total = %, total_tax_amount = %', net_total, total_tax_amount;
          ELSE
            net_total := gross_total;
            total_tax_amount := 0;
            RAISE NOTICE '  No tax_total, set net_total = gross_total = %', net_total;
          END IF;
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE NOTICE 'EXCEPTION in extraction: %', SQLERRM;
          net_total := gross_total;
          total_tax_amount := 0;
      END;
    ELSE
      RAISE NOTICE 'No subtotal_excl_tax key, trying tax_total...';
      IF tax_lines_jsonb ? 'tax_total' THEN
        BEGIN
          total_tax_amount := (tax_lines_jsonb->>'tax_total')::numeric;
          IF total_tax_amount IS NULL OR total_tax_amount < 0 THEN
            total_tax_amount := 0;
          END IF;
        EXCEPTION
          WHEN OTHERS THEN
            total_tax_amount := 0;
        END;
        net_total := gross_total - total_tax_amount;
        RAISE NOTICE 'Calculated from tax_total: net_total = %, total_tax_amount = %', net_total, total_tax_amount;
      ELSE
        net_total := gross_total;
        total_tax_amount := 0;
        RAISE NOTICE 'No tax data, set net_total = gross_total = %', net_total;
      END IF;
    END IF;
  ELSE
    net_total := gross_total;
    total_tax_amount := 0;
    RAISE NOTICE 'tax_lines_jsonb is NULL or not object, set net_total = gross_total = %', net_total;
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'After extraction: net_total = %, total_tax_amount = %', net_total, total_tax_amount;
  
  -- Simulate line 373
  net_total := ROUND(COALESCE(net_total, gross_total), 2);
  total_tax_amount := ROUND(COALESCE(total_tax_amount, 0), 2);
  RAISE NOTICE 'After line 373: net_total = %, total_tax_amount = %', net_total, total_tax_amount;
  
  -- Simulate line 379-382 (rebalance)
  IF ABS(gross_total - (net_total + total_tax_amount)) > 0.01 THEN
    net_total := gross_total - total_tax_amount;
    net_total := ROUND(net_total, 2);
    RAISE NOTICE 'After rebalance: net_total = %', net_total;
  END IF;
  
  -- Simulate line 387 (THE PROBLEM!)
  gross_total := COALESCE(gross_total, 0);
  net_total := COALESCE(net_total, 0);  -- If net_total is NULL here, it becomes 0!
  total_tax_amount := COALESCE(total_tax_amount, 0);
  RAISE NOTICE 'After line 387: net_total = %, gross_total = %, total_tax_amount = %', 
    net_total, gross_total, total_tax_amount;
  
  -- Get revenue account ID
  revenue_account_id := get_account_by_code(business_id_val, '4000');
  RAISE NOTICE 'revenue_account_id = %', revenue_account_id;
  
  -- Build journal_lines (line 575)
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', get_account_by_control_key(business_id_val, 'CASH'),
      'debit', ROUND(COALESCE(gross_total, 0), 2),
      'description', 'Sale receipt'
    ),
    jsonb_build_object(
      'account_id', revenue_account_id,
      'credit', ROUND(COALESCE(net_total, 0), 2),  -- THIS IS WHERE THE PROBLEM IS!
      'description', 'Sales revenue'
    )
  );
  
  RAISE NOTICE '';
  RAISE NOTICE 'journal_lines = %', journal_lines;
  RAISE NOTICE '';
  RAISE NOTICE 'Calculated totals:';
  RAISE NOTICE '  debit = %', (SELECT SUM(COALESCE((line->>'debit')::NUMERIC, 0)) FROM jsonb_array_elements(journal_lines) as line);
  RAISE NOTICE '  credit = %', (SELECT SUM(COALESCE((line->>'credit')::NUMERIC, 0)) FROM jsonb_array_elements(journal_lines) as line);
  
  IF net_total = 0 THEN
    RAISE NOTICE '';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'ERROR: net_total is 0! This explains why credits are 0.';
    RAISE NOTICE '============================================================================';
  END IF;
  
END $$;
