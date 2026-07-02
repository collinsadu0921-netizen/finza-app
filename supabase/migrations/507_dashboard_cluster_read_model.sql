 ============================================================================
-- Dashboard cluster read-model (507) — timeline summaries + activity hot path
-- ============================================================================
-- Targets combined dashboard saturation: timeline ledger scan (~17s p95) and
-- activity journal nested-line fetch (500s under pool pressure).
-- Keeps 506 SQL baseline; journal remains authoritative for refresh.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Activity feed indexes (506 journal/inbound + resend received_at sort)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_resend_email_events_business_received_at
  ON public.resend_email_events (business_id, received_at DESC)
  WHERE business_id IS NOT NULL;

COMMENT ON INDEX idx_resend_email_events_business_received_at IS
  'Service activity feed: resend events by business + received_at (dashboard_activity route).';

-- ---------------------------------------------------------------------------
-- 2. Journal activity head — aggregated line totals in SQL (no PostgREST nest)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_service_dashboard_journal_activity(
  p_business_id UUID,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  created_at TIMESTAMPTZ,
  description TEXT,
  source_type TEXT,
  reference_type TEXT,
  reference_id UUID,
  journal_amount NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH limited AS (
    SELECT je.id
    FROM journal_entries je
    WHERE je.business_id = p_business_id
    ORDER BY je.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 20))
  )
  SELECT
    je.id,
    je.created_at,
    je.description,
    je.source_type,
    je.reference_type,
    je.reference_id,
    ROUND(COALESCE(GREATEST(agg.total_debit, agg.total_credit), 0), 2) AS journal_amount
  FROM limited l
  INNER JOIN journal_entries je ON je.id = l.id
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(jel.debit), 0) AS total_debit,
      COALESCE(SUM(jel.credit), 0) AS total_credit
    FROM journal_entry_lines jel
    WHERE jel.journal_entry_id = je.id
  ) agg ON TRUE
  ORDER BY je.created_at DESC;
$$;

COMMENT ON FUNCTION public.get_service_dashboard_journal_activity(UUID, INT) IS
  'Dashboard activity: recent journal entries with pre-aggregated line amounts (avoids nested PostgREST fetch).';

-- ---------------------------------------------------------------------------
-- 3. Period summary table (timeline read model)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_dashboard_period_summary (
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES public.accounting_periods(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  revenue NUMERIC NOT NULL DEFAULT 0,
  expenses NUMERIC NOT NULL DEFAULT 0,
  net_profit NUMERIC NOT NULL DEFAULT 0,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, period_id)
);

CREATE INDEX IF NOT EXISTS idx_service_dashboard_period_summary_business_start
  ON public.service_dashboard_period_summary (business_id, period_start ASC);

COMMENT ON TABLE public.service_dashboard_period_summary IS
  'Precomputed P&L movement per accounting period for dashboard timeline reads.';

ALTER TABLE public.service_dashboard_period_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_dashboard_period_summary_select ON public.service_dashboard_period_summary;
CREATE POLICY service_dashboard_period_summary_select
  ON public.service_dashboard_period_summary FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

GRANT SELECT ON public.service_dashboard_period_summary TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Refresh period summaries (advisory lock, uses finza_dashboard_pnl_totals)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_service_dashboard_period_summaries(
  p_business_id UUID,
  p_periods_limit INT DEFAULT 6
)
RETURNS INT
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

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.refresh_service_dashboard_period_summaries(UUID, INT) IS
  'Upserts dashboard period summaries from finza_dashboard_pnl_totals. Advisory lock per business.';

-- ---------------------------------------------------------------------------
-- 5. Timeline read from summary (fresh rows only)
-- ---------------------------------------------------------------------------
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
      AND s.refreshed_at >= NOW() - (GREATEST(COALESCE(p_max_stale_seconds, 300), 60) || ' seconds')::interval
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

COMMENT ON FUNCTION public.get_service_dashboard_timeline_from_summary(UUID, INT, INT) IS
  'Dashboard timeline from period summary when refreshed within p_max_stale_seconds.';

GRANT EXECUTE ON FUNCTION public.get_service_dashboard_journal_activity(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_service_dashboard_period_summaries(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_service_dashboard_timeline_from_summary(UUID, INT, INT) TO authenticated;
