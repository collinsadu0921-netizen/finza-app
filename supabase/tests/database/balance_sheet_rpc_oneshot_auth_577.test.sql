-- ============================================================================
-- Database tests for migration 577 — Balance Sheet RPC one-shot authorization
-- Runs inside a single transaction ending with ROLLBACK.
--
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/database/balance_sheet_rpc_oneshot_auth_577.test.sql
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_biz uuid := '4e6cdfba-e2ab-4ee4-ac00-9b077d696544';
  v_mat uuid := 'b4766e05-f5c0-4232-a97f-4dfba6e1f0c2';
  v_as_of date := DATE '2026-08-26';
  v_owner uuid := 'd559d652-9c68-4146-823c-c4d218b7cbc6';
  v_member uuid := '7b6f765e-cd86-44b8-9283-5b480bd0b441';
  v_firm_user uuid := 'f9ad7433-fba8-4c04-9733-b1928059ded4';
  v_firm uuid := 'ca612dee-cebd-40da-90ea-4141101d0381';
  v_unrelated uuid := 'ef7f259e-9c0d-43e8-bfac-fba0165fee48';
  v_forged uuid := '00000000-0000-4000-8000-000000000001';
  v_ni numeric;
  v_lines int;
  v_cash numeric;
  v_ar numeric;
  v_assets numeric;
  v_liab numeric;
  v_equity numeric;
  v_prosecdef boolean;
  v_search text;
  v_owner_name text;
  v_vol text;
  v_fn_count int;
  v_je int;
  v_jel int;
  v_eng_id uuid;
  r record;
