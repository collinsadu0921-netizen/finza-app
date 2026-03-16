-- ============================================================================
-- Migration: 223 — Ledger adjustment governance (policy + approvals)
-- ============================================================================
-- Per-business policy for who can approve adjustments; append-only approval
-- records; proposal hash to prevent bait-and-switch.
-- ============================================================================

-- ============================================================================
-- 1. LEDGER ADJUSTMENT POLICY (per business)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ledger_adjustment_policy (
  business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  adjustment_requires_accountant BOOLEAN NOT NULL DEFAULT true,
  adjustment_requires_owner_over_amount NUMERIC NOT NULL DEFAULT 0,
  adjustment_requires_two_person_rule BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_adjustment_policy_business_id ON ledger_adjustment_policy(business_id);

COMMENT ON TABLE ledger_adjustment_policy IS 'Per-business governance: who can approve reconciliation adjustments. Small deltas (<=0.01) may be posted by accountant alone; larger deltas require owner or two-person approval depending on these flags.';
COMMENT ON COLUMN ledger_adjustment_policy.adjustment_requires_accountant IS 'If true, only accountant or admin can initiate/post adjustments (already enforced by resolve API).';
COMMENT ON COLUMN ledger_adjustment_policy.adjustment_requires_owner_over_amount IS 'Threshold (e.g. 50 GHS): adjustments with |delta| above this require owner to post.';
COMMENT ON COLUMN ledger_adjustment_policy.adjustment_requires_two_person_rule IS 'If true, two distinct approvers required before posting (append-only approval records).';

-- ============================================================================
-- 2. LEDGER ADJUSTMENT APPROVALS (append-only)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ledger_adjustment_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('invoice', 'customer', 'period')),
  scope_id UUID NOT NULL,
  proposal_hash TEXT NOT NULL,
  delta NUMERIC NOT NULL,
  approved_by UUID NOT NULL REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approver_role TEXT NOT NULL CHECK (approver_role IN ('owner', 'admin', 'accountant')),
  proposal_snapshot JSONB
);

CREATE INDEX IF NOT EXISTS idx_ledger_adjustment_approvals_business_scope_hash
  ON ledger_adjustment_approvals(business_id, scope_type, scope_id, proposal_hash);
CREATE INDEX IF NOT EXISTS idx_ledger_adjustment_approvals_approved_at
  ON ledger_adjustment_approvals(approved_at);

COMMENT ON TABLE ledger_adjustment_approvals IS 'Append-only: who approved which proposal (by hash), when, and role. Used for two-person rule and audit.';
COMMENT ON COLUMN ledger_adjustment_approvals.proposal_hash IS 'Hash of proposed_fix; approval only valid for this exact proposal (prevents bait-and-switch).';

-- RLS: only authenticated with business access can read; insert via service/API only
ALTER TABLE ledger_adjustment_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_adjustment_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view ledger_adjustment_policy for their business" ON ledger_adjustment_policy;
CREATE POLICY "Users can view ledger_adjustment_policy for their business"
  ON ledger_adjustment_policy FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses b
      WHERE b.id = ledger_adjustment_policy.business_id
        AND (b.owner_id = auth.uid() OR EXISTS (SELECT 1 FROM business_users bu WHERE bu.business_id = b.id AND bu.user_id = auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Admins can update ledger_adjustment_policy for their business" ON ledger_adjustment_policy;
CREATE POLICY "Admins can update ledger_adjustment_policy for their business"
  ON ledger_adjustment_policy FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM businesses b
      JOIN business_users bu ON bu.business_id = b.id AND bu.user_id = auth.uid()
      WHERE b.id = ledger_adjustment_policy.business_id AND bu.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses b
      JOIN business_users bu ON bu.business_id = b.id AND bu.user_id = auth.uid()
      WHERE b.id = ledger_adjustment_policy.business_id AND bu.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Users can view ledger_adjustment_approvals for their business" ON ledger_adjustment_approvals;
CREATE POLICY "Users can view ledger_adjustment_approvals for their business"
  ON ledger_adjustment_approvals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses b
      WHERE b.id = ledger_adjustment_approvals.business_id
        AND (b.owner_id = auth.uid() OR EXISTS (SELECT 1 FROM business_users bu WHERE bu.business_id = b.id AND bu.user_id = auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Service can insert ledger_adjustment_approvals" ON ledger_adjustment_approvals;
CREATE POLICY "Service can insert ledger_adjustment_approvals"
  ON ledger_adjustment_approvals FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses b
      WHERE b.id = ledger_adjustment_approvals.business_id
        AND (b.owner_id = auth.uid() OR EXISTS (SELECT 1 FROM business_users bu WHERE bu.business_id = b.id AND bu.user_id = auth.uid()))
    )
  );

-- No UPDATE/DELETE on ledger_adjustment_approvals (append-only)
-- Trigger to enforce append-only
CREATE OR REPLACE FUNCTION prevent_ledger_adjustment_approval_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'ledger_adjustment_approvals is append-only.';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger_adjustment_approvals is append-only.';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_ledger_adjustment_approval_modification ON ledger_adjustment_approvals;
CREATE TRIGGER trigger_prevent_ledger_adjustment_approval_modification
  BEFORE UPDATE OR DELETE ON ledger_adjustment_approvals
  FOR EACH ROW
  EXECUTE FUNCTION prevent_ledger_adjustment_approval_modification();
