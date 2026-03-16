-- ============================================================================
-- Phase 13.2: Complete accounting bootstrap (control mappings)
-- ============================================================================
-- Bootstrap must ensure control-account mappings (AR, AP, CASH, BANK) exist
-- so the first posting action succeeds. Use existing initializer; do not
-- reimplement mapping logic. Preserve: no accounting on business creation,
-- idempotent bootstrap, strict posting layer.
-- ============================================================================

-- ============================================================================
-- 1. initialize_business_chart_of_accounts: SECURITY DEFINER + search_path
-- ============================================================================
-- Must run under same trusted context as bootstrap so INSERTs into
-- chart_of_accounts and chart_of_accounts_control_map succeed when called
-- from ensure_accounting_initialized (no RLS bypass elsewhere).

ALTER FUNCTION initialize_business_chart_of_accounts(UUID) SET search_path = public;
ALTER FUNCTION initialize_business_chart_of_accounts(UUID) SECURITY DEFINER;

-- ============================================================================
-- 2. ensure_accounting_initialized: ensure control mappings after accounts
-- ============================================================================
-- After create_system_accounts and before returning, ensure control mappings
-- exist by calling initialize_business_chart_of_accounts (syncs accounts →
-- chart_of_accounts, inserts AR, AP, CASH, BANK into chart_of_accounts_control_map).
-- Idempotent: initializer uses ON CONFLICT DO NOTHING / DO UPDATE.

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

  -- Idempotent: if any accounting period exists, consider initialized
  SELECT EXISTS (
    SELECT 1 FROM accounting_periods
    WHERE business_id = p_business_id
  ) INTO v_period_exists;

  IF v_period_exists THEN
    RETURN;
  END IF;

  -- 1. System accounts (idempotent inside create_system_accounts)
  PERFORM create_system_accounts(p_business_id);

  -- 2. Chart of accounts + control mappings (AR, AP, CASH, BANK)
  --    Syncs accounts → chart_of_accounts; inserts into chart_of_accounts_control_map.
  --    Idempotent: ON CONFLICT DO NOTHING / DO UPDATE.
  PERFORM initialize_business_chart_of_accounts(p_business_id);

  -- 3. First accounting period (start from business.start_date or current month)
  SELECT COALESCE(
    (SELECT (b.start_date)::DATE FROM businesses b WHERE b.id = p_business_id),
    DATE_TRUNC('month', CURRENT_DATE)::DATE
  ) INTO v_start_date;

  PERFORM initialize_business_accounting_period(p_business_id, v_start_date);

  RETURN;
END;
$$;

COMMENT ON FUNCTION ensure_accounting_initialized(UUID) IS
  'Phase 13: Fortnox-style bootstrap. Idempotent. Caller must be owner or admin/accountant. Creates accounts, chart_of_accounts + control mappings (AR/AP/CASH/BANK), and one open period. No journal entries, snapshots, or balances. Call from invoice post, expense post, Ledger/TB/P&L/BS read.';
