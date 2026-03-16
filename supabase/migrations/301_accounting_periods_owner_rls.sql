-- ============================================================================
-- Migration 301: accounting_periods RLS — allow business owners (businesses.owner_id)
-- ============================================================================
-- Adds owner-based policies so owners can SELECT, INSERT, UPDATE, DELETE
-- accounting_periods for their own business. Existing business_users and firm
-- policies are unchanged. Enables Service workspace owners to close periods.
-- ============================================================================

-- SELECT: owners can view accounting periods for their business
CREATE POLICY "Owners can view accounting periods for their business"
  ON accounting_periods
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM businesses b
      WHERE b.id = accounting_periods.business_id
        AND b.owner_id = auth.uid()
    )
  );

COMMENT ON POLICY "Owners can view accounting periods for their business" ON accounting_periods IS
  'Allows business owners (businesses.owner_id) to read accounting_periods for their business. Service workspace close period.';

-- INSERT: owners can insert accounting periods for their business
CREATE POLICY "Owners can insert accounting periods for their business"
  ON accounting_periods
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM businesses b
      WHERE b.id = accounting_periods.business_id
        AND b.owner_id = auth.uid()
    )
  );

COMMENT ON POLICY "Owners can insert accounting periods for their business" ON accounting_periods IS
  'Allows business owners to create accounting_periods for their business.';

-- UPDATE: owners can update accounting periods for their business
CREATE POLICY "Owners can update accounting periods for their business"
  ON accounting_periods
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM businesses b
      WHERE b.id = accounting_periods.business_id
        AND b.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM businesses b
      WHERE b.id = accounting_periods.business_id
        AND b.owner_id = auth.uid()
    )
  );

COMMENT ON POLICY "Owners can update accounting periods for their business" ON accounting_periods IS
  'Allows business owners to update accounting_periods (e.g. close/lock) for their business.';

-- DELETE: owners can delete accounting periods for their business
CREATE POLICY "Owners can delete accounting periods for their business"
  ON accounting_periods
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM businesses b
      WHERE b.id = accounting_periods.business_id
        AND b.owner_id = auth.uid()
    )
  );

COMMENT ON POLICY "Owners can delete accounting periods for their business" ON accounting_periods IS
  'Allows business owners to delete accounting_periods for their business.';
