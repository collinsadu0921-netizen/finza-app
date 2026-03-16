-- ============================================================================
-- Service Financial Flow v2: ledger-derived analytics timeline (read-only)
-- ============================================================================
-- Purpose: Aggregate journal_entries + journal_entry_lines + accounts by
-- date bucket for Service dashboard chart. Does NOT touch trial_balance_snapshots,
-- get_profit_and_loss_from_trial_balance, or any accounting report.
-- Scope: New RPC only. No changes to posting, periods, or reconciliation.
-- ============================================================================

-- Cash/bank account codes for "cash movement" metric.
-- TODO: Replace with control mapping (e.g. CASH, BANK) or is_reconcilable when available.
CREATE OR REPLACE FUNCTION get_service_analytics_timeline(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_interval TEXT DEFAULT 'day'
)
RETURNS TABLE (
  period_start DATE,
  period_end DATE,
  revenue NUMERIC,
  expenses NUMERIC,
  net_profit NUMERIC,
  cash_movement NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_interval TEXT := LOWER(TRIM(COALESCE(NULLIF(p_interval, ''), 'day')));
  v_cash_codes TEXT[] := ARRAY['1000','1010','1020','1100'];
BEGIN
  IF v_interval NOT IN ('day', 'week', 'month') THEN
    v_interval := 'day';
  END IF;

  RETURN QUERY
  WITH je_filtered AS (
    SELECT id, date
    FROM journal_entries
    WHERE business_id = p_business_id
      AND date >= p_start_date
      AND date <= p_end_date
  ),
  buckets AS (
    SELECT
      CASE v_interval
        WHEN 'day'   THEN je.date
        WHEN 'week'  THEN (date_trunc('week', je.date)::DATE)
        WHEN 'month' THEN (date_trunc('month', je.date)::DATE)
        ELSE je.date
      END AS bucket_start
    FROM je_filtered je
    GROUP BY 1
  ),
  line_totals AS (
    SELECT
      CASE v_interval
        WHEN 'day'   THEN je.date
        WHEN 'week'  THEN (date_trunc('week', je.date)::DATE)
        WHEN 'month' THEN (date_trunc('month', je.date)::DATE)
        ELSE je.date
      END AS bucket_start,
      SUM(CASE WHEN a.type = 'income'  THEN (COALESCE(jel.credit, 0) - COALESCE(jel.debit, 0)) ELSE 0 END) AS rev,
      SUM(CASE WHEN a.type = 'expense' THEN (COALESCE(jel.debit, 0) - COALESCE(jel.credit, 0)) ELSE 0 END) AS exp,
      SUM(CASE WHEN a.type = 'asset' AND TRIM(a.code) = ANY(v_cash_codes)
               THEN (COALESCE(jel.debit, 0) - COALESCE(jel.credit, 0)) ELSE 0 END) AS cash
    FROM je_filtered je
    JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
    JOIN accounts a ON a.id = jel.account_id AND a.business_id = p_business_id AND a.deleted_at IS NULL
    GROUP BY
      CASE v_interval
        WHEN 'day'   THEN je.date
        WHEN 'week'  THEN (date_trunc('week', je.date)::DATE)
        WHEN 'month' THEN (date_trunc('month', je.date)::DATE)
        ELSE je.date
      END
  )
  SELECT
    b.bucket_start AS period_start,
    (CASE v_interval
      WHEN 'day'   THEN b.bucket_start
      WHEN 'week'  THEN (b.bucket_start + INTERVAL '6 days')::DATE
      WHEN 'month' THEN (b.bucket_start + INTERVAL '1 month - 1 day')::DATE
      ELSE b.bucket_start
    END)::DATE AS period_end,
    ROUND(COALESCE(lt.rev, 0)::NUMERIC, 2) AS revenue,
    ROUND(COALESCE(lt.exp, 0)::NUMERIC, 2) AS expenses,
    ROUND((COALESCE(lt.rev, 0) - COALESCE(lt.exp, 0))::NUMERIC, 2) AS net_profit,
    ROUND(COALESCE(lt.cash, 0)::NUMERIC, 2) AS cash_movement
  FROM buckets b
  LEFT JOIN line_totals lt ON lt.bucket_start = b.bucket_start
  ORDER BY b.bucket_start ASC;
END;
$$;

COMMENT ON FUNCTION get_service_analytics_timeline(UUID, DATE, DATE, TEXT) IS
  'Service Financial Flow v2: Ledger-derived analytics by date bucket. Revenue = sum(credit-debit) income; Expenses = sum(debit-credit) expense; Cash = sum(debit-credit) asset codes 1000,1010,1020,1100. Read-only; does not modify snapshots or reports.';
