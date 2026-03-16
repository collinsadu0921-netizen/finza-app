-- ============================================================================
-- Migration 281: Accounting firms visible for owner engagements (any status)
-- ============================================================================
-- Adds an OR path so business owners can read firm identity for pending
-- invitations. Existing effective-engagement policy (279) remains intact.
-- ============================================================================

CREATE POLICY "Accounting firms visible for owner engagements"
  ON accounting_firms FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM firm_client_engagements fce
      JOIN businesses b
        ON b.id = fce.client_business_id
       AND b.owner_id = auth.uid()
      WHERE fce.accounting_firm_id = accounting_firms.id
    )
  );

COMMENT ON POLICY "Accounting firms visible for owner engagements" ON accounting_firms IS
  'Required so owners can see firm name/contact for pending invitations at /service/invitations. Owner-only via businesses.owner_id; no extra visibility for firm users.';
