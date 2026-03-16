-- ============================================================================
-- Migration 284: Firm users can SELECT client businesses they have an engagement with
-- ============================================================================
-- Allows accounting firm users to read business id/name for clients so the
-- firm dashboard and client selector show real names (no "Unknown").
-- ============================================================================

CREATE POLICY "Firm users can select engaged client businesses"
  ON public.businesses FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM firm_client_engagements fce
      INNER JOIN accounting_firm_users afu
        ON afu.firm_id = fce.accounting_firm_id
       AND afu.user_id = auth.uid()
      WHERE fce.client_business_id = businesses.id
    )
  );

COMMENT ON POLICY "Firm users can select engaged client businesses" ON public.businesses IS
  'Firm users can read client business rows (e.g. id, name) for businesses their firm is engaged with; required for /api/accounting/firm/clients to return business_name.';
