-- ============================================================================
-- Migration 378: Fix "function post_payment_to_ledger(uuid) is not unique"
-- ============================================================================
-- Root cause: Migration 373 defined two overloads of post_payment_to_ledger:
--
--   1. post_payment_to_ledger(UUID)
--      → the real implementation: advisory lock, idempotency, period guard,
--        draft guard, then delegates to post_invoice_payment_to_ledger.
--
--   2. post_payment_to_ledger(UUID, TEXT DEFAULT NULL, TEXT DEFAULT NULL, TEXT DEFAULT NULL)
--      → backward-compat wrapper; body is a single RETURN post_payment_to_ledger(p_payment_id).
--
-- When the payment trigger calls PERFORM post_payment_to_ledger(NEW.id),
-- PostgreSQL cannot resolve which overload to invoke because both accept
-- a single UUID argument (the 4-param version has all-optional defaults).
-- This causes: ERROR: function post_payment_to_ledger(uuid) is not unique
--
-- Fix: Drop the 4-param overload. It has no unique logic — it immediately
-- delegates to the 1-param version. All callers (triggers + API) use
-- 1-param style. Dropping this overload leaves only one candidate and
-- resolves the ambiguity permanently.
-- ============================================================================

DROP FUNCTION IF EXISTS post_payment_to_ledger(UUID, TEXT, TEXT, TEXT) CASCADE;

-- Verify: after this migration only one overload should exist:
-- SELECT proname, pg_get_function_arguments(oid)
-- FROM pg_proc
-- WHERE proname = 'post_payment_to_ledger';
-- Expected: 1 row — post_payment_to_ledger(p_payment_id uuid)
