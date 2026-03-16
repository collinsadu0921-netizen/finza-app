-- ============================================================================
-- Phase 13.3: Repairable Fortnox-style bootstrap
-- ============================================================================
-- Bootstrap must be repairable: every invocation guarantees all invariants
-- (accounts, chart_of_accounts, control mappings, period) exist, regardless
-- of partial state from previous bootstrap runs or other code paths.
--
-- Removes early return that prevented control mapping creation when period
-- already exists. Always ensures: accounts → chart_of_accounts sync →
-- control mappings → at least one period.
-- ============================================================================

CREATE OR REPLACE FUNCTION ensure_accounting_initialized(p_business_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_date DATE;
  v_period_exists BOOLEAN;
BEGIN
  -- Caller authorized if owner OR business_users with admin/accountant
  IF NOT EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = p_business_id AND b.owner_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM business_users bu
    WHERE bu.business_id = p_business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('admin', 'accountant')
  ) THEN
    RAISE EXCEPTION 'Not allowed to initialize accounting for this business'
      USING ERRCODE = 'P0001';
  END IF;

  -- 1. System accounts (always ensure, idempotent inside create_system_accounts)
  PERFORM create_system_accounts(p_business_id);

  -- 2. Chart of accounts + control mappings (always ensure, idempotent)
  --    Syncs accounts → chart_of_accounts; inserts AR, AP, CASH, BANK into
  --    chart_of_accounts_control_map. ON CONFLICT DO NOTHING / DO UPDATE.
  PERFORM initialize_business_chart_of_accounts(p_business_id);

  -- 3. At least one accounting period (only create if none exists)
  SELECT EXISTS (
    SELECT 1 FROM accounting_periods
    WHERE business_id = p_business_id
  ) INTO v_period_exists;

  IF NOT v_period_exists THEN
    -- Resolve start date from business.start_date or current month
    SELECT COALESCE(
      (SELECT (b.start_date)::DATE FROM businesses b WHERE b.id = p_business_id),
      DATE_TRUNC('month', CURRENT_DATE)::DATE
    ) INTO v_start_date;

    PERFORM initialize_business_accounting_period(p_business_id, v_start_date);
  END IF;

  RETURN;
END;
$$;

COMMENT ON FUNCTION ensure_accounting_initialized(UUID) IS
  'Phase 13.3: Repairable Fortnox-style bootstrap. Idempotent. Caller must be owner or admin/accountant. Always ensures: accounts, chart_of_accounts (synced), control mappings (AR/AP/CASH/BANK), and at least one period. Repairs partial state: if period exists but mappings missing, creates mappings. Safe to call repeatedly. No journal entries, snapshots, or balances. Call from invoice post, expense post, Ledger/TB/P&L/BS read.';

GRANT EXECUTE ON FUNCTION ensure_accounting_initialized(UUID) TO authenticated;

-- ============================================================================
-- Verification queries (read-only, no data changes)
-- ============================================================================
-- Use these to verify bootstrap state for a business before/after bootstrap:
--
-- SELECT
--   (SELECT COUNT(*) FROM accounts WHERE business_id = :business_id AND deleted_at IS NULL) AS accounts_count,
--   (SELECT COUNT(*) FROM chart_of_accounts WHERE business_id = :business_id AND is_active = TRUE) AS chart_of_accounts_count,
--   (SELECT COUNT(*) FROM chart_of_accounts_control_map WHERE business_id = :business_id AND control_key = 'AR') AS ar_mapping_exists,
--   (SELECT COUNT(*) FROM accounting_periods WHERE business_id = :business_id) AS periods_count;
--
-- Expected after bootstrap:
--   accounts_count >= 1
--   chart_of_accounts_count >= 1
--   ar_mapping_exists = 1
--   periods_count >= 1
