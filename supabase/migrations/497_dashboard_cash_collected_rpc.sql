-- ============================================================================
-- Dashboard cash collected aggregate (replaces fetching all cash journal lines)
-- ============================================================================
-- Sums debit amounts on cash/bank accounts (1000, 1010, 1020, 1030) for a
-- business within an inclusive date range. Matches service-metrics route logic.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_cash_collected_total(
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
  FROM journal_entry_lines jel
  INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
  INNER JOIN accounts a ON a.id = jel.account_id
  WHERE je.business_id = p_business_id
    AND a.business_id = p_business_id
    AND a.code IN ('1000', '1010', '1020', '1030')
    AND a.deleted_at IS NULL
    AND je.date >= p_start_date
    AND je.date <= p_end_date;
$$;

COMMENT ON FUNCTION get_cash_collected_total(UUID, DATE, DATE) IS
  'Read-only: sum of cash/bank account debits in a date range for dashboard cash collected KPI.';

GRANT EXECUTE ON FUNCTION public.get_cash_collected_total(UUID, DATE, DATE) TO authenticated;
