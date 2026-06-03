-- Phase 2H: Cumulative as-of balance sheet + exclude future periods from default resolver

-- ============================================================================
-- 1. Default period resolver: never pick a period that starts after today
-- ============================================================================
CREATE OR REPLACE FUNCTION resolve_default_accounting_period(
  p_business_id UUID
)
RETURNS TABLE (
  period_id UUID,
  period_start DATE,
  period_end DATE,
  status TEXT,
  resolution_reason TEXT
) AS $$
DECLARE
  resolved_period accounting_periods;
  v_today DATE := CURRENT_DATE;
BEGIN
  SELECT ap.* INTO resolved_period
  FROM accounting_periods ap
  WHERE ap.business_id = p_business_id
    AND ap.status = 'open'
    AND ap.period_start <= v_today
    AND EXISTS (
      SELECT 1
      FROM journal_entries je
      WHERE je.business_id = p_business_id
        AND je.date >= ap.period_start
        AND je.date <= ap.period_end
    )
  ORDER BY ap.period_start DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT
      resolved_period.id,
      resolved_period.period_start,
      resolved_period.period_end,
      resolved_period.status,
      'latest_open_with_activity'::TEXT;
    RETURN;
  END IF;

  SELECT ap.* INTO resolved_period
  FROM accounting_periods ap
  WHERE ap.business_id = p_business_id
    AND ap.status = 'soft_closed'
    AND ap.period_start <= v_today
    AND EXISTS (
      SELECT 1
      FROM journal_entries je
      WHERE je.business_id = p_business_id
        AND je.date >= ap.period_start
        AND je.date <= ap.period_end
    )
  ORDER BY ap.period_start DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT
      resolved_period.id,
      resolved_period.period_start,
      resolved_period.period_end,
      resolved_period.status,
      'latest_soft_closed_with_activity'::TEXT;
    RETURN;
  END IF;

  SELECT ap.* INTO resolved_period
  FROM accounting_periods ap
  WHERE ap.business_id = p_business_id
    AND ap.status = 'locked'
    AND ap.period_start <= v_today
    AND EXISTS (
      SELECT 1
      FROM journal_entries je
      WHERE je.business_id = p_business_id
        AND je.date >= ap.period_start
        AND je.date <= ap.period_end
    )
  ORDER BY ap.period_start DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT
      resolved_period.id,
      resolved_period.period_start,
      resolved_period.period_end,
      resolved_period.status,
      'latest_locked_with_activity'::TEXT;
    RETURN;
  END IF;

  SELECT * INTO resolved_period
  FROM ensure_accounting_period(p_business_id, v_today);

  RETURN QUERY SELECT
    resolved_period.id,
    resolved_period.period_start,
    resolved_period.period_end,
    resolved_period.status,
    'current_month_fallback'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION resolve_default_accounting_period(UUID) IS
  'Resolves default accounting period for reports. Latest period with activity where period_start <= CURRENT_DATE, then status hierarchy, then current month.';

-- ============================================================================
-- 2. Cumulative balance sheet rows (ledger-only, je.date <= as_of)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_balance_sheet_as_of(
  p_business_id UUID,
  p_as_of_date DATE
)
RETURNS TABLE (
  account_id UUID,
  account_code TEXT,
  account_name TEXT,
  account_type TEXT,
  balance NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.code,
    a.name,
    a.type,
    CASE
      WHEN a.type = 'asset' THEN
        COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)
      WHEN a.type = 'contra_asset' THEN
        -(
          COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)
        )
      ELSE
        COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)
    END AS balance
  FROM accounts a
  LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
  LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
    AND je.business_id = p_business_id
    AND je.date <= p_as_of_date
  WHERE a.business_id = p_business_id
    AND a.type IN ('asset', 'contra_asset', 'liability', 'equity')
    AND a.deleted_at IS NULL
  GROUP BY a.id, a.code, a.name, a.type
  HAVING
    (
      a.type IN ('asset', 'contra_asset')
      AND (
        CASE
          WHEN a.type = 'asset' THEN
            COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)
          ELSE
            -(
              COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)
            )
        END
      ) != 0
    )
    OR (
      a.type IN ('liability', 'equity')
      AND (COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)) != 0
    )
  ORDER BY a.type, a.code;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_balance_sheet_as_of(UUID, DATE) IS
  'Phase 2H: Cumulative balance sheet from ledger. Includes asset, contra_asset (negative balance), liability, equity. Filters journal_entries.date <= as_of_date.';

-- ============================================================================
-- 3. Cumulative net income through as_of (income/expense accounts only)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_cumulative_net_income_as_of(
  p_business_id UUID,
  p_as_of_date DATE
)
RETURNS NUMERIC AS $$
DECLARE
  v_net NUMERIC := 0;
BEGIN
  SELECT COALESCE(SUM(
    CASE
      WHEN a.type IN ('income', 'revenue') THEN
        COALESCE(jel.credit, 0) - COALESCE(jel.debit, 0)
      WHEN a.type = 'expense' THEN
        -(COALESCE(jel.debit, 0) - COALESCE(jel.credit, 0))
      ELSE
        0
    END
  ), 0)
  INTO v_net
  FROM accounts a
  INNER JOIN journal_entry_lines jel ON jel.account_id = a.id
  INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
    AND je.business_id = p_business_id
    AND je.date <= p_as_of_date
  WHERE a.business_id = p_business_id
    AND a.type IN ('income', 'expense', 'revenue')
    AND a.deleted_at IS NULL;

  RETURN COALESCE(v_net, 0);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_cumulative_net_income_as_of(UUID, DATE) IS
  'Phase 2H: Cumulative net income (income − expense) from ledger through as_of_date. Used to balance cumulative balance sheet when earnings are not yet in equity accounts.';
