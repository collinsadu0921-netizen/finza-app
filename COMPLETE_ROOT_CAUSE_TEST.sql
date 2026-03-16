-- ============================================================================
-- COMPLETE ROOT CAUSE TEST: Retail Ledger Posting Credit=0 Investigation
-- ============================================================================
-- This script:
-- 1. Creates a test sale with proper tax_lines structure
-- 2. Calls post_sale_to_ledger to trigger diagnostics
-- 3. Captures ALL diagnostic output (EVIDENCE lines)
-- 4. Preserves the test sale for inspection
-- 5. Shows clear summary of findings
--
-- PREREQUISITES:
-- - Enable client_min_messages = 'NOTICE' to see diagnostic output
-- - Accounts must exist: 1000 (Cash), 4000 (Revenue), 2100 (VAT Payable)
-- ============================================================================

SET client_min_messages TO NOTICE;

DO $$
DECLARE
  -- Test configuration
  test_business_id UUID := '69278e9a-8694-4640-88d1-cbcfe7dd42f3';
  test_user_id UUID := 'b19cd6f1-6ca6-491d-9b51-8bed0da2d1d4';
  test_store_id UUID;
  test_register_id UUID;
  
  -- Test sale data
  test_sale_id UUID;
  test_amount NUMERIC := 100.00;
  test_subtotal_excl_tax NUMERIC := 83.34;
  test_tax_total NUMERIC := 16.66;
  test_tax_lines JSONB;
  
  -- Results
  journal_entry_id UUID;
  sale_record RECORD;
  
  -- Diagnostic summary
  diagnostic_summary TEXT := '';
