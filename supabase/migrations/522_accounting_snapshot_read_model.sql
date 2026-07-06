-- ============================================================================
-- Accounting snapshot read model (522)
-- ============================================================================
-- Durable dashboard + P&L snapshot maintenance:
--   • P&L snapshot metadata (distinguish missing vs valid zero)
--   • Refresh job queue + ledger-change triggers
--   • Worker RPCs (service_role) without user access checks
--   • Zero-state snapshots on new accounting period bootstrap
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. P&L snapshot metadata
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_pnl_movement_snapshots (
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  line_count INT NOT NULL DEFAULT 0,
  revenue NUMERIC NOT NULL DEFAULT 0,
  expenses NUMERIC NOT NULL DEFAULT 0,
  net_profit NUMERIC NOT NULL DEFAULT 0,
  source_version INT NOT NULL DEFAULT 522,
  PRIMARY KEY (business_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_service_pnl_movement_snapshots_business_refreshed
  ON public.service_pnl_movement_snapshots (business_id, refreshed_at DESC);

COMMENT ON TABLE public.service_pnl_movement_snapshots IS
  'Per-period P&L snapshot metadata — line_count=0 means valid zero movement, not missing snapshot (522).';

ALTER TABLE public.service_pnl_movement_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_pnl_movement_snapshots_select ON public.service_pnl_movement_snapshots;
CREATE POLICY service_pnl_movement_snapshots_select
  ON public.service_pnl_movement_snapshots FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

GRANT SELECT ON public.service_pnl_movement_snapshots TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Refresh job queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounting_snapshot_refresh_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('dashboard', 'pnl', 'both')),
  reason TEXT NOT NULL DEFAULT 'ledger_change',
  source_type TEXT,
  source_id UUID,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounting_snapshot_refresh_jobs_pending
  ON public.accounting_snapshot_refresh_jobs (next_run_at ASC)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_snapshot_refresh_jobs_pending_unique
  ON public.accounting_snapshot_refresh_jobs (business_id, period_start, period_end, job_type)
  WHERE status IN ('pending', 'processing');

COMMENT ON TABLE public.accounting_snapshot_refresh_jobs IS
  'Async refresh queue for dashboard period summaries and P&L movement snapshots (522).';

ALTER TABLE public.accounting_snapshot_refresh_jobs ENABLE ROW LEVEL SECURITY;

-- No authenticated policies — worker uses service_role only.

-- ---------------------------------------------------------------------------
-- 3. Resolve accounting period for a journal date
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finza_resolve_accounting_period_for_date(
  p_business_id UUID,
  p_journal_date DATE
)
RETURNS TABLE (
  period_id UUID,
  period_start DATE,
  period_end DATE
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT ap.id, ap.period_start, ap.period_end
  FROM accounting_periods ap
  WHERE ap.business_id = p_business_id
    AND p_journal_date >= ap.period_start
    AND p_journal_date <= ap.period_end
  ORDER BY ap.period_start DESC
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 4. Enqueue refresh job (coalesce pending/processing)
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
  v_existing_id UUID;
  v_new_id UUID;
BEGIN
  IF v_job_type NOT IN ('dashboard', 'pnl', 'both') THEN
    RAISE EXCEPTION 'invalid job_type: %', v_job_type;
  END IF;

  SELECT j.id INTO v_existing_id
  FROM accounting_snapshot_refresh_jobs j
  WHERE j.business_id = p_business_id
    AND j.period_start = p_period_start
    AND j.period_end = p_period_end
    AND j.job_type = v_job_type
    AND j.status IN ('pending', 'processing')
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE accounting_snapshot_refresh_jobs
    SET updated_at = NOW(),
        next_run_at = LEAST(next_run_at, NOW())
    WHERE id = v_existing_id;
    RETURN v_existing_id;
  END IF;

  INSERT INTO accounting_snapshot_refresh_jobs (
    business_id, period_start, period_end, job_type, reason, source_type, source_id
  )
  VALUES (
    p_business_id, p_period_start, p_period_end, v_job_type, COALESCE(p_reason, 'ledger_change'),
    p_source_type, p_source_id
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.enqueue_accounting_snapshot_refresh_job IS
  'Coalesced enqueue for snapshot refresh jobs (522).';

GRANT EXECUTE ON FUNCTION public.enqueue_accounting_snapshot_refresh_job(UUID, DATE, DATE, TEXT, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_accounting_snapshot_refresh_job(UUID, DATE, DATE, TEXT, TEXT, TEXT, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Internal: refresh P&L lines + metadata for one period
-- ---------------------------------------------------------------------------
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
    source_version
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
    522
  )
  ON CONFLICT (business_id, period_start, period_end) DO UPDATE SET
    refreshed_at = NOW(),
    line_count = EXCLUDED.line_count,
    revenue = EXCLUDED.revenue,
    expenses = EXCLUDED.expenses,
    net_profit = EXCLUDED.net_profit,
    source_version = EXCLUDED.source_version;

  RETURN v_line_count;
END;
$$;

-- Replace line upsert helper to use metadata-aware refresh
CREATE OR REPLACE FUNCTION public._upsert_service_pnl_movement_lines(
  p_business_id UUID,
  p_period_id UUID,
  p_period_start DATE,
  p_period_end DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._refresh_service_pnl_snapshot_for_period(
    p_business_id, p_period_id, p_period_start, p_period_end
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Worker RPCs (service_role — no finza_user_can_access_business gate)
-- ---------------------------------------------------------------------------
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
    revenue, expenses, net_profit, refreshed_at
  )
  VALUES (
    p_business_id, v_period_id, p_period_start, p_period_end,
    COALESCE(v_rev, 0), COALESCE(v_exp, 0), COALESCE(v_np, 0), NOW()
  )
  ON CONFLICT (business_id, period_id) DO UPDATE SET
    period_start = EXCLUDED.period_start,
    period_end = EXCLUDED.period_end,
    revenue = EXCLUDED.revenue,
    expenses = EXCLUDED.expenses,
    net_profit = EXCLUDED.net_profit,
    refreshed_at = NOW();

  RETURN 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.finza_worker_refresh_pnl_snapshot(
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
  v_ps DATE;
  v_pe DATE;
BEGIN
  SELECT ap.id, ap.period_start, ap.period_end
  INTO v_period_id, v_ps, v_pe
  FROM accounting_periods ap
  WHERE ap.business_id = p_business_id
    AND ap.period_start = p_period_start
    AND ap.period_end = p_period_end
  LIMIT 1;

  IF v_period_id IS NULL THEN
    SELECT ap.id, ap.period_start, ap.period_end
    INTO v_period_id, v_ps, v_pe
    FROM accounting_periods ap
    WHERE ap.business_id = p_business_id
      AND ap.period_start <= p_period_end
      AND ap.period_end >= p_period_start
    ORDER BY ap.period_start DESC
    LIMIT 1;
  END IF;

  IF v_period_id IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_business_id::text, 51301));

  RETURN public._refresh_service_pnl_snapshot_for_period(
    p_business_id, v_period_id, v_ps, v_pe
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finza_worker_write_zero_period_snapshots(
  p_business_id UUID,
  p_period_start DATE,
  p_period_end DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_id UUID;
BEGIN
  SELECT ap.id INTO v_period_id
  FROM accounting_periods ap
  WHERE ap.business_id = p_business_id
    AND ap.period_start = p_period_start
    AND ap.period_end = p_period_end
  LIMIT 1;

  IF v_period_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.service_dashboard_period_summary (
    business_id, period_id, period_start, period_end,
    revenue, expenses, net_profit, refreshed_at
  )
  VALUES (
    p_business_id, v_period_id, p_period_start, p_period_end,
    0, 0, 0, NOW()
  )
  ON CONFLICT (business_id, period_id) DO UPDATE SET
    refreshed_at = NOW(),
    revenue = 0,
    expenses = 0,
    net_profit = 0;

  DELETE FROM public.service_pnl_movement_lines
  WHERE business_id = p_business_id
    AND period_id = v_period_id;

  INSERT INTO public.service_pnl_movement_snapshots (
    business_id, period_start, period_end, refreshed_at,
    line_count, revenue, expenses, net_profit, source_version
  )
  VALUES (
    p_business_id, p_period_start, p_period_end, NOW(),
    0, 0, 0, 0, 522
  )
  ON CONFLICT (business_id, period_start, period_end) DO UPDATE SET
    refreshed_at = NOW(),
    line_count = 0,
    revenue = 0,
    expenses = 0,
    net_profit = 0,
    source_version = 522;
END;
$$;

REVOKE ALL ON FUNCTION public.finza_worker_refresh_dashboard_period_summary(UUID, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finza_worker_refresh_pnl_snapshot(UUID, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finza_worker_write_zero_period_snapshots(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finza_worker_refresh_dashboard_period_summary(UUID, DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.finza_worker_refresh_pnl_snapshot(UUID, DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.finza_worker_write_zero_period_snapshots(UUID, DATE, DATE) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Read helpers
-- ---------------------------------------------------------------------------
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
    AND s.refreshed_at >= NOW() - make_interval(secs => GREATEST(1, COALESCE(p_max_stale_seconds, 300)))
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_service_pnl_movement_snapshot_metadata(UUID, DATE, DATE, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_service_pnl_movement_snapshot_metadata(UUID, DATE, DATE, INT) TO service_role;

CREATE OR REPLACE FUNCTION public.get_stale_service_pnl_movement_snapshot_metadata(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE
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
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_stale_service_pnl_movement_snapshot_metadata(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stale_service_pnl_movement_snapshot_metadata(UUID, DATE, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.period_has_live_pnl_movement(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.get_profit_and_loss_movement(
      p_business_id,
      p_start_date,
      p_end_date
    ) m
    WHERE COALESCE(m.period_total, 0) <> 0
  );
$$;

GRANT EXECUTE ON FUNCTION public.period_has_live_pnl_movement(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.period_has_live_pnl_movement(UUID, DATE, DATE) TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_zero_pnl_snapshot_for_period(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_id UUID;
  v_ps DATE;
  v_pe DATE;
BEGIN
  IF public.period_has_live_pnl_movement(p_business_id, p_start_date, p_end_date) THEN
    RETURN FALSE;
  END IF;

  PERFORM public.finza_worker_write_zero_period_snapshots(
    p_business_id,
    p_start_date,
    p_end_date
  );
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_zero_pnl_snapshot_for_period(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_zero_pnl_snapshot_for_period(UUID, DATE, DATE) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Worker job claim / complete / fail
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_accounting_snapshot_refresh_jobs(
  p_limit INT DEFAULT 10
)
RETURNS SETOF public.accounting_snapshot_refresh_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.accounting_snapshot_refresh_jobs j
  SET
    status = 'processing',
    locked_at = NOW(),
    attempts = j.attempts + 1,
    updated_at = NOW()
  WHERE j.id IN (
    SELECT q.id
    FROM public.accounting_snapshot_refresh_jobs q
    WHERE q.status = 'pending'
      AND q.next_run_at <= NOW()
    ORDER BY q.next_run_at ASC, q.created_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 50))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING j.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_accounting_snapshot_refresh_job(
  p_job_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.accounting_snapshot_refresh_jobs
  SET status = 'done', locked_at = NULL, last_error = NULL, updated_at = NOW()
  WHERE id = p_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_accounting_snapshot_refresh_job(
  p_job_id UUID,
  p_error TEXT,
  p_max_attempts INT DEFAULT 5,
  p_backoff_seconds INT DEFAULT 60
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts INT;
BEGIN
  SELECT attempts INTO v_attempts
  FROM public.accounting_snapshot_refresh_jobs
  WHERE id = p_job_id;

  IF v_attempts IS NULL THEN
    RETURN;
  END IF;

  IF v_attempts >= p_max_attempts THEN
    UPDATE public.accounting_snapshot_refresh_jobs
    SET
      status = 'failed',
      locked_at = NULL,
      last_error = LEFT(COALESCE(p_error, 'unknown'), 2000),
      updated_at = NOW()
    WHERE id = p_job_id;
  ELSE
    UPDATE public.accounting_snapshot_refresh_jobs
    SET
      status = 'pending',
      locked_at = NULL,
      last_error = LEFT(COALESCE(p_error, 'unknown'), 2000),
      next_run_at = NOW() + make_interval(secs => GREATEST(30, COALESCE(p_backoff_seconds, 60) * v_attempts)),
      updated_at = NOW()
    WHERE id = p_job_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_accounting_snapshot_refresh_jobs(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_accounting_snapshot_refresh_job(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_accounting_snapshot_refresh_job(UUID, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_accounting_snapshot_refresh_jobs(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_accounting_snapshot_refresh_job(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_accounting_snapshot_refresh_job(UUID, TEXT, INT, INT) TO service_role;

-- ---------------------------------------------------------------------------
-- 9. Snapshot health (monitoring)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_accounting_snapshot_health()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ledger_businesses AS (
    SELECT DISTINCT je.business_id
    FROM journal_entries je
  ),
  missing_dashboard AS (
    SELECT COUNT(DISTINCT lb.business_id)::INT AS cnt
    FROM ledger_businesses lb
    WHERE EXISTS (
      SELECT 1 FROM journal_entries je WHERE je.business_id = lb.business_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM service_dashboard_period_summary s
      WHERE s.business_id = lb.business_id
    )
  ),
  missing_pnl AS (
    SELECT COUNT(DISTINCT ap.business_id)::INT AS cnt
    FROM accounting_periods ap
    WHERE public.period_has_live_pnl_movement(ap.business_id, ap.period_start, ap.period_end)
      AND NOT EXISTS (
        SELECT 1 FROM service_pnl_movement_snapshots m
        WHERE m.business_id = ap.business_id
          AND m.period_start = ap.period_start
          AND m.period_end = ap.period_end
      )
  ),
  failed_jobs AS (
    SELECT COUNT(*)::INT AS cnt FROM accounting_snapshot_refresh_jobs WHERE status = 'failed'
  ),
  pending_jobs AS (
    SELECT COUNT(*)::INT AS cnt FROM accounting_snapshot_refresh_jobs WHERE status = 'pending'
  ),
  oldest_pending AS (
    SELECT MIN(next_run_at) AS ts FROM accounting_snapshot_refresh_jobs WHERE status = 'pending'
  ),
  stale_snapshots AS (
    SELECT COUNT(*)::INT AS cnt
    FROM service_pnl_movement_snapshots s
    WHERE s.refreshed_at < NOW() - INTERVAL '24 hours'
  )
  SELECT jsonb_build_object(
    'businesses_with_ledger_missing_dashboard_summary', (SELECT cnt FROM missing_dashboard),
    'periods_with_live_pnl_missing_snapshot', (SELECT cnt FROM missing_pnl),
    'failed_refresh_jobs', (SELECT cnt FROM failed_jobs),
    'pending_refresh_jobs', (SELECT cnt FROM pending_jobs),
    'oldest_pending_job_at', (SELECT ts FROM oldest_pending),
    'stale_pnl_snapshots_24h', (SELECT cnt FROM stale_snapshots),
    'checked_at', NOW()
  );
$$;

REVOKE ALL ON FUNCTION public.get_accounting_snapshot_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_accounting_snapshot_health() TO service_role;

-- ---------------------------------------------------------------------------
-- 10. Ledger-change triggers → enqueue jobs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_enqueue_snapshot_refresh_from_journal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_je_id UUID;
  v_business_id UUID;
  v_je_date DATE;
  v_old_date DATE;
  v_period_start DATE;
  v_period_end DATE;
  v_old_period_start DATE;
  v_old_period_end DATE;
BEGIN
  IF TG_TABLE_NAME = 'journal_entry_lines' THEN
    v_je_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
    SELECT je.business_id, je.date INTO v_business_id, v_je_date
    FROM journal_entries je WHERE je.id = v_je_id;
  ELSIF TG_TABLE_NAME = 'journal_entries' THEN
    v_je_id := COALESCE(NEW.id, OLD.id);
    v_business_id := COALESCE(NEW.business_id, OLD.business_id);
    v_je_date := COALESCE(NEW.date, OLD.date);
    IF TG_OP = 'UPDATE' AND OLD.date IS DISTINCT FROM NEW.date THEN
      v_old_date := OLD.date;
    ELSIF TG_OP = 'DELETE' THEN
      v_old_date := OLD.date;
    END IF;
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_business_id IS NULL OR v_je_date IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT rp.period_start, rp.period_end
  INTO v_period_start, v_period_end
  FROM finza_resolve_accounting_period_for_date(v_business_id, v_je_date) rp;

  IF v_period_start IS NOT NULL THEN
    PERFORM enqueue_accounting_snapshot_refresh_job(
      v_business_id, v_period_start, v_period_end, 'both', 'ledger_change', TG_TABLE_NAME, v_je_id
    );
  END IF;

  IF v_old_date IS NOT NULL THEN
    SELECT rp.period_start, rp.period_end
    INTO v_old_period_start, v_old_period_end
    FROM finza_resolve_accounting_period_for_date(v_business_id, v_old_date) rp;

    IF v_old_period_start IS NOT NULL
       AND (v_old_period_start IS DISTINCT FROM v_period_start OR v_old_period_end IS DISTINCT FROM v_period_end) THEN
      PERFORM enqueue_accounting_snapshot_refresh_job(
        v_business_id, v_old_period_start, v_old_period_end, 'both', 'ledger_change', TG_TABLE_NAME, v_je_id
      );
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_entry_lines_enqueue_snapshot ON public.journal_entry_lines;
CREATE TRIGGER trg_journal_entry_lines_enqueue_snapshot
  AFTER INSERT OR UPDATE OR DELETE ON public.journal_entry_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enqueue_snapshot_refresh_from_journal();

DROP TRIGGER IF EXISTS trg_journal_entries_enqueue_snapshot ON public.journal_entries;
CREATE TRIGGER trg_journal_entries_enqueue_snapshot
  AFTER UPDATE OF date OR DELETE ON public.journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enqueue_snapshot_refresh_from_journal();

-- ---------------------------------------------------------------------------
-- 11. New accounting period bootstrap → zero-state snapshots
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION initialize_business_accounting_period(
  p_business_id UUID,
  p_start_date DATE DEFAULT CURRENT_DATE
)
RETURNS VOID AS $$
DECLARE
  period_exists BOOLEAN;
  period_start_date DATE;
  period_end_date DATE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM businesses WHERE id = p_business_id) THEN
    RAISE EXCEPTION 'Business not found: %', p_business_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM accounting_periods WHERE business_id = p_business_id
  ) INTO period_exists;

  IF period_exists THEN
    RETURN;
  END IF;

  period_start_date := DATE_TRUNC('month', p_start_date)::DATE;
  period_end_date := (DATE_TRUNC('month', p_start_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  INSERT INTO accounting_periods (
    business_id,
    period_start,
    period_end,
    status
  )
  VALUES (
    p_business_id,
    period_start_date,
    period_end_date,
    'open'
  );

  PERFORM public.finza_worker_write_zero_period_snapshots(
    p_business_id,
    period_start_date,
    period_end_date
  );
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

COMMENT ON FUNCTION initialize_business_accounting_period(UUID, DATE) IS
  'Bootstrap one open accounting period; writes zero-state dashboard + P&L snapshots (522).';
