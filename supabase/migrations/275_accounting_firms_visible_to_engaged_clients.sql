-- ============================================================================
-- Migration 275: Allow business owners to view firm details for their accountant
-- ============================================================================
-- Service workspace relationship API needs to show firm name/onboarding_status.
-- No authority or engagement schema change; visibility only.
-- ============================================================================

ALTER TABLE accounting_firms
  ADD COLUMN IF NOT EXISTS contact_email TEXT;
COMMENT ON COLUMN accounting_firms.contact_email IS 'Optional contact email shown to clients (partner sets in firm settings).';

DROP POLICY IF EXISTS "Clients can view firm with active engagement" ON accounting_firms;
CREATE POLICY "Clients can view firm with active engagement"
  ON accounting_firms FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM firm_client_engagements fce
      INNER JOIN businesses b ON b.id = fce.client_business_id AND b.owner_id = auth.uid()
      WHERE fce.accounting_firm_id = accounting_firms.id
        AND fce.status = 'active'
        AND fce.effective_from <= CURRENT_DATE
        AND (fce.effective_to IS NULL OR fce.effective_to >= CURRENT_DATE)
    )
  );

COMMENT ON POLICY "Clients can view firm with active engagement" ON accounting_firms IS
  'Allows business owners to read firm name/onboarding_status when firm has active engagement with their business (Service accountant relationship UI).';
