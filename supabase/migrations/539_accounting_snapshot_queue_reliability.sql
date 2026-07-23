-- ============================================================================
-- Migration 539: Accounting snapshot queue reliability
-- ============================================================================
-- Hardens enqueue coalescing, atomic claim with lease reclaim, follow-up
-- pending jobs while a refresh is running, snapshot invalidation on ledger
-- change, combined transactional refresh, diagnostics, and backlog helpers.
-- Forward-only. Does not rewrite journal lines.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Schema additions
-- ---------------------------------------------------------------------------
ALTER TABLE public.accounting_snapshot_refresh_jobs
  ADD COLUMN IF NOT EXISTS claim_token UUID,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;

ALTER TABLE public.service_pnl_movement_snapshots
  ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS generation BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.service_dashboard_period_summary
  ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS generation BIGINT NOT NULL DEFAULT 0;

-- Pending-only uniqueness so a processing job can coexist with one follow-up pending.
DROP INDEX IF EXISTS public.idx_accounting_snapshot_refresh_jobs_pending_unique;
CREATE UNIQUE INDEX idx_accounting_snapshot_refresh_jobs_pending_unique
  ON public.accounting_snapshot_refresh_jobs (business_id, period_start, period_end, job_type)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_accounting_snapshot_refresh_jobs_claimable
  ON public.accounting_snapshot_refresh_jobs (status, next_run_at ASC, created_at ASC)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_accounting_snapshot_refresh_jobs_processing_locked
  ON public.accounting_snapshot_refresh_jobs (locked_at ASC)
  WHERE status = 'processing';

