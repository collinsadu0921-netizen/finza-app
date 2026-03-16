-- ============================================================================
-- VERIFICATION PASS: Confirm Current State Before Any New Fix
-- ============================================================================
-- This script verifies whether migrations 184 + 185 fully resolve the issue.
-- Run each section and capture output for the verification report.
-- ============================================================================

-- ============================================================================
-- SECTION 1: Trigger Semantics Test
-- ============================================================================
-- Tests whether statement-level trigger fires once or per-INSERT
-- ============================================================================

CREATE OR REPLACE FUNCTION test_trigger_semantics()
RETURNS TABLE (
  test_name TEXT,
  trigger_fired_count INT,
  balance_validated BOOLEAN,
  notes TEXT
) AS $$
DECLARE
  test_journal_id UUID;
  test_business_id UUID := '69278e9a-8694-4640-88d1-cbcfe7dd42f3';
  test_account_id UUID;
  test_date DATE;
  test_owner_id UUID;
  insert_count INT := 0;
  trigger_fire_count INT := 0;
  period_rec RECORD;
BEGIN
  -- Setup: Get test account and date
  SELECT owner_id INTO test_owner_id FROM businesses WHERE id = test_business_id;
  
  IF test_owner_id IS NULL THEN
    RAISE EXCEPTION 'Test business not found: %', test_business_id;
  END IF;
  
  SELECT id INTO test_account_id 
  FROM accounts 
  WHERE business_id = test_business_id AND code = '1000' AND deleted_at IS NULL
  LIMIT 1;
  
  IF test_account_id IS NULL THEN
    RAISE EXCEPTION 'Test account (1000) not found for business: %', test_business_id;
  END IF;
  
  -- Find or create an accounting period for testing
  -- First, try to use ensure_accounting_period function if it exists
  BEGIN
    SELECT * INTO period_rec FROM ensure_accounting_period(test_business_id, CURRENT_DATE);
    test_date := CURRENT_DATE;
    RAISE NOTICE 'Using ensure_accounting_period for date: % (period: % to %)', 
      test_date, period_rec.period_start, period_rec.period_end;
  EXCEPTION
    WHEN undefined_function THEN
      -- Function doesn't exist, manually find or create period
      -- First, try to find an open period that includes current date
      SELECT period_start, period_end INTO period_rec
      FROM accounting_periods
      WHERE business_id = test_business_id 
        AND status IN ('open', 'soft_closed')
        AND CURRENT_DATE BETWEEN period_start AND period_end
      ORDER BY period_start DESC
      LIMIT 1;
      
      IF FOUND THEN
        test_date := CURRENT_DATE;
      ELSE
        -- Try any open or soft_closed period
        SELECT period_start, period_end INTO period_rec
        FROM accounting_periods
        WHERE business_id = test_business_id 
          AND status IN ('open', 'soft_closed')
        ORDER BY period_start DESC
        LIMIT 1;
        
        IF FOUND THEN
          -- Use a date within the period (use period_start + 1 day to be safe)
          IF period_rec.period_start + INTERVAL '1 day' <= period_rec.period_end THEN
            test_date := period_rec.period_start + INTERVAL '1 day';
          ELSE
            test_date := period_rec.period_start;
          END IF;
        ELSE
          -- Try any period at all
          SELECT period_start, period_end INTO period_rec
          FROM accounting_periods
          WHERE business_id = test_business_id
          ORDER BY period_start DESC
          LIMIT 1;
          
          IF FOUND THEN
            -- Use a date within the period
            IF period_rec.period_start + INTERVAL '1 day' <= period_rec.period_end THEN
              test_date := period_rec.period_start + INTERVAL '1 day';
            ELSE
              test_date := period_rec.period_start;
            END IF;
          ELSE
            -- Create a test period for current month
            DECLARE
              period_start_date DATE;
              period_end_date DATE;
            BEGIN
              period_start_date := DATE_TRUNC('month', CURRENT_DATE)::DATE;
              period_end_date := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
              
              INSERT INTO accounting_periods (business_id, period_start, period_end, status)
              VALUES (test_business_id, period_start_date, period_end_date, 'open')
              RETURNING period_start, period_end INTO period_rec;
              
              test_date := CURRENT_DATE;
              RAISE NOTICE 'Created test accounting period: % to % (status: open)', 
                period_rec.period_start, period_rec.period_end;
            END;
          END IF;
        END IF;
      END IF;
      
      RAISE NOTICE 'Using test date: % (from accounting period % to %)', 
        test_date, period_rec.period_start, period_rec.period_end;
  END;
  
  -- Create test journal entry
  INSERT INTO journal_entries (
    business_id, date, description, reference_type, reference_id,
    posted_by_accountant_id
  ) VALUES (
    test_business_id, test_date, 'TRIGGER SEMANTICS TEST', 'test', gen_random_uuid(),
    test_owner_id
  ) RETURNING id INTO test_journal_id;
  
  RAISE NOTICE 'Created test journal entry: %', test_journal_id;
  RAISE NOTICE 'Now inserting lines in a loop (like post_journal_entry does)...';
  
  -- Simulate loop-based INSERT (like post_journal_entry)
  -- Insert line 1: Debit
  BEGIN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (test_journal_id, test_account_id, 100.00, 0, 'Test debit line 1');
    insert_count := insert_count + 1;
    RAISE NOTICE 'Inserted line 1 (debit: 100.00, credit: 0)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ERROR on line 1 insert: %', SQLERRM;
    RETURN QUERY SELECT 'Trigger Semantics Test'::TEXT, 0, FALSE, 'Failed on first insert: ' || SQLERRM;
    RETURN;
  END;
  
  -- Insert line 2: Credit (balances the entry)
  BEGIN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (test_journal_id, test_account_id, 0, 100.00, 'Test credit line 2');
    insert_count := insert_count + 1;
    RAISE NOTICE 'Inserted line 2 (debit: 0, credit: 100.00)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ERROR on line 2 insert: %', SQLERRM;
    RETURN QUERY SELECT 'Trigger Semantics Test'::TEXT, insert_count, FALSE, 'Failed on second insert: ' || SQLERRM;
    RETURN;
  END;
  
  -- Check final balance
  DECLARE
    total_debit NUMERIC;
    total_credit NUMERIC;
    is_balanced BOOLEAN;
  BEGIN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO total_debit, total_credit
    FROM journal_entry_lines
    WHERE journal_entry_id = test_journal_id;
    
    is_balanced := ABS(total_debit - total_credit) <= 0.01;
    
    RAISE NOTICE 'Final state: debit_sum=%, credit_sum=%, balanced=%', 
      total_debit, total_credit, is_balanced;
    
    -- Cleanup
    DELETE FROM journal_entry_lines WHERE journal_entry_id = test_journal_id;
    DELETE FROM journal_entries WHERE id = test_journal_id;
    
    RETURN QUERY SELECT 
      'Trigger Semantics Test'::TEXT,
      insert_count::INT,
      is_balanced,
      format('Inserted %s lines successfully. Statement-level trigger should fire once after all inserts.', insert_count);
  END;
  
