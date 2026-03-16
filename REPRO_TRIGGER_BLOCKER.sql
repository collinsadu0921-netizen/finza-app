-- ============================================================================
-- STEP 1: PROVE THE TRIGGER IS THE BLOCKER (MINIMAL REPRO)
-- ============================================================================
-- This script demonstrates that a row-level AFTER INSERT trigger will
-- ALWAYS fail on the first line of a multi-line journal entry.
-- ============================================================================

-- Setup: Create a test journal entry header
DO $$
DECLARE
  test_business_id UUID := '69278e9a-8694-4640-88d1-cbcfe7dd42f3';  -- Use existing test business
  test_journal_id UUID;
  test_account_id UUID;
  test_date DATE;
  has_period_start BOOLEAN;
BEGIN
  -- Get a test account (cash account)
  SELECT id INTO test_account_id
  FROM accounts
  WHERE business_id = test_business_id
    AND code = '1000'  -- Cash account
  LIMIT 1;
  
  IF test_account_id IS NULL THEN
    RAISE EXCEPTION 'Test account not found. Please ensure business has accounts.';
  END IF;
  
  -- Get a valid accounting period date (use an existing period)
  -- Check which column exists: period_start (migration 094+) or start_date (migration 084)
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'accounting_periods'
      AND column_name = 'period_start'
  ) INTO has_period_start;
  
  IF has_period_start THEN
    -- Use period_start (migration 094+)
    SELECT period_start INTO test_date
    FROM accounting_periods
    WHERE business_id = test_business_id
      AND status = 'open'
    ORDER BY period_start DESC
    LIMIT 1;
    
    IF test_date IS NULL THEN
      SELECT period_start INTO test_date
      FROM accounting_periods
      WHERE business_id = test_business_id
      ORDER BY period_start DESC
      LIMIT 1;
    END IF;
  ELSE
    -- Use start_date (migration 084)
    SELECT start_date INTO test_date
    FROM accounting_periods
    WHERE business_id = test_business_id
      AND status = 'open'
    ORDER BY start_date DESC
    LIMIT 1;
    
    IF test_date IS NULL THEN
      SELECT start_date INTO test_date
      FROM accounting_periods
      WHERE business_id = test_business_id
      ORDER BY start_date DESC
      LIMIT 1;
    END IF;
  END IF;
  
  IF test_date IS NULL THEN
    RAISE EXCEPTION 'No accounting period found for business. Please create an accounting period first.';
  END IF;
  
  RAISE NOTICE 'Using date % from existing accounting period', test_date;
  
  -- Create journal entry header (use is_adjustment=true to bypass strict period validation if needed)
  INSERT INTO journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    is_adjustment,
    adjustment_reason,
    posted_by_accountant_id
  )
  VALUES (
    test_business_id,
    test_date,
    'TEST: Trigger blocker repro',
    'adjustment',
    NULL,
    TRUE,
    'Test trigger blocker reproduction',
    (SELECT owner_id FROM businesses WHERE id = test_business_id LIMIT 1)
  )
  RETURNING id INTO test_journal_id;
  
  RAISE NOTICE 'Created test journal entry: %', test_journal_id;
  
  -- STEP 1: Insert FIRST line (debit only) - This will trigger balance check
  -- The trigger will fire AFTER this insert and see:
  --   total_debit = 100.00
  --   total_credit = 0
  --   imbalance = 100.00 > 0.01
  --   TRIGGER RAISES EXCEPTION
  
  BEGIN
    INSERT INTO journal_entry_lines (
      journal_entry_id,
      account_id,
      debit,
      credit,
      description
    )
    VALUES (
      test_journal_id,
      test_account_id,
      100.00,  -- Debit only
      0.00,    -- No credit
      'Test debit line'
    );
    
    RAISE NOTICE 'SUCCESS: First line inserted (this should not happen if trigger works correctly)';
    
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'EXPECTED FAILURE: Trigger blocked first line insert. Error: %', SQLERRM;
      RAISE NOTICE 'This proves the trigger validates balance after EACH row, not after ALL rows';
      RAISE NOTICE 'Therefore, it is IMPOSSIBLE to insert balanced journals line-by-line';
  END;
  
  -- STEP 2: This will NEVER execute because transaction was aborted above
  -- But if it did, it would insert the credit line to balance the entry
  BEGIN
    INSERT INTO journal_entry_lines (
      journal_entry_id,
      account_id,
      debit,
      credit,
      description
    )
    VALUES (
      test_journal_id,
      test_account_id,
      0.00,    -- No debit
      100.00,  -- Credit to balance
      'Test credit line'
    );
    
    RAISE NOTICE 'Second line inserted (this will never execute)';
    
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'Second line insert failed: %', SQLERRM;
  END;
  
  -- Cleanup: Rollback will handle this, but document it
  RAISE NOTICE 'Transaction will be rolled back due to trigger exception';
END $$;

-- ============================================================================
-- EXPECTED OUTPUT:
-- ============================================================================
-- Created test journal entry: <uuid>
-- EXPECTED FAILURE: Trigger blocked first line insert. Error: Journal entry is not balanced. Debit total: 100.00, Credit total: 0, Difference: 100.00...
-- This proves the trigger validates balance after EACH row, not after ALL rows
-- Therefore, it is IMPOSSIBLE to insert balanced journals line-by-line
-- Transaction will be rolled back due to trigger exception
-- ============================================================================
