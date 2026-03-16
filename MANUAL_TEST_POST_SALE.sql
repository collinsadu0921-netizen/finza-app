-- ============================================================================
-- MANUAL TEST: Call post_sale_to_ledger directly and capture error
-- ============================================================================
-- This will show us the exact error message

SET client_min_messages TO NOTICE;

DO $$
DECLARE
  test_sale_id UUID;
  journal_entry_id UUID;
BEGIN
  -- Get the most recent test sale
  SELECT id INTO test_sale_id
  FROM sales
  WHERE description LIKE '%ROOT CAUSE TEST%'
  ORDER BY created_at DESC
  LIMIT 1;
  
  IF test_sale_id IS NULL THEN
    RAISE EXCEPTION 'No test sale found';
  END IF;
  
  RAISE NOTICE 'Testing with sale ID: %', test_sale_id;
  RAISE NOTICE '';
  RAISE NOTICE 'Calling post_sale_to_ledger...';
  RAISE NOTICE '>>> SCROLL DOWN TO SEE ALL DIAGNOSTIC OUTPUT <<<';
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
    RAISE NOTICE 'SUCCESS: Journal entry created: %', journal_entry_id;
    
    -- Verify it was created
    IF journal_entry_id IS NOT NULL THEN
      RAISE NOTICE 'Journal entry ID is not NULL - entry should exist in database';
    ELSE
      RAISE WARNING 'WARNING: Journal entry ID is NULL!';
    END IF;
    
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE '';
      RAISE NOTICE '============================================================================';
      RAISE NOTICE 'ERROR CAUGHT:';
      RAISE NOTICE '  SQLSTATE: %', SQLSTATE;
      RAISE NOTICE '  Error Message: %', SQLERRM;
      RAISE NOTICE '============================================================================';
      RAISE NOTICE '';
      RAISE NOTICE '>>> SCROLL UP TO SEE ALL "EVIDENCE" DIAGNOSTIC LINES <<<';
      RAISE NOTICE '';
      RAISE NOTICE 'This error explains why no journal entry was created.';
      RAISE NOTICE 'The diagnostic output above shows what journal_lines was passed to post_journal_entry.';
      RAISE NOTICE '';
      
      -- Re-raise to see full stack trace
      RAISE;
  END;
  
END $$;
