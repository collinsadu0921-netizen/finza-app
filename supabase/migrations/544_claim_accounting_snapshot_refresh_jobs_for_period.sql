-- ============================================================================
-- Migration 544: Tenant/period-scoped accounting snapshot job claim
-- ============================================================================
-- Additive claim RPC for immediate targeted refresh. Preserves the global
-- claim_accounting_snapshot_refresh_jobs used by the five-minute recovery
-- worker. service_role only — not exposed to browser clients.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Scoped claim (business + period only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_accounting_snapshot_refresh_jobs_for_period(
  p_business_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_limit INT DEFAULT 10,
  p_lease_seconds INT DEFAULT 900
)
RETURNS SETOF public.accounting_snapshot_refresh_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
  v_lease INT := GREATEST(60, LEAST(COALESCE(p_lease_seconds, 900), 3600));
BEGIN
  IF p_business_id IS NULL OR p_period_start IS NULL OR p_period_end IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.accounting_snapshot_refresh_jobs j
  SET
    status = 'processing',
    locked_at = NOW(),
    claim_token = gen_random_uuid(),
    attempts = j.attempts + 1,
    updated_at = NOW(),
    last_error = CASE
      WHEN j.status = 'processing' THEN LEFT('reclaimed_stale_lease', 2000)
      ELSE j.last_error
    END
  WHERE j.id IN (
    SELECT q.id
    FROM public.accounting_snapshot_refresh_jobs q
    WHERE q.business_id = p_business_id
      AND q.period_start = p_period_start
      AND q.period_end = p_period_end
      AND (
        (q.status = 'pending' AND q.next_run_at <= NOW())
        OR (
          q.status = 'processing'
          AND q.locked_at IS NOT NULL
          AND q.locked_at < NOW() - make_interval(secs => v_lease)
        )
      )
    ORDER BY
      CASE WHEN q.status = 'processing' THEN 0 ELSE 1 END,
      q.next_run_at ASC,
      q.created_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING j.*;
END;
$$;

COMMENT ON FUNCTION public.claim_accounting_snapshot_refresh_jobs_for_period(UUID, DATE, DATE, INT, INT) IS
  'Claim snapshot refresh jobs for one business-period only (544). Compatible with global recovery claim.';

REVOKE ALL ON FUNCTION public.claim_accounting_snapshot_refresh_jobs_for_period(UUID, DATE, DATE, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_accounting_snapshot_refresh_jobs_for_period(UUID, DATE, DATE, INT, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_accounting_snapshot_refresh_jobs_for_period(UUID, DATE, DATE, INT, INT) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Require claim_token for complete/fail (preserve protection)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_accounting_snapshot_refresh_job(
  p_job_id UUID,
  p_claim_token UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT := 0;
BEGIN
  IF p_job_id IS NULL OR p_claim_token IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE public.accounting_snapshot_refresh_jobs
  SET
    status = 'done',
    locked_at = NULL,
    claim_token = NULL,
    last_error = NULL,
    completed_at = NOW(),
    failed_at = NULL,
    updated_at = NOW()
  WHERE id = p_job_id
    AND status = 'processing'
    AND claim_token = p_claim_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_accounting_snapshot_refresh_job(
  p_job_id UUID,
  p_error TEXT,
  p_max_attempts INT DEFAULT 5,
  p_backoff_seconds INT DEFAULT 60,
  p_claim_token UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts INT;
  v_status TEXT;
BEGIN
  IF p_job_id IS NULL OR p_claim_token IS NULL THEN
    RETURN;
  END IF;

  SELECT attempts, status INTO v_attempts, v_status
  FROM public.accounting_snapshot_refresh_jobs
  WHERE id = p_job_id
    AND claim_token = p_claim_token
  FOR UPDATE;

  IF v_attempts IS NULL THEN
    RETURN;
  END IF;

  IF v_status IS DISTINCT FROM 'processing' AND v_status IS DISTINCT FROM 'pending' THEN
    RETURN;
  END IF;

  IF v_attempts >= GREATEST(1, COALESCE(p_max_attempts, 5)) THEN
    UPDATE public.accounting_snapshot_refresh_jobs
    SET
      status = 'failed',
      locked_at = NULL,
      claim_token = NULL,
      last_error = LEFT(COALESCE(p_error, 'unknown'), 2000),
      failed_at = NOW(),
      updated_at = NOW()
    WHERE id = p_job_id;
  ELSE
    UPDATE public.accounting_snapshot_refresh_jobs
    SET
      status = 'pending',
      locked_at = NULL,
      claim_token = NULL,
      last_error = LEFT(COALESCE(p_error, 'unknown'), 2000),
      next_run_at = NOW() + make_interval(
        secs => GREATEST(30, COALESCE(p_backoff_seconds, 60) * GREATEST(v_attempts, 1))
      ),
      updated_at = NOW()
    WHERE id = p_job_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_accounting_snapshot_refresh_job(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_accounting_snapshot_refresh_job(UUID, TEXT, INT, INT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_accounting_snapshot_refresh_job(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_accounting_snapshot_refresh_job(UUID, TEXT, INT, INT, UUID) TO service_role;
