-- ============================================================================
-- Database tests for migration 576 — positions RPC secure caller authorization
-- Runs inside a single transaction ending with ROLLBACK.
--
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/database/positions_rpc_secure_auth_576.test.sql
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
  v_cash numeric;
  v_ar numeric;
  v_ap numeric;
  v_prosecdef boolean;
  v_search text;
  v_owner_name text;
  v_fn_count int;
  v_je int;
  v_jel int;
  v_eng_id uuid;
  v_set_role_err text;
  v_set_config_role text;
  v_set_config_role_err text;
BEGIN
  SELECT COUNT(*) INTO v_fn_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'finza_dashboard_positions_as_of';
  IF v_fn_count <> 1 THEN
    RAISE EXCEPTION '576 fn identity: expected 1 overload, got %', v_fn_count;
  END IF;

  SELECT p.prosecdef, array_to_string(p.proconfig, ','), pg_get_userbyid(p.proowner)
    INTO v_prosecdef, v_search, v_owner_name
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'finza_dashboard_positions_as_of';

  IF v_prosecdef IS NOT TRUE THEN
    RAISE EXCEPTION '576 fn identity: expected SECURITY DEFINER';
  END IF;
  IF v_search IS DISTINCT FROM 'search_path=pg_catalog' THEN
    RAISE EXCEPTION '576 fn identity: expected search_path=pg_catalog, got %', v_search;
  END IF;
  IF v_owner_name IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION '576 fn identity: expected owner postgres, got %', v_owner_name;
  END IF;
  IF pg_get_functiondef((
        SELECT p.oid FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'finza_dashboard_positions_as_of'
      )) LIKE '%app.current_business_id%' THEN
    RAISE EXCEPTION '576 fn must not authorize via app.current_business_id';
  END IF;
  IF pg_get_functiondef((
        SELECT p.oid FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'finza_dashboard_positions_as_of'
      )) LIKE '%request.jwt.claim.role%' THEN
    RAISE EXCEPTION '576 fn must not authorize via JWT role GUC';
  END IF;

  -- ------------------------------------------------------------------
  -- OWNER + accounting parity
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash, v_ar, v_ap
  FROM public.finza_dashboard_positions_as_of(v_biz, v_as_of);
  IF v_cash IS DISTINCT FROM 193678.85
     OR v_ar IS DISTINCT FROM 738841.20
     OR v_ap IS DISTINCT FROM 293740.14 THEN
    RAISE EXCEPTION '576 owner 2026-08-24 mismatch: % / % / %', v_cash, v_ar, v_ap;
  END IF;

  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash, v_ar, v_ap
  FROM public.finza_dashboard_positions_as_of(v_biz, DATE '2026-01-31');
  IF v_cash IS DISTINCT FROM 228478.00
     OR v_ar IS DISTINCT FROM 477773.00
     OR v_ap IS DISTINCT FROM 47559.75 THEN
    RAISE EXCEPTION '576 owner 2026-01-31 mismatch: % / % / %', v_cash, v_ar, v_ap;
  END IF;

  SELECT cash_balance INTO v_cash
  FROM public.finza_dashboard_positions_as_of(v_biz, DATE '2020-01-01');
  IF v_cash IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '576 owner pre-ledger date expected 0, got %', v_cash;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- BUSINESS MEMBER
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
    RAISE EXCEPTION '576 member mismatch: % / % / %', v_cash, v_ar, v_ap;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- PRACTICE no engagement
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_firm_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_firm_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash, v_ar, v_ap
  FROM public.finza_dashboard_positions_as_of(v_biz, v_as_of);
  IF v_cash IS DISTINCT FROM 0 OR v_ar IS DISTINCT FROM 0 OR v_ap IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '576 practice without engagement leaked: % / % / %', v_cash, v_ar, v_ap;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- PRACTICE accepted (in window)
  -- ------------------------------------------------------------------
  INSERT INTO public.firm_client_engagements (
    accounting_firm_id, client_business_id, status, access_level,
    effective_from, effective_to, created_by, accepted_by, accepted_at
  ) VALUES (
    v_firm, v_biz, 'accepted', 'read',
    CURRENT_DATE - 7, NULL, v_firm_user, v_firm_user, NOW()
  )
  RETURNING id INTO v_eng_id;

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
    RAISE EXCEPTION '576 practice accepted mismatch: % / % / %', v_cash, v_ar, v_ap;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- PRACTICE active (in window)
  -- ------------------------------------------------------------------
  UPDATE public.firm_client_engagements
     SET status = 'active'
   WHERE id = v_eng_id;

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
    RAISE EXCEPTION '576 practice active mismatch: % / % / %', v_cash, v_ar, v_ap;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- PRACTICE outside date window
  -- ------------------------------------------------------------------
  UPDATE public.firm_client_engagements
     SET effective_from = CURRENT_DATE - 30,
         effective_to = CURRENT_DATE - 1
   WHERE id = v_eng_id;

  PERFORM set_config('request.jwt.claim.sub', v_firm_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_firm_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash, v_ar, v_ap
  FROM public.finza_dashboard_positions_as_of(v_biz, v_as_of);
  IF v_cash IS DISTINCT FROM 0 OR v_ar IS DISTINCT FROM 0 OR v_ap IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '576 practice outside window leaked: % / % / %', v_cash, v_ar, v_ap;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- PRACTICE wrong status
  -- ------------------------------------------------------------------
  UPDATE public.firm_client_engagements
     SET status = 'suspended',
         effective_from = CURRENT_DATE - 7,
         effective_to = NULL
   WHERE id = v_eng_id;

  PERFORM set_config('request.jwt.claim.sub', v_firm_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_firm_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash, v_ar, v_ap
  FROM public.finza_dashboard_positions_as_of(v_biz, v_as_of);
  IF v_cash IS DISTINCT FROM 0 OR v_ar IS DISTINCT FROM 0 OR v_ap IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '576 practice wrong status leaked: % / % / %', v_cash, v_ar, v_ap;
  END IF;
  RESET ROLE;

  DELETE FROM public.firm_client_engagements WHERE id = v_eng_id;

  -- ------------------------------------------------------------------
  -- UNRELATED + hostile GUC + hostile JWT role + forged business + RLS
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_unrelated::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_unrelated, 'role', 'authenticated')::text, true);
  PERFORM set_config('app.current_business_id', v_forged::text, true);
  SET LOCAL ROLE authenticated;

  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash, v_ar, v_ap
  FROM public.finza_dashboard_positions_as_of(v_biz, v_as_of);
  IF v_cash IS DISTINCT FROM 0 OR v_ar IS DISTINCT FROM 0 OR v_ap IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '576 unrelated leaked: % / % / %', v_cash, v_ar, v_ap;
  END IF;

  PERFORM set_config('app.current_business_id', v_biz::text, true);
  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash, v_ar, v_ap
  FROM public.finza_dashboard_positions_as_of(v_biz, v_as_of);
  IF v_cash IS DISTINCT FROM 0 OR v_ar IS DISTINCT FROM 0 OR v_ap IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '576 hostile set_config GUC leaked: % / % / %', v_cash, v_ar, v_ap;
  END IF;

  EXECUTE format('SET LOCAL app.current_business_id = %L', v_biz::text);
  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash, v_ar, v_ap
  FROM public.finza_dashboard_positions_as_of(v_biz, v_as_of);
  IF v_cash IS DISTINCT FROM 0 OR v_ar IS DISTINCT FROM 0 OR v_ap IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '576 hostile SET LOCAL GUC leaked: % / % / %', v_cash, v_ar, v_ap;
  END IF;

  PERFORM set_config('app.current_business_id', v_forged::text, true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_unrelated, 'role', 'service_role')::text, true);
  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash, v_ar, v_ap
  FROM public.finza_dashboard_positions_as_of(v_biz, v_as_of);
  IF v_cash IS DISTINCT FROM 0 OR v_ar IS DISTINCT FROM 0 OR v_ap IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '576 hostile JWT role GUC leaked: % / % / %', v_cash, v_ar, v_ap;
  END IF;

  SELECT cash_balance INTO v_cash
  FROM public.finza_dashboard_positions_as_of(v_forged, v_as_of);
  IF v_cash IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '576 forged business leaked: %', v_cash;
  END IF;

  SELECT count(*)::int INTO v_je
  FROM public.journal_entries
  WHERE business_id = v_biz;
  SELECT count(*)::int INTO v_jel
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  WHERE je.business_id = v_biz;
  IF v_je <> 0 OR v_jel <> 0 THEN
    RAISE EXCEPTION '576 direct-table RLS regression: % entries / % lines', v_je, v_jel;
  END IF;

  -- Database role spoof: 576 does not use a role signal. Prove GUC 'role'
  -- cannot elevate, and record SET ROLE behavior from this postgres session.
  BEGIN
    PERFORM set_config('role', 'service_role', true);
    v_set_config_role := current_setting('role', true);
  EXCEPTION WHEN OTHERS THEN
    v_set_config_role_err := SQLERRM;
  END;
  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash, v_ar, v_ap
  FROM public.finza_dashboard_positions_as_of(v_biz, v_as_of);
  IF v_cash IS DISTINCT FROM 0 OR v_ar IS DISTINCT FROM 0 OR v_ap IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '576 set_config(role) leaked: % / % / %', v_cash, v_ar, v_ap;
  END IF;

  BEGIN
    SET LOCAL ROLE service_role;
  EXCEPTION WHEN OTHERS THEN
    v_set_role_err := SQLERRM;
  END;
  -- Connected as postgres, SET ROLE service_role is permitted (session_user
  -- is superuser). That is not caller elevation. RPC must still be zeros
  -- because there is no persisted auth.uid() authority after the JWT-role
  -- forge above (unrelated sub, no membership).
  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash, v_ar, v_ap
  FROM public.finza_dashboard_positions_as_of(v_biz, v_as_of);
  IF v_cash IS DISTINCT FROM 0 OR v_ar IS DISTINCT FROM 0 OR v_ap IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '576 SET ROLE service_role leaked: % / % / %', v_cash, v_ar, v_ap;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- ANON
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000099', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash, v_ar, v_ap
  FROM public.finza_dashboard_positions_as_of(v_biz, v_as_of);
  IF v_cash IS DISTINCT FROM 0 OR v_ar IS DISTINCT FROM 0 OR v_ap IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '576 anon leaked: % / % / %', v_cash, v_ar, v_ap;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- service_role JWT without persisted uid — Option A: zeros
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000099', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SELECT cash_balance, accounts_receivable, accounts_payable
    INTO v_cash, v_ar, v_ap
  FROM public.finza_dashboard_positions_as_of(v_biz, v_as_of);
  IF v_cash IS DISTINCT FROM 0 OR v_ar IS DISTINCT FROM 0 OR v_ap IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '576 service_role without uid leaked: % / % / %', v_cash, v_ar, v_ap;
  END IF;

  RAISE NOTICE '576 positions RPC secure auth tests passed (set_config role=%, set_role_err=%)',
    COALESCE(v_set_config_role, v_set_config_role_err, 'n/a'),
    COALESCE(v_set_role_err, 'allowed_as_postgres_session');
EXCEPTION
  WHEN OTHERS THEN
    RESET ROLE;
    RAISE;
END;
$$;

ROLLBACK;
