-- ============================================================================
-- Service workspace: backfill chart_of_accounts from accounts
-- ============================================================================
-- Service businesses get create_system_accounts() (5100, 1000, etc.) into
-- "accounts" but chart_of_accounts is never auto-populated. assert_account_exists
-- and get_control_account_code read chart_of_accounts, so expense posting fails
-- with "Invalid account code for this business: 5100".
--
-- This migration syncs accounts → chart_of_accounts and ensures control
-- mappings (CASH, AR, etc.) for every business that has accounts. Idempotent.
-- ============================================================================

DO $$
DECLARE
  biz RECORD;
  done INTEGER := 0;
BEGIN
  FOR biz IN SELECT DISTINCT business_id FROM accounts WHERE deleted_at IS NULL
  LOOP
    PERFORM initialize_business_chart_of_accounts(biz.business_id);
    done := done + 1;
  END LOOP;
  RAISE NOTICE 'chart_of_accounts backfill: synced % business(es)', done;
END $$;
