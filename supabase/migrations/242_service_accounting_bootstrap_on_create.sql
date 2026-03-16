-- ============================================================================
-- MIGRATION: Accounting bootstrap on business creation (Service)
-- ============================================================================
-- Principle: Accounting starts the moment a business is created.
-- There is no pre-accounting state.
--
-- When a Service (or legacy Professional) business row is created:
-- 1. trigger_create_system_accounts (existing) creates Chart of Accounts.
-- 2. This trigger creates exactly one open accounting period.
--
-- Result: accounts.count > 0, accounting_periods.count >= 1, ledger valid (empty).
-- No trial balance snapshots, no journal entries, no fabricated balances.
-- ============================================================================

-- ============================================================================
-- Trigger function: create initial accounting period after business insert
-- ============================================================================
CREATE OR REPLACE FUNCTION trigger_initialize_business_accounting_period()
RETURNS TRIGGER AS $$
DECLARE
  period_start_date DATE;
BEGIN
  -- Only for service and professional (accounting-using industries)
  IF NEW.industry IN ('service', 'professional') THEN
    period_start_date := COALESCE(
      (NEW.start_date)::DATE,
      DATE_TRUNC('month', CURRENT_DATE)::DATE
    );
    PERFORM initialize_business_accounting_period(NEW.id, period_start_date);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trigger_initialize_business_accounting_period() IS
  'After INSERT on businesses: for service/professional, create one open accounting period (idempotent via initialize_business_accounting_period). Single source of truth for accounting bootstrap at business creation.';

-- ============================================================================
-- Attach trigger: AFTER INSERT on businesses
-- ============================================================================
DROP TRIGGER IF EXISTS after_business_insert_initialize_accounting_period ON businesses;
CREATE TRIGGER after_business_insert_initialize_accounting_period
  AFTER INSERT ON businesses
  FOR EACH ROW
  EXECUTE FUNCTION trigger_initialize_business_accounting_period();
