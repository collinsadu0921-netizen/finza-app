-- ============================================================================
-- Dashboard service metrics — consolidated KPI RPC
-- ============================================================================
-- Replaces per-request P&L + balance sheet + cash RPC fan-out from
-- GET /api/dashboard/service-metrics. Reuses get_balance_sheet_as_of (486)
-- for position extraction and get_cash_collected_total (497) for cash inflow.
-- P&L movement sign rules match get_profit_and_loss_movement (490).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.finza_dashboard_pnl_totals(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  revenue NUMERIC,
  expenses NUMERIC,
  net_profit NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
    ROUND(
      COALESCE(SUM(
        CASE
          WHEN a.type IN ('income', 'revenue') THEN jel.credit - jel.debit
          WHEN a.type = 'expense' THEN -(jel.debit - jel.credit)
          ELSE 0::numeric
        END
      ), 0),
      2
    ) AS net_profit
  FROM journal_entries je
  JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
  JOIN accounts a
    ON a.id = jel.account_id
   AND a.business_id = p_business_id
   AND a.deleted_at IS NULL
   AND a.type IN ('income', 'revenue', 'expense')
  WHERE je.business_id = p_business_id
    AND je.date >= p_start_date
    AND je.date <= p_end_date;
$$;

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
  WITH bs AS (
    SELECT account_code, account_type, balance
    FROM get_balance_sheet_as_of(p_business_id, p_as_of_date)
  )
  SELECT
    ROUND(COALESCE(SUM(bs.balance) FILTER (
      WHERE bs.account_code IN ('1000', '1010', '1020', '1030')
    ), 0), 2) AS cash_balance,
    ROUND(COALESCE(MAX(bs.balance) FILTER (
      WHERE bs.account_code = '1100'
    ), 0), 2) AS accounts_receivable,
    ROUND(COALESCE(SUM(bs.balance) FILTER (
      WHERE bs.account_type = 'liability'
        AND bs.account_code ~ '^\d+$'
        AND bs.account_code::integer >= 2000
        AND bs.account_code::integer < 2500
    ), 0), 2) AS accounts_payable
  FROM bs;
$$;

CREATE OR REPLACE FUNCTION public.get_service_dashboard_metrics(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_position_as_of_date DATE,
  p_compare_start_date DATE DEFAULT NULL,
  p_compare_end_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_currency TEXT;
  v_revenue NUMERIC;
  v_expenses NUMERIC;
  v_net_profit NUMERIC;
  v_cash_collected NUMERIC;
  v_cash_balance NUMERIC;
  v_ar NUMERIC;
  v_ap NUMERIC;
  v_prev_revenue NUMERIC;
  v_prev_expenses NUMERIC;
  v_prev_net_profit NUMERIC;
  v_prev_cash_balance NUMERIC;
  v_prev_ar NUMERIC;
  v_prev_ap NUMERIC;
  v_result JSONB;
BEGIN
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'p_end_date must be on or after p_start_date';
  END IF;

  SELECT COALESCE(b.default_currency, 'GHS')
  INTO v_currency
  FROM businesses b
  WHERE b.id = p_business_id;

  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'Business not found: %', p_business_id;
  END IF;

  SELECT p.revenue, p.expenses, p.net_profit
  INTO v_revenue, v_expenses, v_net_profit
  FROM finza_dashboard_pnl_totals(p_business_id, p_start_date, p_end_date) p;

  v_cash_collected := get_cash_collected_total(p_business_id, p_start_date, p_end_date);

  SELECT pos.cash_balance, pos.accounts_receivable, pos.accounts_payable
  INTO v_cash_balance, v_ar, v_ap
  FROM finza_dashboard_positions_as_of(p_business_id, p_position_as_of_date) pos;

  v_result := jsonb_build_object(
    'currency_code', v_currency,
    'revenue', COALESCE(v_revenue, 0),
    'expenses', COALESCE(v_expenses, 0),
    'net_profit', COALESCE(v_net_profit, 0),
    'cash_collected', COALESCE(v_cash_collected, 0),
    'cash_balance', COALESCE(v_cash_balance, 0),
    'accounts_receivable', COALESCE(v_ar, 0),
    'accounts_payable', COALESCE(v_ap, 0)
  );

  IF p_compare_start_date IS NOT NULL AND p_compare_end_date IS NOT NULL THEN
    IF p_compare_end_date < p_compare_start_date THEN
      RAISE EXCEPTION 'p_compare_end_date must be on or after p_compare_start_date';
    END IF;

    SELECT p.revenue, p.expenses, p.net_profit
    INTO v_prev_revenue, v_prev_expenses, v_prev_net_profit
    FROM finza_dashboard_pnl_totals(
      p_business_id, p_compare_start_date, p_compare_end_date
    ) p;

    SELECT pos.cash_balance, pos.accounts_receivable, pos.accounts_payable
    INTO v_prev_cash_balance, v_prev_ar, v_prev_ap
    FROM finza_dashboard_positions_as_of(p_business_id, p_compare_end_date) pos;

    v_result := v_result || jsonb_build_object(
      'previous_revenue', COALESCE(v_prev_revenue, 0),
      'previous_expenses', COALESCE(v_prev_expenses, 0),
      'previous_net_profit', COALESCE(v_prev_net_profit, 0),
      'previous_cash_collected', 0,
      'previous_cash_balance', COALESCE(v_prev_cash_balance, 0),
      'previous_accounts_receivable', COALESCE(v_prev_ar, 0),
      'previous_accounts_payable', COALESCE(v_prev_ap, 0)
    );
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_service_dashboard_metrics(UUID, DATE, DATE, DATE, DATE, DATE) IS
  'Consolidated service dashboard KPIs: P&L movement, cash collected, balance-sheet positions. Optional previous-period comparison.';

GRANT EXECUTE ON FUNCTION public.finza_dashboard_pnl_totals(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finza_dashboard_positions_as_of(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_service_dashboard_metrics(UUID, DATE, DATE, DATE, DATE, DATE) TO authenticated;
