-- ============================================================================
-- Ledger posting security ACL and function-shape checks (migration 627)
-- Runs inside one transaction and rolls back all data.
-- Behavioral role tests are in ledger_posting_security_627.test.js.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_sig TEXT;
  v_prosrc TEXT;
  v_proconfig TEXT[];
  v_anon_blocked TEXT[] := ARRAY[
    'public.post_journal_entry(uuid,date,text,text,uuid,jsonb,boolean,text,text,uuid,text,text,text,uuid,text,boolean,uuid)',
    'public.post_journal_entry(uuid,date,text,text,uuid,jsonb,boolean,text,text,uuid,text,text,text,uuid)',
    'public.post_journal_entry(uuid,date,text,text,uuid,jsonb,boolean,text,text,uuid)',
    'public.post_wht_remittance_to_ledger(uuid,text)',
    'public.post_journal_entry_with_request_metadata(uuid,date,text,text,uuid,jsonb,boolean,text,text,uuid,text,text,text,uuid,text,boolean,uuid,text,text)',
    'public.post_adjustment_to_ledger(uuid,date,jsonb,text,uuid)',
    'public.post_cit_payment_to_ledger(uuid,text,date,text)',
    'public.post_reconciliation_journal_entry(uuid,uuid,text,date,text,jsonb,uuid,uuid,text)',
    'public.create_wht_remittance_atomic(uuid,uuid[],date,text,text,text)',
    'public.post_vat_return_payment_atomic(uuid,date,uuid,text)'
  ];
  v_authenticated_allowed TEXT[] := ARRAY[
    'public.post_journal_entry(uuid,date,text,text,uuid,jsonb,boolean,text,text,uuid,text,text,text,uuid,text,boolean,uuid)',
    'public.post_journal_entry(uuid,date,text,text,uuid,jsonb,boolean,text,text,uuid,text,text,text,uuid)',
    'public.post_journal_entry(uuid,date,text,text,uuid,jsonb,boolean,text,text,uuid)',
    'public.post_adjustment_to_ledger(uuid,date,jsonb,text,uuid)',
    'public.post_cit_payment_to_ledger(uuid,text,date,text)',
    'public.post_reconciliation_journal_entry(uuid,uuid,text,date,text,jsonb,uuid,uuid,text)',
    'public.create_wht_remittance_atomic(uuid,uuid[],date,text,text,text)',
    'public.post_vat_return_payment_atomic(uuid,date,uuid,text)'
  ];
  v_internal_only TEXT[] := ARRAY[
    'public.post_wht_remittance_to_ledger(uuid,text)',
    'public.post_journal_entry_with_request_metadata(uuid,date,text,text,uuid,jsonb,boolean,text,text,uuid,text,text,text,uuid,text,boolean,uuid,text,text)'
  ];
BEGIN
  FOREACH v_sig IN ARRAY v_anon_blocked LOOP
    IF has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST_FAILED: anon can execute %', v_sig;
    END IF;
  END LOOP;

  FOREACH v_sig IN ARRAY v_authenticated_allowed LOOP
    IF NOT has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST_FAILED: authenticated cannot execute %', v_sig;
    END IF;
  END LOOP;

  FOREACH v_sig IN ARRAY v_internal_only LOOP
    IF has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST_FAILED: authenticated can execute internal-only %', v_sig;
    END IF;
    IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST_FAILED: service_role cannot execute %', v_sig;
    END IF;
  END LOOP;

  SELECT p.prosrc, p.proconfig
  INTO v_prosrc, v_proconfig
  FROM pg_proc p
  WHERE p.oid = 'public.post_journal_entry(uuid,date,text,text,uuid,jsonb,boolean,text,text,uuid,text,text,text,uuid,text,boolean,uuid)'::regprocedure;

  IF v_prosrc LIKE '%auth.uid() IS NOT NULL%' THEN
    RAISE EXCEPTION 'TEST_FAILED: post_journal_entry still skips authorization for NULL auth.uid()';
  END IF;
  IF v_prosrc NOT LIKE '%LEDGER_POSTING_ACTOR_FORBIDDEN%' THEN
    RAISE EXCEPTION 'TEST_FAILED: post_journal_entry lacks actor-spoofing protection';
  END IF;
  IF v_prosrc NOT LIKE '%LEDGER_POSTING_ACCOUNT_INVALID%' THEN
    RAISE EXCEPTION 'TEST_FAILED: post_journal_entry lacks account tenant validation';
  END IF;
  IF NOT (v_proconfig @> ARRAY['search_path=public, pg_catalog']::TEXT[]) THEN
    RAISE EXCEPTION 'TEST_FAILED: post_journal_entry search_path is not hardened';
  END IF;

  SELECT p.prosrc, p.proconfig
  INTO v_prosrc, v_proconfig
  FROM pg_proc p
  WHERE p.oid = 'public.post_wht_remittance_to_ledger(uuid,text)'::regprocedure;

  IF v_prosrc NOT LIKE '%journal_entry_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'TEST_FAILED: WHT writer lacks idempotent journal reuse';
  END IF;
  IF v_prosrc NOT LIKE '%FOR UPDATE%' THEN
    RAISE EXCEPTION 'TEST_FAILED: WHT writer does not lock the remittance row';
  END IF;
  IF NOT (v_proconfig @> ARRAY['search_path=public, pg_catalog']::TEXT[]) THEN
    RAISE EXCEPTION 'TEST_FAILED: WHT writer search_path is not hardened';
  END IF;

  RAISE NOTICE 'PASS: ledger posting security ACL and function-shape checks (627)';
END $$;

ROLLBACK;
