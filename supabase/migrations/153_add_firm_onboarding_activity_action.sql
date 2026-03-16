-- ============================================================================
-- MIGRATION: Add firm_onboarding_completed action type to activity logs
-- ============================================================================
-- Adds 'firm_onboarding_completed' to the allowed action types in
-- accounting_firm_activity_logs table.
-- 
-- Note: This migration requires migration 144 (accounting_firm_activity_logs) to run first.
-- If the table doesn't exist, this migration will do nothing.
-- ============================================================================

-- Only proceed if the table exists (using dynamic SQL in DO block)
DO $$
BEGIN
  -- Check if the table exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'accounting_firm_activity_logs'
  ) THEN
    -- Drop the existing constraint if it exists
    EXECUTE 'ALTER TABLE accounting_firm_activity_logs DROP CONSTRAINT IF EXISTS accounting_firm_activity_logs_action_type_check';

    -- Recreate constraint with 'firm_onboarding_completed' added
    EXECUTE 'ALTER TABLE accounting_firm_activity_logs
      ADD CONSTRAINT accounting_firm_activity_logs_action_type_check
      CHECK (action_type IN (
        ''bulk_preflight'',
        ''bulk_afs_finalize'',
        ''single_afs_finalize'',
        ''bulk_exception_review'',
        ''client_access_granted'',
        ''client_access_revoked'',
        ''template_created'',
        ''template_copied'',
        ''firm_onboarding_completed''
      ))';

    RAISE NOTICE 'Added firm_onboarding_completed to allowed action types';
  ELSE
    RAISE NOTICE 'Table accounting_firm_activity_logs does not exist. Skipping constraint update.';
  END IF;
END $$;
