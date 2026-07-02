-- ============================================================================
-- Mixed-load shared P&L snapshot (512)
-- ============================================================================
-- Extends 507 period summaries with line-level movement snapshots so
-- dashboard metrics and reports_pnl can share one refresh path under load.
-- Ledger remains authoritative; snapshots are read-through caches only.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Line-level P&L movement snapshot (per business + accounting period)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_pnl_movement_lines (
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES public.accounting_periods(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  account_id UUID NOT NULL,
  account_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  period_total NUMERIC NOT NULL DEFAULT 0,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, period_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_service_pnl_movement_lines_business_period
  ON public.service_pnl_movement_lines (business_id, period_start, period_end);

COMMENT ON TABLE public.service_pnl_movement_lines IS
  'Precomputed get_profit_and_loss_movement rows per period for dashboard + reports read-through.';

ALTER TABLE public.service_pnl_movement_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_pnl_movement_lines_select ON public.service_pnl_movement_lines;
CREATE POLICY service_pnl_movement_lines_select
  ON public.service_pnl_movement_lines FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

GRANT SELECT ON public.service_pnl_movement_lines TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Internal: upsert line snapshot for one period (called under advisory lock)
-- ---------------------------------------------------------------------------
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
END;
$$;

COMMENT ON FUNCTION public._upsert_service_pnl_movement_lines(UUID, UUID, DATE, DATE) IS
  'Rebuild line-level P&L snapshot for one period from live movement RPC.';

-- ---------------------------------------------------------------------------
-- 3. Fresh period totals read (dashboard metrics fast path)
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
    AND s.refreshed_at >= NOW() - make_interval(secs => GREATEST(1, COALESCE(p_max_stale_seconds, 300)))
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_fresh_service_dashboard_period_pnl(UUID, DATE, DATE, INT) IS
  'Fresh period P&L totals from service_dashboard_period_summary (512 metrics fast path).';

GRANT EXECUTE ON FUNCTION public.get_fresh_service_dashboard_period_pnl(UUID, DATE, DATE, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Fresh line-level movement read (reports_pnl fast path)
-- ---------------------------------------------------------------------------
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
  WHERE l.business_id = p_business_id
    AND l.period_start = p_start_date
    AND l.period_end = p_end_date
    AND l.refreshed_at >= NOW() - make_interval(secs => GREATEST(1, COALESCE(p_max_stale_seconds, 300)))
  ORDER BY l.account_type, l.account_code;
$$;

COMMENT ON FUNCTION public.get_pnl_movement_lines_from_snapshot(UUID, DATE, DATE, INT) IS
  'Fresh P&L movement lines from snapshot; empty when stale/missing (app falls back to live RPC).';

GRANT EXECUTE ON FUNCTION public.get_pnl_movement_lines_from_snapshot(UUID, DATE, DATE, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Blocking refresh — add line snapshots (509 baseline + 512 lines)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_service_dashboard_period_summaries(
  p_business_id UUID,
  p_periods_limit INT DEFAULT 6
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_periods_limit, 6), 24));
  v_count INT := 0;
  r RECORD;
  v_rev NUMERIC;
  v_exp NUMERIC;
  v_np NUMERIC;
BEGIN
  IF NOT public.finza_user_can_access_business(p_business_id) THEN
    RAISE EXCEPTION 'Access denied for business %', p_business_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_business_id::text, 50701));

  FOR r IN
    SELECT ap.id, ap.period_start, ap.period_end
    FROM accounting_periods ap
    WHERE ap.business_id = p_business_id
    ORDER BY ap.period_start DESC
    LIMIT v_limit
  LOOP
    SELECT p.revenue, p.expenses, p.net_profit
    INTO v_rev, v_exp, v_np
    FROM finza_dashboard_pnl_totals(p_business_id, r.period_start, r.period_end) p;

    INSERT INTO public.service_dashboard_period_summary (
      business_id,
      period_id,
      period_start,
      period_end,
      revenue,
      expenses,
      net_profit,
      refreshed_at
    )
    VALUES (
      p_business_id,
      r.id,
      r.period_start,
      r.period_end,
      COALESCE(v_rev, 0),
      COALESCE(v_exp, 0),
      COALESCE(v_np, 0),
      NOW()
    )
    ON CONFLICT (business_id, period_id) DO UPDATE SET
      period_start = EXCLUDED.period_start,
      period_end = EXCLUDED.period_end,
      revenue = EXCLUDED.revenue,
      expenses = EXCLUDED.expenses,
      net_profit = EXCLUDED.net_profit,
      refreshed_at = NOW();

    PERFORM public._upsert_service_pnl_movement_lines(
      p_business_id,
      r.id,
      r.period_start,
      r.period_end
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.refresh_service_dashboard_period_summaries(UUID, INT) IS
  'Blocking upsert of period summaries + line snapshots. SECURITY DEFINER with business access check.';

-- ---------------------------------------------------------------------------
-- 6. Non-blocking refresh — add line snapshots (509 baseline + 512 lines)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_refresh_service_dashboard_period_summaries(
  p_business_id UUID,
  p_periods_limit INT DEFAULT 6
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_periods_limit, 6), 24));
  v_count INT := 0;
  r RECORD;
  v_rev NUMERIC;
  v_exp NUMERIC;
  v_np NUMERIC;
BEGIN
  IF NOT public.finza_user_can_access_business(p_business_id) THEN
    RETURN jsonb_build_object(
      'refreshed', false,
      'lock_held', false,
      'period_count', 0,
      'error', 'access_denied'
    );
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_business_id::text, 50701)) THEN
    RETURN jsonb_build_object(
      'refreshed', false,
      'lock_held', true,
      'period_count', 0
    );
  END IF;

  FOR r IN
    SELECT ap.id, ap.period_start, ap.period_end
    FROM accounting_periods ap
    WHERE ap.business_id = p_business_id
    ORDER BY ap.period_start DESC
    LIMIT v_limit
  LOOP
    SELECT p.revenue, p.expenses, p.net_profit
    INTO v_rev, v_exp, v_np
    FROM finza_dashboard_pnl_totals(p_business_id, r.period_start, r.period_end) p;

    INSERT INTO public.service_dashboard_period_summary (
      business_id,
      period_id,
      period_start,
      period_end,
      revenue,
      expenses,
      net_profit,
      refreshed_at
    )
    VALUES (
      p_business_id,
      r.id,
      r.period_start,
      r.period_end,
      COALESCE(v_rev, 0),
      COALESCE(v_exp, 0),
      COALESCE(v_np, 0),
      NOW()
    )
    ON CONFLICT (business_id, period_id) DO UPDATE SET
      period_start = EXCLUDED.period_start,
      period_end = EXCLUDED.period_end,
      revenue = EXCLUDED.revenue,
      expenses = EXCLUDED.expenses,
      net_profit = EXCLUDED.net_profit,
      refreshed_at = NOW();

    PERFORM public._upsert_service_pnl_movement_lines(
      p_business_id,
      r.id,
      r.period_start,
      r.period_end
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'refreshed', true,
    'lock_held', false,
    'period_count', v_count
  );
END;
$$;

COMMENT ON FUNCTION public.try_refresh_service_dashboard_period_summaries(UUID, INT) IS
  'Non-blocking summary + line snapshot refresh. SECURITY DEFINER with business access check.';

GRANT EXECUTE ON FUNCTION public.refresh_service_dashboard_period_summaries(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.try_refresh_service_dashboard_period_summaries(UUID, INT) TO authenticated;
