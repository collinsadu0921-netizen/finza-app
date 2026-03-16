-- ============================================================================
-- MIGRATION: Accountant Write Access Guard
-- ============================================================================
-- This migration adds a guard function to block accountant_readonly users
-- from performing write actions (period close/lock, adjustment creation).
--
-- Scope: Accounting Mode ONLY
-- ============================================================================

-- ============================================================================
-- STEP 1: ENSURE accountant_readonly COLUMN EXISTS
-- ============================================================================
-- Add accountant_readonly column if it doesn't exist
ALTER TABLE business_users
  ADD COLUMN IF NOT EXISTS accountant_readonly BOOLEAN DEFAULT false;

-- ============================================================================
-- STEP 2: CREATE GUARD FUNCTION
-- ============================================================================
-- Function: Check if user has accountant write access
-- Returns TRUE only if:
--   - user is business owner
--   OR
--   - role = 'accountant' AND accountant_readonly = false
CREATE OR REPLACE FUNCTION is_user_accountant_write(
  p_user_id UUID,
  p_business_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  user_role TEXT;
  user_accountant_readonly BOOLEAN;
BEGIN
  -- Check if user is business owner (they have full authority)
  IF EXISTS (
    SELECT 1 FROM businesses
    WHERE id = p_business_id
      AND owner_id = p_user_id
  ) THEN
    RETURN TRUE;
  END IF;
  
  -- Check if user has accountant role AND accountant_readonly is false
  SELECT role, COALESCE(accountant_readonly, false) INTO user_role, user_accountant_readonly
  FROM business_users
  WHERE user_id = p_user_id
    AND business_id = p_business_id;
  
  -- Return TRUE only if role is 'accountant' AND accountant_readonly is false
  RETURN (user_role = 'accountant' AND user_accountant_readonly = false);
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON FUNCTION is_user_accountant_write(UUID, UUID) IS 
'Guard function for accountant write access. Returns TRUE only if user is business owner OR (role = accountant AND accountant_readonly = false). Blocks accountant_readonly users from write actions.';





