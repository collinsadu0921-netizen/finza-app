-- ============================================================================
-- Fix dashboard AR aggregation (524)
-- ============================================================================
-- Account 1100 (Accounts Receivable) must use SUM(debit - credit) across all
-- ledger lines — not MAX(single line), which understates cumulative AR balance.
-- Cash (1000–1030) and AP (2000–2499) already use SUM.
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
    ROUND(COALESCE(SUM(
      CASE
        WHEN a.code = '1100' AND a.type = 'asset'
          THEN jel.debit - jel.credit
        ELSE 0::numeric
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
  'Dashboard KPI positions: cumulative cash/AR/AP — SUM of signed ledger movements per account band (524 fixes AR MAX→SUM).';

GRANT EXECUTE ON FUNCTION public.finza_dashboard_positions_as_of(UUID, DATE) TO authenticated;
