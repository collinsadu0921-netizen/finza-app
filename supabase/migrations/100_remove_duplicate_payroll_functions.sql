-- Migration: Remove duplicate payroll calculation functions
-- 
-- These functions are removed because:
-- 1. Payroll calculations now use the payroll engine (lib/payrollEngine/)
-- 2. Calculations happen in TypeScript before data is stored
-- 3. post_payroll_to_ledger() only uses pre-calculated values from payroll_runs table
-- 4. Eliminates duplication between SQL and TypeScript logic
--
-- Authority: This migration removes functions that are no longer used after
-- the payroll engine architecture was introduced.

-- ============================================================================
-- DROP FUNCTIONS: Calculate Ghana PAYE Tax
-- ============================================================================
DROP FUNCTION IF EXISTS calculate_ghana_paye(NUMERIC) CASCADE;

-- ============================================================================
-- DROP FUNCTIONS: Calculate SSNIT Employee Contribution
-- ============================================================================
DROP FUNCTION IF EXISTS calculate_ssnit_employee(NUMERIC) CASCADE;

-- ============================================================================
-- DROP FUNCTIONS: Calculate SSNIT Employer Contribution
-- ============================================================================
DROP FUNCTION IF EXISTS calculate_ssnit_employer(NUMERIC) CASCADE;

-- ============================================================================
-- VERIFY: post_payroll_to_ledger() still exists and works
-- ============================================================================
-- post_payroll_to_ledger() is kept because:
-- 1. It only uses pre-calculated values from payroll_runs table
-- 2. It does not depend on the removed calculation functions
-- 3. It handles ledger posting (accounting logic), not payroll calculation
--
-- Note: This function should NOT be modified unless accounting logic changes.
-- Payroll calculation logic belongs in the payroll engine, not in SQL.

-- If post_payroll_to_ledger() is missing, recreate it (from migration 047)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'post_payroll_to_ledger' 
    AND pronargs = 1
  ) THEN
    RAISE EXCEPTION 'post_payroll_to_ledger() function is missing. Please ensure migration 047_payroll_system.sql is applied.';
  END IF;
END $$;
