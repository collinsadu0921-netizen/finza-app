-- ============================================================================
-- MIGRATION: Remove 'professional' from Database Constraints
-- ============================================================================
-- This migration removes 'professional' as a valid industry value and adds
-- guards to prevent it from being reintroduced.
--
-- Prerequisites:
-- - Migration 201 must have run successfully (all Professional businesses converted)

-- ============================================================================
-- STEP 1: Verify no Professional businesses remain
-- ============================================================================
DO $$
DECLARE
  professional_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO professional_count
  FROM businesses
  WHERE industry = 'professional';
  
  IF professional_count > 0 THEN
    RAISE EXCEPTION 'ABORT: % Professional businesses still exist. Run migration 201 first.', 
      professional_count;
  END IF;
  
  RAISE NOTICE 'Verification passed: No Professional businesses remain';
END $$;

-- ============================================================================
-- STEP 2: Update trigger function to only check for 'service'
-- ============================================================================
-- Revert the change from migration 200 - now that all Professional businesses
-- are converted, we only need to check for 'service'
CREATE OR REPLACE FUNCTION trigger_create_system_accounts()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create accounts for service businesses (where accounting is used)
  -- Note: 'professional' has been removed - all converted to 'service'
  IF NEW.industry = 'service' THEN
    PERFORM create_system_accounts(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 3: Add guard function to prevent 'professional' from being set
-- ============================================================================
CREATE OR REPLACE FUNCTION guard_industry_value()
RETURNS TRIGGER AS $$
BEGIN
  -- Prevent 'professional' from being set (it has been removed)
  IF NEW.industry = 'professional' THEN
    RAISE EXCEPTION 'Industry value "professional" is no longer supported. Use "service" instead.';
  END IF;
  
  -- Ensure only valid industry values are allowed
  IF NEW.industry NOT IN ('retail', 'service', 'logistics') THEN
    RAISE EXCEPTION 'Invalid industry value: %. Valid values are: retail, service, logistics', NEW.industry;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to enforce industry validation
DROP TRIGGER IF EXISTS trigger_guard_industry_value ON businesses;
CREATE TRIGGER trigger_guard_industry_value
  BEFORE INSERT OR UPDATE ON businesses
  FOR EACH ROW
  EXECUTE FUNCTION guard_industry_value();

-- ============================================================================
-- STEP 4: Update any existing businesses that might have 'professional'
-- ============================================================================
-- This is a safety net in case any businesses were created between migrations
DO $$
DECLARE
  converted_count INTEGER;
BEGIN
  UPDATE businesses
  SET industry = 'service'
  WHERE industry = 'professional';
  
  GET DIAGNOSTICS converted_count = ROW_COUNT;
  
  IF converted_count > 0 THEN
    RAISE WARNING 'Converted % additional Professional businesses to Service (safety net)', 
      converted_count;
  END IF;
END $$;

-- ============================================================================
-- STEP 5: Final verification
-- ============================================================================
DO $$
DECLARE
  professional_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO professional_count
  FROM businesses
  WHERE industry = 'professional';
  
  IF professional_count > 0 THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: % Professional businesses still exist', 
      professional_count;
  END IF;
  
  RAISE NOTICE 'VERIFICATION PASSED: No Professional businesses exist (count: %)', 
    professional_count;
END $$;

-- ============================================================================
-- COMMENT
-- ============================================================================
COMMENT ON FUNCTION guard_industry_value() IS 
  'Prevents "professional" industry from being set. Professional has been removed and merged into "service".';
  
COMMENT ON FUNCTION trigger_create_system_accounts() IS 
  'Auto-creates system accounts for service businesses. Professional has been removed - all converted to service.';
