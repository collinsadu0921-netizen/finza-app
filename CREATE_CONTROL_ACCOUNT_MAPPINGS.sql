-- ============================================================================
-- CREATE CONTROL ACCOUNT MAPPINGS FOR TEST BUSINESS
-- ============================================================================
-- The function uses control keys (like 'CASH') that map to account codes
-- We need to create mappings in chart_of_accounts_control_map table
-- ============================================================================

SET client_min_messages TO NOTICE;

DO $$
DECLARE
  test_business_id UUID := '69278e9a-8694-4640-88d1-cbcfe7dd42f3';
  mapping_exists BOOLEAN;
  new_mapping_id UUID;
BEGIN
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'CREATING CONTROL ACCOUNT MAPPINGS';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Business ID: %', test_business_id;
  RAISE NOTICE '';
  
  -- Check existing mappings
  RAISE NOTICE 'Existing control account mappings:';
  FOR mapping_exists IN
    SELECT control_key, account_code
    FROM chart_of_accounts_control_map
    WHERE business_id = test_business_id
    ORDER BY control_key
  LOOP
    RAISE NOTICE '  Found mapping: %', mapping_exists;
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE 'Creating required control account mappings...';
  
  -- CASH control key -> 1000
  SELECT EXISTS(
    SELECT 1 FROM chart_of_accounts_control_map 
    WHERE business_id = test_business_id AND control_key = 'CASH'
  ) INTO mapping_exists;
  
  IF NOT mapping_exists THEN
    RAISE NOTICE '  Creating CASH -> 1000 mapping...';
    INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
    VALUES (test_business_id, 'CASH', '1000')
    ON CONFLICT (business_id, control_key) DO UPDATE SET account_code = '1000'
    RETURNING id INTO new_mapping_id;
    RAISE NOTICE '    Created/Updated: %', new_mapping_id;
  ELSE
    RAISE NOTICE '  CASH -> 1000 mapping already exists';
    -- Update it to ensure it's correct
    UPDATE chart_of_accounts_control_map
    SET account_code = '1000'
    WHERE business_id = test_business_id AND control_key = 'CASH';
    RAISE NOTICE '    Updated to ensure correct mapping';
  END IF;
  
  -- BANK control key -> 1010 (optional, but good to have)
  SELECT EXISTS(
    SELECT 1 FROM chart_of_accounts_control_map 
    WHERE business_id = test_business_id AND control_key = 'BANK'
  ) INTO mapping_exists;
  
  IF NOT mapping_exists THEN
    -- Check if account 1010 exists, if not create it
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = test_business_id AND account_code = '1010') THEN
      INSERT INTO chart_of_accounts (business_id, account_code, account_name, account_type, is_active)
      VALUES (test_business_id, '1010', 'Bank Account', 'asset', TRUE);
      RAISE NOTICE '    Created account 1010 (Bank Account)';
    END IF;
    
    RAISE NOTICE '  Creating BANK -> 1010 mapping...';
    INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
    VALUES (test_business_id, 'BANK', '1010')
    ON CONFLICT (business_id, control_key) DO UPDATE SET account_code = '1010'
    RETURNING id INTO new_mapping_id;
    RAISE NOTICE '    Created/Updated: %', new_mapping_id;
  ELSE
    RAISE NOTICE '  BANK -> 1010 mapping already exists';
  END IF;
  
  -- AR (Accounts Receivable) control key -> 1100 (optional, but good to have)
  SELECT EXISTS(
    SELECT 1 FROM chart_of_accounts_control_map 
    WHERE business_id = test_business_id AND control_key = 'AR'
  ) INTO mapping_exists;
  
  IF NOT mapping_exists THEN
    -- Check if account 1100 exists, if not create it
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = test_business_id AND account_code = '1100') THEN
      INSERT INTO chart_of_accounts (business_id, account_code, account_name, account_type, is_active)
      VALUES (test_business_id, '1100', 'Accounts Receivable', 'asset', TRUE);
      RAISE NOTICE '    Created account 1100 (Accounts Receivable)';
    END IF;
    
    RAISE NOTICE '  Creating AR -> 1100 mapping...';
    INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
    VALUES (test_business_id, 'AR', '1100')
    ON CONFLICT (business_id, control_key) DO UPDATE SET account_code = '1100'
    RETURNING id INTO new_mapping_id;
    RAISE NOTICE '    Created/Updated: %', new_mapping_id;
  ELSE
    RAISE NOTICE '  AR -> 1100 mapping already exists';
  END IF;
  
  -- AP (Accounts Payable) control key -> 2000 (optional, but good to have)
  SELECT EXISTS(
    SELECT 1 FROM chart_of_accounts_control_map 
    WHERE business_id = test_business_id AND control_key = 'AP'
  ) INTO mapping_exists;
  
  IF NOT mapping_exists THEN
    -- Check if account 2000 exists, if not create it
    IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = test_business_id AND account_code = '2000') THEN
      INSERT INTO chart_of_accounts (business_id, account_code, account_name, account_type, is_active)
      VALUES (test_business_id, '2000', 'Accounts Payable', 'liability', TRUE);
      RAISE NOTICE '    Created account 2000 (Accounts Payable)';
    END IF;
    
    RAISE NOTICE '  Creating AP -> 2000 mapping...';
    INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
    VALUES (test_business_id, 'AP', '2000')
    ON CONFLICT (business_id, control_key) DO UPDATE SET account_code = '2000'
    RETURNING id INTO new_mapping_id;
    RAISE NOTICE '    Created/Updated: %', new_mapping_id;
  ELSE
    RAISE NOTICE '  AP -> 2000 mapping already exists';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'CONTROL ACCOUNT MAPPINGS COMPLETE';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Now you can run MANUAL_TEST_POST_SALE.sql again to test the posting.';
  RAISE NOTICE '';
  
END $$;

-- Show all control account mappings for this business
SELECT 
  'CONTROL ACCOUNT MAPPINGS' as section,
  control_key,
  account_code,
  id
FROM chart_of_accounts_control_map
WHERE business_id = '69278e9a-8694-4640-88d1-cbcfe7dd42f3'
ORDER BY control_key;
