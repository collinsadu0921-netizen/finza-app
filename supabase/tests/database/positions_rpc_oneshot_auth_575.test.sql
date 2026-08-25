-- ============================================================================
-- Database tests for migration 575 — positions RPC one-shot authorization
-- Runs inside a single transaction ending with ROLLBACK.
--
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/database/positions_rpc_oneshot_auth_575.test.sql
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_biz uuid := '4e6cdfba-e2ab-4ee4-ac00-9b077d696544';
  v_as_of date := DATE '2026-08-24';
  v_owner uuid := 'd559d652-9c68-4146-823c-c4d218b7cbc6';
  v_member uuid := '7b6f765e-cd86-44b8-9283-5b480bd0b441';
  v_firm_user uuid := 'f9ad7433-fba8-4c04-9733-b1928059ded4';
  v_firm uuid := 'ca612dee-cebd-40da-90ea-4141101d0381';
  v_unrelated uuid := 'ef7f259e-9c0d-43e8-bfac-fba0165fee48';
  v_forged uuid := '00000000-0000-4000-8000-000000000001';
  v_empty_biz uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_cash numeric;
  v_ar numeric;
  v_ap numeric;
  v_cash2 numeric;
  v_ar2 numeric;
  v_ap2 numeric;
  v_uid uuid;
  v_role text;
  v_prosecdef boolean;
  v_search text;
  v_owner_name text;
  v_je_unauth int;
  v_jel_unauth int;
  v_fn_count int;
