-- ============================================================================
-- Migration 547: SQL tests for accounting snapshot recovery cron (546)
-- Run: SELECT * FROM public.test_accounting_snapshot_recovery_cron();
-- ============================================================================

CREATE OR REPLACE FUNCTION public.test_accounting_snapshot_recovery_cron()
RETURNS TABLE (test_name text, passed boolean, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE
  v_ext_net boolean;
  v_ext_cron boolean;
  v_fn boolean;
  v_job boolean;
  v_missing jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_net'
  ) INTO v_ext_net;
  test_name := 'pg_net_extension_installed';
  passed := v_ext_net;
  detail := CASE WHEN v_ext_net THEN 'ok' ELSE 'pg_net missing' END;
  RETURN NEXT;

  SELECT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) INTO v_ext_cron;
  test_name := 'pg_cron_extension_installed';
  passed := v_ext_cron;
  detail := CASE WHEN v_ext_cron THEN 'ok' ELSE 'pg_cron missing' END;
  RETURN NEXT;

  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'invoke_accounting_snapshot_recovery_worker'
  ) INTO v_fn;
  test_name := 'invoke_function_exists';
  passed := v_fn;
  detail := CASE WHEN v_fn THEN 'ok' ELSE 'function missing' END;
  RETURN NEXT;

  SELECT EXISTS (
    SELECT 1
    FROM cron.job j
    WHERE j.jobname = 'accounting-snapshot-recovery'
      AND j.schedule = '* * * * *'
      AND j.active
  ) INTO v_job;
  test_name := 'cron_job_active_every_minute';
  passed := v_job;
  detail := CASE WHEN v_job THEN 'ok' ELSE 'cron job missing or inactive' END;
  RETURN NEXT;

  -- When Vault URL secret is absent, invoker must fail closed (json, not throw).
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets ds
    WHERE ds.name = 'accounting_snapshot_cron_url'
  ) THEN
    v_missing := public.invoke_accounting_snapshot_recovery_worker();
    test_name := 'invoke_without_secrets_returns_json_error';
    passed := (v_missing ? 'ok') AND ((v_missing ->> 'ok') = 'false');
    detail := left(coalesce(v_missing::text, 'null'), 200);
    RETURN NEXT;
  ELSE
    test_name := 'invoke_without_secrets_returns_json_error';
    passed := true;
    detail := 'skipped_secrets_already_configured';
    RETURN NEXT;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.test_accounting_snapshot_recovery_cron() IS
  'SQL tests for 546 accounting snapshot recovery cron.';

REVOKE ALL ON FUNCTION public.test_accounting_snapshot_recovery_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_accounting_snapshot_recovery_cron() TO service_role;
