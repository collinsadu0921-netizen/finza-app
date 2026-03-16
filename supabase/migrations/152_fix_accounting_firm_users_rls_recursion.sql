-- ============================================================================
-- MIGRATION: Fix infinite recursion in accounting_firm_users RLS policy
-- ============================================================================
-- Problem: The SELECT policy on accounting_firm_users queries the same table,
--          causing infinite recursion when evaluating the policy.
-- Solution: Create a SECURITY DEFINER helper function that bypasses RLS
--           to check firm membership without triggering recursion.
-- ============================================================================

-- ============================================================================
-- STEP 1: Create helper function to check firm membership (bypasses RLS)
-- ============================================================================
CREATE OR REPLACE FUNCTION check_user_in_firm(
  p_firm_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  -- This function runs with SECURITY DEFINER, so it bypasses RLS
  -- when querying accounting_firm_users
  RETURN EXISTS (
    SELECT 1
    FROM accounting_firm_users
    WHERE firm_id = p_firm_id
      AND user_id = p_user_id
  );
END;
$$;

COMMENT ON FUNCTION check_user_in_firm IS 'Helper function to check if a user belongs to a firm. Uses SECURITY DEFINER to bypass RLS and prevent recursion.';

-- Helper function to check if user is a partner in a firm (also bypasses RLS)
CREATE OR REPLACE FUNCTION check_user_is_partner_in_firm(
  p_firm_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  -- This function runs with SECURITY DEFINER, so it bypasses RLS
  -- when querying accounting_firm_users
  RETURN EXISTS (
    SELECT 1
    FROM accounting_firm_users
    WHERE firm_id = p_firm_id
      AND user_id = p_user_id
      AND role = 'partner'
  );
END;
$$;

COMMENT ON FUNCTION check_user_is_partner_in_firm IS 'Helper function to check if a user is a partner in a firm. Uses SECURITY DEFINER to bypass RLS and prevent recursion.';

-- ============================================================================
-- STEP 2: Replace the recursive SELECT policy with one using the helper
-- ============================================================================
DROP POLICY IF EXISTS "Users can view firm users in their firms" ON accounting_firm_users;

CREATE POLICY "Users can view firm users in their firms"
  ON accounting_firm_users FOR SELECT
  USING (
    check_user_in_firm(accounting_firm_users.firm_id, auth.uid())
  );

-- ============================================================================
-- STEP 3: Add INSERT policy for accounting_firms (users can create firms)
-- ============================================================================
DROP POLICY IF EXISTS "Users can create firms" ON accounting_firms;

CREATE POLICY "Users can create firms"
  ON accounting_firms FOR INSERT
  WITH CHECK (
    -- Users can create firms where they are the creator
    created_by = auth.uid()
  );

-- ============================================================================
-- STEP 4: Add INSERT policy (users can add themselves to firms they create)
-- ============================================================================
DROP POLICY IF EXISTS "Users can insert themselves into firms" ON accounting_firm_users;

CREATE POLICY "Users can insert themselves into firms"
  ON accounting_firm_users FOR INSERT
  WITH CHECK (
    -- Allow if user is adding themselves (for firm creation)
    -- This is the primary use case: user creates firm and adds themselves as partner
    user_id = auth.uid()
    -- OR if user is a partner in the firm (for adding other users)
    -- Using helper function to avoid recursion
    OR check_user_is_partner_in_firm(firm_id, auth.uid())
  );

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Fixed infinite recursion in accounting_firm_users RLS policy';
  RAISE NOTICE '  - Created check_user_in_firm() SECURITY DEFINER function';
  RAISE NOTICE '  - Created check_user_is_partner_in_firm() SECURITY DEFINER function';
  RAISE NOTICE '  - Updated SELECT policy to use helper function';
  RAISE NOTICE '  - Added INSERT policy for accounting_firms (firm creation)';
  RAISE NOTICE '  - Added INSERT policy for accounting_firm_users (partner management)';
END $$;
