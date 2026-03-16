-- ============================================================================
-- MIGRATION: Convert Professional Businesses to Service
-- ============================================================================
-- This migration converts all businesses with industry = 'professional'
-- to industry = 'service', completing the collapse of Professional into Service.
--
-- Prerequisites:
-- - Migration 200 must have run successfully (system accounts created)
-- - All Professional businesses must have system accounts

-- ============================================================================
-- STEP 1: Pre-conversion verification
-- ============================================================================
DO $$
DECLARE
  professional_count INTEGER;
  businesses_without_accounts INTEGER;
BEGIN
  -- Count Professional businesses
  SELECT COUNT(*) INTO professional_count
  FROM businesses
  WHERE industry = 'professional';
  
  RAISE NOTICE 'Found % Professional businesses to convert', professional_count;
  
  -- Verify all Professional businesses have system accounts
  SELECT COUNT(DISTINCT b.id) INTO businesses_without_accounts
  FROM businesses b
  WHERE b.industry = 'professional'
    AND NOT EXISTS (
      SELECT 1 FROM accounts a
      WHERE a.business_id = b.id
        AND a.code IN ('1000', '1100', '4000')  -- Cash, AR, Revenue
        AND a.deleted_at IS NULL
    );
  
  IF businesses_without_accounts > 0 THEN
    RAISE EXCEPTION 'ABORT: % Professional businesses missing system accounts. Run migration 200 first.', 
      businesses_without_accounts;
  END IF;
  
  RAISE NOTICE 'Verification passed: All Professional businesses have system accounts';
END $$;

-- ============================================================================
-- STEP 2: Convert Professional businesses to Service
-- ============================================================================
DO $$
DECLARE
  converted_count INTEGER;
BEGIN
  -- Convert all Professional businesses to Service
  UPDATE businesses
  SET industry = 'service'
  WHERE industry = 'professional';
  
  GET DIAGNOSTICS converted_count = ROW_COUNT;
  
  RAISE NOTICE 'Converted % Professional businesses to Service', converted_count;
END $$;

-- ============================================================================
-- STEP 3: Post-conversion verification
-- ============================================================================
DO $$
DECLARE
  remaining_professional_count INTEGER;
BEGIN
  -- Verify no Professional businesses remain
  SELECT COUNT(*) INTO remaining_professional_count
  FROM businesses
  WHERE industry = 'professional';
  
  IF remaining_professional_count > 0 THEN
    RAISE EXCEPTION 'CONVERSION FAILED: % Professional businesses still exist', 
      remaining_professional_count;
  END IF;
  
  RAISE NOTICE 'VERIFICATION PASSED: No Professional businesses remain (count: %)', 
    remaining_professional_count;
END $$;

-- ============================================================================
-- COMMENT
-- ============================================================================
-- This migration completes the conversion of Professional to Service.
-- Next step: Remove 'professional' from database constraints (Phase 3).
