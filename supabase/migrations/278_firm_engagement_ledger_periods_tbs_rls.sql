-- ============================================================================
-- Migration 278: Firm users with active engagement can read ledger, periods, TBS
-- ============================================================================
-- Adds SELECT policies so firm users (accounting_firm_users) with an ACTIVE
-- effective firm_client_engagements row can read journal_entries, journal_entry_lines,
-- accounting_periods, and trial_balance_snapshots for the engaged client_business_id.
-- Does not remove or weaken existing owner/business_users policies.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) journal_entries — firm user with active effective engagement
-- ----------------------------------------------------------------------------
CREATE POLICY "Firm users can view journal entries for engaged clients"
  ON journal_entries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM accounting_firm_users afu
      INNER JOIN firm_client_engagements fce
        ON fce.accounting_firm_id = afu.firm_id
        AND fce.client_business_id = journal_entries.business_id
        AND fce.status = 'active'
        AND fce.effective_from <= CURRENT_DATE
        AND (fce.effective_to IS NULL OR fce.effective_to >= CURRENT_DATE)
      WHERE afu.user_id = auth.uid()
    )
  );

COMMENT ON POLICY "Firm users can view journal entries for engaged clients" ON journal_entries IS
  'Allows firm members to read journal_entries for businesses with an active, effective engagement.';

-- ----------------------------------------------------------------------------
-- B) journal_entry_lines — same access via journal_entries.business_id
-- ----------------------------------------------------------------------------
CREATE POLICY "Firm users can view journal entry lines for engaged clients"
  ON journal_entry_lines
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM journal_entries je
      INNER JOIN accounting_firm_users afu ON afu.user_id = auth.uid()
      INNER JOIN firm_client_engagements fce
        ON fce.accounting_firm_id = afu.firm_id
        AND fce.client_business_id = je.business_id
        AND fce.status = 'active'
        AND fce.effective_from <= CURRENT_DATE
        AND (fce.effective_to IS NULL OR fce.effective_to >= CURRENT_DATE)
      WHERE je.id = journal_entry_lines.journal_entry_id
    )
  );

COMMENT ON POLICY "Firm users can view journal entry lines for engaged clients" ON journal_entry_lines IS
  'Allows firm members to read journal_entry_lines for businesses with an active, effective engagement.';

-- ----------------------------------------------------------------------------
-- C) accounting_periods — firm user with active effective engagement
-- ----------------------------------------------------------------------------
CREATE POLICY "Firm users can view accounting periods for engaged clients"
  ON accounting_periods
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM accounting_firm_users afu
      INNER JOIN firm_client_engagements fce
        ON fce.accounting_firm_id = afu.firm_id
        AND fce.client_business_id = accounting_periods.business_id
        AND fce.status = 'active'
        AND fce.effective_from <= CURRENT_DATE
        AND (fce.effective_to IS NULL OR fce.effective_to >= CURRENT_DATE)
      WHERE afu.user_id = auth.uid()
    )
  );

COMMENT ON POLICY "Firm users can view accounting periods for engaged clients" ON accounting_periods IS
  'Allows firm members to read accounting_periods for businesses with an active, effective engagement.';

-- ----------------------------------------------------------------------------
-- D) trial_balance_snapshots — add OR branch for firm_client_engagements
--    (keep existing owner, business_users, accounting_firm_clients paths)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "read_trial_balance_snapshots" ON trial_balance_snapshots;

CREATE POLICY "read_trial_balance_snapshots"
  ON trial_balance_snapshots
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses b
      WHERE b.id = trial_balance_snapshots.business_id
        AND b.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = trial_balance_snapshots.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('admin', 'accountant')
    )
    OR EXISTS (
      SELECT 1 FROM accounting_firm_users afu
      INNER JOIN accounting_firm_clients afc ON afu.firm_id = afc.firm_id
      WHERE afu.user_id = auth.uid()
        AND afc.business_id = trial_balance_snapshots.business_id
    )
    OR EXISTS (
      SELECT 1 FROM accounting_firm_users afu
      INNER JOIN firm_client_engagements fce
        ON fce.accounting_firm_id = afu.firm_id
        AND fce.client_business_id = trial_balance_snapshots.business_id
        AND fce.status = 'active'
        AND fce.effective_from <= CURRENT_DATE
        AND (fce.effective_to IS NULL OR fce.effective_to >= CURRENT_DATE)
      WHERE afu.user_id = auth.uid()
    )
  );

COMMENT ON POLICY "read_trial_balance_snapshots" ON trial_balance_snapshots IS
  'Owner, employee (admin/accountant), or firm via accounting_firm_clients or active effective firm_client_engagements.';
