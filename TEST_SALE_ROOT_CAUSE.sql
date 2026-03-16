-- ============================================================================
-- TEST SCRIPT: Root Cause Diagnostic - Retail Ledger Posting Credit=0
-- ============================================================================
-- This script creates a test sale and calls post_sale_to_ledger to trigger
-- the error and capture diagnostic RAISE NOTICE output.
--
-- PREREQUISITES:
-- 1. Enable client_min_messages = 'NOTICE' to see diagnostic output
-- 2. Replace test UUIDs with actual business_id, user_id, store_id, register_id
-- 3. Ensure accounts exist: 1000 (Cash), 4000 (Revenue), 5000 (COGS), 1200 (Inventory), 2100 (VAT Payable)
-- ============================================================================

-- Enable NOTICE output
SET client_min_messages TO NOTICE;

-- ============================================================================
-- STEP 1: Configure Test Data
-- ============================================================================
-- REPLACE THESE WITH ACTUAL VALUES FROM YOUR DATABASE:
DO $$
DECLARE
  -- ACTUAL IDs FROM YOUR DATABASE
  test_business_id UUID := '69278e9a-8694-4640-88d1-cbcfe7dd42f3';
  test_user_id UUID := 'b19cd6f1-6ca6-491d-9b51-8bed0da2d1d4';
  test_store_id UUID;  -- Will be created if needed
  test_register_id UUID;  -- Will be created if needed
  
  -- Test sale data
  test_sale_id UUID;
  test_amount NUMERIC := 100.00;  -- Authoritative gross total
  test_subtotal_excl_tax NUMERIC := 83.34;  -- Net revenue
  test_tax_total NUMERIC := 16.66;  -- Total tax
  
  -- Tax lines JSONB (canonical format)
  test_tax_lines JSONB;
  
  -- Result
  journal_entry_id UUID;
  
  -- Diagnostic variables
  missing_accounts TEXT[];
