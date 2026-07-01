-- ============================================================================
-- Restore dashboard timeline first-load correctness (509)
-- ============================================================================
-- Fixes 508 regression: refresh RPCs were SECURITY INVOKER with SELECT-only RLS
-- on service_dashboard_period_summary, so upserts silently failed and timeline
-- returned []. Refresh functions run as DEFINER; ledger probe for empty fallback.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Ledger movement probe (for app empty-vs-fallback decisions)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_service_dashboard_business_has_ledger_movement(
  p_business_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM journal_entries je
    WHERE je.business_id = p_business_id
    LIMIT 1
  );
$$;

COMMENT ON FUNCTION public.get_service_dashboard_business_has_ledger_movement(UUID) IS
  'True when business has at least one journal entry (timeline should not stay empty).';

-- ---------------------------------------------------------------------------
-- 2. Blocking refresh — SECURITY DEFINER (first-load population)
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

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.refresh_service_dashboard_period_summaries(UUID, INT) IS
  'Blocking upsert of period summaries. SECURITY DEFINER with business access check.';

-- ---------------------------------------------------------------------------
-- 3. Non-blocking refresh — SECURITY DEFINER (background refresh under load)
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
  'Non-blocking summary refresh. SECURITY DEFINER with business access check.';

GRANT EXECUTE ON FUNCTION public.get_service_dashboard_business_has_ledger_movement(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_service_dashboard_period_summaries(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.try_refresh_service_dashboard_period_summaries(UUID, INT) TO authenticated;
