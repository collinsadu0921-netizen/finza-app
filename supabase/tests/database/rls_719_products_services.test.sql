-- 719 products_services RLS test
BEGIN;

DO $$
DECLARE v boolean; n int;
BEGIN
  SELECT relrowsecurity INTO v FROM pg_class WHERE oid='public.products_services'::regclass;
  IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'products_services RLS not enabled'; END IF;

  IF has_table_privilege('anon','public.products_services','SELECT')
     OR has_table_privilege('anon','public.products_services','INSERT')
     OR has_table_privilege('anon','public.products_services','UPDATE')
     OR has_table_privilege('anon','public.products_services','DELETE') THEN
    RAISE EXCEPTION 'anon retains products_services privileges';
  END IF;

  IF NOT has_table_privilege('authenticated','public.products_services','SELECT')
     OR NOT has_table_privilege('authenticated','public.products_services','INSERT')
     OR NOT has_table_privilege('authenticated','public.products_services','UPDATE')
     OR NOT has_table_privilege('authenticated','public.products_services','DELETE') THEN
    RAISE EXCEPTION 'authenticated lacks expected products_services privileges';
  END IF;

  SELECT count(*) INTO n FROM pg_policies WHERE schemaname='public' AND tablename='products_services';
  IF n <> 4 THEN RAISE EXCEPTION 'products_services expected 4 policies, found %', n; END IF;

  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname='public' AND tablename='products_services'
    AND (qual='true' OR with_check='true');
  IF n <> 0 THEN RAISE EXCEPTION 'products_services has unconditional true policy'; END IF;

  SELECT count(*) INTO n FROM pg_trigger t
  JOIN pg_class c ON c.oid=t.tgrelid
  WHERE c.oid='public.products_services'::regclass AND t.tgname='trg_products_services_guard_write' AND NOT t.tgisinternal;
  IF n <> 1 THEN RAISE EXCEPTION 'products_services guard trigger missing'; END IF;

  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    EXECUTE 'SELECT 1 FROM public.products_services LIMIT 1';
    RAISE EXCEPTION 'anon SELECT succeeded on products_services';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

ROLLBACK;
