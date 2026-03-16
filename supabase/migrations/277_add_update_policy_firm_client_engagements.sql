-- ============================================================================
-- Migration 277: Add UPDATE RLS policy for firm_client_engagements
-- ============================================================================
-- Enables accept/reject/suspend/resume/terminate flows: firm users and business
-- owners must be able to update engagement status and related fields.
-- ============================================================================

-- Firm users (Partners/Seniors) can update engagements for their firm
DROP POLICY IF EXISTS "Firm users can update their firm engagements" ON firm_client_engagements;
CREATE POLICY "Firm users can update their firm engagements"
  ON firm_client_engagements FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = firm_client_engagements.accounting_firm_id
        AND accounting_firm_users.user_id = auth.uid()
        AND accounting_firm_users.role IN ('partner', 'senior')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = firm_client_engagements.accounting_firm_id
        AND accounting_firm_users.user_id = auth.uid()
        AND accounting_firm_users.role IN ('partner', 'senior')
    )
  );

-- Business owners can update engagements for their business (e.g. accept/reject)
DROP POLICY IF EXISTS "Business owners can update their business engagements" ON firm_client_engagements;
CREATE POLICY "Business owners can update their business engagements"
  ON firm_client_engagements FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = firm_client_engagements.client_business_id
        AND businesses.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = firm_client_engagements.client_business_id
        AND businesses.owner_id = auth.uid()
    )
  );

COMMENT ON POLICY "Firm users can update their firm engagements" ON firm_client_engagements IS
  'Allows Partners and Seniors to update engagement status (suspend, resume, terminate).';
COMMENT ON POLICY "Business owners can update their business engagements" ON firm_client_engagements IS
  'Allows business owners to accept or reject pending engagements.';
