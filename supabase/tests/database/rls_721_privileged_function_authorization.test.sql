-- 721 privileged-function authorization test
BEGIN;

DO $$
DECLARE n int;
BEGIN
  -- Anonymous callers must not execute any of the hardened functions.
  IF has_function_privilege('anon','public.process_retail_purchase_order_receipt(uuid,uuid,uuid,uuid,jsonb)','EXECUTE')
     OR has_function_privilege('anon','public.get_customer_sale_stats(uuid,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.return_service_job_material_usage(uuid,uuid,date,text,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.reverse_service_job_cogs(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.salary_advance_apply_posted_balance(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.salary_advance_stop_recurring_deduction(uuid,text,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.salary_advance_posted_repaid_amount(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'anon retains privileged function execution';
  END IF;

  -- Client-callable functions keep authenticated execution.
  IF NOT has_function_privilege('authenticated','public.process_retail_purchase_order_receipt(uuid,uuid,uuid,uuid,jsonb)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.get_customer_sale_stats(uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.return_service_job_material_usage(uuid,uuid,date,text,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.reverse_service_job_cogs(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated lost a client-callable function';
  END IF;

  -- Payroll helpers are backend-only.
  IF has_function_privilege('authenticated','public.salary_advance_apply_posted_balance(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.salary_advance_stop_recurring_deduction(uuid,text,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.salary_advance_posted_repaid_amount(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated retains payroll backend helper execution';
  END IF;

  -- Trusted backend keeps execution.
  IF NOT has_function_privilege('service_role','public.salary_advance_apply_posted_balance(uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.salary_advance_stop_recurring_deduction(uuid,text,uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.salary_advance_posted_repaid_amount(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'service_role lost payroll backend helper execution';
  END IF;

  -- Internal authorization guards must be present.
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
  WHERE ns.nspname='public'
    AND p.proname IN ('process_retail_purchase_order_receipt','get_customer_sale_stats',
                      'return_service_job_material_usage','reverse_service_job_cogs')
    AND p.prosrc ILIKE '%Not authorized%'
    AND p.prosrc ILIKE '%auth.uid%';
  IF n <> 4 THEN RAISE EXCEPTION 'expected 4 guarded functions, found %', n; END IF;

  -- Real anon call must be denied at the privilege layer.
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    EXECUTE 'SELECT * FROM public.get_customer_sale_stats(''00000000-0000-0000-0000-000000000000''::uuid,''00000000-0000-0000-0000-000000000000''::uuid)';
    RAISE EXCEPTION 'anon get_customer_sale_stats succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

ROLLBACK;
