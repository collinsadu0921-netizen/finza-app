-- ============================================================================
-- CREATE ACCOUNTS IN accounts TABLE (required for journal entries)
-- ============================================================================
-- journal_entry_lines.account_id references accounts.id, not chart_of_accounts.id
-- We need accounts in BOTH tables

SET client_min_messages TO NOTICE;

DO $$
DECLARE
  test_business_id UUID := '69278e9a-8694-4640-88d1-cbcfe7dd42f3';
  account_exists BOOLEAN;
  new_account_id UUID;
BEGIN
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'CREATING ACCOUNTS IN accounts TABLE';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Business ID: %', test_business_id;
  RAISE NOTICE '';
  
  -- Account 1000: Cash (Asset)
  SELECT EXISTS(
    SELECT 1 FROM accounts 
    WHERE business_id = test_business_id AND code = '1000' AND deleted_at IS NULL
  ) INTO account_exists;
  
  IF NOT account_exists THEN
    RAISE NOTICE '  Creating account 1000 (Cash) in accounts table...';
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (test_business_id, 'Cash', '1000', 'asset', 'Cash account', TRUE)
    ON CONFLICT (business_id, code) DO UPDATE SET deleted_at = NULL
    RETURNING id INTO new_account_id;
    RAISE NOTICE '    Created: %', new_account_id;
  ELSE
    RAISE NOTICE '  Account 1000 (Cash) already exists in accounts table';
    -- Ensure it's not deleted
    UPDATE accounts SET deleted_at = NULL WHERE business_id = test_business_id AND code = '1000';
  END IF;
  
  -- Account 4000: Revenue (Revenue/Income)
  SELECT EXISTS(
    SELECT 1 FROM accounts 
    WHERE business_id = test_business_id AND code = '4000' AND deleted_at IS NULL
  ) INTO account_exists;
  
  IF NOT account_exists THEN
    RAISE NOTICE '  Creating account 4000 (Revenue) in accounts table...';
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (test_business_id, 'Revenue', '4000', 'income', 'Service Revenue', TRUE)
    ON CONFLICT (business_id, code) DO UPDATE SET deleted_at = NULL
    RETURNING id INTO new_account_id;
    RAISE NOTICE '    Created: %', new_account_id;
  ELSE
    RAISE NOTICE '  Account 4000 (Revenue) already exists in accounts table';
    UPDATE accounts SET deleted_at = NULL WHERE business_id = test_business_id AND code = '4000';
  END IF;
  
  -- Account 2100: VAT Payable (Liability)
  SELECT EXISTS(
    SELECT 1 FROM accounts 
    WHERE business_id = test_business_id AND code = '2100' AND deleted_at IS NULL
  ) INTO account_exists;
  
  IF NOT account_exists THEN
    RAISE NOTICE '  Creating account 2100 (VAT Payable) in accounts table...';
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (test_business_id, 'VAT Payable', '2100', 'liability', 'VAT Payable', TRUE)
    ON CONFLICT (business_id, code) DO UPDATE SET deleted_at = NULL
    RETURNING id INTO new_account_id;
    RAISE NOTICE '    Created: %', new_account_id;
  ELSE
    RAISE NOTICE '  Account 2100 (VAT Payable) already exists in accounts table';
    UPDATE accounts SET deleted_at = NULL WHERE business_id = test_business_id AND code = '2100';
  END IF;
  
  -- Account 5000: COGS (Expense) - optional but good to have
  SELECT EXISTS(
    SELECT 1 FROM accounts 
    WHERE business_id = test_business_id AND code = '5000' AND deleted_at IS NULL
  ) INTO account_exists;
  
  IF NOT account_exists THEN
    RAISE NOTICE '  Creating account 5000 (COGS) in accounts table...';
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (test_business_id, 'Cost of Goods Sold', '5000', 'expense', 'COGS', TRUE)
    ON CONFLICT (business_id, code) DO UPDATE SET deleted_at = NULL
    RETURNING id INTO new_account_id;
    RAISE NOTICE '    Created: %', new_account_id;
  ELSE
    RAISE NOTICE '  Account 5000 (COGS) already exists in accounts table';
    UPDATE accounts SET deleted_at = NULL WHERE business_id = test_business_id AND code = '5000';
  END IF;
  
  -- Account 1200: Inventory (Asset) - optional but good to have
  SELECT EXISTS(
    SELECT 1 FROM accounts 
    WHERE business_id = test_business_id AND code = '1200' AND deleted_at IS NULL
  ) INTO account_exists;
  
  IF NOT account_exists THEN
    RAISE NOTICE '  Creating account 1200 (Inventory) in accounts table...';
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (test_business_id, 'Inventory', '1200', 'asset', 'Inventory', TRUE)
    ON CONFLICT (business_id, code) DO UPDATE SET deleted_at = NULL
    RETURNING id INTO new_account_id;
    RAISE NOTICE '    Created: %', new_account_id;
  ELSE
    RAISE NOTICE '  Account 1200 (Inventory) already exists in accounts table';
    UPDATE accounts SET deleted_at = NULL WHERE business_id = test_business_id AND code = '1200';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'ACCOUNTS CREATED IN accounts TABLE';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Now test get_account_by_code function...';
  
  DECLARE
    test_account_id UUID;
  BEGIN
    SELECT get_account_by_code(test_business_id, '1000') INTO test_account_id;
    IF test_account_id IS NOT NULL THEN
      RAISE NOTICE 'SUCCESS: get_account_by_code(''1000'') returned: %', test_account_id;
    ELSE
      RAISE EXCEPTION 'FAILED: get_account_by_code returned NULL';
    END IF;
    
    SELECT get_account_by_control_key(test_business_id, 'CASH') INTO test_account_id;
    IF test_account_id IS NOT NULL THEN
      RAISE NOTICE 'SUCCESS: get_account_by_control_key(''CASH'') returned: %', test_account_id;
    ELSE
      RAISE EXCEPTION 'FAILED: get_account_by_control_key returned NULL';
    END IF;
  END;
  
  RAISE NOTICE '';
  RAISE NOTICE 'Ready to test posting! Run MANUAL_TEST_POST_SALE.sql';
  
END $$;

-- Show all accounts in accounts table for this business
SELECT 
  'ACCOUNTS IN accounts TABLE' as section,
  code,
  name,
  type,
  is_system,
  deleted_at,
  id
FROM accounts
WHERE business_id = '69278e9a-8694-4640-88d1-cbcfe7dd42f3'
  AND deleted_at IS NULL
ORDER BY code;
