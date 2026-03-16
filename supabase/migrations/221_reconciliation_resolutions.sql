-- Minimal table for recording manual reconciliation approvals.
-- Every approval is attributable to the authenticated user; no auto-fix.
-- Used by POST /api/accounting/reconciliation/resolve.

CREATE TABLE IF NOT EXISTS reconciliation_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('invoice', 'customer', 'period')),
  scope_id UUID NOT NULL,
  reference_id UUID NOT NULL,
  approved_by UUID NOT NULL REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delta_before NUMERIC NOT NULL,
  delta_after NUMERIC NOT NULL,
  proposal JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_resolutions_business_id ON reconciliation_resolutions(business_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_resolutions_scope ON reconciliation_resolutions(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_resolutions_approved_at ON reconciliation_resolutions(approved_at);

COMMENT ON TABLE reconciliation_resolutions IS
  'Records human-approved reconciliation fixes. Each row = one approved posting; approver and timestamp required.';
