-- ============================================================================
-- Dashboard metrics hot-path (workday_50 round 2)
-- ============================================================================
-- 502 removed get_balance_sheet_as_of but get_service_dashboard_metrics still
-- invoked 3 sequential ledger scans per request (pnl, cash, positions).
-- Positions scan still touched all asset/liability/equity lines cumulatively.
--
-- 503:
--   1. finza_dashboard_positions_as_of — only KPI account codes (cash/AR/AP band)
--   2. get_service_dashboard_metrics — single SQL, 2 CTE scans (period + positions)
-- ============================================================================

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
  SELECT
    ROUND(COALESCE(SUM(
      CASE
        WHEN a.code IN ('1000', '1010', '1020', '1030') AND a.type = 'asset'
          THEN jel.debit - jel.credit
        ELSE 0::numeric
      END
    ), 0), 2) AS cash_balance,
    ROUND(COALESCE(MAX(
      CASE
        WHEN a.code = '1100' AND a.type = 'asset'
          THEN jel.debit - jel.credit
        ELSE NULL::numeric
      END
    ), 0), 2) AS accounts_receivable,
    ROUND(COALESCE(SUM(
      CASE
        WHEN a.type = 'liability'
          AND a.code ~ '^\d+$'
          AND a.code::integer >= 2000
          AND a.code::integer < 2500
          THEN jel.credit - jel.debit
        ELSE 0::numeric
      END
    ), 0), 2) AS accounts_payable
  FROM journal_entries je
  INNER JOIN journal_entry_lines jel
    ON jel.journal_entry_id = je.id
  INNER JOIN accounts a
    ON a.id = jel.account_id
   AND a.business_id = p_business_id
   AND a.deleted_at IS NULL
   AND (
     a.code IN ('1000', '1010', '1020', '1030', '1100')
     OR (
       a.type = 'liability'
       AND a.code ~ '^\d+$'
       AND a.code::integer >= 2000
       AND a.code::integer < 2500
     )
   )
  WHERE je.business_id = p_business_id
    AND je.date <= p_as_of_date;
$$;

COMMENT ON FUNCTION public.finza_dashboard_positions_as_of(UUID, DATE) IS
  'Dashboard KPI positions: cumulative cash/AR/AP only — restricted account codes, no full balance sheet.';

