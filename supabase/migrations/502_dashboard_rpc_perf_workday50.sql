-- ============================================================================
-- Dashboard RPC performance (workday_50 remediation)
-- ============================================================================
-- Root cause: get_service_dashboard_metrics called get_balance_sheet_as_of,
-- which scanned all accounts LEFT JOIN cumulative journal lines per request.
-- Timeline RPC repeated period-scoped journal scans (N × ledger pass).
--
-- Fixes:
--   1. finza_dashboard_positions_as_of — journal-first aggregation (no full BS)
--   2. get_cash_collected_total — journal-first join order
--   3. get_service_dashboard_timeline — single ledger pass, bucket by period date
--   4. Indexes for activity feed + cash account lookups
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Dashboard position KPIs (cash / AR / AP) without full balance sheet
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finza_dashboard_positions_as_of(
  p_business_id UUID,
  p_as_of_date DATE
)
RETURNS TABLE (
  cash_balance NUMERIC,
  accounts_receivable NUMERIC,
  accounts_payable NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH line_balances AS (
    SELECT
      a.code,
      a.type,
      CASE
        WHEN a.type = 'asset' THEN
          COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)
        WHEN a.type = 'contra_asset' THEN
          -(
            COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)
          )
        WHEN a.type IN ('liability', 'equity') THEN
          COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)
        ELSE 0::numeric
      END AS balance
    FROM journal_entries je
    INNER JOIN journal_entry_lines jel
      ON jel.journal_entry_id = je.id
    INNER JOIN accounts a
      ON a.id = jel.account_id
     AND a.business_id = p_business_id
     AND a.deleted_at IS NULL
     AND a.type IN ('asset', 'contra_asset', 'liability', 'equity')
    WHERE je.business_id = p_business_id
      AND je.date <= p_as_of_date
    GROUP BY a.id, a.code, a.type
  )
  SELECT
    ROUND(COALESCE(SUM(lb.balance) FILTER (
      WHERE lb.code IN ('1000', '1010', '1020', '1030')
    ), 0), 2) AS cash_balance,
    ROUND(COALESCE(MAX(lb.balance) FILTER (
      WHERE lb.code = '1100'
    ), 0), 2) AS accounts_receivable,
    ROUND(COALESCE(SUM(lb.balance) FILTER (
      WHERE lb.type = 'liability'
        AND lb.code ~ '^\d+$'
        AND lb.code::integer >= 2000
        AND lb.code::integer < 2500
    ), 0), 2) AS accounts_payable
  FROM line_balances lb;
$$;

COMMENT ON FUNCTION public.finza_dashboard_positions_as_of(UUID, DATE) IS
  'Dashboard KPI positions: journal-first cumulative balances for cash/AR/AP. Avoids full get_balance_sheet_as_of scan.';

-- ---------------------------------------------------------------------------
-- 2. Cash collected — journal-first (uses business_id + date index)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_cash_collected_total(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    ROUND(SUM(jel.debit)::NUMERIC, 2),
    0
  )
  FROM journal_entries je
  INNER JOIN journal_entry_lines jel
    ON jel.journal_entry_id = je.id
  INNER JOIN accounts a
    ON a.id = jel.account_id
   AND a.business_id = p_business_id
   AND a.code IN ('1000', '1010', '1020', '1030')
   AND a.deleted_at IS NULL
  WHERE je.business_id = p_business_id
    AND je.date >= p_start_date
    AND je.date <= p_end_date;
$$;