BEGIN
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'ROOT CAUSE DIAGNOSTIC TEST: Retail Ledger Posting';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  
  -- Validate business and user IDs exist
  IF NOT EXISTS (SELECT 1 FROM businesses WHERE id = test_business_id) THEN
    RAISE EXCEPTION 'Business not found: %', test_business_id;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = test_user_id) THEN
    RAISE EXCEPTION 'User not found: %', test_user_id;
  END IF;
  
  -- Check for required accounts (using account_code column)
  missing_accounts := ARRAY[]::TEXT[];
  IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = test_business_id AND account_code = '1000') THEN
    missing_accounts := array_append(missing_accounts, '1000 (Cash)');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = test_business_id AND account_code = '4000') THEN
    missing_accounts := array_append(missing_accounts, '4000 (Revenue)');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = test_business_id AND account_code = '2100') THEN
    missing_accounts := array_append(missing_accounts, '2100 (VAT Payable)');
  END IF;
  
  IF array_length(missing_accounts, 1) > 0 THEN
    RAISE WARNING 'Missing required accounts: %', array_to_string(missing_accounts, ', ');
    RAISE NOTICE 'Please ensure these accounts exist before running the test.';
  END IF;
  
  -- Create test store if it doesn't exist
  SELECT id INTO test_store_id
  FROM stores
  WHERE business_id = test_business_id
  LIMIT 1;
  
  IF test_store_id IS NULL THEN
    RAISE NOTICE 'Creating test store...';
    INSERT INTO stores (business_id, name, location)
    VALUES (test_business_id, 'Test Store (Root Cause Diagnostic)', NULL)
    RETURNING id INTO test_store_id;
    RAISE NOTICE 'Test store created: %', test_store_id;
  ELSE
    RAISE NOTICE 'Using existing store: %', test_store_id;
  END IF;
  
  -- Create test register if it doesn't exist
  SELECT id INTO test_register_id
  FROM registers
  WHERE business_id = test_business_id
    AND (store_id = test_store_id OR store_id IS NULL)
  LIMIT 1;
  
  IF test_register_id IS NULL THEN
    RAISE NOTICE 'Creating test register...';
    INSERT INTO registers (business_id, store_id, name)
    VALUES (test_business_id, test_store_id, 'Test Register (Root Cause Diagnostic)')
    RETURNING id INTO test_register_id;
    RAISE NOTICE 'Test register created: %', test_register_id;
  ELSE
    RAISE NOTICE 'Using existing register: %', test_register_id;
  END IF;
  
  RAISE NOTICE 'Test Configuration:';
  RAISE NOTICE '  business_id: %', test_business_id;
  RAISE NOTICE '  user_id: %', test_user_id;
  RAISE NOTICE '  store_id: %', test_store_id;
  RAISE NOTICE '  register_id: %', test_register_id;
  RAISE NOTICE '  amount (gross_total): %', test_amount;
  RAISE NOTICE '  subtotal_excl_tax (net_total): %', test_subtotal_excl_tax;
  RAISE NOTICE '  tax_total: %', test_tax_total;
  RAISE NOTICE '';
  
  -- ============================================================================
  -- STEP 2: Build tax_lines JSONB (canonical format)
  -- ============================================================================
  -- Format: { tax_lines: [...], subtotal_excl_tax: X, tax_total: Y, total_incl_tax: Z }
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
  
  RAISE NOTICE 'Tax Lines JSONB:';
  RAISE NOTICE '%', test_tax_lines;
  RAISE NOTICE '';
  
  -- ============================================================================
  -- STEP 3: Create Test Sale
  -- ============================================================================
  RAISE NOTICE 'Creating test sale...';
  
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
    test_amount,  -- Authoritative gross total
    'cash',
    'paid',
    'ROOT CAUSE TEST: Diagnostic sale for credit=0 investigation',
    test_tax_lines,
    'GH_TAX_ENGINE',
    CURRENT_DATE,
    'GH'
  )
  RETURNING id INTO test_sale_id;
  
  RAISE NOTICE 'Test sale created: %', test_sale_id;
  RAISE NOTICE '';
  
  -- ============================================================================
  -- STEP 4: Create Test Sale Items (for COGS calculation)
  -- ============================================================================
  -- Note: This assumes you have a product. If not, COGS will be 0.
  -- The diagnostic will show total_cogs=0 which is fine for this test.
  
  RAISE NOTICE 'Creating test sale items (COGS will be 0 if no products)...';
  -- Sale items are optional for this diagnostic test
  RAISE NOTICE '';
  
  -- ============================================================================
  -- STEP 5: Call post_sale_to_ledger (THIS WILL TRIGGER DIAGNOSTICS)
  -- ============================================================================
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'CALLING post_sale_to_ledger() - DIAGNOSTIC OUTPUT FOLLOWS:';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  
  BEGIN
    SELECT post_sale_to_ledger(
      test_sale_id,
      NULL,  -- p_entry_type
      NULL,  -- p_backfill_reason
      NULL,  -- p_backfill_actor
      NULL   -- p_posted_by_accountant_id (will use business owner)
    ) INTO journal_entry_id;
    
    RAISE NOTICE '';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'SUCCESS: Journal entry created: %', journal_entry_id;
    RAISE NOTICE '============================================================================';
    
    -- Verify the journal entry
    RAISE NOTICE '';
    RAISE NOTICE 'Verifying journal entry balance...';
    
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
      
      RAISE NOTICE 'Journal Entry Lines:';
      RAISE NOTICE '  Total lines: %', line_count;
      RAISE NOTICE '  Debit sum: %', debit_sum;
      RAISE NOTICE '  Credit sum: %', credit_sum;
      RAISE NOTICE '  Balance difference: %', ABS(debit_sum - credit_sum);
      
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
      RAISE NOTICE 'ERROR: post_sale_to_ledger() failed:';
      RAISE NOTICE '  SQLSTATE: %', SQLSTATE;
      RAISE NOTICE '  Message: %', SQLERRM;
      RAISE NOTICE '============================================================================';
      RAISE NOTICE '';
      
      -- Inspect the sale record that was created
      DECLARE
        sale_record RECORD;
      BEGIN
        SELECT * INTO sale_record
        FROM sales
        WHERE id = test_sale_id;
        
        IF sale_record.id IS NOT NULL THEN
          RAISE NOTICE 'Sale Record Details:';
          RAISE NOTICE '  sale_id: %', sale_record.id;
          RAISE NOTICE '  amount: %', sale_record.amount;
          RAISE NOTICE '  tax_lines: %', sale_record.tax_lines;
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          -- Ignore errors in inspection
          NULL;
      END;
      
      RAISE NOTICE '';
      RAISE NOTICE 'IMPORTANT: Review ALL diagnostic output above (scroll up if needed).';
      RAISE NOTICE 'Look for lines prefixed with "EVIDENCE" to see:';
      RAISE NOTICE '  - Variable values (gross_total, net_total, tax_total, cogs)';
      RAISE NOTICE '  - tax_lines_jsonb content';
      RAISE NOTICE '  - journal_lines JSONB (full payload)';
      RAISE NOTICE '  - Per-line details (account_id, debit, credit, description)';
      RAISE NOTICE '  - Summary counts and sums';
      RAISE NOTICE '';
      RAISE NOTICE 'Test sale preserved for inspection: %', test_sale_id;
      RAISE NOTICE 'You can query it with: SELECT * FROM sales WHERE id = ''%'';', test_sale_id;
      RAISE NOTICE '';
      RAISE NOTICE 'To clean up the test sale, run:';
      RAISE NOTICE '  DELETE FROM sales WHERE id = ''%'';', test_sale_id;
      RAISE NOTICE '';
      
      -- PRESERVE the test sale - DO NOT DELETE
      -- DELETE FROM sales WHERE id = test_sale_id;
      
      RAISE EXCEPTION 'Test failed - see diagnostic output above. Test sale preserved: %', test_sale_id;
  END;
  
  -- ============================================================================
  -- STEP 6: Cleanup (Optional - comment out to keep test data)
  -- ============================================================================
  -- Uncomment to clean up test sale after diagnostic:
  -- DELETE FROM sales WHERE id = test_sale_id;
  -- RAISE NOTICE 'Test sale cleaned up';
  
  RAISE NOTICE '';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'TEST COMPLETE';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Review all diagnostic output above (lines prefixed with "EVIDENCE")';
  RAISE NOTICE '2. Check for credit=0 or missing credit lines in journal_lines';
  RAISE NOTICE '3. Compare variable values to identify where credits become 0';
  RAISE NOTICE '4. Use ROOT_CAUSE_DIAGNOSTIC_REPORT.md analysis framework';
  
END $$;

-- ============================================================================
-- ALTERNATIVE: Test with existing sale
-- ============================================================================
-- If you have an existing sale that triggers the error, use this instead:
/*
DO $$
DECLARE
  existing_sale_id UUID := 'YOUR_EXISTING_SALE_ID_HERE';
  journal_entry_id UUID;
BEGIN
  RAISE NOTICE 'Testing with existing sale: %', existing_sale_id;
  
  SELECT post_sale_to_ledger(
    existing_sale_id,
    NULL, NULL, NULL, NULL
  ) INTO journal_entry_id;
  
  RAISE NOTICE 'Journal entry created: %', journal_entry_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error: %', SQLERRM;
    RAISE NOTICE 'Review diagnostic output above';
END $$;
*/
