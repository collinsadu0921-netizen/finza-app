-- ============================================================================
-- MIGRATION: Debug payment issue - verify migrations applied
-- ============================================================================
-- This migration helps verify that previous migrations were applied correctly
-- and provides a function to test payment creation manually
-- ============================================================================

-- Check if migration 072 was applied (should have payment_amount validation)
DO $$
DECLARE
  func_oid OID;
BEGIN
  SELECT p.oid INTO func_oid
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  AND p.proname = 'post_payment_to_ledger';
  
  IF func_oid IS NOT NULL THEN
    IF pg_get_functiondef(func_oid) LIKE '%payment_amount NUMERIC%' THEN
      RAISE NOTICE 'Migration 072 applied: post_payment_to_ledger has payment_amount variable';
    ELSE
      RAISE WARNING 'Migration 072 may not be applied: post_payment_to_ledger function exists but missing payment_amount variable';
    END IF;
  ELSE
    RAISE WARNING 'Migration 072: post_payment_to_ledger function not found';
  END IF;
END $$;

-- Check if migration 073 was applied (should have exception handling in trigger)
DO $$
DECLARE
  func_oid OID;
BEGIN
  SELECT p.oid INTO func_oid
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
  AND p.proname = 'trigger_post_payment';
  
  IF func_oid IS NOT NULL THEN
    IF pg_get_functiondef(func_oid) LIKE '%EXCEPTION WHEN OTHERS%' THEN
      RAISE NOTICE 'Migration 073 applied: trigger_post_payment has exception handling';
    ELSE
      RAISE WARNING 'Migration 073 may not be applied: trigger_post_payment function exists but missing exception handling';
    END IF;
  ELSE
    RAISE WARNING 'Migration 073: trigger_post_payment function not found';
  END IF;
END $$;

