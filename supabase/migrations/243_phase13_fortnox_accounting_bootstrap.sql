-- ============================================================================
-- Phase 13: Fortnox-style accounting bootstrap (authoritative spec)
-- ============================================================================
-- Principle: A business profile is NOT an accounting system. Accounting
-- initializes only when the business performs its first accounting action.
--
-- 9.1 Rollback: Remove accounting bootstrap from business creation.
-- 9.2 Forward: Add ensure_accounting_initialized (SECURITY DEFINER), call from
--     invoice post, expense post, ledger read, trial balance read, P&L/BS read.
-- ============================================================================

-- ============================================================================
-- 9.1 ROLLBACK: Remove accounting bootstrap from business creation
-- ============================================================================

-- Remove trigger that created accounting period on business INSERT (RLS failure)
DROP TRIGGER IF EXISTS after_business_insert_initialize_accounting_period ON businesses;

-- Remove trigger that created Chart of Accounts on business INSERT
DROP TRIGGER IF EXISTS trigger_auto_create_system_accounts ON businesses;

-- ============================================================================
-- Trusted bootstrap: SECURITY DEFINER helpers
-- ============================================================================
-- ensure_accounting_initialized will run as definer and call these; they must
-- run with definer privileges so INSERTs bypass RLS (no business_users yet for
-- first-time bootstrap when called from Ledger/TB open).

ALTER FUNCTION create_system_accounts(UUID) SET search_path = public;
ALTER FUNCTION create_system_accounts(UUID) SECURITY DEFINER;

ALTER FUNCTION initialize_business_accounting_period(UUID, DATE) SET search_path = public;
ALTER FUNCTION initialize_business_accounting_period(UUID, DATE) SECURITY DEFINER;

-- ============================================================================
-- 9.2 FORWARD: ensure_accounting_initialized(business_id UUID)
-- ============================================================================
-- Idempotent. Allowed to run only when caller is a member of the business.
-- Creates CoA + one open period; does NOT create journal entries, snapshots, etc.

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

  -- 1. Chart of Accounts (idempotent inside create_system_accounts)
  PERFORM create_system_accounts(p_business_id);

  -- 2. First accounting period (start from business.start_date or current month)
  SELECT COALESCE(
    (SELECT (b.start_date)::DATE FROM businesses b WHERE b.id = p_business_id),
    DATE_TRUNC('month', CURRENT_DATE)::DATE
  ) INTO v_start_date;

  PERFORM initialize_business_accounting_period(p_business_id, v_start_date);

  RETURN;
END;
$$;

COMMENT ON FUNCTION ensure_accounting_initialized(UUID) IS
  'Phase 13: Fortnox-style bootstrap. Idempotent. Caller must be owner or admin/accountant. Creates CoA + one open period. No journal entries, snapshots, or balances. Call from invoice post, expense post, Ledger/TB/P&L/BS read.';

GRANT EXECUTE ON FUNCTION ensure_accounting_initialized(UUID) TO authenticated;
