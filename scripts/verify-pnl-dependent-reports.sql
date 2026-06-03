-- Phase 3 verification: canonical P&L net profit vs Cash Flow / Equity Changes net income.
-- Replace business_id and dates before running in Supabase SQL editor.

WITH params AS (
  SELECT
    '00000000-0000-0000-0000-000000000001'::uuid AS business_id,
    '2026-01-01'::date AS start_date,
    '2026-01-31'::date AS end_date
),
pnl AS (
  SELECT
    COALESCE(SUM(period_total) FILTER (WHERE account_type IN ('income', 'revenue')), 0)
    - COALESCE(SUM(period_total) FILTER (WHERE account_type = 'expense'), 0) AS net_profit
  FROM get_profit_and_loss_movement(
    (SELECT business_id FROM params),
    (SELECT start_date FROM params),
    (SELECT end_date FROM params)
  )
)
SELECT
  pnl.net_profit AS canonical_pnl_net_profit,
  'Compare in app: Cash Flow operating "Net profit for the period" and Equity Changes totals.net_profit' AS note,
  'PASS when both equal canonical_pnl_net_profit for same business/period' AS expected
FROM pnl;
