-- ============================================================================
-- Migration 280: Owners can view firms with any engagement (including pending)
-- ============================================================================
-- Service invitations UI needs to show firm name/contact for pending invitations.
-- Existing policy (279) allows SELECT only when engagement is accepted/active.
-- This adds a policy so business owners can SELECT accounting_firms when they
-- have any firm_client_engagement (any status) with that firm for their business.
-- ============================================================================

DROP POLICY IF EXISTS "Business owners can view firms with any engagement for their business" ON accounting_firms;
CREATE POLICY "Business owners can view firms with any engagement for their business"
  ON accounting_firms FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM firm_client_engagements fce
      INNER JOIN businesses b ON b.id = fce.client_business_id AND b.owner_id = auth.uid()
      WHERE fce.accounting_firm_id = accounting_firms.id
    )
  );

COMMENT ON POLICY "Business owners can view firms with any engagement for their business" ON accounting_firms IS
  'Allows business owners to read firm name/contact for Service invitations (pending and active engagements).';
