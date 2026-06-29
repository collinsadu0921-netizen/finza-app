-- ============================================================================
-- Dashboard service timeline — single-query ledger aggregates per period
-- ============================================================================
-- Replaces N× get_profit_and_loss_movement / getProfitAndLossReport calls from
-- GET /api/dashboard/service-timeline. Uses the same movement rules as migration
-- 490 (income/revenue = credit−debit; expense = debit−credit).
--
-- Default granularity: accounting_period (matches existing dashboard chart).
-- Optional calendar month buckets when p_granularity = 'month' and dates set.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_service_dashboard_timeline(
  p_business_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_granularity TEXT DEFAULT 'accounting_period',
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
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_granularity TEXT := lower(COALESCE(NULLIF(trim(p_granularity), ''), 'accounting_period'));
  v_limit INT := GREATEST(1, LEAST(COALESCE(p_periods_limit, 6), 24));
BEGIN
  IF v_granularity NOT IN ('accounting_period', 'month') THEN
    RAISE EXCEPTION 'Unsupported granularity: %', p_granularity;
  END IF;

  IF v_granularity = 'month' THEN
    IF p_start_date IS NULL OR p_end_date IS NULL THEN
      RAISE EXCEPTION 'p_start_date and p_end_date are required for month granularity';
    END IF;
    IF p_end_date < p_start_date THEN
      RAISE EXCEPTION 'p_end_date must be on or after p_start_date';
    END IF;

    RETURN QUERY
    WITH month_series AS (
      SELECT
        gs::date AS bucket_start,
        (date_trunc('month', gs::timestamp) + interval '1 month - 1 day')::date AS bucket_end
      FROM generate_series(
        date_trunc('month', p_start_date::timestamp)::date,
        date_trunc('month', p_end_date::timestamp)::date,
        interval '1 month'
      ) AS gs
    ),
    movement AS (
      SELECT
        ms.bucket_start,
        ms.bucket_end,
        ROUND(
          COALESCE(
            SUM(
              CASE
                WHEN a.type IN ('income', 'revenue') THEN jel.credit - jel.debit
                WHEN a.type = 'expense' THEN jel.debit - jel.credit
                ELSE 0::numeric
              END
            ),
            0
          ),
          2
        ) AS signed_total,
        a.type AS account_type
      FROM month_series ms
      LEFT JOIN journal_entries je
        ON je.business_id = p_business_id
       AND je.date >= ms.bucket_start
       AND je.date <= ms.bucket_end
      LEFT JOIN journal_entry_lines jel
        ON jel.journal_entry_id = je.id
      LEFT JOIN accounts a
        ON a.id = jel.account_id
       AND a.business_id = p_business_id
       AND a.deleted_at IS NULL
       AND a.type IN ('income', 'revenue', 'expense')
      GROUP BY ms.bucket_start, ms.bucket_end, a.type
    ),
    rolled AS (
      SELECT
        bucket_start,
        bucket_end,
        ROUND(COALESCE(SUM(signed_total) FILTER (WHERE account_type IN ('income', 'revenue')), 0), 2) AS rev,
        ROUND(COALESCE(SUM(signed_total) FILTER (WHERE account_type = 'expense'), 0), 2) AS exp
      FROM movement
      GROUP BY bucket_start, bucket_end
    )
    SELECT
      NULL::uuid AS period_id,
      r.bucket_start AS period_start,
      LEAST(r.bucket_end, p_end_date) AS period_end,
      r.rev AS revenue,
      r.exp AS expenses,
      ROUND(r.rev - r.exp, 2) AS net_profit
    FROM rolled r
    ORDER BY r.bucket_start ASC;

    RETURN;
  END IF;

  -- accounting_period granularity (dashboard default)
  RETURN QUERY
  WITH selected_periods AS (
    SELECT ap.id, ap.period_start, ap.period_end
    FROM accounting_periods ap
    WHERE ap.business_id = p_business_id
      AND (p_start_date IS NULL OR ap.period_end >= p_start_date)
      AND (p_end_date IS NULL OR ap.period_start <= p_end_date)
    ORDER BY ap.period_start DESC
    LIMIT v_limit
  ),
  ordered_periods AS (
    SELECT sp.id, sp.period_start, sp.period_end
    FROM selected_periods sp
    ORDER BY sp.period_start ASC
  ),
  movement AS (
    SELECT
      op.id AS pid,
      op.period_start AS pstart,
      op.period_end AS pend,
      ROUND(
        COALESCE(
          SUM(
            CASE
              WHEN a.type IN ('income', 'revenue') THEN jel.credit - jel.debit
              WHEN a.type = 'expense' THEN jel.debit - jel.credit
              ELSE 0::numeric
            END
          ),
          0
        ),
        2
      ) AS signed_total,
      a.type AS account_type
    FROM ordered_periods op
    LEFT JOIN journal_entries je
      ON je.business_id = p_business_id
     AND je.date >= op.period_start
     AND je.date <= op.period_end
    LEFT JOIN journal_entry_lines jel
      ON jel.journal_entry_id = je.id
    LEFT JOIN accounts a
      ON a.id = jel.account_id
     AND a.business_id = p_business_id
     AND a.deleted_at IS NULL
     AND a.type IN ('income', 'revenue', 'expense')
    GROUP BY op.id, op.period_start, op.period_end, a.type
  ),
  rolled AS (
    SELECT
      pid,
      pstart,
      pend,
      ROUND(COALESCE(SUM(signed_total) FILTER (WHERE account_type IN ('income', 'revenue')), 0), 2) AS rev,
      ROUND(COALESCE(SUM(signed_total) FILTER (WHERE account_type = 'expense'), 0), 2) AS exp
    FROM movement
    GROUP BY pid, pstart, pend
  )
  SELECT
    op.id AS period_id,
    op.period_start,
    op.period_end,
    COALESCE(r.rev, 0) AS revenue,
    COALESCE(r.exp, 0) AS expenses,
    ROUND(COALESCE(r.rev, 0) - COALESCE(r.exp, 0), 2) AS net_profit
  FROM ordered_periods op
  LEFT JOIN rolled r
    ON r.pid = op.id
  ORDER BY op.period_start ASC;
END;
$$;

COMMENT ON FUNCTION public.get_service_dashboard_timeline(UUID, DATE, DATE, TEXT, INT) IS
  'Ledger-derived dashboard timeline: revenue/expenses/net_profit per accounting period (default) or calendar month. Matches get_profit_and_loss_movement sign rules.';

GRANT EXECUTE ON FUNCTION public.get_service_dashboard_timeline(UUID, DATE, DATE, TEXT, INT) TO authenticated;
