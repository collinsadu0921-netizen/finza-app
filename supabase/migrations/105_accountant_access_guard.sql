-- ============================================================================
-- MIGRATION: Accountant Firm Access Guard Function
-- ============================================================================
-- This migration creates a guard function to determine whether a user can
-- READ or WRITE for a given business via their accountant firm membership.
--
-- Scope: Accounting Mode ONLY
-- ============================================================================

-- ============================================================================
-- CREATE GUARD FUNCTION
-- ============================================================================
-- Function: Check if user can access business via accountant firm
-- Returns:
--   - 'write' if user is business owner
--   - access_level ('readonly' or 'write') if user is in accountant firm with access
--   - NULL if no access
CREATE OR REPLACE FUNCTION can_accountant_access_business(
  p_user_id UUID,
  p_business_id UUID
)
RETURNS TEXT AS $$
DECLARE
  v_access_level TEXT;
BEGIN
  -- Check if user is business owner (they have full write access)
  IF EXISTS (
    SELECT 1 FROM businesses
    WHERE id = p_business_id
      AND owner_id = p_user_id
  ) THEN
    RETURN 'write';
  END IF;
  
  -- Check if user is in accountant_firm_users AND firm has accountant_client_access for business
  SELECT aca.access_level INTO v_access_level
  FROM accountant_firm_users afu
  INNER JOIN accountant_client_access aca
    ON afu.firm_id = aca.firm_id
  WHERE afu.user_id = p_user_id
    AND aca.business_id = p_business_id
  LIMIT 1;
  
  -- Return access_level if found, NULL otherwise
  RETURN v_access_level;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON FUNCTION can_accountant_access_business(UUID, UUID) IS 
'Guard function for accountant firm access to client businesses. Returns access_level (write/readonly) if user has access via their firm membership, or NULL if no access. Business owners always return write.';

