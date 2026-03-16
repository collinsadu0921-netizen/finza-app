-- ============================================================================
-- INSPECT PRESERVED SALE AND RE-RUN POSTING TO CAPTURE DIAGNOSTICS
-- ============================================================================
-- This script inspects the preserved test sale and re-runs post_sale_to_ledger
-- to capture all diagnostic output without deleting the sale

SET client_min_messages TO NOTICE;

DO $$
DECLARE
  preserved_sale_id UUID;
  sale_record RECORD;
  journal_entry_id UUID;
BEGIN
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'FINDING MOST RECENT TEST SALE AND RE-RUNNING POSTING';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  
  -- Find the most recent test sale
  SELECT id INTO preserved_sale_id
  FROM sales
  WHERE description LIKE '%ROOT CAUSE TEST%'
     OR description LIKE '%Diagnostic sale%'
  ORDER BY created_at DESC
  LIMIT 1;
  
  IF preserved_sale_id IS NULL THEN
    RAISE EXCEPTION 'No test sale found. Please run TEST_SALE_ROOT_CAUSE.sql first to create a test sale.';
  END IF;
  
  RAISE NOTICE 'Found test sale: %', preserved_sale_id;
  RAISE NOTICE '';
  
  -- Inspect the preserved sale
  SELECT * INTO sale_record
  FROM sales
  WHERE id = preserved_sale_id;
  
  IF sale_record.id IS NULL THEN
    RAISE EXCEPTION 'Sale not found: %', preserved_sale_id;
  END IF;
  
  RAISE NOTICE 'Sale Record:';
  RAISE NOTICE '  id: %', sale_record.id;
  RAISE NOTICE '  business_id: %', sale_record.business_id;
  RAISE NOTICE '  amount: %', sale_record.amount;
  RAISE NOTICE '  payment_method: %', sale_record.payment_method;
  RAISE NOTICE '  payment_status: %', sale_record.payment_status;
  RAISE NOTICE '  tax_lines: %', sale_record.tax_lines;
  RAISE NOTICE '  tax_engine_code: %', sale_record.tax_engine_code;
  RAISE NOTICE '  tax_jurisdiction: %', sale_record.tax_jurisdiction;
  RAISE NOTICE '';
  
  -- Show tax_lines structure
  IF sale_record.tax_lines IS NOT NULL THEN
    RAISE NOTICE 'Tax Lines Structure:';
    RAISE NOTICE '  tax_lines type: %', jsonb_typeof(sale_record.tax_lines);
    RAISE NOTICE '  tax_lines keys: %', (SELECT array_agg(key) FROM jsonb_object_keys(sale_record.tax_lines) key);
    IF sale_record.tax_lines ? 'tax_lines' THEN
      RAISE NOTICE '  tax_lines array length: %', jsonb_array_length(sale_record.tax_lines->'tax_lines');
      RAISE NOTICE '  tax_lines array: %', sale_record.tax_lines->'tax_lines';
    END IF;
    IF sale_record.tax_lines ? 'subtotal_excl_tax' THEN
      RAISE NOTICE '  subtotal_excl_tax: %', sale_record.tax_lines->>'subtotal_excl_tax';
    END IF;
    IF sale_record.tax_lines ? 'tax_total' THEN
      RAISE NOTICE '  tax_total: %', sale_record.tax_lines->>'tax_total';
    END IF;
    IF sale_record.tax_lines ? 'total_incl_tax' THEN
      RAISE NOTICE '  total_incl_tax: %', sale_record.tax_lines->>'total_incl_tax';
    END IF;
  ELSE
    RAISE NOTICE 'WARNING: tax_lines is NULL!';
  END IF;
  RAISE NOTICE '';
  
  -- Re-run post_sale_to_ledger to capture diagnostics
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'RE-RUNNING post_sale_to_ledger() - DIAGNOSTIC OUTPUT FOLLOWS:';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'SCROLL DOWN AFTER THIS RUN TO SEE ALL "EVIDENCE" LINES';
  RAISE NOTICE '';
  
  BEGIN
    SELECT post_sale_to_ledger(
      preserved_sale_id,
      NULL,  -- p_entry_type
      NULL,  -- p_backfill_reason
      NULL,  -- p_backfill_actor
      NULL   -- p_posted_by_accountant_id
    ) INTO journal_entry_id;
    
    RAISE NOTICE '';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'SUCCESS: Journal entry created: %', journal_entry_id;
    RAISE NOTICE '============================================================================';
    
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE '';
      RAISE NOTICE '============================================================================';
      RAISE NOTICE 'ERROR DETAILS:';
      RAISE NOTICE '  SQLSTATE: %', SQLSTATE;
      RAISE NOTICE '  SQLERRM: %', SQLERRM;
      RAISE NOTICE '============================================================================';
      RAISE NOTICE '';
      RAISE NOTICE 'IMPORTANT: SCROLL UP to see all diagnostic output!';
      RAISE NOTICE 'Look for lines prefixed with "EVIDENCE" that show:';
      RAISE NOTICE '  - gross_total, net_total, tax_total, cogs values';
      RAISE NOTICE '  - tax_lines_jsonb content';
      RAISE NOTICE '  - journal_lines JSONB (the full payload passed to post_journal_entry)';
      RAISE NOTICE '  - Per-line details showing account_id, debit, credit for each line';
      RAISE NOTICE '  - Summary showing debit_sum, credit_sum, line_count';
      RAISE NOTICE '';
      RAISE NOTICE 'The key question: Does journal_lines contain credit values > 0?';
      RAISE NOTICE 'If credit_sum = 0 in the diagnostics, that is the root cause.';
      RAISE NOTICE '';
      
      -- Don't re-raise - just log the error
      -- RAISE;
  END;
  
  RAISE NOTICE '';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'INSPECTION COMPLETE';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'Sale preserved: %', preserved_sale_id;
  
END $$;