BEGIN
  SELECT COUNT(*) INTO v_fn_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('get_balance_sheet_as_of', 'get_cumulative_net_income_as_of');
  IF v_fn_count <> 2 THEN
    RAISE EXCEPTION '577 fn identity: expected 2 functions, got %', v_fn_count;
  END IF;

  FOR r IN
    SELECT p.proname, p.prosecdef, array_to_string(p.proconfig, ',') AS cfg,
           pg_get_userbyid(p.proowner) AS owner_name,
           CASE p.provolatile WHEN 'v' THEN 'VOLATILE' WHEN 's' THEN 'STABLE' ELSE 'OTHER' END AS vol
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_balance_sheet_as_of', 'get_cumulative_net_income_as_of')
  LOOP
    IF r.prosecdef IS NOT TRUE THEN
      RAISE EXCEPTION '577 %: expected SECURITY DEFINER', r.proname;
    END IF;
    IF r.cfg IS DISTINCT FROM 'search_path=pg_catalog' THEN
      RAISE EXCEPTION '577 %: expected search_path=pg_catalog, got %', r.proname, r.cfg;
    END IF;
    IF r.owner_name IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION '577 %: expected owner postgres, got %', r.proname, r.owner_name;
    END IF;
    IF r.vol IS DISTINCT FROM 'VOLATILE' THEN
      RAISE EXCEPTION '577 %: expected VOLATILE, got %', r.proname, r.vol;
    END IF;
  END LOOP;

  IF pg_get_functiondef((
        SELECT p.oid FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'get_balance_sheet_as_of'
      )) LIKE '%app.current_business_id%' THEN
    RAISE EXCEPTION '577 BS must not authorize via app.current_business_id';
  END IF;
  IF pg_get_functiondef((
        SELECT p.oid FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'get_cumulative_net_income_as_of'
      )) LIKE '%request.jwt.claim.role%' THEN
    RAISE EXCEPTION '577 NI must not authorize via JWT role GUC';
  END IF;

  -- ------------------------------------------------------------------
  -- OWNER + accounting parity
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*)::int,
         COALESCE(sum(CASE WHEN account_type IN ('asset', 'contra_asset') THEN balance ELSE 0 END), 0),
         COALESCE(sum(CASE WHEN account_type = 'liability' THEN balance ELSE 0 END), 0),
         COALESCE(sum(CASE WHEN account_type = 'equity' THEN balance ELSE 0 END), 0)
    INTO v_lines, v_assets, v_liab, v_equity
  FROM public.get_balance_sheet_as_of(v_biz, v_as_of);
  SELECT balance INTO v_cash FROM public.get_balance_sheet_as_of(v_biz, v_as_of) WHERE account_code = '1000';
  SELECT balance INTO v_ar FROM public.get_balance_sheet_as_of(v_biz, v_as_of) WHERE account_code = '1100';
  v_ni := public.get_cumulative_net_income_as_of(v_biz, v_as_of);

  IF v_lines IS DISTINCT FROM 19 THEN
    RAISE EXCEPTION '577 owner 2026-08-26 line count %', v_lines;
  END IF;
  IF v_assets IS DISTINCT FROM 1271023.38 THEN
    RAISE EXCEPTION '577 owner assets %', v_assets;
  END IF;
  IF v_liab IS DISTINCT FROM 293740.14 THEN
    RAISE EXCEPTION '577 owner liabilities %', v_liab;
  END IF;
  IF v_equity IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '577 owner equity accounts %', v_equity;
  END IF;
  IF v_ni IS DISTINCT FROM 977283.24 THEN
    RAISE EXCEPTION '577 owner NI %', v_ni;
  END IF;
  IF (v_assets - (v_liab + v_equity + v_ni)) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '577 owner imbalance %', v_assets - (v_liab + v_equity + v_ni);
  END IF;
  IF v_cash IS DISTINCT FROM 78573.45 OR v_ar IS DISTINCT FROM 738841.20 THEN
    RAISE EXCEPTION '577 owner cash/AR % / %', v_cash, v_ar;
  END IF;

  SELECT count(*)::int INTO v_lines
  FROM public.get_balance_sheet_as_of(v_biz, DATE '2026-01-31');
  v_ni := public.get_cumulative_net_income_as_of(v_biz, DATE '2026-01-31');
  IF v_lines IS DISTINCT FROM 12 OR v_ni IS DISTINCT FROM 679191.23 THEN
    RAISE EXCEPTION '577 owner 2026-01-31 lines=% ni=%', v_lines, v_ni;
  END IF;

  SELECT count(*)::int INTO v_lines
  FROM public.get_balance_sheet_as_of(v_biz, DATE '2020-01-01');
  v_ni := public.get_cumulative_net_income_as_of(v_biz, DATE '2020-01-01');
  IF v_lines IS DISTINCT FROM 0 OR v_ni IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '577 owner pre-ledger expected empty/0, got % / %', v_lines, v_ni;
  END IF;

  RESET ROLE;

  -- ------------------------------------------------------------------
  -- SECOND BUSINESS (Materials staging) as its owner
  -- ------------------------------------------------------------------
  DECLARE
    v_mat_owner uuid;
  BEGIN
    SELECT owner_id INTO v_mat_owner FROM public.businesses WHERE id = v_mat;
    IF v_mat_owner IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_mat_owner::text, true);
      PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mat_owner, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*)::int INTO v_lines FROM public.get_balance_sheet_as_of(v_mat, v_as_of);
      v_ni := public.get_cumulative_net_income_as_of(v_mat, v_as_of);
      IF v_lines IS DISTINCT FROM 11 OR v_ni IS DISTINCT FROM -4452.09 THEN
        RAISE EXCEPTION '577 materials 2026-08-26 lines=% ni=%', v_lines, v_ni;
      END IF;
      RESET ROLE;
    END IF;
  END;

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
  SELECT count(*)::int INTO v_lines FROM public.get_balance_sheet_as_of(v_biz, v_as_of);
  v_ni := public.get_cumulative_net_income_as_of(v_biz, v_as_of);
  IF v_lines IS DISTINCT FROM 19 OR v_ni IS DISTINCT FROM 977283.24 THEN
    RAISE EXCEPTION '577 member mismatch lines=% ni=%', v_lines, v_ni;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- PRACTICE no engagement
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_firm_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_firm_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::int INTO v_lines FROM public.get_balance_sheet_as_of(v_biz, v_as_of);
  v_ni := public.get_cumulative_net_income_as_of(v_biz, v_as_of);
  IF v_lines IS DISTINCT FROM 0 OR v_ni IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '577 practice without engagement leaked lines=% ni=%', v_lines, v_ni;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- PRACTICE accepted
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
  SELECT count(*)::int INTO v_lines FROM public.get_balance_sheet_as_of(v_biz, v_as_of);
  v_ni := public.get_cumulative_net_income_as_of(v_biz, v_as_of);
  IF v_lines IS DISTINCT FROM 19 OR v_ni IS DISTINCT FROM 977283.24 THEN
    RAISE EXCEPTION '577 practice accepted mismatch lines=% ni=%', v_lines, v_ni;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- PRACTICE active
  -- ------------------------------------------------------------------
  UPDATE public.firm_client_engagements SET status = 'active' WHERE id = v_eng_id;
  PERFORM set_config('request.jwt.claim.sub', v_firm_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_firm_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::int INTO v_lines FROM public.get_balance_sheet_as_of(v_biz, v_as_of);
  v_ni := public.get_cumulative_net_income_as_of(v_biz, v_as_of);
  IF v_lines IS DISTINCT FROM 19 OR v_ni IS DISTINCT FROM 977283.24 THEN
    RAISE EXCEPTION '577 practice active mismatch lines=% ni=%', v_lines, v_ni;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- PRACTICE outside date window
  -- ------------------------------------------------------------------
  UPDATE public.firm_client_engagements
     SET effective_from = CURRENT_DATE - 30, effective_to = CURRENT_DATE - 1
   WHERE id = v_eng_id;
  PERFORM set_config('request.jwt.claim.sub', v_firm_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_firm_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::int INTO v_lines FROM public.get_balance_sheet_as_of(v_biz, v_as_of);
  v_ni := public.get_cumulative_net_income_as_of(v_biz, v_as_of);
  IF v_lines IS DISTINCT FROM 0 OR v_ni IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '577 practice outside window leaked lines=% ni=%', v_lines, v_ni;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- PRACTICE suspended
  -- ------------------------------------------------------------------
  UPDATE public.firm_client_engagements
     SET status = 'suspended', effective_from = CURRENT_DATE - 7, effective_to = NULL
   WHERE id = v_eng_id;
  PERFORM set_config('request.jwt.claim.sub', v_firm_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_firm_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::int INTO v_lines FROM public.get_balance_sheet_as_of(v_biz, v_as_of);
  v_ni := public.get_cumulative_net_income_as_of(v_biz, v_as_of);
  IF v_lines IS DISTINCT FROM 0 OR v_ni IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '577 practice suspended leaked lines=% ni=%', v_lines, v_ni;
  END IF;
  RESET ROLE;

  DELETE FROM public.firm_client_engagements WHERE id = v_eng_id;

  -- ------------------------------------------------------------------
  -- UNRELATED + hostile GUC + hostile JWT role + direct table RLS
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_unrelated::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_unrelated, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*)::int INTO v_lines FROM public.get_balance_sheet_as_of(v_biz, v_as_of);
  v_ni := public.get_cumulative_net_income_as_of(v_biz, v_as_of);
  IF v_lines IS DISTINCT FROM 0 OR v_ni IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '577 unrelated leaked lines=% ni=%', v_lines, v_ni;
  END IF;

  SELECT count(*)::int INTO v_je FROM public.journal_entries WHERE business_id = v_biz;
  BEGIN
    SELECT count(*)::int INTO v_jel
    FROM public.journal_entry_lines jel
    JOIN public.journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.business_id = v_biz;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Pre-existing GUC policy casts empty app.current_business_id to uuid.
    -- An error here is not a leak.
    v_jel := 0;
  END;
  IF v_je <> 0 OR v_jel <> 0 THEN
    RAISE EXCEPTION '577 direct-table RLS regression: % entries / % lines', v_je, v_jel;
  END IF;

  PERFORM set_config('app.current_business_id', v_biz::text, true);
  SELECT count(*)::int INTO v_lines FROM public.get_balance_sheet_as_of(v_biz, v_as_of);
  v_ni := public.get_cumulative_net_income_as_of(v_biz, v_as_of);
  IF v_lines IS DISTINCT FROM 0 OR v_ni IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '577 hostile set_config GUC leaked lines=% ni=%', v_lines, v_ni;
  END IF;

  EXECUTE format('SET LOCAL app.current_business_id = %L', v_biz::text);
  SELECT count(*)::int INTO v_lines FROM public.get_balance_sheet_as_of(v_biz, v_as_of);
  v_ni := public.get_cumulative_net_income_as_of(v_biz, v_as_of);
  IF v_lines IS DISTINCT FROM 0 OR v_ni IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '577 hostile SET LOCAL GUC leaked lines=% ni=%', v_lines, v_ni;
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_unrelated, 'role', 'service_role')::text, true);
  SELECT count(*)::int INTO v_lines FROM public.get_balance_sheet_as_of(v_biz, v_as_of);
  v_ni := public.get_cumulative_net_income_as_of(v_biz, v_as_of);
  IF v_lines IS DISTINCT FROM 0 OR v_ni IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '577 hostile JWT role leaked lines=% ni=%', v_lines, v_ni;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- ANON
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000099', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  SELECT count(*)::int INTO v_lines FROM public.get_balance_sheet_as_of(v_biz, v_as_of);
  v_ni := public.get_cumulative_net_income_as_of(v_biz, v_as_of);
  IF v_lines IS DISTINCT FROM 0 OR v_ni IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '577 anon leaked lines=% ni=%', v_lines, v_ni;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- service_role without persisted uid — empty / 0 (Option A)
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000099', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SELECT count(*)::int INTO v_lines FROM public.get_balance_sheet_as_of(v_biz, v_as_of);
  v_ni := public.get_cumulative_net_income_as_of(v_biz, v_as_of);
  IF v_lines IS DISTINCT FROM 0 OR v_ni IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '577 service_role without uid leaked lines=% ni=%', v_lines, v_ni;
  END IF;

  RAISE NOTICE '577 balance sheet RPC oneshot auth tests passed';
EXCEPTION
  WHEN OTHERS THEN
    RESET ROLE;
    RAISE;
END;
$$;

ROLLBACK;
