-- ============================================================================
-- Forensic failure incident lifecycle (open → acknowledged → resolved/ignored).
-- Implementation-scoped. No ledger, contract, RPC, or invariant logic changes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Add lifecycle columns to accounting_invariant_failures
-- ----------------------------------------------------------------------------
ALTER TABLE accounting_invariant_failures
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'ignored')),
  ADD COLUMN IF NOT EXISTS acknowledged_by UUID NULL,
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS resolved_by UUID NULL,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS resolution_note TEXT NULL;

COMMENT ON COLUMN accounting_invariant_failures.status IS 'Incident lifecycle: open, acknowledged, resolved, ignored';
COMMENT ON COLUMN accounting_invariant_failures.acknowledged_by IS 'User who acknowledged (auth.uid())';
COMMENT ON COLUMN accounting_invariant_failures.resolution_note IS 'Required when resolving; set to "Ignored by user" when ignoring';

-- Backfill: existing rows keep default 'open' (already set by DEFAULT)
-- No change to forensic runner insert logic (continues to omit these columns).

-- ----------------------------------------------------------------------------
-- 2) RLS: same access as canAccessForensicMonitoring (owner, firm admin, accounting admin)
-- ----------------------------------------------------------------------------
ALTER TABLE accounting_invariant_failures ENABLE ROW LEVEL SECURITY;

-- Helper: true if user may read/update forensic failures (mirrors app canAccessForensicMonitoring)
CREATE OR REPLACE FUNCTION has_forensic_monitoring_access(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM accounting_firm_users WHERE user_id = p_user_id LIMIT 1)
  OR EXISTS (SELECT 1 FROM businesses WHERE owner_id = p_user_id LIMIT 1)
  OR EXISTS (SELECT 1 FROM business_users WHERE user_id = p_user_id AND role IN ('admin', 'accountant') LIMIT 1);
$$;

DROP POLICY IF EXISTS "forensic_failures_select" ON accounting_invariant_failures;
CREATE POLICY "forensic_failures_select"
  ON accounting_invariant_failures FOR SELECT
  USING (has_forensic_monitoring_access(auth.uid()));

DROP POLICY IF EXISTS "forensic_failures_update" ON accounting_invariant_failures;
CREATE POLICY "forensic_failures_update"
  ON accounting_invariant_failures FOR UPDATE
  USING (has_forensic_monitoring_access(auth.uid()))
  WITH CHECK (has_forensic_monitoring_access(auth.uid()));

-- Service role (cron) bypasses RLS for INSERT; no INSERT policy for anon/authenticated.
-- SELECT/UPDATE only for authorized users.

CREATE INDEX IF NOT EXISTS idx_accounting_invariant_failures_status ON accounting_invariant_failures(status);
