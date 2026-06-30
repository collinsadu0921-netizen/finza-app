-- ============================================================================
-- Stabilize workday_50 hot paths (506)
-- ============================================================================
-- Supersedes orphaned DB-only 504/505 experiments on staging.
--
-- Restores the best-known 502 baseline with selective 503 improvements:
--   • plpgsql get_service_dashboard_metrics — separate P&L, cash, positions calls
--   • compare block runs only when compare dates are provided (501 pattern)
--   • finza_dashboard_positions_as_of — lighter KPI-only scan from 503 (NOT 502
--     grouped asset/liability/equity pass that regressed under load)
--   • get_cash_collected_total — journal-first from 502
--   • get_service_dashboard_timeline — single-pass ledger bucket from 502
--   • 502 supporting indexes (idempotent) + new list/feed indexes
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Dashboard position KPIs — KPI account codes only (503 shape)
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

-- ---------------------------------------------------------------------------
-- 2. Cash collected — journal-first (502)
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
-- 3. Consolidated metrics — plpgsql wrapper, separate ledger passes (501/502)
-- ---------------------------------------------------------------------------
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
  'Service dashboard KPIs: separate P&L, cash collected, and position passes. Optional compare period when dates provided.';

-- ---------------------------------------------------------------------------
-- 4. Timeline — single ledger pass (502, idempotent re-apply)
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
-- 5. Supporting indexes (502 + workday list/feed paths)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_journal_entries_business_created_at
  ON public.journal_entries (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_accounts_business_code_cash
  ON public.accounts (business_id, code)
  WHERE deleted_at IS NULL
    AND code IN ('1000', '1010', '1020', '1030', '1100');

CREATE INDEX IF NOT EXISTS idx_bills_business_issue_date
  ON public.bills (business_id, issue_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_inbound_email_messages_business_received_at
  ON public.inbound_email_messages (business_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_business_overdue_due_date
  ON public.invoices (business_id, due_date DESC)
  WHERE deleted_at IS NULL
    AND status <> 'draft'
    AND due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credit_notes_business_applied_invoice
  ON public.credit_notes (business_id, invoice_id)
  WHERE deleted_at IS NULL
    AND status = 'applied'
    AND invoice_id IS NOT NULL;

COMMENT ON INDEX idx_journal_entries_business_created_at IS
  'Service activity feed: recent journal_entries by business.';

COMMENT ON INDEX idx_accounts_business_code_cash IS
  'Dashboard cash/AR account lookups for get_cash_collected_total and position KPIs.';

COMMENT ON INDEX idx_bills_business_issue_date IS
  'Bills list: business-scoped issue_date sort (workday_50 bills_list routes).';

COMMENT ON INDEX idx_inbound_email_messages_business_received_at IS
  'Service activity feed: inbound emails by business + received_at.';

COMMENT ON INDEX idx_invoices_business_overdue_due_date IS
  'Operational overdue invoice RPC: business + past-due filter.';

COMMENT ON INDEX idx_credit_notes_business_applied_invoice IS
  'Operational overdue invoice RPC: applied credit totals by invoice.';

GRANT EXECUTE ON FUNCTION public.finza_dashboard_positions_as_of(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_collected_total(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_service_dashboard_metrics(UUID, DATE, DATE, DATE, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_service_dashboard_timeline(UUID, DATE, DATE, TEXT, INT) TO authenticated;
