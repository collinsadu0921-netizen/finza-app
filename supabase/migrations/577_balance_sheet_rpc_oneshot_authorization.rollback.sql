-- STAGING DIAGNOSTIC ONLY — do not execute unless 577 must be reverted.
-- Restores exact pre-577 SECURITY INVOKER bodies, VOLATILE, and ACL
-- (PUBLIC + anon + authenticated + service_role EXECUTE).
-- Captured from live staging adonhhtooawkeemdqqeo before 577
-- (md5 BS cdb3dd1e587943f921e74b3cf31b3954, NI 43b281e33a3f7c69b4e58d3681aad050).

CREATE OR REPLACE FUNCTION public.get_balance_sheet_as_of(
  p_business_id uuid,
  p_as_of_date date
)
RETURNS TABLE (
  account_id uuid,
  account_code text,
  account_name text,
  account_type text,
  balance numeric
)
LANGUAGE plpgsql
VOLATILE
AS $function$
BEGIN
  RETURN QUERY
  WITH account_balances AS (
    SELECT
      jel.account_id,
      COALESCE(SUM(jel.debit), 0) AS total_debit,
      COALESCE(SUM(jel.credit), 0) AS total_credit
    FROM journal_entries je
    JOIN journal_entry_lines jel
      ON jel.journal_entry_id = je.id
    WHERE je.business_id = p_business_id
      AND je.date <= p_as_of_date
    GROUP BY jel.account_id
  )
  SELECT
    a.id AS account_id,
    a.code AS account_code,
    a.name AS account_name,
    a.type AS account_type,
    CASE
      WHEN a.type = 'asset' THEN
        COALESCE(ab.total_debit, 0) - COALESCE(ab.total_credit, 0)
      WHEN a.type = 'contra_asset' THEN
        -(
          COALESCE(ab.total_credit, 0) - COALESCE(ab.total_debit, 0)
        )
      ELSE
        COALESCE(ab.total_credit, 0) - COALESCE(ab.total_debit, 0)
    END AS balance
  FROM accounts a
  LEFT JOIN account_balances ab
    ON ab.account_id = a.id
  WHERE a.business_id = p_business_id
    AND a.type IN ('asset', 'contra_asset', 'liability', 'equity')
    AND a.deleted_at IS NULL
    AND (
      CASE
        WHEN a.type = 'asset' THEN
          COALESCE(ab.total_debit, 0) - COALESCE(ab.total_credit, 0)
        WHEN a.type = 'contra_asset' THEN
          -(
            COALESCE(ab.total_credit, 0) - COALESCE(ab.total_debit, 0)
          )
        ELSE
          COALESCE(ab.total_credit, 0) - COALESCE(ab.total_debit, 0)
      END
    ) != 0
  ORDER BY a.type, a.code;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_cumulative_net_income_as_of(
  p_business_id uuid,
  p_as_of_date date
)
RETURNS numeric
LANGUAGE plpgsql
VOLATILE
AS $function$
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
$function$;

ALTER FUNCTION public.get_balance_sheet_as_of(uuid, date) OWNER TO postgres;
ALTER FUNCTION public.get_cumulative_net_income_as_of(uuid, date) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.get_balance_sheet_as_of(uuid, date) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_balance_sheet_as_of(uuid, date) TO anon;
GRANT EXECUTE ON FUNCTION public.get_balance_sheet_as_of(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_balance_sheet_as_of(uuid, date) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_cumulative_net_income_as_of(uuid, date) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cumulative_net_income_as_of(uuid, date) TO anon;
GRANT EXECUTE ON FUNCTION public.get_cumulative_net_income_as_of(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cumulative_net_income_as_of(uuid, date) TO service_role;

-- If 577 was recorded in supabase_migrations.schema_migrations, delete that row
-- in the same revert transaction. Do not execute from the forward migration.
