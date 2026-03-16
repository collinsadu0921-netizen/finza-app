-- ============================================================================
-- MIGRATION: Accounting Mode A4.2 - COA Validation Functions
-- ============================================================================
-- This migration adds functions to validate account codes and control mappings.
-- NO posting logic changes.
--
-- Scope: Accounting Mode ONLY
-- No posting logic modifications, no guards, no refactoring
-- ============================================================================

-- ============================================================================
-- STEP 1: assert_account_exists
-- ============================================================================
CREATE OR REPLACE FUNCTION assert_account_exists(
  p_business_id UUID,
  p_account_code TEXT
)
RETURNS VOID AS $$
DECLARE
  account_record RECORD;
BEGIN
  -- Account must exist in chart_of_accounts
  SELECT * INTO account_record
  FROM chart_of_accounts
  WHERE business_id = p_business_id
    AND account_code = p_account_code
  LIMIT 1;

  -- If not found or not active, raise exception
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid account code for this business: %', p_account_code;
  END IF;

  -- Account must be active
  IF NOT account_record.is_active THEN
    RAISE EXCEPTION 'Invalid account code for this business: %', p_account_code;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 2: get_control_account_code
-- ============================================================================
CREATE OR REPLACE FUNCTION get_control_account_code(
  p_business_id UUID,
  p_control_key TEXT
)
RETURNS TEXT AS $$
DECLARE
  mapped_account_code TEXT;
  account_record RECORD;
BEGIN
  -- Must exist in chart_of_accounts_control_map
  SELECT account_code INTO mapped_account_code
  FROM chart_of_accounts_control_map
  WHERE business_id = p_business_id
    AND control_key = p_control_key
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Missing control account mapping: %', p_control_key;
  END IF;

  -- Mapped account must exist & be active
  SELECT * INTO account_record
  FROM chart_of_accounts
  WHERE business_id = p_business_id
    AND account_code = mapped_account_code
    AND is_active = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Missing control account mapping: %', p_control_key;
  END IF;

  RETURN mapped_account_code;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VERIFICATION: Functions created successfully
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Accounting Mode A4.2: COA validation functions created';
  RAISE NOTICE '  - assert_account_exists: Validates account exists and is active';
  RAISE NOTICE '  - get_control_account_code: Gets and validates control account mapping';
  RAISE NOTICE '  - NO posting logic modifications';
  RAISE NOTICE '  - NO guards added';
  RAISE NOTICE '  - NO refactoring';
END;
$$;





