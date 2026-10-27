-- ============================================================================
-- 5990_drop_obsolete_payroll_payment_overloads.sql
--
-- P0 repair for payroll RPC overload ambiguity.
--
-- Background:
--   Migration 562 created 11-arg / 10-arg / 3-arg payroll RPCs.
--   Migration 563 correctly dropped those obsolete overloads and created the
--   canonical 8-arg / 9-arg / 2-arg versions.
--   Production later re-created the obsolete overloads out of order, leaving
--   both signatures for each RPC. PostgREST then cannot resolve an 8/9/2-arg
--   call (`SQLSTATE 42725`, "function ... is not unique").
--
-- This migration is deliberately idempotent and safe on:
--   * staging, where only the canonical signatures exist (no-op), and
--   * production, where the canonical + obsolete signatures coexist.
--
-- It does NOT modify data, financial logic, or the canonical function bodies.
-- It drops ONLY the exact obsolete signatures, without CASCADE.
-- If any unexpected signature, missing canonical function, or dependent object
-- is found, the transaction aborts before any DROP is attempted.
-- ============================================================================

DO $$
DECLARE
  v_canon_payment oid := to_regprocedure(
    'public.record_payroll_payment_atomic(uuid,uuid,date,numeric,uuid,text,text,text)'
  )::oid;
  v_old_payment oid := to_regprocedure(
    'public.record_payroll_payment_atomic(uuid,uuid,date,numeric,uuid,text,text,uuid,uuid,uuid,text)'
  )::oid;

  v_canon_batch oid := to_regprocedure(
    'public.record_payroll_batch_item_payment_atomic(uuid,uuid,uuid,uuid,date,uuid,text,text,text)'
  )::oid;
  v_old_batch oid := to_regprocedure(
    'public.record_payroll_batch_item_payment_atomic(uuid,uuid,uuid,uuid,date,uuid,text,text,uuid,text)'
  )::oid;

  v_canon_lock oid := to_regprocedure(
    'public.lock_payroll_run_atomic(uuid,uuid)'
  )::oid;
  v_old_lock oid := to_regprocedure(
    'public.lock_payroll_run_atomic(uuid,uuid,uuid)'
  )::oid;

  v_count integer;
  r record;
BEGIN
  -- ------------------------------------------------------------------------
  -- 1) Canonical functions must exist exactly once.
  -- ------------------------------------------------------------------------
  IF v_canon_payment IS NULL THEN
    RAISE EXCEPTION '5990 precondition failed: canonical 8-arg record_payroll_payment_atomic is missing';
  END IF;
  IF v_canon_batch IS NULL THEN
    RAISE EXCEPTION '5990 precondition failed: canonical 9-arg record_payroll_batch_item_payment_atomic is missing';
  END IF;
  IF v_canon_lock IS NULL THEN
    RAISE EXCEPTION '5990 precondition failed: canonical 2-arg lock_payroll_run_atomic is missing';
  END IF;

  -- ------------------------------------------------------------------------
  -- 2) Every overload of each RPC must be either the canonical signature or
  --    the known obsolete signature. Anything else aborts the migration.
  -- ------------------------------------------------------------------------
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'record_payroll_payment_atomic',
        'record_payroll_batch_item_payment_atomic',
        'lock_payroll_run_atomic'
      )
  LOOP
    IF r.proname = 'record_payroll_payment_atomic' THEN
      IF r.oid <> v_canon_payment AND (v_old_payment IS NULL OR r.oid <> v_old_payment) THEN
        RAISE EXCEPTION '5990 precondition failed: unexpected signature public.record_payroll_payment_atomic(%)', r.args;
      END IF;
    ELSIF r.proname = 'record_payroll_batch_item_payment_atomic' THEN
      IF r.oid <> v_canon_batch AND (v_old_batch IS NULL OR r.oid <> v_old_batch) THEN
        RAISE EXCEPTION '5990 precondition failed: unexpected signature public.record_payroll_batch_item_payment_atomic(%)', r.args;
      END IF;
    ELSIF r.proname = 'lock_payroll_run_atomic' THEN
      IF r.oid <> v_canon_lock AND (v_old_lock IS NULL OR r.oid <> v_old_lock) THEN
        RAISE EXCEPTION '5990 precondition failed: unexpected signature public.lock_payroll_run_atomic(%)', r.args;
      END IF;
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------------
  -- 3) Canonical signature must be unique (no duplicate canonical OID).
  -- ------------------------------------------------------------------------
  SELECT count(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'record_payroll_payment_atomic';
  IF v_count NOT IN (1, 2) THEN
    RAISE EXCEPTION '5990 precondition failed: expected 1 or 2 record_payroll_payment_atomic overloads, found %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'record_payroll_batch_item_payment_atomic';
  IF v_count NOT IN (1, 2) THEN
    RAISE EXCEPTION '5990 precondition failed: expected 1 or 2 record_payroll_batch_item_payment_atomic overloads, found %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'lock_payroll_run_atomic';
  IF v_count NOT IN (1, 2) THEN
    RAISE EXCEPTION '5990 precondition failed: expected 1 or 2 lock_payroll_run_atomic overloads, found %', v_count;
  END IF;

  -- ------------------------------------------------------------------------
  -- 4) Refuse to drop an obsolete function that has dependent objects.
  --    DROP FUNCTION without CASCADE would fail anyway; this gives a clear
  --    error before any DDL is attempted.
  -- ------------------------------------------------------------------------
  IF v_old_payment IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_depend d
    WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = v_old_payment
  ) THEN
    RAISE EXCEPTION '5990 precondition failed: obsolete 11-arg record_payroll_payment_atomic has dependent objects';
  END IF;

  IF v_old_batch IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_depend d
    WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = v_old_batch
  ) THEN
    RAISE EXCEPTION '5990 precondition failed: obsolete 10-arg record_payroll_batch_item_payment_atomic has dependent objects';
  END IF;

  IF v_old_lock IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_depend d
    WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = v_old_lock
  ) THEN
    RAISE EXCEPTION '5990 precondition failed: obsolete 3-arg lock_payroll_run_atomic has dependent objects';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5) Drop only the known obsolete signatures. No CASCADE.