BEGIN
  SELECT COUNT(*) INTO v_fn_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'finza_dashboard_positions_as_of';
  IF v_fn_count <> 1 THEN
    RAISE EXCEPTION '575 fn identity: expected 1 overload, got %', v_fn_count;
  END IF;

  SELECT p.prosecdef, array_to_string(p.proconfig, ','), pg_get_userbyid(p.proowner)
    INTO v_prosecdef, v_search, v_owner_name
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'finza_dashboard_positions_as_of';

  IF v_prosecdef IS NOT TRUE THEN
    RAISE EXCEPTION '575 fn identity: expected SECURITY DEFINER';
  END IF;
  IF v_search IS DISTINCT FROM 'search_path=pg_catalog' THEN
    RAISE EXCEPTION '575 fn identity: expected search_path=pg_catalog, got %', v_search;
  END IF;
  IF v_owner_name IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION '575 fn identity: expected owner postgres, got %', v_owner_name;
  END IF;

  -- ------------------------------------------------------------------
  -- OWNER — fixture accounting parity + auth.uid is caller JWT
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT auth.uid() INTO v_uid;
  IF v_uid IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION '575 auth.uid: expected caller owner, got %', v_uid;
  END IF;

  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash, v_ar, v_ap
  FROM public.finza_dashboard_positions_as_of(v_biz, v_as_of);

  IF v_cash IS DISTINCT FROM 193678.85
     OR v_ar IS DISTINCT FROM 738841.20
     OR v_ap IS DISTINCT FROM 293740.14 THEN
    RAISE EXCEPTION '575 owner 2026-08-24 mismatch: % / % / %', v_cash, v_ar, v_ap;
  END IF;

  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash2, v_ar2, v_ap2
  FROM public.finza_dashboard_positions_as_of(v_biz, DATE '2026-01-31');
  IF v_cash2 IS DISTINCT FROM 228478.00
     OR v_ar2 IS DISTINCT FROM 477773.00
     OR v_ap2 IS DISTINCT FROM 47559.75 THEN
    RAISE EXCEPTION '575 owner 2026-01-31 mismatch: % / % / %', v_cash2, v_ar2, v_ap2;
  END IF;

  SELECT cash_balance INTO v_cash
  FROM public.finza_dashboard_positions_as_of(v_biz, DATE '2020-01-01');
  IF v_cash IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '575 owner pre-ledger date expected 0, got %', v_cash;
  END IF;

  RESET ROLE;

  -- ------------------------------------------------------------------
  -- BUSINESS MEMBER (not owner)
  -- ------------------------------------------------------------------
  INSERT INTO public.business_users (business_id, user_id, role, created_at)
  VALUES (v_biz, v_member, 'admin', NOW())
  ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash, v_ar, v_ap
  FROM public.finza_dashboard_positions_as_of(v_biz, v_as_of);
  IF v_cash IS DISTINCT FROM 193678.85
     OR v_ar IS DISTINCT FROM 738841.20
     OR v_ap IS DISTINCT FROM 293740.14 THEN
    RAISE EXCEPTION '575 member mismatch: % / % / %', v_cash, v_ar, v_ap;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- PRACTICE without engagement — denied (zeros)
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_firm_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_firm_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT auth.uid() INTO v_uid;
  IF v_uid IS DISTINCT FROM v_firm_user THEN
    RAISE EXCEPTION '575 practice-without jwt is %, expected %', v_uid, v_firm_user;
  END IF;

  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash, v_ar, v_ap
  FROM public.finza_dashboard_positions_as_of(v_biz, v_as_of);
  IF v_cash IS DISTINCT FROM 0 OR v_ar IS DISTINCT FROM 0 OR v_ap IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '575 practice without engagement leaked values: % / % / %', v_cash, v_ar, v_ap;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- PRACTICE with valid engagement — allowed
  -- ------------------------------------------------------------------
  INSERT INTO public.firm_client_engagements (
    accounting_firm_id,
    client_business_id,
    status,
    access_level,
    effective_from,
    effective_to,
    created_by,
    accepted_by,
    accepted_at
  ) VALUES (
    v_firm,
    v_biz,
    'active',
    'read',
    CURRENT_DATE - 7,
    NULL,
    v_firm_user,
    v_firm_user,
    NOW()
  );

  PERFORM set_config('request.jwt.claim.sub', v_firm_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_firm_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash, v_ar, v_ap
  FROM public.finza_dashboard_positions_as_of(v_biz, v_as_of);
  IF v_cash IS DISTINCT FROM 193678.85
     OR v_ar IS DISTINCT FROM 738841.20
     OR v_ap IS DISTINCT FROM 293740.14 THEN
    RAISE EXCEPTION '575 practice with engagement mismatch: % / % / %', v_cash, v_ar, v_ap;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- UNRELATED authenticated + FORGED business + empty authorized books
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_unrelated::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_unrelated, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash, v_ar, v_ap
  FROM public.finza_dashboard_positions_as_of(v_biz, v_as_of);
  IF v_cash IS DISTINCT FROM 0 OR v_ar IS DISTINCT FROM 0 OR v_ap IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '575 unrelated user leaked values: % / % / %', v_cash, v_ar, v_ap;
  END IF;

  SELECT cash_balance INTO v_cash
  FROM public.finza_dashboard_positions_as_of(v_forged, v_as_of);
  IF v_cash IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '575 forged business leaked: %', v_cash;
  END IF;

  SELECT count(*)::int INTO v_je_unauth
  FROM public.journal_entries
  WHERE business_id = v_biz;
  SELECT count(*)::int INTO v_jel_unauth
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  WHERE je.business_id = v_biz;
  IF v_je_unauth <> 0 OR v_jel_unauth <> 0 THEN
    RAISE EXCEPTION '575 direct-table RLS regression: unrelated saw % entries / % lines', v_je_unauth, v_jel_unauth;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- ANONYMOUS — zeros (EXECUTE preserved; no journal leak)
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
  SET LOCAL ROLE anon;

  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash, v_ar, v_ap
  FROM public.finza_dashboard_positions_as_of(v_biz, v_as_of);
  IF v_cash IS DISTINCT FROM 0 OR v_ar IS DISTINCT FROM 0 OR v_ap IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '575 anon leaked values: % / % / %', v_cash, v_ar, v_ap;
  END IF;
  RESET ROLE;

  -- GUC path (existing RLS OR-policy): unrelated user + app.current_business_id
  PERFORM set_config('request.jwt.claim.sub', v_unrelated::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_unrelated, 'role', 'authenticated')::text, true);
  PERFORM set_config('app.current_business_id', v_biz::text, true);
  SET LOCAL ROLE authenticated;
  SELECT cash_balance INTO v_cash
  FROM public.finza_dashboard_positions_as_of(v_biz, v_as_of);
  IF v_cash IS DISTINCT FROM 193678.85 THEN
    RAISE EXCEPTION '575 GUC path expected fixture cash, got %', v_cash;
  END IF;
  RESET ROLE;
  PERFORM set_config('app.current_business_id', '', true);

  -- ------------------------------------------------------------------
  -- Authorized empty business (owner, no journals)
  -- ------------------------------------------------------------------
  INSERT INTO public.businesses (id, name, address_country, owner_id, created_at, updated_at)
  VALUES (v_empty_biz, '575 empty positions biz', 'Ghana', v_owner, NOW(), NOW());

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash, v_ar, v_ap
  FROM public.finza_dashboard_positions_as_of(v_empty_biz, v_as_of);
  IF v_cash IS DISTINCT FROM 0 OR v_ar IS DISTINCT FROM 0 OR v_ap IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '575 empty authorized business expected zeros, got % / % / %', v_cash, v_ar, v_ap;
  END IF;
  RESET ROLE;

  RAISE NOTICE '575 positions RPC oneshot auth tests passed';
EXCEPTION
  WHEN OTHERS THEN
    RESET ROLE;
    RAISE;
END;
$$;

ROLLBACK;
