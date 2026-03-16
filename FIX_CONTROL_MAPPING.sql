-- ============================================================================
-- FIX CONTROL MAPPING: Ensure CASH -> 1000 mapping exists
-- ============================================================================

SET client_min_messages TO NOTICE;

DO $$
DECLARE
  test_business_id UUID := '69278e9a-8694-4640-88d1-cbcfe7dd42f3';
  mapping_id UUID;
BEGIN
  RAISE NOTICE 'Creating/Updating CASH -> 1000 control mapping...';
  
  -- Insert or update the mapping
  INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
  VALUES (test_business_id, 'CASH', '1000')
  ON CONFLICT (business_id, control_key) 
  DO UPDATE SET account_code = '1000'
  RETURNING id INTO mapping_id;
  
  RAISE NOTICE 'Control mapping created/updated: %', mapping_id;
  RAISE NOTICE '';
  RAISE NOTICE 'Verifying mapping exists...';
  
  -- Verify it exists
  SELECT id INTO mapping_id
  FROM chart_of_accounts_control_map
  WHERE business_id = test_business_id
    AND control_key = 'CASH'
    AND account_code = '1000';
  
  IF mapping_id IS NOT NULL THEN
    RAISE NOTICE 'SUCCESS: Control mapping verified';
  ELSE
    RAISE EXCEPTION 'FAILED: Control mapping not found after creation';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'Testing get_control_account_code function...';
  
  DECLARE
    resolved_code TEXT;
    resolved_id UUID;
  BEGIN
    SELECT get_control_account_code(test_business_id, 'CASH') INTO resolved_code;
    RAISE NOTICE 'get_control_account_code returned: %', resolved_code;
    
    IF resolved_code = '1000' THEN
      RAISE NOTICE 'SUCCESS: Control code resolution works';
    ELSE
      RAISE EXCEPTION 'FAILED: Expected 1000, got %', resolved_code;
    END IF;
    
    SELECT get_account_by_control_key(test_business_id, 'CASH') INTO resolved_id;
    RAISE NOTICE 'get_account_by_control_key returned: %', resolved_id;
    
    IF resolved_id IS NOT NULL THEN
      RAISE NOTICE 'SUCCESS: Account ID resolution works';
    ELSE
      RAISE EXCEPTION 'FAILED: Account ID is NULL';
    END IF;
  END;
  
  RAISE NOTICE '';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'CONTROL MAPPING FIXED - Ready to test posting';
  RAISE NOTICE '============================================================================';
  
END $$;
