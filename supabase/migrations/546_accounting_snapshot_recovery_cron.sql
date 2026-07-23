-- ============================================================================
-- Migration 546: Supabase Cron primary recovery for accounting snapshot queue
-- ============================================================================
-- Staging-first: GitHub Actions schedule is optional backup only.
-- This migration enables pg_cron + pg_net and schedules a 1-minute recovery
-- invoker that POSTs the existing protected Vercel worker endpoint.
--
-- Secrets are NOT stored in this migration. Load them via:
--   node scripts/staging-setup-snapshot-recovery-secrets.mjs
-- Vault secret names:
--   accounting_snapshot_cron_url
--   accounting_snapshot_cron_secret
--   accounting_snapshot_vercel_bypass
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- ---------------------------------------------------------------------------
-- Invoker: read Vault secrets → HTTP POST worker (Bearer + bypass)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoke_accounting_snapshot_recovery_worker()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, net
AS $$
DECLARE
  v_url text;
  v_secret text;
  v_bypass text;
  v_request_id bigint;
  v_headers jsonb;
BEGIN
  SELECT ds.decrypted_secret INTO v_url
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'accounting_snapshot_cron_url'
  LIMIT 1;

  SELECT ds.decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'accounting_snapshot_cron_secret'
  LIMIT 1;

  SELECT ds.decrypted_secret INTO v_bypass
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'accounting_snapshot_vercel_bypass'
  LIMIT 1;

  IF v_url IS NULL OR length(trim(v_url)) = 0 THEN
    RAISE WARNING 'invoke_accounting_snapshot_recovery_worker: missing vault secret accounting_snapshot_cron_url';
    RETURN jsonb_build_object('ok', false, 'error', 'missing_cron_url');
  END IF;

  IF v_secret IS NULL OR length(trim(v_secret)) = 0 THEN
    RAISE WARNING 'invoke_accounting_snapshot_recovery_worker: missing vault secret accounting_snapshot_cron_secret';
    RETURN jsonb_build_object('ok', false, 'error', 'missing_cron_secret');
  END IF;

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || trim(v_secret)
  );

  IF v_bypass IS NOT NULL AND length(trim(v_bypass)) > 0 THEN
    v_headers := v_headers || jsonb_build_object(
      'x-vercel-protection-bypass', trim(v_bypass)
    );
  END IF;

  -- Append query if URL has no batch params yet.
  IF position('batch=' in lower(v_url)) = 0 THEN
    IF position('?' in v_url) > 0 THEN
      v_url := v_url || '&batch=25&batches=8';
    ELSE
      v_url := v_url || '?batch=25&batches=8';
    END IF;
  END IF;

  SELECT net.http_post(
    url := v_url,
    headers := v_headers,
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
  INTO v_request_id;

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'queued_at', NOW()
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'invoke_accounting_snapshot_recovery_worker failed: %', SQLERRM;
    RETURN jsonb_build_object('ok', false, 'error', left(SQLERRM, 300));
END;
$$;

COMMENT ON FUNCTION public.invoke_accounting_snapshot_recovery_worker() IS
  'Recovery-only: POST accounting snapshot process endpoint using Vault secrets (546).';

REVOKE ALL ON FUNCTION public.invoke_accounting_snapshot_recovery_worker() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoke_accounting_snapshot_recovery_worker() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_accounting_snapshot_recovery_worker() TO service_role;
GRANT EXECUTE ON FUNCTION public.invoke_accounting_snapshot_recovery_worker() TO postgres;

-- ---------------------------------------------------------------------------
-- Schedule every minute (recovery only; immediate path remains primary)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT j.jobid INTO v_jobid
  FROM cron.job j
  WHERE j.jobname = 'accounting-snapshot-recovery'
  LIMIT 1;

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'accounting-snapshot-recovery',
    '* * * * *',
    $cron$SELECT public.invoke_accounting_snapshot_recovery_worker();$cron$
  );
END;
$$;
