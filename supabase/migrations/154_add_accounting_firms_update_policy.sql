-- ============================================================================
-- MIGRATION: Add UPDATE RLS policy for accounting_firms
-- ============================================================================
-- Problem: Partners cannot update firm onboarding status because there's
--          no UPDATE RLS policy on accounting_firms table.
-- Solution: Add UPDATE policy that allows Partners to update onboarding
--           fields using the existing SECURITY DEFINER helper function.
-- ============================================================================

-- ============================================================================
-- STEP 1: Add UPDATE policy for accounting_firms (Partners only)
-- ============================================================================
DROP POLICY IF EXISTS "Partners can update firm onboarding details" ON accounting_firms;

CREATE POLICY "Partners can update firm onboarding details"
  ON accounting_firms FOR UPDATE
  USING (
    -- Users can update firms where they are Partners
    -- Using helper function to avoid recursion (defined in migration 152)
    check_user_is_partner_in_firm(accounting_firms.id, auth.uid())
  )
  WITH CHECK (
    -- Also check on the new row values
    check_user_is_partner_in_firm(accounting_firms.id, auth.uid())
  );

COMMENT ON POLICY "Partners can update firm onboarding details" ON accounting_firms IS 
  'Allows Partners to update firm onboarding fields (onboarding_status, legal_name, jurisdiction, reporting_standard, default_accounting_standard).';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Added UPDATE RLS policy for accounting_firms';
  RAISE NOTICE '  - Partners can now update firm onboarding details';
  RAISE NOTICE '  - Uses check_user_is_partner_in_firm() helper to avoid recursion';
END $$;
