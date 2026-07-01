-- ============================================================================
-- Dashboard timeline circuit breaker (508)
-- ============================================================================
-- Summary-first timeline: stale read + try_refresh with pg_try_advisory_xact_lock.
-- No live get_service_dashboard_timeline under load — refresh uses per-period P&L.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Stale summary read (any age, no refreshed_at filter)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_service_dashboard_timeline_stale_summary(
  p_business_id UUID,
  p_periods_limit INT DEFAULT 6
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
      s.net_profit
    FROM service_dashboard_period_summary s
    WHERE s.business_id = p_business_id
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

COMMENT ON FUNCTION public.get_service_dashboard_timeline_stale_summary(UUID, INT) IS
  'Dashboard timeline from period summary regardless of refreshed_at (circuit-breaker stale path).';

-- ---------------------------------------------------------------------------
-- 2. Non-blocking refresh — skips when advisory lock held
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_refresh_service_dashboard_period_summaries(
  p_business_id UUID,
  p_periods_limit INT DEFAULT 6
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
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
  'Upserts period summaries when advisory lock free; returns lock_held when refresh already running.';

GRANT EXECUTE ON FUNCTION public.get_service_dashboard_timeline_stale_summary(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.try_refresh_service_dashboard_period_summaries(UUID, INT) TO authenticated;
