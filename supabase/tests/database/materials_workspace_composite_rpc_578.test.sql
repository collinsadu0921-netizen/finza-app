-- ============================================================================
-- Database tests for migration 578 — materials workspace composite RPC
-- Runs inside a single transaction ending with ROLLBACK.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_biz uuid := '4e6cdfba-e2ab-4ee4-ac00-9b077d696544';
  v_owner uuid := 'd559d652-9c68-4146-823c-c4d218b7cbc6';
  v_member uuid := '7b6f765e-cd86-44b8-9283-5b480bd0b441';
  v_unrelated uuid := 'ef7f259e-9c0d-43e8-bfac-fba0165fee48';
  v_forged uuid := '00000000-0000-4000-8000-000000000001';
  v_fn_count int;
  v_prosecdef boolean;
  v_search text;
  v_owner_name text;
  v_vol text;
  v_payload jsonb;
  v_empty jsonb;
  v_owner_count int;
BEGIN
  SELECT COUNT(*) INTO v_fn_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_service_materials_workspace';
  IF v_fn_count <> 1 THEN
    RAISE EXCEPTION '578 fn identity: expected 1 function, got %', v_fn_count;
  END IF;

  SELECT p.prosecdef, array_to_string(p.proconfig, ','), pg_get_userbyid(p.proowner),
         CASE p.provolatile WHEN 'v' THEN 'VOLATILE' WHEN 's' THEN 'STABLE' ELSE 'OTHER' END
    INTO v_prosecdef, v_search, v_owner_name, v_vol
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_service_materials_workspace';

  IF v_prosecdef IS NOT TRUE THEN
    RAISE EXCEPTION '578 expected SECURITY DEFINER';
  END IF;
  IF v_search IS DISTINCT FROM 'search_path=pg_catalog' THEN
    RAISE EXCEPTION '578 expected search_path=pg_catalog, got %', v_search;
  END IF;
  IF v_owner_name IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION '578 expected owner postgres, got %', v_owner_name;
  END IF;
  IF v_vol IS DISTINCT FROM 'STABLE' THEN
    RAISE EXCEPTION '578 expected STABLE, got %', v_vol;
  END IF;

  IF pg_get_functiondef((
        SELECT p.oid FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'get_service_materials_workspace'
      )) LIKE '%app.current_business_id%' THEN
    RAISE EXCEPTION '578 must not authorize via app.current_business_id';
  END IF;
  IF pg_get_functiondef((
        SELECT p.oid FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'get_service_materials_workspace'
      )) LIKE '%request.jwt.claim%' THEN
    RAISE EXCEPTION '578 must not authorize via request.jwt.claim';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  v_payload := public.get_service_materials_workspace(v_biz, NULL, 'all', 'all', 1, 25);
  v_owner_count := COALESCE((v_payload->'pagination'->>'totalCount')::int, -1);
  IF v_owner_count < 0 THEN
    RAISE EXCEPTION '578 owner payload missing totalCount';
  END IF;
  IF jsonb_typeof(v_payload->'rows') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '578 owner rows must be an array';
  END IF;
  IF NOT (v_payload->'summary' ? 'totalItems') THEN
    RAISE EXCEPTION '578 owner summary missing totalItems';
  END IF;

  v_empty := public.get_service_materials_workspace(v_forged, NULL, 'all', 'all', 1, 25);
  IF (v_empty->'pagination'->>'totalCount')::int <> 0 OR jsonb_array_length(v_empty->'rows') <> 0 THEN
    RAISE EXCEPTION '578 forged business must return empty payload';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_unrelated::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_unrelated::text, 'role', 'authenticated')::text, true);
  v_empty := public.get_service_materials_workspace(v_biz, NULL, 'all', 'all', 1, 25);
  IF (v_empty->'pagination'->>'totalCount')::int <> 0 OR jsonb_array_length(v_empty->'rows') <> 0 THEN
    RAISE EXCEPTION '578 unrelated user must return empty payload';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  v_empty := public.get_service_materials_workspace(v_biz, NULL, 'all', 'all', 1, 25);
  IF (v_empty->'pagination'->>'totalCount')::int <> 0 OR jsonb_array_length(v_empty->'rows') <> 0 THEN
    RAISE EXCEPTION '578 service_role without uid must return empty payload';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_users
    WHERE business_id = v_biz AND user_id = v_member
  ) THEN
    INSERT INTO public.business_users (business_id, user_id, role, created_at)
    VALUES (v_biz, v_member, 'staff', NOW());
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
  v_payload := public.get_service_materials_workspace(v_biz, NULL, 'all', 'all', 1, 25);
  IF (v_payload->'pagination'->>'totalCount')::int IS DISTINCT FROM v_owner_count THEN
    RAISE EXCEPTION '578 member payload count % != owner %',
      (v_payload->'pagination'->>'totalCount')::int, v_owner_count;
  END IF;

  RAISE NOTICE '578 materials workspace RPC tests passed (owner_count=%)', v_owner_count;
END;
$$;

ROLLBACK;
