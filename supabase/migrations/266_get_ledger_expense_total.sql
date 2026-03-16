-- ============================================================================
-- Read-only RPC: total expense from ledger (for dashboard / reports)
-- ============================================================================
-- Dashboard and reports must use ledger-derived totals. This function sums
-- (debit - credit) for all journal_entry_lines whose account has
-- accounts.type = 'expense'. Optional date range; NULL means all time.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_ledger_expense_total(
  p_business_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(jel.debit - jel.credit), 0)::NUMERIC
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a ON a.id = jel.account_id
  WHERE je.business_id = p_business_id
    AND a.type = 'expense'
    AND (p_start_date IS NULL OR je.date >= p_start_date)
    AND (p_end_date IS NULL OR je.date <= p_end_date);
$$;

COMMENT ON FUNCTION get_ledger_expense_total(UUID, DATE, DATE) IS
  'Read-only: sum of (debit - credit) for expense accounts in the ledger. Used by dashboard and reports. Optional date range; NULL = all time.';
