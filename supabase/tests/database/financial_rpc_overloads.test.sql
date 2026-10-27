-- ============================================================================
-- financial_rpc_overloads.test.sql
--
-- Read-only assertion:
--   * FATAL: ambiguous "name-subset + defaults" overloads on the payroll payment
--     RPCs repaired by migration 5990.
--   * ADVISORY: the same pattern on other financial RPCs (general ledger,
--     year-end close, etc.). These are known, separately tracked issues and
--     must not block the payroll hotfix.
--
-- PostgreSQL/PostgREST cannot resolve the shorter argument list for a
-- name-subset+defaults pair (SQLSTATE 42725).
--
-- Run against any environment:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/database/financial_rpc_overloads.test.sql
-- ============================================================================

DO $$
DECLARE
  r record;
  v_critical text := '';
  v_count integer;
BEGIN
  -- 1) Detect name-subset+defaults overload pairs.
  FOR r IN
    WITH protected(proname, critical) AS (
      VALUES
        ('record_payroll_payment_atomic', true),
        ('record_payroll_batch_item_payment_atomic', true),
        ('lock_payroll_run_atomic', true),
        ('record_payroll_obligation_payment_atomic', false),
        ('approve_payroll_run_atomic', false),
        ('reverse_payroll_run_atomic', false),
        ('post_payroll_payment_to_ledger', false),
        ('post_payroll_obligation_payment_to_ledger', false),
        ('get_general_ledger_paginated', false),
        ('get_operational_overdue_invoices_page', false),
        ('post_journal_entry', false),
        ('post_sale_to_ledger', false),
        ('validate_accountant_posting', false)
    )
    SELECT
      p.critical,
      a.proname,
      pg_get_function_identity_arguments(a.oid) AS shorter_args,
      pg_get_function_identity_arguments(b.oid) AS longer_args
    FROM pg_proc a
    JOIN protected p ON p.proname = a.proname
    JOIN pg_proc b
      ON b.proname = a.proname
     AND b.oid <> a.oid
     AND b.pronargs > a.pronargs
     AND b.pronargdefaults >= (b.pronargs - a.pronargs)
     AND a.proargnames IS NOT NULL
     AND b.proargnames IS NOT NULL
     -- PostgREST resolves RPC calls by parameter name. The shorter
     -- function's named arguments are a subset of the longer function's
     -- named arguments, and the longer function defaults the rest.
     AND a.proargnames <@ b.proargnames
    JOIN pg_namespace n ON n.oid = a.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    IF r.critical THEN
      v_critical := v_critical || format(
        '%s (%s) is a name-subset of %s (%s); ',
        r.proname, r.shorter_args, r.proname, r.longer_args
      );
    ELSE
      RAISE WARNING 'ADVISORY ambiguous financial RPC overload (separate issue): % (%) is a name-subset of % (%)',
        r.proname, r.shorter_args, r.proname, r.longer_args;
    END IF;
  END LOOP;

  IF v_critical <> '' THEN
    RAISE EXCEPTION 'Ambiguous CRITICAL financial RPC overload(s): %', v_critical;
  END IF;

  -- 2) The three payroll repair RPCs must have exactly one canonical signature.
  SELECT count(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'record_payroll_payment_atomic';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'record_payroll_payment_atomic must have exactly 1 overload, found %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'record_payroll_batch_item_payment_atomic';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'record_payroll_batch_item_payment_atomic must have exactly 1 overload, found %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'lock_payroll_run_atomic';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'lock_payroll_run_atomic must have exactly 1 overload, found %', v_count;
  END IF;

  -- 3) Canonical signatures must exist.
  IF to_regprocedure('public.record_payroll_payment_atomic(uuid,uuid,date,numeric,uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'canonical 8-arg record_payroll_payment_atomic is missing';
  END IF;
  IF to_regprocedure('public.record_payroll_batch_item_payment_atomic(uuid,uuid,uuid,uuid,date,uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'canonical 9-arg record_payroll_batch_item_payment_atomic is missing';
  END IF;
  IF to_regprocedure('public.lock_payroll_run_atomic(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'canonical 2-arg lock_payroll_run_atomic is missing';
  END IF;

  RAISE NOTICE 'PASS: no ambiguous critical financial RPC overloads; canonical payroll RPCs present';
END $$;
