-- Verify P&L report movement matches direct journal aggregation for a business/range.
-- Replace placeholders before running in Supabase SQL editor.

-- :business_id  UUID
-- :start_date   DATE  e.g. '2026-01-01'
-- :end_date     DATE  e.g. '2026-03-31'

WITH params AS (
  SELECT
    '00000000-0000-0000-0000-000000000001'::uuid AS business_id,
    '2026-01-01'::date AS start_date,
    '2026-03-31'::date AS end_date
),
report AS (
  SELECT
    COALESCE(SUM(period_total) FILTER (WHERE account_type IN ('income', 'revenue')), 0) AS report_revenue,
    COALESCE(SUM(period_total) FILTER (WHERE account_type = 'expense'), 0) AS report_expenses
  FROM get_profit_and_loss_movement(
    (SELECT business_id FROM params),
    (SELECT start_date FROM params),
    (SELECT end_date FROM params)
  )
),
direct AS (
  SELECT
    COALESCE(SUM(
      CASE WHEN a.type IN ('income', 'revenue') THEN jel.credit - jel.debit ELSE 0 END
    ), 0) AS direct_revenue,
    COALESCE(SUM(
      CASE WHEN a.type = 'expense' THEN jel.debit - jel.credit ELSE 0 END
    ), 0) AS direct_expenses
  FROM journal_entries je
  JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
  JOIN accounts a ON a.id = jel.account_id AND a.business_id = je.business_id
  CROSS JOIN params p
  WHERE je.business_id = p.business_id
    AND je.date >= p.start_date
    AND je.date <= p.end_date
    AND a.deleted_at IS NULL
    AND a.type IN ('income', 'revenue', 'expense')
)
SELECT
  report.report_revenue,
  direct.direct_revenue,
  report.report_revenue - direct.direct_revenue AS revenue_delta,
  report.report_expenses,
  direct.direct_expenses,
  report.report_expenses - direct.direct_expenses AS expenses_delta,
  (report.report_revenue - report.report_expenses) AS report_net_profit,
  (direct.direct_revenue - direct.direct_expenses) AS direct_net_profit,
  (report.report_revenue - report.report_expenses)
    - (direct.direct_revenue - direct.direct_expenses) AS net_profit_delta,
  CASE
    WHEN ABS(report.report_revenue - direct.direct_revenue) < 0.01
     AND ABS(report.report_expenses - direct.direct_expenses) < 0.01
     AND ABS(
       (report.report_revenue - report.report_expenses)
       - (direct.direct_revenue - direct.direct_expenses)
     ) < 0.01
    THEN 'PASS'
    ELSE 'FAIL'
  END AS result
FROM report, direct;