CREATE OR REPLACE FUNCTION public.get_service_dashboard_metrics(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_position_as_of_date DATE,
  p_compare_start_date DATE DEFAULT NULL,
  p_compare_end_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH biz AS (
    SELECT COALESCE(b.default_currency, 'GHS') AS currency_code
    FROM businesses b
    WHERE b.id = p_business_id
  ),
  period_agg AS (
    SELECT
      ROUND(COALESCE(SUM(
        CASE
          WHEN a.type IN ('income', 'revenue') THEN jel.credit - jel.debit
          ELSE 0::numeric
        END
      ), 0), 2) AS revenue,
      ROUND(COALESCE(SUM(
        CASE
          WHEN a.type = 'expense' THEN jel.debit - jel.credit
          ELSE 0::numeric
        END
      ), 0), 2) AS expenses,
      ROUND(COALESCE(SUM(
        CASE
          WHEN a.code IN ('1000', '1010', '1020', '1030') THEN jel.debit
          ELSE 0::numeric
        END
      ), 0), 2) AS cash_collected
    FROM journal_entries je
    INNER JOIN journal_entry_lines jel
      ON jel.journal_entry_id = je.id
    INNER JOIN accounts a
      ON a.id = jel.account_id
     AND a.business_id = p_business_id
     AND a.deleted_at IS NULL
     AND (
       a.type IN ('income', 'revenue', 'expense')
       OR a.code IN ('1000', '1010', '1020', '1030')
     )
    WHERE je.business_id = p_business_id
      AND p_end_date >= p_start_date
      AND je.date >= p_start_date
      AND je.date <= p_end_date
  ),
  position_agg AS (
    SELECT
      pos.cash_balance,
      pos.accounts_receivable,
      pos.accounts_payable
    FROM finza_dashboard_positions_as_of(p_business_id, p_position_as_of_date) pos
  ),
  compare_period_agg AS (
    SELECT
      ROUND(COALESCE(SUM(
        CASE
          WHEN a.type IN ('income', 'revenue') THEN jel.credit - jel.debit
          ELSE 0::numeric
        END
      ), 0), 2) AS revenue,
      ROUND(COALESCE(SUM(
        CASE
          WHEN a.type = 'expense' THEN jel.debit - jel.credit
          ELSE 0::numeric
        END
      ), 0), 2) AS expenses
    FROM journal_entries je
    INNER JOIN journal_entry_lines jel
      ON jel.journal_entry_id = je.id
    INNER JOIN accounts a
      ON a.id = jel.account_id
     AND a.business_id = p_business_id
     AND a.deleted_at IS NULL
     AND a.type IN ('income', 'revenue', 'expense')
    WHERE je.business_id = p_business_id
      AND p_compare_start_date IS NOT NULL
      AND p_compare_end_date IS NOT NULL
      AND p_compare_end_date >= p_compare_start_date
      AND je.date >= p_compare_start_date
      AND je.date <= p_compare_end_date
  ),
  compare_position_agg AS (
    SELECT
      pos.cash_balance,
      pos.accounts_receivable,
      pos.accounts_payable
    FROM finza_dashboard_positions_as_of(p_business_id, p_compare_end_date) pos
    WHERE p_compare_start_date IS NOT NULL
      AND p_compare_end_date IS NOT NULL
      AND p_compare_end_date >= p_compare_start_date
  )
  SELECT
    jsonb_build_object(
      'currency_code', COALESCE((SELECT currency_code FROM biz), 'GHS'),
      'revenue', COALESCE((SELECT revenue FROM period_agg), 0),
      'expenses', COALESCE((SELECT expenses FROM period_agg), 0),
      'net_profit', ROUND(
        COALESCE((SELECT revenue FROM period_agg), 0)
        - COALESCE((SELECT expenses FROM period_agg), 0),
        2
      ),
      'cash_collected', COALESCE((SELECT cash_collected FROM period_agg), 0),
      'cash_balance', COALESCE((SELECT cash_balance FROM position_agg), 0),
      'accounts_receivable', COALESCE((SELECT accounts_receivable FROM position_agg), 0),
      'accounts_payable', COALESCE((SELECT accounts_payable FROM position_agg), 0)
    )
    || CASE
      WHEN p_compare_start_date IS NOT NULL AND p_compare_end_date IS NOT NULL THEN
        jsonb_build_object(
          'previous_revenue', COALESCE((SELECT revenue FROM compare_period_agg), 0),
          'previous_expenses', COALESCE((SELECT expenses FROM compare_period_agg), 0),
          'previous_net_profit', ROUND(
            COALESCE((SELECT revenue FROM compare_period_agg), 0)
            - COALESCE((SELECT expenses FROM compare_period_agg), 0),
            2
          ),
          'previous_cash_collected', 0,
          'previous_cash_balance', COALESCE((SELECT cash_balance FROM compare_position_agg), 0),
          'previous_accounts_receivable', COALESCE((SELECT accounts_receivable FROM compare_position_agg), 0),
          'previous_accounts_payable', COALESCE((SELECT accounts_payable FROM compare_position_agg), 0)
        )
      ELSE '{}'::jsonb
    END;
$$;

COMMENT ON FUNCTION public.get_service_dashboard_metrics(UUID, DATE, DATE, DATE, DATE, DATE) IS
  'Dashboard KPIs: one period ledger pass (P&L + cash collected) + filtered cumulative positions. Optional compare period.';

GRANT EXECUTE ON FUNCTION public.finza_dashboard_positions_as_of(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_service_dashboard_metrics(UUID, DATE, DATE, DATE, DATE, DATE) TO authenticated;
