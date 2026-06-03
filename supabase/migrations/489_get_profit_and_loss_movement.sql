-- Phase 2: P&L period movement from ledger (not trial balance closing balances).
-- income/revenue: credits - debits; expense: debits - credits; filtered by je.date in range.

CREATE OR REPLACE FUNCTION get_profit_and_loss_movement(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  account_id UUID,
  account_code TEXT,
  account_name TEXT,
  account_type TEXT,
  period_total NUMERIC
) AS $$
BEGIN
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'end_date must be on or after start_date';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.code,
    a.name,
    a.type,
    CASE
      WHEN a.type IN ('income', 'revenue') THEN
        COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)
      WHEN a.type = 'expense' THEN
        COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)
      ELSE
        0::NUMERIC
    END AS period_total
  FROM accounts a
  LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
  LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
    AND je.business_id = p_business_id
    AND je.date >= p_start_date
    AND je.date <= p_end_date
  WHERE a.business_id = p_business_id
    AND a.type IN ('income', 'revenue', 'expense')
    AND a.deleted_at IS NULL
  GROUP BY a.id, a.code, a.name, a.type
  HAVING
    (a.type IN ('income', 'revenue')
      AND (COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)) <> 0)
    OR (a.type = 'expense'
      AND (COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)) <> 0)
  ORDER BY a.type, a.code;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_profit_and_loss_movement IS
  'P&L period movement from journal_entries + journal_entry_lines + accounts for [start_date, end_date]. Not trial balance closing balances.';

GRANT EXECUTE ON FUNCTION get_profit_and_loss_movement(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_profit_and_loss_movement(UUID, DATE, DATE) TO service_role;