--    These are no-ops on staging, where 563 already removed them.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_payroll_payment_atomic(
  uuid, uuid, date, numeric, uuid, text, text, uuid, uuid, uuid, text
);

DROP FUNCTION IF EXISTS public.record_payroll_batch_item_payment_atomic(
  uuid, uuid, uuid, uuid, date, uuid, text, text, uuid, text
);

DROP FUNCTION IF EXISTS public.lock_payroll_run_atomic(
  uuid, uuid, uuid
);

DO $$
DECLARE
  v_canon_payment oid := to_regprocedure(
    'public.record_payroll_payment_atomic(uuid,uuid,date,numeric,uuid,text,text,text)'
  )::oid;
  v_canon_batch oid := to_regprocedure(
    'public.record_payroll_batch_item_payment_atomic(uuid,uuid,uuid,uuid,date,uuid,text,text,text)'
  )::oid;
  v_canon_lock oid := to_regprocedure(
    'public.lock_payroll_run_atomic(uuid,uuid)'
  )::oid;

  v_count integer;
BEGIN
  -- ------------------------------------------------------------------------
  -- 6) Exactly one signature must remain for each RPC.
  -- ------------------------------------------------------------------------
  SELECT count(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'record_payroll_payment_atomic';
  IF v_count <> 1 THEN
    RAISE EXCEPTION '5990 postcondition failed: record_payroll_payment_atomic overloads=%', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'record_payroll_batch_item_payment_atomic';
  IF v_count <> 1 THEN
    RAISE EXCEPTION '5990 postcondition failed: record_payroll_batch_item_payment_atomic overloads=%', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'lock_payroll_run_atomic';
  IF v_count <> 1 THEN
    RAISE EXCEPTION '5990 postcondition failed: lock_payroll_run_atomic overloads=%', v_count;
  END IF;

  -- ------------------------------------------------------------------------
  -- 7) The remaining function must be the canonical signature and must still
  --    be SECURITY DEFINER, locked search_path, and executable by
  --    `authenticated`. This proves the drop preserved the canonical RPC,
  --    its permissions, and its security posture.
  -- ------------------------------------------------------------------------
  IF v_canon_payment IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_proc p
       WHERE p.oid = v_canon_payment
         AND p.prosecdef
         AND p.proacl IS NOT NULL
         AND p.proacl::text LIKE '%authenticated=%'
         AND 'search_path=public' = ANY (p.proconfig)
     ) THEN
    RAISE EXCEPTION '5990 postcondition failed: canonical 8-arg payment RPC or its security/grants were altered';
  END IF;

  IF v_canon_batch IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_proc p
       WHERE p.oid = v_canon_batch
         AND p.prosecdef
         AND p.proacl IS NOT NULL
         AND p.proacl::text LIKE '%authenticated=%'
         AND 'search_path=public' = ANY (p.proconfig)
     ) THEN
    RAISE EXCEPTION '5990 postcondition failed: canonical 9-arg batch RPC or its security/grants were altered';
  END IF;

  IF v_canon_lock IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_proc p
       WHERE p.oid = v_canon_lock
         AND p.prosecdef
         AND p.proacl IS NOT NULL
         AND p.proacl::text LIKE '%authenticated=%'
         AND 'search_path=public' = ANY (p.proconfig)
     ) THEN
    RAISE EXCEPTION '5990 postcondition failed: canonical 2-arg lock RPC or its security/grants were altered';
  END IF;

  IF NOT has_function_privilege('authenticated', v_canon_payment, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_canon_batch, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_canon_lock, 'EXECUTE') THEN
    RAISE EXCEPTION '5990 postcondition failed: canonical RPC EXECUTE privilege for authenticated was not preserved';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 8) Ask PostgREST to rebuild its schema cache so the obsolete signature
--    disappears from OpenAPI and RPC resolution immediately after commit.
-- ----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