-- ---------------------------------------------------------------------------
-- 3. Timeline — one ledger pass across selected periods
-- ---------------------------------------------------------------------------
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
        je.date AS entry_date,
        SUM(
          CASE
            WHEN a.type IN ('income', 'revenue') THEN jel.credit - jel.debit
            WHEN a.type = 'expense' THEN jel.debit - jel.credit
            ELSE 0::numeric
          END
        ) AS signed_total,
        a.type AS account_type
      FROM journal_entries je
      INNER JOIN journal_entry_lines jel
        ON jel.journal_entry_id = je.id
      INNER JOIN accounts a
        ON a.id = jel.account_id
       AND a.business_id = p_business_id
       AND a.deleted_at IS NULL
       AND a.type IN ('income', 'revenue', 'expense')
      WHERE je.business_id = p_business_id
        AND je.date >= p_start_date
        AND je.date <= p_end_date
      GROUP BY je.date, a.type
    ),
    rolled AS (
      SELECT
        ms.bucket_start,
        ms.bucket_end,
        ROUND(COALESCE(SUM(m.signed_total) FILTER (WHERE m.account_type IN ('income', 'revenue')), 0), 2) AS rev,
        ROUND(COALESCE(SUM(m.signed_total) FILTER (WHERE m.account_type = 'expense'), 0), 2) AS exp
      FROM month_series ms
      LEFT JOIN movement m
        ON m.entry_date >= ms.bucket_start
       AND m.entry_date <= ms.bucket_end
      GROUP BY ms.bucket_start, ms.bucket_end
    )
    SELECT
      NULL::uuid,
      r.bucket_start,
      LEAST(r.bucket_end, p_end_date),
      r.rev,
      r.exp,
      ROUND(r.rev - r.exp, 2)
    FROM rolled r
    ORDER BY r.bucket_start ASC;

    RETURN;
  END IF;

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
  bounds AS (
    SELECT
      MIN(op.period_start) AS min_date,
      MAX(op.period_end) AS max_date
    FROM ordered_periods op
  ),
  movement AS (
    SELECT
      je.date AS entry_date,
      SUM(
        CASE
          WHEN a.type IN ('income', 'revenue') THEN jel.credit - jel.debit
          WHEN a.type = 'expense' THEN jel.debit - jel.credit
          ELSE 0::numeric
        END
      ) AS signed_total,
      a.type AS account_type
    FROM journal_entries je
    CROSS JOIN bounds b
    INNER JOIN journal_entry_lines jel
      ON jel.journal_entry_id = je.id
    INNER JOIN accounts a
      ON a.id = jel.account_id
     AND a.business_id = p_business_id
     AND a.deleted_at IS NULL
     AND a.type IN ('income', 'revenue', 'expense')
    WHERE je.business_id = p_business_id
      AND b.min_date IS NOT NULL
      AND je.date >= b.min_date
      AND je.date <= b.max_date
    GROUP BY je.date, a.type
  ),
  rolled AS (
    SELECT
      op.id AS pid,
      op.period_start AS pstart,
      op.period_end AS pend,
      ROUND(COALESCE(SUM(m.signed_total) FILTER (WHERE m.account_type IN ('income', 'revenue')), 0), 2) AS rev,
      ROUND(COALESCE(SUM(m.signed_total) FILTER (WHERE m.account_type = 'expense'), 0), 2) AS exp
    FROM ordered_periods op
    LEFT JOIN movement m
      ON m.entry_date >= op.period_start
     AND m.entry_date <= op.period_end
    GROUP BY op.id, op.period_start, op.period_end
  )
  SELECT
    op.id,
    op.period_start,
    op.period_end,
    COALESCE(r.rev, 0),
    COALESCE(r.exp, 0),
    ROUND(COALESCE(r.rev, 0) - COALESCE(r.exp, 0), 2)
  FROM ordered_periods op
  LEFT JOIN rolled r
    ON r.pid = op.id
  ORDER BY op.period_start ASC;
END;
$$;

COMMENT ON FUNCTION public.get_service_dashboard_timeline(UUID, DATE, DATE, TEXT, INT) IS
  'Ledger-derived dashboard timeline. accounting_period mode uses one journal pass across selected periods.';

-- ---------------------------------------------------------------------------
-- 4. Supporting indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_journal_entries_business_created_at
  ON public.journal_entries (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_accounts_business_code_cash
  ON public.accounts (business_id, code)
  WHERE deleted_at IS NULL
    AND code IN ('1000', '1010', '1020', '1030', '1100');

COMMENT ON INDEX idx_journal_entries_business_created_at IS
  'Service activity feed: recent journal_entries by business.';

COMMENT ON INDEX idx_accounts_business_code_cash IS
  'Dashboard cash/AR account lookups for get_cash_collected_total and position KPIs.';
