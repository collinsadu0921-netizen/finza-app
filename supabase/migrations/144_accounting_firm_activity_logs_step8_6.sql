-- ============================================================================
-- MIGRATION: Step 8.6 - Firm Activity Log & Audit Trail
-- ============================================================================
-- This migration creates accounting_firm_activity_logs table to provide
-- a unified, immutable audit trail for all firm-level actions across clients.
--
-- Scope: Accounting Workspace ONLY (no Service/POS changes)
-- Mode: Append-only audit trail for firm operations
-- ============================================================================

-- ============================================================================
-- STEP 1: CREATE ACCOUNTING_FIRM_ACTIVITY_LOGS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS accounting_firm_activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES accounting_firms(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id),
  action_type TEXT NOT NULL CHECK (action_type IN (
    'bulk_preflight',
    'bulk_afs_finalize',
    'single_afs_finalize',
    'bulk_exception_review',
    'client_access_granted',
    'client_access_revoked',
    'template_created',
    'template_copied'
  )),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('business', 'afs_run', 'bulk_batch', 'template')),
  entity_id UUID, -- Nullable for bulk_batch operations
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb, -- Stores additional context (business_ids, results, etc.)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_accounting_firm_activity_logs_firm_id ON accounting_firm_activity_logs(firm_id);
CREATE INDEX IF NOT EXISTS idx_accounting_firm_activity_logs_created_at ON accounting_firm_activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_accounting_firm_activity_logs_firm_created_at ON accounting_firm_activity_logs(firm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_firm_activity_logs_actor_user_id ON accounting_firm_activity_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_accounting_firm_activity_logs_action_type ON accounting_firm_activity_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_accounting_firm_activity_logs_entity ON accounting_firm_activity_logs(entity_type, entity_id) WHERE entity_id IS NOT NULL;

-- Comments
COMMENT ON TABLE accounting_firm_activity_logs IS 'Immutable audit trail for all firm-level actions across clients (append-only)';
COMMENT ON COLUMN accounting_firm_activity_logs.id IS 'Primary key';
COMMENT ON COLUMN accounting_firm_activity_logs.firm_id IS 'Reference to the accounting firm';
COMMENT ON COLUMN accounting_firm_activity_logs.actor_user_id IS 'User ID who performed the action';
COMMENT ON COLUMN accounting_firm_activity_logs.action_type IS 'Type of action: bulk_preflight, bulk_afs_finalize, single_afs_finalize, etc.';
COMMENT ON COLUMN accounting_firm_activity_logs.entity_type IS 'Type of entity affected: business, afs_run, bulk_batch, template';
COMMENT ON COLUMN accounting_firm_activity_logs.entity_id IS 'ID of the entity (nullable for bulk_batch operations)';
COMMENT ON COLUMN accounting_firm_activity_logs.metadata IS 'JSONB data storing additional context (business_ids, results, error messages, etc.)';
COMMENT ON COLUMN accounting_firm_activity_logs.created_at IS 'Timestamp when the action occurred';

-- ============================================================================
-- STEP 2: RLS POLICIES
-- ============================================================================

-- Enable RLS on accounting_firm_activity_logs
ALTER TABLE accounting_firm_activity_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Firm members can view activity logs for their firms
DROP POLICY IF EXISTS "Firm members can view activity logs for their firms" ON accounting_firm_activity_logs;
CREATE POLICY "Firm members can view activity logs for their firms"
  ON accounting_firm_activity_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = accounting_firm_activity_logs.firm_id
        AND accounting_firm_users.user_id = auth.uid()
    )
  );

-- Policy: Prevent UPDATE (append-only)
DROP POLICY IF EXISTS "Prevent UPDATE on activity logs" ON accounting_firm_activity_logs;
CREATE POLICY "Prevent UPDATE on activity logs"
  ON accounting_firm_activity_logs FOR UPDATE
  USING (false); -- Always deny updates

-- Policy: Prevent DELETE (append-only)
DROP POLICY IF EXISTS "Prevent DELETE on activity logs" ON accounting_firm_activity_logs;
CREATE POLICY "Prevent DELETE on activity logs"
  ON accounting_firm_activity_logs FOR DELETE
  USING (false); -- Always deny deletes

-- Policy: Allow INSERT only from authenticated users (application code will validate firm membership)
-- Note: Actual validation of firm membership should happen in application code before INSERT
DROP POLICY IF EXISTS "Allow INSERT for authenticated users" ON accounting_firm_activity_logs;
CREATE POLICY "Allow INSERT for authenticated users"
  ON accounting_firm_activity_logs FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================================
-- STEP 3: APPEND-ONLY TRIGGER (Additional Safety)
-- ============================================================================

-- Function to prevent updates and deletes
CREATE OR REPLACE FUNCTION prevent_activity_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Activity logs are append-only. Updates are not allowed.';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Activity logs are append-only. Deletes are not allowed.';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Prevent UPDATE and DELETE
DROP TRIGGER IF EXISTS trigger_prevent_activity_log_modification ON accounting_firm_activity_logs;
CREATE TRIGGER trigger_prevent_activity_log_modification
  BEFORE UPDATE OR DELETE ON accounting_firm_activity_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_activity_log_modification();

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Step 8.6: Firm Activity Log & Audit Trail created';
  RAISE NOTICE '  - accounting_firm_activity_logs table created';
  RAISE NOTICE '  - Append-only enforcement (no UPDATE/DELETE)';
  RAISE NOTICE '  - RLS policies: Firm members can view, authenticated users can insert';
  RAISE NOTICE '  - Action types: bulk_preflight, bulk_afs_finalize, single_afs_finalize, etc.';
END;
$$;
