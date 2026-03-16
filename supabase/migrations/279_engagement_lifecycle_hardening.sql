-- ============================================================================
-- Migration 279: Engagement lifecycle hardening (canonical model)
-- ============================================================================
-- Domain: pending → accepted (client approve); active = virtual/effective.
-- - Add status 'accepted'; enforce accepted_at when status IN ('accepted','active').
-- - Block pending→active; accept flow sets status='accepted' only.
-- - is_engagement_effective(): accepted/active + date range.
-- - get_active_engagement returns effective engagements (accepted or active).
-- - Legacy: normalize existing 'active' to 'accepted' or 'pending'.
-- No ledger, posting, or trial balance schema changes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1: Expand status allowed values (add 'accepted')
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'firm_client_engagements'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%status%'
      AND pg_get_constraintdef(c.oid) LIKE '%pending%'
  LOOP
    EXECUTE format('ALTER TABLE firm_client_engagements DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE firm_client_engagements
  ADD CONSTRAINT firm_client_engagements_status_check
  CHECK (status IN ('pending', 'accepted', 'active', 'suspended', 'terminated'));

-- ----------------------------------------------------------------------------
-- STEP 1.5: Normalize legacy engagement rows BEFORE constraints
-- ----------------------------------------------------------------------------
-- Case 1: Historical "active" engagements with approval already implied
UPDATE firm_client_engagements
SET
  status = 'accepted',
  accepted_at = COALESCE(accepted_at, created_at, NOW())
WHERE status = 'active'
AND accepted_at IS NOT NULL;

-- Case 2: Historical "active" engagements never approved
UPDATE firm_client_engagements
SET status = 'pending'
WHERE status = 'active'
AND accepted_at IS NULL;

-- Case 3: Defensive repair for accepted rows missing timestamp
UPDATE firm_client_engagements
SET accepted_at = COALESCE(accepted_at, created_at, NOW())
WHERE status = 'accepted'
AND accepted_at IS NULL;

-- ----------------------------------------------------------------------------
-- STEP 2: Require accepted_at when status is accepted or active
-- ----------------------------------------------------------------------------
ALTER TABLE firm_client_engagements
  ADD CONSTRAINT firm_client_engagements_accepted_at_required
  CHECK (
    status NOT IN ('accepted', 'active')
    OR accepted_at IS NOT NULL
  );

COMMENT ON CONSTRAINT firm_client_engagements_accepted_at_required ON firm_client_engagements IS
  'When status is accepted or active, accepted_at must be set (client has approved).';

-- ----------------------------------------------------------------------------
-- STEP 3: Trigger — block direct pending → active (only pending → accepted)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_engagement_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'active' THEN
    RAISE EXCEPTION 'Invalid transition: pending → active. Use accepted first. Client accept sets status to accepted.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_enforce_engagement_status_transition ON firm_client_engagements;
CREATE TRIGGER trigger_enforce_engagement_status_transition
  BEFORE UPDATE ON firm_client_engagements
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION enforce_engagement_status_transition();

COMMENT ON FUNCTION enforce_engagement_status_transition() IS
  'Prevents pending→active. Only pending→accepted (client accept); active is virtual/legacy.';

-- Guard: prevent future writes with status accepted/active and no accepted_at
CREATE OR REPLACE FUNCTION enforce_accepted_requires_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('accepted','active') AND NEW.accepted_at IS NULL THEN
    RAISE EXCEPTION 'accepted_at required when engagement is accepted or active';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_enforce_accepted_timestamp ON firm_client_engagements;
CREATE TRIGGER trigger_enforce_accepted_timestamp
  BEFORE INSERT OR UPDATE ON firm_client_engagements
  FOR EACH ROW
  EXECUTE FUNCTION enforce_accepted_requires_timestamp();

COMMENT ON FUNCTION enforce_accepted_requires_timestamp() IS
  'Prevents INSERT/UPDATE with status accepted or active when accepted_at is NULL.';

-- ----------------------------------------------------------------------------
-- STEP 4: Canonical effectiveness function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_engagement_effective(
  p_status TEXT,
  p_effective_from DATE,
  p_effective_to DATE,
  p_check_date DATE DEFAULT CURRENT_DATE
)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    p_status IN ('accepted', 'active')
    AND p_effective_from <= p_check_date
    AND (p_effective_to IS NULL OR p_effective_to >= p_check_date)
  );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION is_engagement_effective(TEXT, DATE, DATE, DATE) IS
  'Returns true when engagement is accepted/active and within effective date range. Authority and RLS use this.';

