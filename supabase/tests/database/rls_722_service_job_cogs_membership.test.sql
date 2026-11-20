-- 722 service job COGS membership-guard test
BEGIN;

DO $$
DECLARE d text;
BEGIN
  SELECT p.prosrc INTO d
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='reverse_service_job_cogs';

  IF d IS NULL THEN RAISE EXCEPTION 'reverse_service_job_cogs missing'; END IF;
  IF d NOT ILIKE '%finza_user_can_access_business%' THEN
    RAISE EXCEPTION 'reverse_service_job_cogs missing membership guard';
  END IF;
  IF d ILIKE '%finza_rls_can_write_accounting_business%' THEN
    RAISE EXCEPTION 'reverse_service_job_cogs still requires accounting role';
  END IF;

  IF NOT has_function_privilege('authenticated','public.reverse_service_job_cogs(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated lost reverse_service_job_cogs execution';
  END IF;
  IF has_function_privilege('anon','public.reverse_service_job_cogs(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute reverse_service_job_cogs';
  END IF;
END $$;

ROLLBACK;
