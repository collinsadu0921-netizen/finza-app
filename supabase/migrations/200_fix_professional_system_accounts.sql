-- ============================================================================
-- MIGRATION: Fix Professional System Account Creation Bug
-- ============================================================================
-- This migration fixes the critical bug where Professional businesses
-- don't get system accounts created automatically, breaking accounting.
--
-- Phase 1 of removing 'professional' industry: Ensure all Professional
-- businesses have system accounts before converting to 'service'.

-- ============================================================================
-- STEP 1: Update trigger function to include 'professional'
-- ============================================================================
CREATE OR REPLACE FUNCTION trigger_create_system_accounts()
RETURNS TRIGGER AS $$
BEGIN
  -- Create accounts for service and professional businesses (where accounting is used)
  -- Note: This will be updated in Phase 3 to only check for 'service' after conversion
  IF NEW.industry IN ('service', 'professional') THEN
    PERFORM create_system_accounts(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 2: Backfill system accounts for existing Professional businesses
-- ============================================================================
-- This ensures all existing Professional businesses have system accounts
-- Idempotent: Uses ON CONFLICT DO NOTHING in create_system_accounts()
DO $$
DECLARE
  business_record RECORD;
  account_count INTEGER;
BEGIN
  -- Count Professional businesses
  SELECT COUNT(*) INTO account_count
  FROM businesses
  WHERE industry = 'professional';
  
  RAISE NOTICE 'Found % Professional businesses to backfill system accounts', account_count;
  
  -- Backfill system accounts for each Professional business
  FOR business_record IN 
    SELECT id, name FROM businesses WHERE industry = 'professional'
  LOOP
    -- Create system accounts if they don't exist (idempotent)
    PERFORM create_system_accounts(business_record.id);
    
    RAISE NOTICE 'Created system accounts for Professional business: % (ID: %)', 
      business_record.name, business_record.id;
  END LOOP;
  
  RAISE NOTICE 'Completed backfill of system accounts for Professional businesses';
END $$;

-- ============================================================================
-- STEP 3: Verification - Ensure all Professional businesses have system accounts
-- ============================================================================
DO $$
DECLARE
  business_record RECORD;
  missing_accounts_count INTEGER;
  total_professional_businesses INTEGER;
  businesses_with_missing_accounts TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Count total Professional businesses
  SELECT COUNT(*) INTO total_professional_businesses
  FROM businesses
  WHERE industry = 'professional';
  
  -- Check each Professional business for required system accounts
  FOR business_record IN 
    SELECT id, name FROM businesses WHERE industry = 'professional'
  LOOP
    -- Check for critical system accounts (Cash, AR, Revenue)
    SELECT COUNT(*) INTO missing_accounts_count
    FROM accounts
    WHERE business_id = business_record.id
      AND code IN ('1000', '1100', '4000')  -- Cash, AR, Revenue
      AND deleted_at IS NULL;
    
    -- If any critical account is missing, add to list
    IF missing_accounts_count < 3 THEN
      businesses_with_missing_accounts := array_append(
        businesses_with_missing_accounts,
        format('%s (ID: %)', business_record.name, business_record.id)
      );
    END IF;
  END LOOP;
  
  -- Report results
  IF array_length(businesses_with_missing_accounts, 1) > 0 THEN
    RAISE WARNING 'VERIFICATION FAILED: % Professional businesses missing system accounts: %', 
      array_length(businesses_with_missing_accounts, 1),
      array_to_string(businesses_with_missing_accounts, ', ');
  ELSE
    RAISE NOTICE 'VERIFICATION PASSED: All % Professional businesses have system accounts', 
      total_professional_businesses;
  END IF;
END $$;

-- ============================================================================
-- COMMENT
-- ============================================================================
COMMENT ON FUNCTION trigger_create_system_accounts() IS 
  'Auto-creates system accounts for service and professional businesses. Will be updated in Phase 3 to only check for service after professional→service conversion.';