-- ----------------------------------------------------------------------------
-- STEP 5: Update get_active_engagement to treat accepted + effective as "active"
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_active_engagement(
  p_firm_id UUID,
  p_business_id UUID,
  p_check_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  id UUID,
  status TEXT,
  access_level TEXT,
  effective_from DATE,
  effective_to DATE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.status,
    e.access_level,
    e.effective_from,
    e.effective_to
  FROM firm_client_engagements e
  WHERE e.accounting_firm_id = p_firm_id
    AND e.client_business_id = p_business_id
    AND e.status IN ('accepted', 'active')
    AND e.effective_from <= p_check_date
    AND (e.effective_to IS NULL OR e.effective_to >= p_check_date)
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_active_engagement(UUID, UUID, DATE) IS
  'Returns the effective engagement (status accepted or active, within date range) for firm-client pair.';

-- ----------------------------------------------------------------------------
-- STEP 6: Unique index — one effective engagement per firm-client
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_firm_client_engagements_one_active;

CREATE UNIQUE INDEX idx_firm_client_engagements_one_effective
  ON firm_client_engagements(accounting_firm_id, client_business_id)
  WHERE status IN ('accepted', 'active');

-- ----------------------------------------------------------------------------
-- STEP 7: RLS — firm policies use effective (accepted or active + dates)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Firm users can view journal entries for engaged clients" ON journal_entries;
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
        AND fce.status IN ('accepted', 'active')
        AND fce.effective_from <= CURRENT_DATE
        AND (fce.effective_to IS NULL OR fce.effective_to >= CURRENT_DATE)
      WHERE afu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Firm users can view journal entry lines for engaged clients" ON journal_entry_lines;
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
        AND fce.status IN ('accepted', 'active')
        AND fce.effective_from <= CURRENT_DATE
        AND (fce.effective_to IS NULL OR fce.effective_to >= CURRENT_DATE)
      WHERE je.id = journal_entry_lines.journal_entry_id
    )
  );

DROP POLICY IF EXISTS "Firm users can view accounting periods for engaged clients" ON accounting_periods;
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
        AND fce.status IN ('accepted', 'active')
        AND fce.effective_from <= CURRENT_DATE
        AND (fce.effective_to IS NULL OR fce.effective_to >= CURRENT_DATE)
      WHERE afu.user_id = auth.uid()
    )
  );

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
        AND fce.status IN ('accepted', 'active')
        AND fce.effective_from <= CURRENT_DATE
        AND (fce.effective_to IS NULL OR fce.effective_to >= CURRENT_DATE)
      WHERE afu.user_id = auth.uid()
    )
  );

COMMENT ON POLICY "read_trial_balance_snapshots" ON trial_balance_snapshots IS
  'Owner, employee, or firm via accounting_firm_clients or effective firm_client_engagements (accepted/active + dates).';

-- ----------------------------------------------------------------------------
-- STEP 8: RLS — accounting_firms (275) use effective engagement
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Clients can view firm with active engagement" ON accounting_firms;
CREATE POLICY "Clients can view firm with active engagement"
  ON accounting_firms FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM firm_client_engagements fce
      INNER JOIN businesses b ON b.id = fce.client_business_id AND b.owner_id = auth.uid()
      WHERE fce.accounting_firm_id = accounting_firms.id
        AND fce.status IN ('accepted', 'active')
        AND fce.effective_from <= CURRENT_DATE
        AND (fce.effective_to IS NULL OR fce.effective_to >= CURRENT_DATE)
    )
  );

COMMENT ON POLICY "Clients can view firm with active engagement" ON accounting_firms IS
  'Allows business owners to read firm when firm has effective engagement (accepted/active + dates).';

-- ----------------------------------------------------------------------------
-- STEP 9: RLS — manual_journal_drafts (147) effective engagement
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Firm users with write access can create drafts" ON manual_journal_drafts;
CREATE POLICY "Firm users with write access can create drafts"
  ON manual_journal_drafts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = manual_journal_drafts.accounting_firm_id
        AND accounting_firm_users.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM firm_client_engagements
      WHERE firm_client_engagements.accounting_firm_id = manual_journal_drafts.accounting_firm_id
        AND firm_client_engagements.client_business_id = manual_journal_drafts.client_business_id
        AND firm_client_engagements.status IN ('accepted', 'active')
        AND firm_client_engagements.access_level IN ('write', 'approve')
        AND firm_client_engagements.effective_from <= CURRENT_DATE
        AND (firm_client_engagements.effective_to IS NULL OR firm_client_engagements.effective_to >= CURRENT_DATE)
    )
  );

DROP POLICY IF EXISTS "Firm users with write access can submit drafts" ON manual_journal_drafts;
CREATE POLICY "Firm users with write access can submit drafts"
  ON manual_journal_drafts FOR UPDATE
  USING (
    status = 'draft'
    AND EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = manual_journal_drafts.accounting_firm_id
        AND accounting_firm_users.user_id = auth.uid()
        AND accounting_firm_users.role IN ('junior', 'senior', 'partner')
    )
    AND EXISTS (
      SELECT 1 FROM firm_client_engagements
      WHERE firm_client_engagements.accounting_firm_id = manual_journal_drafts.accounting_firm_id
        AND firm_client_engagements.client_business_id = manual_journal_drafts.client_business_id
        AND firm_client_engagements.status IN ('accepted', 'active')
        AND firm_client_engagements.access_level IN ('write', 'approve')
        AND firm_client_engagements.effective_from <= CURRENT_DATE
        AND (firm_client_engagements.effective_to IS NULL OR firm_client_engagements.effective_to >= CURRENT_DATE)
    )
  )
  WITH CHECK (
    status IN ('submitted', 'draft')
  );

