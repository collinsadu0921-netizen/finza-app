-- ============================================================================
-- Migration 362: Consolidate business_users role constraint
-- ============================================================================
-- Previous constraint (069) allowed: admin, manager, cashier, employee
-- Service team UI/API used: admin, manager, staff, accountant
-- → 'staff' and 'accountant' were missing, causing DB constraint violations on insert.
--
-- Final allowed set:
--   admin      – full access including settings and team management
--   manager    – operational access: jobs, invoices, customers
--   accountant – ledger, reports, bills, expenses; blocked from settings/payroll
--   staff      – view/update assigned jobs only
--   cashier    – POS terminal only (retail)
--   employee   – legacy alias for staff (retained for backward compat)
-- ============================================================================

DO $$
BEGIN
  -- Drop the existing constraint
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'business_users'
      AND constraint_name = 'business_users_role_check'
  ) THEN
    ALTER TABLE business_users DROP CONSTRAINT business_users_role_check;
  END IF;

  -- Recreate with full role set
  ALTER TABLE business_users
    ADD CONSTRAINT business_users_role_check
    CHECK (role IN ('admin', 'manager', 'accountant', 'staff', 'cashier', 'employee'));

  RAISE NOTICE 'business_users_role_check updated: admin, manager, accountant, staff, cashier, employee';
END $$;