END;
$$ LANGUAGE plpgsql;

-- Run trigger semantics test
SELECT * FROM test_trigger_semantics();

-- ============================================================================
-- SECTION 2: Enhanced Test Runner (Captures All Evidence)
-- ============================================================================

CREATE OR REPLACE FUNCTION verification_test_runner()
RETURNS TABLE (
  test_case TEXT,
  passed BOOLEAN,
  error_source TEXT,
  error_message TEXT,
  journal_entry_id UUID,
  journal_lines_jsonb JSONB,
  intent_debit NUMERIC,
  intent_credit NUMERIC,
  jsonb_debit NUMERIC,
  jsonb_credit NUMERIC,
  table_debit NUMERIC,
  table_credit NUMERIC,
  mismatch_location TEXT
) AS $$
DECLARE
  test_business_id UUID := '69278e9a-8694-4640-88d1-cbcfe7dd42f3';
  test_user_id UUID;
  test_store_id UUID;
  test_register_id UUID;
  test_sale_id UUID;
  test_journal_id UUID;
  captured_journal_lines JSONB;
  intent_d NUMERIC;
  intent_c NUMERIC;
  jsonb_d NUMERIC;
  jsonb_c NUMERIC;
  table_d NUMERIC;
  table_c NUMERIC;
  mismatch_loc TEXT;
