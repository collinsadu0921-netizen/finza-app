-- ============================================================================
-- 335_chart_of_accounts_allow_contra_asset.sql
--
-- Fix: Bootstrap fails with "Unable to start accounting" after 333.
-- Cause: accounts.type can be 'contra_asset' (1650); initialize_business_chart_of_accounts
-- syncs accounts → chart_of_accounts and inserts account_type = account_record.type.
-- chart_of_accounts had CHECK (account_type IN ('asset','liability','equity','revenue','expense'))
-- so INSERT with 'contra_asset' violated the constraint and ensure_accounting_initialized failed.
--
-- This migration widens the chart_of_accounts.account_type CHECK to include 'contra_asset'.
-- ============================================================================

ALTER TABLE chart_of_accounts
  DROP CONSTRAINT IF EXISTS chart_of_accounts_account_type_check;

ALTER TABLE chart_of_accounts
  ADD CONSTRAINT chart_of_accounts_account_type_check
  CHECK (account_type IN ('asset', 'contra_asset', 'liability', 'equity', 'revenue', 'expense'));

COMMENT ON COLUMN chart_of_accounts.account_type IS
  'Account type: asset, contra_asset, liability, equity, revenue, expense. contra_asset = credit-normal (e.g. Accumulated Depreciation 1650).';
