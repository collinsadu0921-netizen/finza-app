-- ============================================================================
-- MIGRATION: Step 8.8 - Firm Onboarding Status
-- ============================================================================
-- This migration adds onboarding status tracking to accounting firms.
-- Firms must complete onboarding before they can add clients or perform
-- accounting actions.
--
-- Scope: Accounting Workspace ONLY
-- ============================================================================

-- ============================================================================
-- STEP 1: ADD ONBOARDING STATUS COLUMN
-- ============================================================================
ALTER TABLE accounting_firms
  ADD COLUMN IF NOT EXISTS onboarding_status TEXT DEFAULT 'pending' 
    CHECK (onboarding_status IN ('pending', 'in_progress', 'completed')),
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS onboarding_completed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS legal_name TEXT,
  ADD COLUMN IF NOT EXISTS jurisdiction TEXT,
  ADD COLUMN IF NOT EXISTS reporting_standard TEXT,
  ADD COLUMN IF NOT EXISTS default_accounting_standard TEXT;

-- Index for onboarding status queries
CREATE INDEX IF NOT EXISTS idx_accounting_firms_onboarding_status 
  ON accounting_firms(onboarding_status);

-- Comments
COMMENT ON COLUMN accounting_firms.onboarding_status IS 
  'Onboarding status: pending (not started), in_progress (started but incomplete), completed (ready for operations)';
COMMENT ON COLUMN accounting_firms.onboarding_completed_at IS 
  'Timestamp when firm onboarding was completed';
COMMENT ON COLUMN accounting_firms.onboarding_completed_by IS 
  'User ID (Partner) who completed the onboarding';
COMMENT ON COLUMN accounting_firms.legal_name IS 
  'Legal name of the accounting firm';
COMMENT ON COLUMN accounting_firms.jurisdiction IS 
  'Jurisdiction where the firm operates';
COMMENT ON COLUMN accounting_firms.reporting_standard IS 
  'Primary reporting standard (e.g., IFRS, Local GAAP)';
COMMENT ON COLUMN accounting_firms.default_accounting_standard IS 
  'Default accounting standard for new clients';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Step 8.8: Firm Onboarding Status columns added';
  RAISE NOTICE '  - onboarding_status column added (pending/in_progress/completed)';
  RAISE NOTICE '  - onboarding_completed_at column added';
  RAISE NOTICE '  - onboarding_completed_by column added';
  RAISE NOTICE '  - Firm details columns added (legal_name, jurisdiction, etc.)';
END;
$$;
