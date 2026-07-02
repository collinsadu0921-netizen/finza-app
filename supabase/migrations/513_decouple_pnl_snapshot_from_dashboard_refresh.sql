-- ============================================================================
-- Decouple P&L movement snapshot from dashboard summary refresh (513)
-- ============================================================================
-- 512 coupled line-level P&L rebuild into refresh_service_dashboard_period_summaries,
-- doubling ledger work on every dashboard timeline refresh under load.
-- 513 restores 509-era dashboard refresh and adds a reports-only P&L snapshot path.
-- ============================================================================

COMMENT ON TABLE public.service_pnl_movement_lines IS
  'Precomputed get_profit_and_loss_movement rows per period — reports_pnl read-through only (513).';

-- ---------------------------------------------------------------------------
-- 1. Dashboard summary refresh — 509 baseline (no P&L line rebuild)
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
  'Blocking upsert of dashboard period summaries only (513). No P&L line snapshot rebuild.';

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
  'Non-blocking dashboard summary refresh only (513). No P&L line snapshot rebuild.';

-- ---------------------------------------------------------------------------
-- 2. Reports-only P&L movement snapshot refresh (separate advisory lock)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_service_pnl_movement_snapshot(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_id UUID;
  v_period_start DATE;
  v_period_end DATE;
BEGIN
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'p_end_date must be on or after p_start_date';
  END IF;

  IF NOT public.finza_user_can_access_business(p_business_id) THEN
    RAISE EXCEPTION 'Access denied for business %', p_business_id;
  END IF;

  SELECT ap.id, ap.period_start, ap.period_end
  INTO v_period_id, v_period_start, v_period_end
  FROM accounting_periods ap
  WHERE ap.business_id = p_business_id
    AND ap.period_start = p_start_date
    AND ap.period_end = p_end_date
  LIMIT 1;

  IF v_period_id IS NULL THEN
    SELECT ap.id, ap.period_start, ap.period_end
    INTO v_period_id, v_period_start, v_period_end
    FROM accounting_periods ap
    WHERE ap.business_id = p_business_id
      AND ap.period_start <= p_end_date
      AND ap.period_end >= p_start_date
    ORDER BY ap.period_start DESC
    LIMIT 1;
  END IF;

  IF v_period_id IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_business_id::text, 51301));

  PERFORM public._upsert_service_pnl_movement_lines(
    p_business_id,
    v_period_id,
    v_period_start,
    v_period_end
  );

  RETURN 1;
END;
$$;

COMMENT ON FUNCTION public.refresh_service_pnl_movement_snapshot(UUID, DATE, DATE) IS
  'Blocking rebuild of service_pnl_movement_lines for one period — reports_pnl only (513).';

CREATE OR REPLACE FUNCTION public.try_refresh_service_pnl_movement_snapshot(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_id UUID;
  v_period_start DATE;
  v_period_end DATE;
BEGIN
  IF p_end_date < p_start_date THEN
    RETURN jsonb_build_object(
      'refreshed', false,
      'lock_held', false,
      'period_count', 0,
      'error', 'invalid_date_range'
    );
  END IF;

  IF NOT public.finza_user_can_access_business(p_business_id) THEN
    RETURN jsonb_build_object(
      'refreshed', false,
      'lock_held', false,
      'period_count', 0,
      'error', 'access_denied'
    );
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_business_id::text, 51301)) THEN
    RETURN jsonb_build_object(
      'refreshed', false,
      'lock_held', true,
      'period_count', 0
    );
  END IF;

  SELECT ap.id, ap.period_start, ap.period_end
  INTO v_period_id, v_period_start, v_period_end
  FROM accounting_periods ap
  WHERE ap.business_id = p_business_id
    AND ap.period_start = p_start_date
    AND ap.period_end = p_end_date
  LIMIT 1;

  IF v_period_id IS NULL THEN
    SELECT ap.id, ap.period_start, ap.period_end
    INTO v_period_id, v_period_start, v_period_end
    FROM accounting_periods ap
    WHERE ap.business_id = p_business_id
      AND ap.period_start <= p_end_date
      AND ap.period_end >= p_start_date
    ORDER BY ap.period_start DESC
    LIMIT 1;
  END IF;

  IF v_period_id IS NULL THEN
    RETURN jsonb_build_object(
      'refreshed', false,
      'lock_held', false,
      'period_count', 0,
      'error', 'period_not_found'
    );
  END IF;

  PERFORM public._upsert_service_pnl_movement_lines(
    p_business_id,
    v_period_id,
    v_period_start,
    v_period_end
  );

  RETURN jsonb_build_object(
    'refreshed', true,
    'lock_held', false,
    'period_count', 1
  );
END;
$$;

COMMENT ON FUNCTION public.try_refresh_service_pnl_movement_snapshot(UUID, DATE, DATE) IS
  'Non-blocking P&L line snapshot refresh for reports_pnl (513).';

GRANT EXECUTE ON FUNCTION public.refresh_service_dashboard_period_summaries(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.try_refresh_service_dashboard_period_summaries(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_service_pnl_movement_snapshot(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.try_refresh_service_pnl_movement_snapshot(UUID, DATE, DATE) TO authenticated;