DROP POLICY IF EXISTS "Senior/Partner can approve or reject drafts" ON manual_journal_drafts;
CREATE POLICY "Senior/Partner can approve or reject drafts"
  ON manual_journal_drafts FOR UPDATE
  USING (
    status = 'submitted'
    AND EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = manual_journal_drafts.accounting_firm_id
        AND accounting_firm_users.user_id = auth.uid()
        AND accounting_firm_users.role IN ('senior', 'partner')
    )
    AND EXISTS (
      SELECT 1 FROM firm_client_engagements
      WHERE firm_client_engagements.accounting_firm_id = manual_journal_drafts.accounting_firm_id
        AND firm_client_engagements.client_business_id = manual_journal_drafts.client_business_id
        AND firm_client_engagements.status IN ('accepted', 'active')
        AND firm_client_engagements.access_level = 'approve'
        AND firm_client_engagements.effective_from <= CURRENT_DATE
        AND (firm_client_engagements.effective_to IS NULL OR firm_client_engagements.effective_to >= CURRENT_DATE)
    )
  )
  WITH CHECK (
    status IN ('approved', 'rejected', 'submitted')
  );

-- ----------------------------------------------------------------------------
-- STEP 10: RLS — opening_balance_imports (150) effective engagement
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Firm users with write access can create opening balance imports" ON opening_balance_imports;
CREATE POLICY "Firm users with write access can create opening balance imports"
  ON opening_balance_imports FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = opening_balance_imports.accounting_firm_id
        AND accounting_firm_users.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM firm_client_engagements
      WHERE firm_client_engagements.accounting_firm_id = opening_balance_imports.accounting_firm_id
        AND firm_client_engagements.client_business_id = opening_balance_imports.client_business_id
        AND firm_client_engagements.status IN ('accepted', 'active')
        AND firm_client_engagements.access_level IN ('write', 'approve')
        AND firm_client_engagements.effective_from <= CURRENT_DATE
        AND (firm_client_engagements.effective_to IS NULL OR firm_client_engagements.effective_to >= CURRENT_DATE)
    )
  );

DROP POLICY IF EXISTS "Partner can approve opening balance imports" ON opening_balance_imports;
CREATE POLICY "Partner can approve opening balance imports"
  ON opening_balance_imports FOR UPDATE
  USING (
    status = 'draft'
    AND EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = opening_balance_imports.accounting_firm_id
        AND accounting_firm_users.user_id = auth.uid()
        AND accounting_firm_users.role = 'partner'
    )
    AND EXISTS (
      SELECT 1 FROM firm_client_engagements
      WHERE firm_client_engagements.accounting_firm_id = opening_balance_imports.accounting_firm_id
        AND firm_client_engagements.client_business_id = opening_balance_imports.client_business_id
        AND firm_client_engagements.status IN ('accepted', 'active')
        AND firm_client_engagements.access_level = 'approve'
        AND firm_client_engagements.effective_from <= CURRENT_DATE
        AND (firm_client_engagements.effective_to IS NULL OR firm_client_engagements.effective_to >= CURRENT_DATE)
    )
  )
  WITH CHECK (
    status = 'approved'
  );

-- ----------------------------------------------------------------------------
-- STEP 11: Posting functions — validate effective engagement (148, 151)
-- Patch engagement check: status = 'active' → status IN ('accepted', 'active')
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  fn_oid OID;
  def TEXT;
BEGIN
  -- post_manual_journal_draft_to_ledger
  SELECT p.oid INTO fn_oid FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'post_manual_journal_draft_to_ledger';
  IF fn_oid IS NOT NULL THEN
    def := pg_get_functiondef(fn_oid);
    def := replace(def, 'AND status = ''active''', 'AND status IN (''accepted'', ''active'')');
    def := replace(def, 'No active engagement found', 'No effective engagement found');
    EXECUTE def;
  END IF;

  -- post_opening_balance_import_to_ledger
  SELECT p.oid INTO fn_oid FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'post_opening_balance_import_to_ledger';
  IF fn_oid IS NOT NULL THEN
    def := pg_get_functiondef(fn_oid);
    def := replace(def, 'AND status = ''active''', 'AND status IN (''accepted'', ''active'')');
    def := replace(def, 'No active engagement found', 'No effective engagement found');
    EXECUTE def;
  END IF;
END $$;