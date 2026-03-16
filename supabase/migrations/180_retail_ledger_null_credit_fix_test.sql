-- ============================================================================
-- TEST/VERIFICATION: Retail Ledger NULL Credit Fix
-- ============================================================================
-- This script verifies that post_sale_to_ledger() never produces credit=0
-- from NULL totals. Tests three scenarios:
-- A) tax_lines_jsonb object present with subtotal_excl_tax + tax_total
-- B) tax_lines_jsonb missing those keys (derive from parsed_tax_lines)
-- C) tax_lines_jsonb NULL (must fail with explicit error, not post unbalanced)
-- ============================================================================

-- Test function that creates a minimal sale and verifies posting succeeds
CREATE OR REPLACE FUNCTION test_retail_ledger_null_credit_fix()
RETURNS TABLE (
  test_case TEXT,
  passed BOOLEAN,
  error_message TEXT,
  journal_entry_id UUID
) AS $$
DECLARE
  test_business_id UUID := '69278e9a-8694-4640-88d1-cbcfe7dd42f3';
  test_user_id UUID;
  test_store_id UUID;
  test_register_id UUID;
  test_sale_id UUID;
  test_journal_id UUID;
  test_error TEXT;
BEGIN
  -- Get test user (business owner)
  SELECT owner_id INTO test_user_id
  FROM businesses
  WHERE id = test_business_id;
  
  IF test_user_id IS NULL THEN
    RAISE EXCEPTION 'Test business not found';
  END IF;
  
  -- Ensure test store and register exist
  SELECT id INTO test_store_id
  FROM stores
  WHERE business_id = test_business_id
  LIMIT 1;
  
  IF test_store_id IS NULL THEN
    INSERT INTO stores (business_id, name)
    VALUES (test_business_id, 'Test Store')
    RETURNING id INTO test_store_id;
  END IF;
  
  SELECT id INTO test_register_id
  FROM registers
  WHERE business_id = test_business_id AND store_id = test_store_id
  LIMIT 1;
  
  IF test_register_id IS NULL THEN
    INSERT INTO registers (business_id, store_id, name)
    VALUES (test_business_id, test_store_id, 'Test Register')
    RETURNING id INTO test_register_id;
  END IF;
  
  -- ========================================================================
  -- TEST CASE A: tax_lines_jsonb with subtotal_excl_tax + tax_total
  -- ========================================================================
  BEGIN
    -- Create test sale with canonical tax_lines structure
    INSERT INTO sales (
      business_id, user_id, store_id, register_id, amount, payment_method, payment_status,
      description, tax_lines, tax_engine_code, tax_engine_effective_from, tax_jurisdiction
    ) VALUES (
      test_business_id, test_user_id, test_store_id, test_register_id,
      100.00, 'cash', 'paid',
      'TEST A: Canonical tax_lines structure',
      jsonb_build_object(
        'tax_lines', jsonb_build_array(
          jsonb_build_object('code', 'VAT', 'amount', 16.66, 'ledger_side', 'credit', 'ledger_account_code', '2100')
        ),
        'subtotal_excl_tax', 83.34,
        'tax_total', 16.66,
        'total_incl_tax', 100.00
      ),
      'GH_TAX_ENGINE', CURRENT_DATE, 'GH'
    ) RETURNING id INTO test_sale_id;
    
    -- Capture input state
    RAISE NOTICE 'TEST A INPUT: sale_id=%, tax_lines=%', 
      test_sale_id, (SELECT tax_lines FROM sales WHERE id = test_sale_id);
    
    -- Attempt to post
    SELECT post_sale_to_ledger(test_sale_id) INTO test_journal_id;
    
    -- Capture evidence from debug log table (if exists)
    DECLARE
      diag_journal_lines JSONB;
      diag_line_count INT;
      diag_debit_sum NUMERIC;
      diag_credit_sum NUMERIC;
      diag_credit_count INT;
      diag_tax_shape TEXT;
    BEGIN
      SELECT journal_lines,
             line_count,
             debit_sum,
             credit_sum,
             credit_count,
             tax_shape
      INTO diag_journal_lines, diag_line_count, diag_debit_sum, diag_credit_sum, diag_credit_count, diag_tax_shape
      FROM public.retail_posting_debug_log
      WHERE sale_id = test_sale_id
      ORDER BY created_at DESC
      LIMIT 1;
      
      IF diag_journal_lines IS NOT NULL THEN
        RAISE NOTICE 'TEST A EVIDENCE: tax_shape=%, line_count=%, debit_sum=%, credit_sum=%, credit_count=%, journal_lines=%',
          diag_tax_shape, diag_line_count, diag_debit_sum, diag_credit_sum, diag_credit_count, diag_journal_lines;
      END IF;
    EXCEPTION
      WHEN undefined_table THEN
        -- Debug table doesn't exist (migration 181 not applied), skip
        NULL;
    END;
    
    -- Verify journal entry was created
    IF test_journal_id IS NULL THEN
      RETURN QUERY SELECT 'TEST A: Canonical structure'::TEXT, FALSE, 'post_sale_to_ledger returned NULL'::TEXT, NULL::UUID;
    ELSE
      -- Verify journal entry is balanced
      IF EXISTS (
        SELECT 1
        FROM journal_entry_lines
        WHERE journal_entry_id = test_journal_id
        GROUP BY journal_entry_id
        HAVING ABS(SUM(debit) - SUM(credit)) > 0.01
      ) THEN
        RETURN QUERY SELECT 'TEST A: Canonical structure'::TEXT, FALSE, 'Journal entry is not balanced'::TEXT, test_journal_id;
      ELSE
        RETURN QUERY SELECT 'TEST A: Canonical structure'::TEXT, TRUE, NULL::TEXT, test_journal_id;
      END IF;
    END IF;
    
    -- Cleanup
    DELETE FROM sales WHERE id = test_sale_id;
    
  EXCEPTION
    WHEN OTHERS THEN
      RETURN QUERY SELECT 'TEST A: Canonical structure'::TEXT, FALSE, SQLERRM, NULL::UUID;
      DELETE FROM sales WHERE id = test_sale_id;
  END;
  
  -- ========================================================================
  -- TEST CASE B: tax_lines_jsonb with parsed_tax_lines only (derive totals)
  -- ========================================================================
  BEGIN
    -- Create test sale with only tax_lines array (no canonical totals)
    INSERT INTO sales (
      business_id, user_id, store_id, register_id, amount, payment_method, payment_status,
      description, tax_lines, tax_engine_code, tax_engine_effective_from, tax_jurisdiction
    ) VALUES (
      test_business_id, test_user_id, test_store_id, test_register_id,
      100.00, 'cash', 'paid',
      'TEST B: Parsed tax_lines only',
      jsonb_build_object(
        'tax_lines', jsonb_build_array(
          jsonb_build_object('code', 'VAT', 'amount', 16.66, 'ledger_side', 'credit', 'ledger_account_code', '2100')
        )
      ),
      'GH_TAX_ENGINE', CURRENT_DATE, 'GH'
    ) RETURNING id INTO test_sale_id;
    
    -- Capture input state
    RAISE NOTICE 'TEST B INPUT: sale_id=%, tax_lines=%', 
      test_sale_id, (SELECT tax_lines FROM sales WHERE id = test_sale_id);
    
    -- Attempt to post
    SELECT post_sale_to_ledger(test_sale_id) INTO test_journal_id;
    
    -- Capture evidence from debug log table (if exists)
    DECLARE
      diag_journal_lines JSONB;
      diag_line_count INT;
      diag_debit_sum NUMERIC;
      diag_credit_sum NUMERIC;
      diag_credit_count INT;
      diag_tax_shape TEXT;
    BEGIN
      SELECT journal_lines,
             line_count,
             debit_sum,
             credit_sum,
             credit_count,
             tax_shape
      INTO diag_journal_lines, diag_line_count, diag_debit_sum, diag_credit_sum, diag_credit_count, diag_tax_shape
      FROM public.retail_posting_debug_log
      WHERE sale_id = test_sale_id
      ORDER BY created_at DESC
      LIMIT 1;
      
      IF diag_journal_lines IS NOT NULL THEN
        RAISE NOTICE 'TEST B EVIDENCE: tax_shape=%, line_count=%, debit_sum=%, credit_sum=%, credit_count=%, journal_lines=%',
          diag_tax_shape, diag_line_count, diag_debit_sum, diag_credit_sum, diag_credit_count, diag_journal_lines;
      END IF;
    EXCEPTION
      WHEN undefined_table THEN
        -- Debug table doesn't exist (migration 181 not applied), skip
        NULL;
    END;
    
    -- Verify journal entry was created
    IF test_journal_id IS NULL THEN
      RETURN QUERY SELECT 'TEST B: Parsed tax_lines only'::TEXT, FALSE, 'post_sale_to_ledger returned NULL'::TEXT, NULL::UUID;
    ELSE
      -- Verify journal entry is balanced
      IF EXISTS (
        SELECT 1
        FROM journal_entry_lines
        WHERE journal_entry_id = test_journal_id
        GROUP BY journal_entry_id
        HAVING ABS(SUM(debit) - SUM(credit)) > 0.01
      ) THEN
        RETURN QUERY SELECT 'TEST B: Parsed tax_lines only'::TEXT, FALSE, 'Journal entry is not balanced'::TEXT, test_journal_id;
      ELSE
        RETURN QUERY SELECT 'TEST B: Parsed tax_lines only'::TEXT, TRUE, NULL::TEXT, test_journal_id;
      END IF;
    END IF;
    
    -- Cleanup
    DELETE FROM sales WHERE id = test_sale_id;
    
  EXCEPTION
    WHEN OTHERS THEN
      RETURN QUERY SELECT 'TEST B: Parsed tax_lines only'::TEXT, FALSE, SQLERRM, NULL::UUID;
      DELETE FROM sales WHERE id = test_sale_id;
  END;
  
  -- ========================================================================
  -- TEST CASE C: tax_lines_jsonb NULL (must fail with explicit error)
  -- ========================================================================
  BEGIN
    -- Create test sale with NULL tax_lines
    INSERT INTO sales (
      business_id, user_id, store_id, register_id, amount, payment_method, payment_status,
      description, tax_lines, tax_engine_code, tax_engine_effective_from, tax_jurisdiction
    ) VALUES (
      test_business_id, test_user_id, test_store_id, test_register_id,
      100.00, 'cash', 'paid',
      'TEST C: NULL tax_lines (should fail)',
      NULL,
      'GH_TAX_ENGINE', CURRENT_DATE, 'GH'
    ) RETURNING id INTO test_sale_id;
    
    -- Attempt to post (should fail)
    BEGIN
      SELECT post_sale_to_ledger(test_sale_id) INTO test_journal_id;
      -- If we get here, the function didn't fail as expected
      RETURN QUERY SELECT 'TEST C: NULL tax_lines'::TEXT, FALSE, 'Expected exception but function succeeded'::TEXT, test_journal_id;
      DELETE FROM sales WHERE id = test_sale_id;
    EXCEPTION
      WHEN OTHERS THEN
        -- Expected: function should fail with explicit error
        IF SQLERRM LIKE '%Cannot determine net_total or total_tax_amount%' THEN
          RETURN QUERY SELECT 'TEST C: NULL tax_lines'::TEXT, TRUE, NULL::TEXT, NULL::UUID;
        ELSE
          RETURN QUERY SELECT 'TEST C: NULL tax_lines'::TEXT, FALSE, 'Wrong error: ' || SQLERRM, NULL::UUID;
        END IF;
        DELETE FROM sales WHERE id = test_sale_id;
    END;
    
  EXCEPTION
    WHEN OTHERS THEN
      RETURN QUERY SELECT 'TEST C: NULL tax_lines'::TEXT, FALSE, SQLERRM, NULL::UUID;
      DELETE FROM sales WHERE id = test_sale_id;
  END;
  
  RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION test_retail_ledger_null_credit_fix IS 
'Test function to verify post_sale_to_ledger() never produces credit=0 from NULL totals. Tests three scenarios: canonical structure, parsed tax_lines only, and NULL tax_lines (must fail).';

-- Run the tests
SELECT * FROM test_retail_ledger_null_credit_fix();
