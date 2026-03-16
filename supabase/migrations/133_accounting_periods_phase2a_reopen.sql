-- ============================================================================
-- MIGRATION: Accounting Mode - Phase 2A: Period Reopening Workflow
-- ============================================================================
-- Adds controlled, admin-only workflow to reopen soft_closed periods
-- 
-- Scope: Admin-only, auditable, safe
-- Only soft_closed → open allowed
-- Locked periods remain immutable
-- ============================================================================

-- ============================================================================
-- STEP 1: EXTEND accounting_period_actions TABLE
-- ============================================================================
-- Add support for 'reopen' action and reason field

-- Add reason column if it doesn't exist (for audit trail)
ALTER TABLE accounting_period_actions
  ADD COLUMN IF NOT EXISTS reason TEXT;

-- Update action constraint to include 'reopen'
-- First, drop the existing constraint
ALTER TABLE accounting_period_actions
  DROP CONSTRAINT IF EXISTS accounting_period_actions_action_check;

-- Recreate constraint with 'reopen' action
ALTER TABLE accounting_period_actions
  ADD CONSTRAINT accounting_period_actions_action_check
  CHECK (action IN ('soft_close', 'lock', 'reopen'));

-- Add comment for reason column
COMMENT ON COLUMN accounting_period_actions.reason IS
'Reason for the action (required for reopen, optional for close/lock). Provides audit trail context for why a period was reopened.';

-- Update table comment
COMMENT ON TABLE accounting_period_actions IS
'Audit trail for accounting period actions (close, lock, reopen) performed by authorized users. All reopen actions require a reason.';