-- ---------------------------------------------------------------------------
-- 2. Invalidate derived snapshots for a period (lightweight)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invalidate_accounting_snapshot_period(
  p_business_id UUID,
  p_period_start DATE,
  p_period_end DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.service_pnl_movement_snapshots s
  SET invalidated_at = NOW()
  WHERE s.business_id = p_business_id
    AND s.period_start = p_period_start
    AND s.period_end = p_period_end
    AND (s.invalidated_at IS NULL OR s.refreshed_at >= s.invalidated_at);

  UPDATE public.service_dashboard_period_summary s
  SET invalidated_at = NOW()
  WHERE s.business_id = p_business_id
    AND s.period_start = p_period_start
    AND s.period_end = p_period_end
    AND (s.invalidated_at IS NULL OR s.refreshed_at >= s.invalidated_at);
END;
$$;

COMMENT ON FUNCTION public.invalidate_accounting_snapshot_period(UUID, DATE, DATE) IS
  'Mark dashboard + P&L derived snapshots dirty for a period (539).';

REVOKE ALL ON FUNCTION public.invalidate_accounting_snapshot_period(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invalidate_accounting_snapshot_period(UUID, DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.invalidate_accounting_snapshot_period(UUID, DATE, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Enqueue with coalesce + follow-up pending while processing
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_accounting_snapshot_refresh_job(
  p_business_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_job_type TEXT DEFAULT 'both',
  p_reason TEXT DEFAULT 'ledger_change',
  p_source_type TEXT DEFAULT NULL,
  p_source_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_type TEXT := COALESCE(NULLIF(trim(p_job_type), ''), 'both');
  v_pending_id UUID;
  v_processing_id UUID;
  v_new_id UUID;
  v_reason TEXT := COALESCE(NULLIF(trim(p_reason), ''), 'ledger_change');
BEGIN
  IF v_job_type NOT IN ('dashboard', 'pnl', 'both') THEN
    RAISE EXCEPTION 'invalid job_type: %', v_job_type;
  END IF;

  -- Derived layers must not remain "fresh" after a ledger-affecting enqueue.
  PERFORM public.invalidate_accounting_snapshot_period(
    p_business_id, p_period_start, p_period_end
  );

  SELECT j.id INTO v_pending_id
  FROM accounting_snapshot_refresh_jobs j
  WHERE j.business_id = p_business_id
    AND j.period_start = p_period_start
    AND j.period_end = p_period_end
    AND j.job_type = v_job_type
    AND j.status = 'pending'
  LIMIT 1;

  IF v_pending_id IS NOT NULL THEN
    UPDATE accounting_snapshot_refresh_jobs
    SET
      updated_at = NOW(),
      next_run_at = LEAST(next_run_at, NOW()),
      reason = v_reason,
      source_type = COALESCE(p_source_type, source_type),
      source_id = COALESCE(p_source_id, source_id)
    WHERE id = v_pending_id;
    RETURN v_pending_id;
  END IF;

  SELECT j.id INTO v_processing_id
  FROM accounting_snapshot_refresh_jobs j
  WHERE j.business_id = p_business_id
    AND j.period_start = p_period_start
    AND j.period_end = p_period_end
    AND j.job_type = v_job_type
    AND j.status = 'processing'
  LIMIT 1;

  -- Insert pending (new or follow-up). Partial unique index coalesces races.
  INSERT INTO accounting_snapshot_refresh_jobs (
    business_id, period_start, period_end, job_type, reason, source_type, source_id,
    status, next_run_at
  )
  VALUES (
    p_business_id, p_period_start, p_period_end, v_job_type, v_reason,
    p_source_type, p_source_id,
    'pending', NOW()
  )
  ON CONFLICT (business_id, period_start, period_end, job_type)
    WHERE (status = 'pending')
  DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    RETURN v_new_id;
  END IF;

  SELECT j.id INTO v_pending_id
  FROM accounting_snapshot_refresh_jobs j
  WHERE j.business_id = p_business_id
    AND j.period_start = p_period_start
    AND j.period_end = p_period_end
    AND j.job_type = v_job_type
    AND j.status = 'pending'
  LIMIT 1;

  IF v_pending_id IS NOT NULL THEN
    UPDATE accounting_snapshot_refresh_jobs
    SET updated_at = NOW(), next_run_at = LEAST(next_run_at, NOW()), reason = v_reason
    WHERE id = v_pending_id;
    RETURN v_pending_id;
  END IF;

  -- Extreme race: return processing id so callers have a durable handle.
  RETURN v_processing_id;
END;
$$;

COMMENT ON FUNCTION public.enqueue_accounting_snapshot_refresh_job IS
  'Coalesced enqueue: reuse pending, or create one follow-up while processing (539).';

-- ---------------------------------------------------------------------------
-- 4. Atomic claim with lease reclaim
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.claim_accounting_snapshot_refresh_jobs(INT);
DROP FUNCTION IF EXISTS public.complete_accounting_snapshot_refresh_job(UUID);
DROP FUNCTION IF EXISTS public.fail_accounting_snapshot_refresh_job(UUID, TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.claim_accounting_snapshot_refresh_jobs(
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
    WHERE (
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
    AND (p_claim_token IS NULL OR claim_token = p_claim_token);

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
  SELECT attempts, status INTO v_attempts, v_status
  FROM public.accounting_snapshot_refresh_jobs
  WHERE id = p_job_id
    AND (p_claim_token IS NULL OR claim_token = p_claim_token)
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

REVOKE ALL ON FUNCTION public.claim_accounting_snapshot_refresh_jobs(INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_accounting_snapshot_refresh_job(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_accounting_snapshot_refresh_job(UUID, TEXT, INT, INT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_accounting_snapshot_refresh_jobs(INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_accounting_snapshot_refresh_job(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_accounting_snapshot_refresh_job(UUID, TEXT, INT, INT, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Combined transactional refresh (dashboard + P&L)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finza_worker_refresh_period_snapshots(
  p_business_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_job_type TEXT DEFAULT 'both'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_type TEXT := COALESCE(NULLIF(trim(p_job_type), ''), 'both');
  v_dash INT := 0;
  v_pnl INT := 0;
BEGIN
  IF v_job_type NOT IN ('dashboard', 'pnl', 'both') THEN
    RAISE EXCEPTION 'invalid job_type: %', v_job_type;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_business_id::text || ':' || p_period_start::text || ':' || p_period_end::text, 53901)
  );

  IF v_job_type IN ('dashboard', 'both') THEN
    v_dash := public.finza_worker_refresh_dashboard_period_summary(
      p_business_id, p_period_start, p_period_end
    );
  END IF;

  IF v_job_type IN ('pnl', 'both') THEN
    v_pnl := public.finza_worker_refresh_pnl_snapshot(
      p_business_id, p_period_start, p_period_end
    );
  END IF;

  -- Ensure invalidation is cleared even if a helper path omitted it.
  UPDATE public.service_dashboard_period_summary s
  SET invalidated_at = NULL
  WHERE s.business_id = p_business_id
    AND s.period_start = p_period_start
    AND s.period_end = p_period_end
    AND s.invalidated_at IS NOT NULL;

  UPDATE public.service_pnl_movement_snapshots s
  SET
    invalidated_at = NULL,
    source_version = 539
  WHERE s.business_id = p_business_id
    AND s.period_start = p_period_start
    AND s.period_end = p_period_end;

  RETURN jsonb_build_object(
    'dashboard', v_dash,
    'pnl', v_pnl,
    'job_type', v_job_type
  );
END;
$$;

COMMENT ON FUNCTION public.finza_worker_refresh_period_snapshots(UUID, DATE, DATE, TEXT) IS
  'Atomically refresh dashboard summary and/or P&L snapshot for one period (539).';

REVOKE ALL ON FUNCTION public.finza_worker_refresh_period_snapshots(UUID, DATE, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finza_worker_refresh_period_snapshots(UUID, DATE, DATE, TEXT) TO service_role;

-- Patch individual refresh helpers to clear invalidation when run alone.
CREATE OR REPLACE FUNCTION public.finza_worker_refresh_dashboard_period_summary(
  p_business_id UUID,
  p_period_start DATE,
  p_period_end DATE
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_id UUID;
  v_rev NUMERIC;
  v_exp NUMERIC;
  v_np NUMERIC;
BEGIN
  SELECT ap.id INTO v_period_id
  FROM accounting_periods ap
  WHERE ap.business_id = p_business_id
    AND ap.period_start = p_period_start
    AND ap.period_end = p_period_end
  LIMIT 1;

  IF v_period_id IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_business_id::text, 50701));

  SELECT p.revenue, p.expenses, p.net_profit
  INTO v_rev, v_exp, v_np
  FROM finza_dashboard_pnl_totals(p_business_id, p_period_start, p_period_end) p;

  INSERT INTO public.service_dashboard_period_summary (
    business_id, period_id, period_start, period_end,
    revenue, expenses, net_profit, refreshed_at, invalidated_at, generation
  )
  VALUES (
    p_business_id, v_period_id, p_period_start, p_period_end,
    COALESCE(v_rev, 0), COALESCE(v_exp, 0), COALESCE(v_np, 0), NOW(), NULL, 1
  )
  ON CONFLICT (business_id, period_id) DO UPDATE SET
    period_start = EXCLUDED.period_start,
    period_end = EXCLUDED.period_end,
    revenue = EXCLUDED.revenue,
    expenses = EXCLUDED.expenses,
    net_profit = EXCLUDED.net_profit,
    refreshed_at = NOW(),
    invalidated_at = NULL,
    generation = public.service_dashboard_period_summary.generation + 1;

  RETURN 1;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Freshness readers respect invalidation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_fresh_service_dashboard_period_pnl(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_max_stale_seconds INT DEFAULT 300
)
RETURNS TABLE (
  revenue NUMERIC,
  expenses NUMERIC,
  net_profit NUMERIC,
  refreshed_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    s.revenue,
    s.expenses,
    s.net_profit,
    s.refreshed_at
  FROM public.service_dashboard_period_summary s
  WHERE s.business_id = p_business_id
    AND s.period_start = p_start_date
    AND s.period_end = p_end_date
    AND (s.invalidated_at IS NULL OR s.refreshed_at > s.invalidated_at)
    AND s.refreshed_at >= NOW() - make_interval(secs => GREATEST(1, COALESCE(p_max_stale_seconds, 300)))
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_pnl_movement_lines_from_snapshot(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_max_stale_seconds INT DEFAULT 300
)
RETURNS TABLE (
  account_id UUID,
  account_code TEXT,
  account_name TEXT,
  account_type TEXT,
  period_total NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    l.account_id,
    l.account_code,
    l.account_name,
    l.account_type,
    l.period_total
  FROM public.service_pnl_movement_lines l
  JOIN public.service_pnl_movement_snapshots s
    ON s.business_id = l.business_id
   AND s.period_start = l.period_start
   AND s.period_end = l.period_end
  WHERE l.business_id = p_business_id
    AND l.period_start = p_start_date
    AND l.period_end = p_end_date
    AND (s.invalidated_at IS NULL OR s.refreshed_at > s.invalidated_at)
    AND s.refreshed_at >= NOW() - make_interval(secs => GREATEST(1, COALESCE(p_max_stale_seconds, 300)))
  ORDER BY l.account_type, l.account_code;
$$;

CREATE OR REPLACE FUNCTION public.get_service_pnl_movement_snapshot_metadata(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_max_stale_seconds INT DEFAULT 300
)
RETURNS TABLE (
  line_count INT,
  revenue NUMERIC,
  expenses NUMERIC,
  net_profit NUMERIC,
  refreshed_at TIMESTAMPTZ,
  source_version INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    s.line_count,
    s.revenue,
    s.expenses,
    s.net_profit,
    s.refreshed_at,
    s.source_version
  FROM public.service_pnl_movement_snapshots s
  WHERE s.business_id = p_business_id
    AND s.period_start = p_start_date
    AND s.period_end = p_end_date
    AND (s.invalidated_at IS NULL OR s.refreshed_at > s.invalidated_at)
    AND s.refreshed_at >= NOW() - make_interval(secs => GREATEST(1, COALESCE(p_max_stale_seconds, 300)))
  LIMIT 1;
$$;

-- Timeline summary fast path must also reject invalidated rows.
CREATE OR REPLACE FUNCTION public.get_service_dashboard_timeline_from_summary(
  p_business_id UUID,
  p_periods_limit INT DEFAULT 6,
  p_max_stale_seconds INT DEFAULT 300
)
RETURNS TABLE (
  period_id UUID,
  period_start DATE,
  period_end DATE,
  revenue NUMERIC,
  expenses NUMERIC,
  net_profit NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH recent AS (
    SELECT
      s.period_id,
      s.period_start,
      s.period_end,
      s.revenue,
      s.expenses,
      s.net_profit,
      s.refreshed_at
    FROM service_dashboard_period_summary s
    WHERE s.business_id = p_business_id
      AND (s.invalidated_at IS NULL OR s.refreshed_at > s.invalidated_at)
      AND s.refreshed_at >= NOW()
        - (GREATEST(COALESCE(p_max_stale_seconds, 300), 60) || ' seconds')::interval
    ORDER BY s.period_start DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_periods_limit, 6), 24))
  )
  SELECT
    r.period_id,
    r.period_start,
    r.period_end,
    r.revenue,
    r.expenses,
    r.net_profit
  FROM recent r
  ORDER BY r.period_start ASC;
$$;

-- Clear invalidation when P&L snapshot is rebuilt.
CREATE OR REPLACE FUNCTION public._refresh_service_pnl_snapshot_for_period(
  p_business_id UUID,
  p_period_id UUID,
  p_period_start DATE,
  p_period_end DATE
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line_count INT := 0;
  v_rev NUMERIC := 0;
  v_exp NUMERIC := 0;
  v_np NUMERIC := 0;
BEGIN
  DELETE FROM public.service_pnl_movement_lines
  WHERE business_id = p_business_id
    AND period_id = p_period_id;

  INSERT INTO public.service_pnl_movement_lines (
    business_id,
    period_id,
    period_start,
    period_end,
    account_id,
    account_code,
    account_name,
    account_type,
    period_total,
    refreshed_at
  )
  SELECT
    p_business_id,
    p_period_id,
    p_period_start,
    p_period_end,
    m.account_id,
    m.account_code,
    m.account_name,
    m.account_type,
    m.period_total,
    NOW()
  FROM public.get_profit_and_loss_movement(
    p_business_id,
    p_period_start,
    p_period_end
  ) m;

  GET DIAGNOSTICS v_line_count = ROW_COUNT;

  SELECT p.revenue, p.expenses, p.net_profit
  INTO v_rev, v_exp, v_np
  FROM finza_dashboard_pnl_totals(p_business_id, p_period_start, p_period_end) p;

  INSERT INTO public.service_pnl_movement_snapshots (
    business_id,
    period_start,
    period_end,
    refreshed_at,
    line_count,
    revenue,
    expenses,
    net_profit,
    source_version,
    invalidated_at,
    generation
  )
  VALUES (
    p_business_id,
    p_period_start,
    p_period_end,
    NOW(),
    v_line_count,
    COALESCE(v_rev, 0),
    COALESCE(v_exp, 0),
    COALESCE(v_np, 0),
    539,
    NULL,
    1
  )
  ON CONFLICT (business_id, period_start, period_end) DO UPDATE SET
    refreshed_at = NOW(),
    line_count = EXCLUDED.line_count,
    revenue = EXCLUDED.revenue,
    expenses = EXCLUDED.expenses,
    net_profit = EXCLUDED.net_profit,
    source_version = 539,
    invalidated_at = NULL,
    generation = public.service_pnl_movement_snapshots.generation + 1;

  RETURN v_line_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Diagnostics + backlog helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_accounting_snapshot_queue_diagnostics(
  p_business_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending INT;
  v_running INT;
  v_retryable INT;
  v_failed INT;
  v_completed_recent INT;
  v_oldest_pending INTERVAL;
  v_oldest_running INTERVAL;
  v_dupes INT;
BEGIN
  SELECT COUNT(*)::INT INTO v_pending
  FROM accounting_snapshot_refresh_jobs j
  WHERE j.status = 'pending'
    AND (p_business_id IS NULL OR j.business_id = p_business_id);

  SELECT COUNT(*)::INT INTO v_running
  FROM accounting_snapshot_refresh_jobs j
  WHERE j.status = 'processing'
    AND (p_business_id IS NULL OR j.business_id = p_business_id);

  SELECT COUNT(*)::INT INTO v_retryable
  FROM accounting_snapshot_refresh_jobs j
  WHERE j.status = 'pending'
    AND j.attempts > 0
    AND j.next_run_at > NOW()
    AND (p_business_id IS NULL OR j.business_id = p_business_id);

  SELECT COUNT(*)::INT INTO v_failed
  FROM accounting_snapshot_refresh_jobs j
  WHERE j.status = 'failed'
    AND (p_business_id IS NULL OR j.business_id = p_business_id);

  SELECT COUNT(*)::INT INTO v_completed_recent
  FROM accounting_snapshot_refresh_jobs j
  WHERE j.status = 'done'
    AND j.completed_at >= NOW() - INTERVAL '24 hours'
    AND (p_business_id IS NULL OR j.business_id = p_business_id);

  SELECT NOW() - MIN(j.created_at) INTO v_oldest_pending
  FROM accounting_snapshot_refresh_jobs j
  WHERE j.status = 'pending'
    AND (p_business_id IS NULL OR j.business_id = p_business_id);

  SELECT NOW() - MIN(j.locked_at) INTO v_oldest_running
  FROM accounting_snapshot_refresh_jobs j
  WHERE j.status = 'processing'
    AND (p_business_id IS NULL OR j.business_id = p_business_id);

  SELECT COUNT(*)::INT INTO v_dupes
  FROM (
    SELECT j.business_id, j.period_start, j.period_end, j.job_type
    FROM accounting_snapshot_refresh_jobs j
    WHERE j.status = 'pending'
      AND (p_business_id IS NULL OR j.business_id = p_business_id)
    GROUP BY j.business_id, j.period_start, j.period_end, j.job_type
    HAVING COUNT(*) > 1
  ) d;

  RETURN jsonb_build_object(
    'pending', v_pending,
    'running', v_running,
    'retryable', v_retryable,
    'failed_terminal', v_failed,
    'completed_recently', v_completed_recent,
    'oldest_pending_age_seconds', EXTRACT(EPOCH FROM v_oldest_pending)::BIGINT,
    'oldest_running_age_seconds', EXTRACT(EPOCH FROM v_oldest_running)::BIGINT,
    'duplicate_business_period_jobs', v_dupes,
    'business_id', p_business_id,
    'checked_at', NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_accounting_snapshot_queue_diagnostics(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_accounting_snapshot_queue_diagnostics(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.coalesce_redundant_pending_snapshot_jobs(
  p_business_id UUID DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_removed INT := 0;
BEGIN
  WITH ranked AS (
    SELECT
      j.id,
      ROW_NUMBER() OVER (
        PARTITION BY j.business_id, j.period_start, j.period_end, j.job_type
        ORDER BY j.updated_at DESC, j.created_at DESC, j.id DESC
      ) AS rn
    FROM accounting_snapshot_refresh_jobs j
    WHERE j.status = 'pending'
      AND (p_business_id IS NULL OR j.business_id = p_business_id)
  ),
  doomed AS (
    SELECT id FROM ranked WHERE rn > 1
  )
  UPDATE accounting_snapshot_refresh_jobs j
  SET
    status = 'done',
    last_error = LEFT('deduplicated_redundant_pending', 2000),
    completed_at = NOW(),
    locked_at = NULL,
    claim_token = NULL,
    updated_at = NOW()
  FROM doomed d
  WHERE j.id = d.id
    AND j.status = 'pending';

  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RETURN v_removed;
END;
$$;

REVOKE ALL ON FUNCTION public.coalesce_redundant_pending_snapshot_jobs(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.coalesce_redundant_pending_snapshot_jobs(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.requeue_failed_accounting_snapshot_refresh_jobs(
  p_business_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 100
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
BEGIN
  WITH picked AS (
    SELECT j.id
    FROM accounting_snapshot_refresh_jobs j
    WHERE j.status = 'failed'
      AND (p_business_id IS NULL OR j.business_id = p_business_id)
    ORDER BY j.updated_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 1000))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE accounting_snapshot_refresh_jobs j
  SET
    status = 'pending',
    attempts = 0,
    next_run_at = NOW(),
    locked_at = NULL,
    claim_token = NULL,
    failed_at = NULL,
    last_error = LEFT('requeued_after_terminal_failure', 2000),
    updated_at = NOW()
  FROM picked p
  WHERE j.id = p.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.requeue_failed_accounting_snapshot_refresh_jobs(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.requeue_failed_accounting_snapshot_refresh_jobs(UUID, INT) TO service_role;

CREATE OR REPLACE FUNCTION public.recover_abandoned_snapshot_refresh_jobs(
  p_lease_seconds INT DEFAULT 900,
  p_business_id UUID DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease INT := GREATEST(60, LEAST(COALESCE(p_lease_seconds, 900), 3600));
  v_count INT := 0;
BEGIN
  UPDATE accounting_snapshot_refresh_jobs j
  SET
    status = 'pending',
    locked_at = NULL,
    claim_token = NULL,
    next_run_at = NOW(),
    last_error = LEFT('recovered_abandoned_processing', 2000),
    updated_at = NOW()
  WHERE j.status = 'processing'
    AND j.locked_at IS NOT NULL
    AND j.locked_at < NOW() - make_interval(secs => v_lease)
    AND (p_business_id IS NULL OR j.business_id = p_business_id);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recover_abandoned_snapshot_refresh_jobs(INT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recover_abandoned_snapshot_refresh_jobs(INT, UUID) TO service_role;

-- Refresh health RPC with richer fields
CREATE OR REPLACE FUNCTION public.get_accounting_snapshot_health()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_accounting_snapshot_queue_diagnostics(NULL)
    || jsonb_build_object(
      'failed_refresh_jobs', (
        SELECT COUNT(*)::INT FROM accounting_snapshot_refresh_jobs WHERE status = 'failed'
      ),
      'pending_refresh_jobs', (
        SELECT COUNT(*)::INT FROM accounting_snapshot_refresh_jobs WHERE status = 'pending'
      ),
      'processing_refresh_jobs', (
        SELECT COUNT(*)::INT FROM accounting_snapshot_refresh_jobs WHERE status = 'processing'
      ),
      'oldest_pending_job_at', (
        SELECT MIN(created_at) FROM accounting_snapshot_refresh_jobs WHERE status = 'pending'
      ),
      'stale_pnl_snapshots_24h', (
        SELECT COUNT(*)::INT
        FROM service_pnl_movement_snapshots s
        WHERE s.refreshed_at < NOW() - INTERVAL '24 hours'
           OR (s.invalidated_at IS NOT NULL AND s.refreshed_at <= s.invalidated_at)
      ),
      'schema_version', 539
    );
$$;