BEGIN
  -- Setup
  SELECT owner_id INTO test_user_id FROM businesses WHERE id = test_business_id;
  SELECT id INTO test_store_id FROM stores WHERE business_id = test_business_id LIMIT 1;
  
  IF test_store_id IS NULL THEN
    INSERT INTO stores (business_id, name) VALUES (test_business_id, 'Test Store')
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
  -- TEST A: Canonical tax_lines structure
  -- ========================================================================
  BEGIN
    INSERT INTO sales (
      business_id, user_id, store_id, register_id, amount, payment_method, payment_status,
      description, tax_lines, tax_engine_code, tax_engine_effective_from, tax_jurisdiction
    ) VALUES (
      test_business_id, test_user_id, test_store_id, test_register_id,
      100.00, 'cash', 'paid',
      'VERIFICATION TEST A: Canonical structure',
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
    
    -- Expected accounting intent:
    -- Debit: Cash 100.00
    -- Credit: Revenue 83.34, Tax Payable 16.66
    intent_d := 100.00;
    intent_c := 100.00;
    
    BEGIN
      SELECT post_sale_to_ledger(test_sale_id) INTO test_journal_id;
      
      -- Capture journal_lines from debug log
      SELECT journal_lines INTO captured_journal_lines
      FROM retail_posting_debug_log
      WHERE sale_id = test_sale_id
      ORDER BY created_at DESC
      LIMIT 1;
      
      -- Calculate totals from JSONB
      IF captured_journal_lines IS NOT NULL THEN
        SELECT 
          COALESCE(SUM(COALESCE((line->'debit')::numeric, 0)), 0),
          COALESCE(SUM(COALESCE((line->'credit')::numeric, 0)), 0)
        INTO jsonb_d, jsonb_c
        FROM jsonb_array_elements(captured_journal_lines) AS line;
      END IF;
      
      -- Calculate totals from table
      SELECT 
        COALESCE(SUM(debit), 0),
        COALESCE(SUM(credit), 0)
      INTO table_d, table_c
      FROM journal_entry_lines
      WHERE journal_entry_id = test_journal_id;
      
      -- Check for mismatches
      mismatch_loc := NULL;
      IF ABS(jsonb_d - intent_d) > 0.01 OR ABS(jsonb_c - intent_c) > 0.01 THEN
        mismatch_loc := 'Intent vs JSONB';
      ELSIF ABS(table_d - jsonb_d) > 0.01 OR ABS(table_c - jsonb_c) > 0.01 THEN
        mismatch_loc := 'JSONB vs Table';
      END IF;
      
      RETURN QUERY SELECT 
        'TEST A'::TEXT,
        (ABS(table_d - table_c) <= 0.01)::BOOLEAN,
        CASE WHEN ABS(table_d - table_c) > 0.01 THEN 'post_journal_entry validation' ELSE NULL END,
        CASE WHEN ABS(table_d - table_c) > 0.01 THEN 'Imbalanced: debit=' || table_d || ', credit=' || table_c ELSE NULL END,
        test_journal_id,
        captured_journal_lines,
        intent_d, intent_c, jsonb_d, jsonb_c, table_d, table_c,
        mismatch_loc;
      
      DELETE FROM sales WHERE id = test_sale_id;
      
    EXCEPTION WHEN OTHERS THEN
      RETURN QUERY SELECT 
        'TEST A'::TEXT,
        FALSE,
        CASE 
          WHEN SQLERRM LIKE '%post_journal_entry%' THEN 'post_journal_entry'
          WHEN SQLERRM LIKE '%trigger%' THEN 'trigger'
          WHEN SQLERRM LIKE '%post_sale_to_ledger%' THEN 'post_sale_to_ledger'
          ELSE 'unknown'
        END,
        SQLERRM,
        NULL::UUID,
        captured_journal_lines,
        intent_d, intent_c, jsonb_d, jsonb_c, NULL::NUMERIC, NULL::NUMERIC,
        'Exception occurred: ' || SQLERRM;
      
      DELETE FROM sales WHERE id = test_sale_id;
    END;
    
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
      'TEST A'::TEXT, FALSE, 'setup', SQLERRM,
      NULL::UUID, NULL::JSONB,
      NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC,
      'Setup failed';
  END;
  
  -- ========================================================================
  -- TEST B: Parsed tax_lines only
  -- ========================================================================
  BEGIN
    INSERT INTO sales (
      business_id, user_id, store_id, register_id, amount, payment_method, payment_status,
      description, tax_lines, tax_engine_code, tax_engine_effective_from, tax_jurisdiction
    ) VALUES (
      test_business_id, test_user_id, test_store_id, test_register_id,
      100.00, 'cash', 'paid',
      'VERIFICATION TEST B: Parsed tax_lines only',
      jsonb_build_object(
        'tax_lines', jsonb_build_array(
          jsonb_build_object('code', 'VAT', 'amount', 16.66, 'ledger_side', 'credit', 'ledger_account_code', '2100')
        )
      ),
      'GH_TAX_ENGINE', CURRENT_DATE, 'GH'
    ) RETURNING id INTO test_sale_id;
    
    intent_d := 100.00;
    intent_c := 100.00;
    captured_journal_lines := NULL;
    
    BEGIN
      SELECT post_sale_to_ledger(test_sale_id) INTO test_journal_id;
      
      SELECT journal_lines INTO captured_journal_lines
      FROM retail_posting_debug_log
      WHERE sale_id = test_sale_id
      ORDER BY created_at DESC
      LIMIT 1;
      
      IF captured_journal_lines IS NOT NULL THEN
        SELECT 
          COALESCE(SUM(COALESCE((line->'debit')::numeric, 0)), 0),
          COALESCE(SUM(COALESCE((line->'credit')::numeric, 0)), 0)
        INTO jsonb_d, jsonb_c
        FROM jsonb_array_elements(captured_journal_lines) AS line;
      END IF;
      
      SELECT 
        COALESCE(SUM(debit), 0),
        COALESCE(SUM(credit), 0)
      INTO table_d, table_c
      FROM journal_entry_lines
      WHERE journal_entry_id = test_journal_id;
      
      mismatch_loc := NULL;
      IF ABS(jsonb_d - intent_d) > 0.01 OR ABS(jsonb_c - intent_c) > 0.01 THEN
        mismatch_loc := 'Intent vs JSONB';
      ELSIF ABS(table_d - jsonb_d) > 0.01 OR ABS(table_c - jsonb_c) > 0.01 THEN
        mismatch_loc := 'JSONB vs Table';
      END IF;
      
      RETURN QUERY SELECT 
        'TEST B'::TEXT,
        (ABS(table_d - table_c) <= 0.01)::BOOLEAN,
        CASE WHEN ABS(table_d - table_c) > 0.01 THEN 'post_journal_entry validation' ELSE NULL END,
        CASE WHEN ABS(table_d - table_c) > 0.01 THEN 'Imbalanced: debit=' || table_d || ', credit=' || table_c ELSE NULL END,
        test_journal_id,
        captured_journal_lines,
        intent_d, intent_c, jsonb_d, jsonb_c, table_d, table_c,
        mismatch_loc;
      
      DELETE FROM sales WHERE id = test_sale_id;
      
    EXCEPTION WHEN OTHERS THEN
      RETURN QUERY SELECT 
        'TEST B'::TEXT,
        FALSE,
        CASE 
          WHEN SQLERRM LIKE '%post_journal_entry%' THEN 'post_journal_entry'
          WHEN SQLERRM LIKE '%trigger%' THEN 'trigger'
          WHEN SQLERRM LIKE '%post_sale_to_ledger%' THEN 'post_sale_to_ledger'
          ELSE 'unknown'
        END,
        SQLERRM,
        NULL::UUID,
        captured_journal_lines,
        intent_d, intent_c, jsonb_d, jsonb_c, NULL::NUMERIC, NULL::NUMERIC,
        'Exception occurred: ' || SQLERRM;
      
      DELETE FROM sales WHERE id = test_sale_id;
    END;
    
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
      'TEST B'::TEXT, FALSE, 'setup', SQLERRM,
      NULL::UUID, NULL::JSONB,
      NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC,
      'Setup failed';
  END;
  
  -- ========================================================================
  -- TEST C: NULL tax_lines
  -- ========================================================================
  BEGIN
    INSERT INTO sales (
      business_id, user_id, store_id, register_id, amount, payment_method, payment_status,
      description, tax_lines, tax_engine_code, tax_engine_effective_from, tax_jurisdiction
    ) VALUES (
      test_business_id, test_user_id, test_store_id, test_register_id,
      100.00, 'cash', 'paid',
      'VERIFICATION TEST C: NULL tax_lines',
      NULL,
      'GH_TAX_ENGINE', CURRENT_DATE, 'GH'
    ) RETURNING id INTO test_sale_id;
    
    intent_d := 100.00;
    intent_c := 100.00;
    captured_journal_lines := NULL;
    
    BEGIN
      SELECT post_sale_to_ledger(test_sale_id) INTO test_journal_id;
      
      -- If we get here, it should have failed
      RETURN QUERY SELECT 
        'TEST C'::TEXT,
        FALSE,
        'post_sale_to_ledger',
        'Expected exception but function succeeded',
        test_journal_id,
        NULL::JSONB,
        intent_d, intent_c, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC,
        'Function should have failed with NULL tax_lines';
      
      DELETE FROM sales WHERE id = test_sale_id;
      
    EXCEPTION WHEN OTHERS THEN
      -- Expected: function should fail
      IF SQLERRM LIKE '%Cannot determine net_total or total_tax_amount%' THEN
        RETURN QUERY SELECT 
          'TEST C'::TEXT,
          TRUE,
          'post_sale_to_ledger',
          SQLERRM,
          NULL::UUID,
          NULL::JSONB,
          intent_d, intent_c, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC,
          'Correctly failed as expected';
      ELSE
        RETURN QUERY SELECT 
          'TEST C'::TEXT,
          FALSE,
          'post_sale_to_ledger',
          SQLERRM,
          NULL::UUID,
          NULL::JSONB,
          intent_d, intent_c, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC,
          'Failed with unexpected error';
      END IF;
      
      DELETE FROM sales WHERE id = test_sale_id;
    END;
    
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
      'TEST C'::TEXT, FALSE, 'setup', SQLERRM,
      NULL::UUID, NULL::JSONB,
      NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC,
      'Setup failed';
  END;
  
  RETURN;
  
END;
$$ LANGUAGE plpgsql;

-- Run verification tests
SELECT * FROM verification_test_runner();

-- ============================================================================
-- SECTION 3: Trigger Definition Verification
-- ============================================================================

SELECT 
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement,
  action_orientation
FROM information_schema.triggers
WHERE event_object_table = 'journal_entry_lines'
  AND trigger_name = 'trigger_enforce_double_entry_balance';

-- ============================================================================
-- SECTION 4: Function OID Verification
-- ============================================================================

SELECT 
  p.oid,
  p.proname,
  pg_get_functiondef(p.oid) LIKE '%184_diagnostic_post_journal_entry_payload%' AS is_migration_184,
  pg_get_functiondef(p.oid) LIKE '%FOR EACH STATEMENT%' AS has_statement_trigger
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'post_journal_entry'
  AND n.nspname = 'public'
ORDER BY p.oid DESC
LIMIT 1;
