-- ============================================================================
-- VERIFY CONTROL ACCOUNT MAPPING AND TEST RESOLUTION
-- ============================================================================

SET client_min_messages TO NOTICE;

-- 1. Check if control mapping exists
SELECT 
  '1. CONTROL MAPPING CHECK' as check_item,
  control_key,
  account_code,
  id
FROM chart_of_accounts_control_map
WHERE business_id = '69278e9a-8694-4640-88d1-cbcfe7dd42f3'
  AND control_key = 'CASH';

-- 2. Check if account 1000 exists
SELECT 
  '2. ACCOUNT 1000 CHECK' as check_item,
  account_code,
  account_name,
  account_type,
  is_active,
  id
FROM chart_of_accounts
WHERE business_id = '69278e9a-8694-4640-88d1-cbcfe7dd42f3'
  AND account_code = '1000';

-- 3. Test get_control_account_code function
DO $$
DECLARE
  test_business_id UUID := '69278e9a-8694-4640-88d1-cbcfe7dd42f3';
  cash_account_code TEXT;
  cash_account_id UUID;
BEGIN
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'TESTING CONTROL ACCOUNT RESOLUTION';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  
  -- Test get_control_account_code
  BEGIN
    SELECT get_control_account_code(test_business_id, 'CASH') INTO cash_account_code;
    RAISE NOTICE 'get_control_account_code(''CASH'') returned: %', cash_account_code;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'ERROR calling get_control_account_code: %', SQLERRM;
  END;
  
  -- Test get_account_by_code
  IF cash_account_code IS NOT NULL THEN
    BEGIN
      SELECT get_account_by_code(test_business_id, cash_account_code) INTO cash_account_id;
      RAISE NOTICE 'get_account_by_code(''%'') returned: %', cash_account_code, cash_account_id;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'ERROR calling get_account_by_code: %', SQLERRM;
    END;
  END IF;
  
  -- Test get_account_by_control_key (the function used in post_sale_to_ledger)
  BEGIN
    SELECT get_account_by_control_key(test_business_id, 'CASH') INTO cash_account_id;
    RAISE NOTICE 'get_account_by_control_key(''CASH'') returned: %', cash_account_id;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'ERROR calling get_account_by_control_key: %', SQLERRM;
  END;
  
  RAISE NOTICE '';
  RAISE NOTICE '============================================================================';
  
END $$;
