-- Fix get_profit_and_loss_movement join order (489).
-- Bug: accounts → LEFT JOIN journal_entry_lines → LEFT JOIN journal_entries with date filters
-- could aggregate journal lines outside the selected period.
-- Fix: journal_entries (business + date) → journal_entry_lines → accounts (inner joins).

CREATE OR REPLACE FUNCTION public.get_profit_and_loss_movement(
  p_business_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  account_id uuid,
  account_code text,
  account_name text,
  account_type text,
  period_total numeric
)
LANGUAGE plpgsql
STABLE
AS $function$
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
    ROUND(
      CASE
        WHEN a.type IN ('income', 'revenue') THEN
          COALESCE(SUM(jel.credit - jel.debit), 0)
        WHEN a.type = 'expense' THEN
          COALESCE(SUM(jel.debit - jel.credit), 0)
        ELSE
          0::numeric
      END,
      2
    ) AS period_total
  FROM journal_entries je
  JOIN journal_entry_lines jel
    ON jel.journal_entry_id = je.id
  JOIN accounts a
    ON a.id = jel.account_id
   AND a.business_id = p_business_id
  WHERE je.business_id = p_business_id
    AND je.date >= p_start_date
    AND je.date <= p_end_date
    AND a.type IN ('income', 'revenue', 'expense')
    AND a.deleted_at IS NULL
  GROUP BY a.id, a.code, a.name, a.type
  HAVING
    ROUND(
      CASE
        WHEN a.type IN ('income', 'revenue') THEN
          COALESCE(SUM(jel.credit - jel.debit), 0)
        WHEN a.type = 'expense' THEN
          COALESCE(SUM(jel.debit - jel.credit), 0)
        ELSE
          0::numeric
      END,
      2
    ) <> 0
  ORDER BY a.type, a.code;
END;
$function$;

COMMENT ON FUNCTION public.get_profit_and_loss_movement IS
  'P&L period movement: journal_entries (date-filtered) → lines → accounts. income/revenue = credit-debit; expense = debit-credit.';

GRANT EXECUTE ON FUNCTION public.get_profit_and_loss_movement(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_profit_and_loss_movement(UUID, DATE, DATE) TO service_role;
