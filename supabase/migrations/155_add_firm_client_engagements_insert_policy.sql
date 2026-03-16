-- ============================================================================
-- MIGRATION: Add INSERT RLS policy for firm_client_engagements
-- ============================================================================
-- Problem: No INSERT policy exists, blocking all engagement creation
-- Solution: Add policy allowing Partners/Seniors to create engagements
-- Scope: Accounting Workspace ONLY
-- ============================================================================

-- Policy: Partners and Seniors can create engagements for their firm
DROP POLICY IF EXISTS "Partners and Seniors can create engagements" ON firm_client_engagements;

CREATE POLICY "Partners and Seniors can create engagements"
  ON firm_client_engagements FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = firm_client_engagements.accounting_firm_id
        AND accounting_firm_users.user_id = auth.uid()
        AND accounting_firm_users.role IN ('partner', 'senior')
    )
  );

COMMENT ON POLICY "Partners and Seniors can create engagements" ON firm_client_engagements IS 
  'Allows Partners and Seniors to create new firm-client engagements. Enforces role-based access control.';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Added INSERT RLS policy for firm_client_engagements';
  RAISE NOTICE '  - Partners and Seniors can now create engagements';
  RAISE NOTICE '  - Policy enforces role-based access control';
END $$;
