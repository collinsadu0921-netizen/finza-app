-- 720 function execute + period-control hardening test
BEGIN;

DO $$
DECLARE n int; v boolean; r record;
BEGIN
  -- Anonymous callers must not execute the hardened financial/worker surface.
  IF to_regprocedure('public.create_audit_log(uuid,uuid,text,text,uuid,jsonb,jsonb,text,text,text)') IS NOT NULL
     AND has_function_privilege('anon','public.create_audit_log(uuid,uuid,text,text,uuid,jsonb,jsonb,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute create_audit_log';
  END IF;
  IF to_regprocedure('public.initialize_business_accounting_period(uuid,date)') IS NOT NULL
     AND has_function_privilege('anon','public.initialize_business_accounting_period(uuid,date)','EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute initialize_business_accounting_period';
  END IF;
  IF to_regprocedure('public.post_asset_depreciation(uuid,date,numeric,text,text,uuid)') IS NOT NULL
     AND has_function_privilege('anon','public.post_asset_depreciation(uuid,date,numeric,text,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute post_asset_depreciation';
  END IF;
  IF to_regprocedure('public.get_balance_sheet_as_of(uuid,date)') IS NOT NULL
     AND has_function_privilege('anon','public.get_balance_sheet_as_of(uuid,date)','EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute get_balance_sheet_as_of';
  END IF;

  IF NOT has_function_privilege('authenticated','public.create_audit_log(uuid,uuid,text,text,uuid,jsonb,jsonb,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute create_audit_log';
  END IF;
  IF NOT has_function_privilege('authenticated','public.initialize_business_accounting_period(uuid,date)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute initialize_business_accounting_period';
  END IF;

  -- Only intentionally harmless helpers may remain anon-executable.
  SELECT count(*) INTO n
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
  WHERE ns.nspname='public' AND p.prosecdef AND p.prokind='f'
    AND has_function_privilege('anon',p.oid,'EXECUTE');
  IF n > 2 THEN RAISE EXCEPTION 'unexpected anon-executable definer functions: %', n; END IF;

  -- Restrictive period-control policies must exist.
  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname='public' AND tablename='accounting_periods'
    AND permissive='RESTRICTIVE'
    AND policyname IN (
      'accounting_periods_write_accounting_role_insert',
      'accounting_periods_write_accounting_role_update',
      'accounting_periods_write_accounting_role_delete'
    );
  IF n <> 3 THEN RAISE EXCEPTION 'period-control restrictive policies missing'; END IF;

  -- Real anon call must be denied.
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    EXECUTE 'SELECT public.create_audit_log(''00000000-0000-0000-0000-000000000000''::uuid, null, ''x'', ''x'')';
    RAISE EXCEPTION 'anon create_audit_log succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

ROLLBACK;
