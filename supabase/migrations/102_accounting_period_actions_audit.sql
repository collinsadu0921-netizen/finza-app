-- ============================================================================
-- MIGRATION: Accounting Period Actions Audit Table
-- ============================================================================
-- This migration creates an audit table to track period close/lock actions
-- performed by accountants.
--
-- Scope: Accounting Mode ONLY
-- ============================================================================

-- ============================================================================
-- CREATE AUDIT TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS accounting_period_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('soft_close', 'lock')),
  performed_by UUID NOT NULL REFERENCES auth.users(id),
  performed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_accounting_period_actions_business_id ON accounting_period_actions(business_id);
CREATE INDEX IF NOT EXISTS idx_accounting_period_actions_period_start ON accounting_period_actions(period_start);
CREATE INDEX IF NOT EXISTS idx_accounting_period_actions_performed_by ON accounting_period_actions(performed_by);
CREATE INDEX IF NOT EXISTS idx_accounting_period_actions_business_period ON accounting_period_actions(business_id, period_start);

-- Comments
COMMENT ON TABLE accounting_period_actions IS 'Audit trail for accounting period close/lock actions performed by accountants';
COMMENT ON COLUMN accounting_period_actions.business_id IS 'Business for which the period action was performed';
COMMENT ON COLUMN accounting_period_actions.period_start IS 'Period start date (YYYY-MM-01 format)';
COMMENT ON COLUMN accounting_period_actions.action IS 'Action performed: soft_close or lock';
COMMENT ON COLUMN accounting_period_actions.performed_by IS 'User ID of the accountant who performed the action';
COMMENT ON COLUMN accounting_period_actions.performed_at IS 'Timestamp when the action was performed';