BEGIN
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'COMPLETE ROOT CAUSE TEST: Retail Ledger Posting';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  
  -- ============================================================================
  -- STEP 1: Setup - Validate and create store/register if needed
  -- ============================================================================
  RAISE NOTICE 'STEP 1: Setting up test environment...';
  
  IF NOT EXISTS (SELECT 1 FROM businesses WHERE id = test_business_id) THEN
    RAISE EXCEPTION 'Business not found: %', test_business_id;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = test_user_id) THEN
    RAISE EXCEPTION 'User not found: %', test_user_id;
  END IF;
  
  -- Get or create store
  SELECT id INTO test_store_id
  FROM stores
  WHERE business_id = test_business_id
  LIMIT 1;
  
  IF test_store_id IS NULL THEN
    INSERT INTO stores (business_id, name, location)
    VALUES (test_business_id, 'Test Store (Root Cause)', NULL)
    RETURNING id INTO test_store_id;
    RAISE NOTICE '  Created test store: %', test_store_id;
  ELSE
    RAISE NOTICE '  Using existing store: %', test_store_id;
  END IF;
  
  -- Get or create register
  SELECT id INTO test_register_id
  FROM registers
  WHERE business_id = test_business_id
    AND (store_id = test_store_id OR store_id IS NULL)
  LIMIT 1;
  
  IF test_register_id IS NULL THEN
    INSERT INTO registers (business_id, store_id, name)
    VALUES (test_business_id, test_store_id, 'Test Register (Root Cause)')
    RETURNING id INTO test_register_id;
    RAISE NOTICE '  Created test register: %', test_register_id;
  ELSE
    RAISE NOTICE '  Using existing register: %', test_register_id;
  END IF;
  
  RAISE NOTICE '';
  
  -- ============================================================================
  -- STEP 2: Build tax_lines JSONB
  -- ============================================================================
  RAISE NOTICE 'STEP 2: Building tax_lines JSONB...';
  
  test_tax_lines := jsonb_build_object(
    'tax_lines', jsonb_build_array(
      jsonb_build_object(
        'code', 'VAT',
        'amount', test_tax_total,
        'ledger_account_code', '2100',
        'ledger_side', 'credit'
      )
    ),
    'subtotal_excl_tax', test_subtotal_excl_tax,
    'tax_total', test_tax_total,
    'total_incl_tax', test_amount
  );
  
  RAISE NOTICE '  tax_lines structure: %', test_tax_lines;
  RAISE NOTICE '';
  
  -- ============================================================================
  -- STEP 3: Create test sale
  -- ============================================================================
  RAISE NOTICE 'STEP 3: Creating test sale...';
  
  INSERT INTO sales (
    business_id,
    user_id,
    store_id,
    register_id,
    amount,
    payment_method,
    payment_status,
    description,
    tax_lines,
    tax_engine_code,
    tax_engine_effective_from,
    tax_jurisdiction
  ) VALUES (
    test_business_id,
    test_user_id,
    test_store_id,
    test_register_id,
    test_amount,
    'cash',
    'paid',
    'ROOT CAUSE TEST: Diagnostic sale for credit=0 investigation',
    test_tax_lines,
    'GH_TAX_ENGINE',
    CURRENT_DATE,
    'GH'
  )
  RETURNING id INTO test_sale_id;
  
  RAISE NOTICE '  Test sale created: %', test_sale_id;
  RAISE NOTICE '  Amount: %', test_amount;
  RAISE NOTICE '';
  
  -- ============================================================================
  -- STEP 4: Call post_sale_to_ledger (THIS GENERATES DIAGNOSTICS)
  -- ============================================================================
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'STEP 4: Calling post_sale_to_ledger() - DIAGNOSTIC OUTPUT FOLLOWS';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  RAISE NOTICE '>>> SCROLL DOWN AFTER THIS RUN TO SEE ALL "EVIDENCE" LINES <<<';
  RAISE NOTICE '';
  
  BEGIN
    SELECT post_sale_to_ledger(
      test_sale_id,
      NULL,  -- p_entry_type
      NULL,  -- p_backfill_reason
      NULL,  -- p_backfill_actor
      NULL   -- p_posted_by_accountant_id
    ) INTO journal_entry_id;
    
    RAISE NOTICE '';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'SUCCESS: Journal entry created: %', journal_entry_id;
    RAISE NOTICE '============================================================================';
    
    -- Verify balance
    DECLARE
      debit_sum NUMERIC;
      credit_sum NUMERIC;
      line_count INT;
    BEGIN
      SELECT 
        COUNT(*),
        COALESCE(SUM(debit), 0),
        COALESCE(SUM(credit), 0)
      INTO line_count, debit_sum, credit_sum
      FROM journal_entry_lines
      WHERE journal_entry_id = journal_entry_id;
      
      RAISE NOTICE '';
      RAISE NOTICE 'Journal Entry Verification:';
      RAISE NOTICE '  Total lines: %', line_count;
      RAISE NOTICE '  Debit sum: %', debit_sum;
      RAISE NOTICE '  Credit sum: %', credit_sum;
      RAISE NOTICE '  Balance: %', ABS(debit_sum - credit_sum);
      
      IF ABS(debit_sum - credit_sum) > 0.01 THEN
        RAISE WARNING 'WARNING: Journal entry does not balance!';
      ELSE
        RAISE NOTICE 'SUCCESS: Journal entry balances correctly';
      END IF;
    END;
    
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE '';
      RAISE NOTICE '============================================================================';
      RAISE NOTICE 'ERROR: post_sale_to_ledger() failed';
      RAISE NOTICE '============================================================================';
      RAISE NOTICE '  SQLSTATE: %', SQLSTATE;
      RAISE NOTICE '  Error Message: %', SQLERRM;
      RAISE NOTICE '';
      RAISE NOTICE '>>> SCROLL UP TO SEE ALL "EVIDENCE" DIAGNOSTIC LINES <<<';
      RAISE NOTICE '';
      RAISE NOTICE 'Key diagnostics to look for (lines prefixed with "EVIDENCE"):';
      RAISE NOTICE '  1. EVIDENCE gross_total=... net_total=... tax_total=...';
      RAISE NOTICE '  2. EVIDENCE journal_lines=... (full JSONB payload)';
      RAISE NOTICE '  3. EVIDENCE line[1] account_id=... debit=... credit=...';
      RAISE NOTICE '  4. EVIDENCE debit_sum=... credit_sum=...';
      RAISE NOTICE '';
      RAISE NOTICE 'ROOT CAUSE QUESTION: Does credit_sum = 0 in the diagnostics?';
      RAISE NOTICE 'If yes, that explains why the journal entry is unbalanced.';
      RAISE NOTICE '';
      
      -- Don't re-raise - we want to continue to show sale details
  END;
  
  -- ============================================================================
  -- STEP 5: Inspect the created sale
  -- ============================================================================
  RAISE NOTICE '';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'STEP 5: Inspecting test sale record';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  
  SELECT * INTO sale_record
  FROM sales
  WHERE id = test_sale_id;
  
  IF sale_record.id IS NOT NULL THEN
    RAISE NOTICE 'Sale Record Details:';
    RAISE NOTICE '  ID: %', sale_record.id;
    RAISE NOTICE '  Business ID: %', sale_record.business_id;
    RAISE NOTICE '  Amount: %', sale_record.amount;
    RAISE NOTICE '  Payment Method: %', sale_record.payment_method;
    RAISE NOTICE '  Payment Status: %', sale_record.payment_status;
    RAISE NOTICE '  Tax Engine Code: %', sale_record.tax_engine_code;
    RAISE NOTICE '  Tax Jurisdiction: %', sale_record.tax_jurisdiction;
    RAISE NOTICE '  Tax Lines: %', sale_record.tax_lines;
    RAISE NOTICE '';
    
    -- Detailed tax_lines inspection
    IF sale_record.tax_lines IS NOT NULL THEN
      RAISE NOTICE 'Tax Lines Structure:';
      RAISE NOTICE '  Type: %', jsonb_typeof(sale_record.tax_lines);
      
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
      RAISE WARNING 'WARNING: tax_lines is NULL in sale record!';
    END IF;
  ELSE
    RAISE WARNING 'WARNING: Could not retrieve sale record';
  END IF;
  
  -- ============================================================================
  -- SUMMARY
  -- ============================================================================
  RAISE NOTICE '';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'TEST SUMMARY';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Test sale ID: %', test_sale_id;
  RAISE NOTICE 'Test sale preserved for inspection.';
  RAISE NOTICE '';
  RAISE NOTICE 'To query the sale:';
  RAISE NOTICE '  SELECT * FROM sales WHERE id = ''%'';', test_sale_id;
  RAISE NOTICE '';
  RAISE NOTICE 'To clean up (optional):';
  RAISE NOTICE '  DELETE FROM sales WHERE id = ''%'';', test_sale_id;
  RAISE NOTICE '';
  RAISE NOTICE 'NEXT STEPS:';
  RAISE NOTICE '1. Review all diagnostic output above (scroll up for "EVIDENCE" lines)';
  RAISE NOTICE '2. Check if credit_sum = 0 in the diagnostics';
  RAISE NOTICE '3. Examine the journal_lines JSONB to see what was passed to post_journal_entry';
  RAISE NOTICE '4. Identify where credit values become zero or are not added to journal_lines';
  RAISE NOTICE '';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'TEST COMPLETE';
  RAISE NOTICE '============================================================================';
  
END $$;
