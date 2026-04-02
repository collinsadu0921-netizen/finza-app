-- ============================================================================
-- Allow operational business_users (e.g. manager) to run idempotent accounting bootstrap
-- ============================================================================
-- ensure_accounting_initialized is SECURITY DEFINER and idempotent: it only ensures
-- system accounts, chart_of_accounts, control mappings, and an open period exist.
-- Managers and other team roles already create/send invoices; blocking bootstrap here
-- caused "Not allowed to initialize accounting for this business" on invoice send.
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
  -- Caller authorized if owner OR any active business_users role for this tenant
  -- (aligned with business_users_role_check: admin, manager, accountant, staff, cashier, employee).
  IF NOT EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = p_business_id AND b.owner_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM business_users bu
    WHERE bu.business_id = p_business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN (
        'admin',
        'accountant',
        'manager',
        'staff',
        'cashier',
        'employee'
      )
  ) THEN
    RAISE EXCEPTION 'Not allowed to initialize accounting for this business'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM create_system_accounts(p_business_id);
  PERFORM initialize_business_chart_of_accounts(p_business_id);

  SELECT EXISTS (
    SELECT 1 FROM accounting_periods
    WHERE business_id = p_business_id
  ) INTO v_period_exists;

  IF NOT v_period_exists THEN
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
  'Phase 13.3+: Idempotent Fortnox-style bootstrap. Caller: business owner or any business_users role (admin, accountant, manager, staff, cashier, employee). Ensures accounts, chart sync, control mappings, and at least one period.';

GRANT EXECUTE ON FUNCTION ensure_accounting_initialized(UUID) TO authenticated;
