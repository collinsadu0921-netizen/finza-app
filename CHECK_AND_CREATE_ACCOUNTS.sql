-- ============================================================================
-- CHECK AND CREATE REQUIRED ACCOUNTS FOR TEST BUSINESS
-- ============================================================================

SET client_min_messages TO NOTICE;

DO $$
DECLARE
  test_business_id UUID := '69278e9a-8694-4640-88d1-cbcfe7dd42f3';
  account_exists BOOLEAN;
  new_account_id UUID;
BEGIN
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'CHECKING AND CREATING REQUIRED ACCOUNTS';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Business ID: %', test_business_id;
  RAISE NOTICE '';
  
  -- Check existing accounts
  RAISE NOTICE 'Existing accounts:';
  FOR account_exists IN
    SELECT 
      account_code,
      account_name,
      account_type,
      is_active
    FROM chart_of_accounts
    WHERE business_id = test_business_id
    ORDER BY account_code
  LOOP
    RAISE NOTICE '  Found account: %', account_exists;
  END LOOP;
  
  -- Check for required accounts and create if missing
  RAISE NOTICE '';
  RAISE NOTICE 'Checking required accounts...';
  
  -- Account 1000: Cash (Asset)
  SELECT EXISTS(
    SELECT 1 FROM chart_of_accounts 
    WHERE business_id = test_business_id AND account_code = '1000'
  ) INTO account_exists;
  
  IF NOT account_exists THEN
    RAISE NOTICE '  Creating account 1000 (Cash)...';
    INSERT INTO chart_of_accounts (business_id, account_code, account_name, account_type, is_active)
    VALUES (test_business_id, '1000', 'Cash', 'asset', TRUE)
    RETURNING id INTO new_account_id;
    RAISE NOTICE '    Created: %', new_account_id;
  ELSE
    RAISE NOTICE '  Account 1000 (Cash) already exists';
  END IF;
  
  -- Account 4000: Revenue (Revenue)
  SELECT EXISTS(
    SELECT 1 FROM chart_of_accounts 
    WHERE business_id = test_business_id AND account_code = '4000'
  ) INTO account_exists;
  
  IF NOT account_exists THEN
    RAISE NOTICE '  Creating account 4000 (Revenue)...';
    INSERT INTO chart_of_accounts (business_id, account_code, account_name, account_type, is_active)
    VALUES (test_business_id, '4000', 'Revenue', 'revenue', TRUE)
    RETURNING id INTO new_account_id;
    RAISE NOTICE '    Created: %', new_account_id;
  ELSE
    RAISE NOTICE '  Account 4000 (Revenue) already exists';
  END IF;
  
  -- Account 2100: VAT Payable (Liability)
  SELECT EXISTS(
    SELECT 1 FROM chart_of_accounts 
    WHERE business_id = test_business_id AND account_code = '2100'
  ) INTO account_exists;
  
  IF NOT account_exists THEN
    RAISE NOTICE '  Creating account 2100 (VAT Payable)...';
    INSERT INTO chart_of_accounts (business_id, account_code, account_name, account_type, is_active)
    VALUES (test_business_id, '2100', 'VAT Payable', 'liability', TRUE)
    RETURNING id INTO new_account_id;
    RAISE NOTICE '    Created: %', new_account_id;
  ELSE
    RAISE NOTICE '  Account 2100 (VAT Payable) already exists';
  END IF;
  
  -- Account 5000: COGS (Expense) - optional but good to have
  SELECT EXISTS(
    SELECT 1 FROM chart_of_accounts 
    WHERE business_id = test_business_id AND account_code = '5000'
  ) INTO account_exists;
  
  IF NOT account_exists THEN
    RAISE NOTICE '  Creating account 5000 (COGS)...';
    INSERT INTO chart_of_accounts (business_id, account_code, account_name, account_type, is_active)
    VALUES (test_business_id, '5000', 'Cost of Goods Sold', 'expense', TRUE)
    RETURNING id INTO new_account_id;
    RAISE NOTICE '    Created: %', new_account_id;
  ELSE
    RAISE NOTICE '  Account 5000 (COGS) already exists';
  END IF;
  
  -- Account 1200: Inventory (Asset) - optional but good to have
  SELECT EXISTS(
    SELECT 1 FROM chart_of_accounts 
    WHERE business_id = test_business_id AND account_code = '1200'
  ) INTO account_exists;
  
  IF NOT account_exists THEN
    RAISE NOTICE '  Creating account 1200 (Inventory)...';
    INSERT INTO chart_of_accounts (business_id, account_code, account_name, account_type, is_active)
    VALUES (test_business_id, '1200', 'Inventory', 'asset', TRUE)
    RETURNING id INTO new_account_id;
    RAISE NOTICE '    Created: %', new_account_id;
  ELSE
    RAISE NOTICE '  Account 1200 (Inventory) already exists';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'ACCOUNT SETUP COMPLETE';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Now you can run MANUAL_TEST_POST_SALE.sql again to test the posting.';
  RAISE NOTICE '';
  
END $$;

-- Show all accounts for this business
SELECT 
  'ALL ACCOUNTS FOR BUSINESS' as section,
  account_code,
  account_name,
  account_type,
  is_active,
  id
FROM chart_of_accounts
WHERE business_id = '69278e9a-8694-4640-88d1-cbcfe7dd42f3'
ORDER BY account_code;
