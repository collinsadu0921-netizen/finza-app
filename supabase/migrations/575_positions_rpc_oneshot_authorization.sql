-- ============================================================================
-- 575: Dashboard positions RPC — one-shot authorization (SECURITY DEFINER)
-- ============================================================================
-- Why:
--   SECURITY INVOKER caused journal_entries / journal_entry_lines RLS to
--   re-evaluate owner/member + firm-engagement predicates once per KPI line
--   (~1,600 loops, ~235 ms authenticated vs ~5–13 ms with RLS bypassed).
--
-- What changes:
--   Authorization is evaluated ONCE, then the EXACT same cash/AR/AP aggregation
--   runs as the function owner (postgres, BYPASSRLS). Table RLS policies are
--   NOT dropped, disabled, or rewritten. This function is the only trusted
--   boundary.
--
-- Authorization (must match current journal SELECT OR-policies):
--   1. public.finza_user_can_access_business(p_business_id)
--      owner OR business_users member (any role)
--   2. OR valid Practice engagement: accounting_firm_users +
--      firm_client_engagements status IN (accepted, active) and in date window
--      (NOT the looser has_firm_engagement_with_business helper, which omits
--      status/date filters)
--   3. OR app.current_business_id GUC equality (existing RLS policy)
--   service_role JWT preserves the previous RLS-bypass read.
--
-- Unauthorized / anonymous:
--   same observable contract as INVOKER + empty RLS: one row of 0.00 / 0.00 / 0.00.
--   Does not leak whether another business has journals or balances.
--
-- Accounting formula: UNCHANGED (524). No journal status filter.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.finza_dashboard_positions_as_of(
  p_business_id uuid,
  p_as_of_date date
)
RETURNS TABLE (
  cash_balance numeric,
  accounts_receivable numeric,
  accounts_payable numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_uid uuid;
  v_jwt_role text;
  v_authorized boolean;
BEGIN
  v_uid := auth.uid();
  v_jwt_role := COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::pg_catalog.jsonb ->> 'role'
  );

  v_authorized := COALESCE(
    v_jwt_role = 'service_role'
    OR (
      v_uid IS NOT NULL
      AND (
        public.finza_user_can_access_business(p_business_id)
        OR EXISTS (
          SELECT 1
          FROM public.accounting_firm_users AS afu
          INNER JOIN public.firm_client_engagements AS fce
            ON fce.accounting_firm_id = afu.firm_id
           AND fce.client_business_id = p_business_id
           AND fce.status = ANY (ARRAY['accepted'::text, 'active'::text])
           AND fce.effective_from <= CURRENT_DATE
           AND (fce.effective_to IS NULL OR fce.effective_to >= CURRENT_DATE)
          WHERE afu.user_id = v_uid
        )
        OR p_business_id IS NOT DISTINCT FROM NULLIF(
          pg_catalog.current_setting('app.current_business_id', true),
          ''
        )::uuid
      )
    ),
    false
  );

  IF NOT v_authorized THEN
    cash_balance := 0;
    accounts_receivable := 0;
    accounts_payable := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    pg_catalog.round(COALESCE(pg_catalog.sum(
      CASE
        WHEN a.code IN ('1000', '1010', '1020', '1030') AND a.type = 'asset'
          THEN jel.debit - jel.credit
        ELSE 0::numeric
      END
    ), 0::numeric), 2) AS cash_balance,
    pg_catalog.round(COALESCE(pg_catalog.sum(
      CASE
        WHEN a.code = '1100' AND a.type = 'asset'
          THEN jel.debit - jel.credit
        ELSE 0::numeric
      END
    ), 0::numeric), 2) AS accounts_receivable,
    pg_catalog.round(COALESCE(pg_catalog.sum(
      CASE
        WHEN a.type = 'liability'
          AND a.code ~ '^\d+$'
          AND a.code::integer >= 2000
          AND a.code::integer < 2500
          THEN jel.credit - jel.debit
        ELSE 0::numeric
      END
    ), 0::numeric), 2) AS accounts_payable
  FROM public.journal_entries AS je
  INNER JOIN public.journal_entry_lines AS jel
    ON jel.journal_entry_id = je.id
  INNER JOIN public.accounts AS a
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
END;
$function$;

COMMENT ON FUNCTION public.finza_dashboard_positions_as_of(uuid, date) IS
  'Dashboard KPI positions: cumulative cash/AR/AP. One-shot authorization (owner/member OR dated Practice engagement OR app.current_business_id), then the same 524 SUM(CASE) aggregation as SECURITY DEFINER so journal RLS is not re-evaluated per line. Table RLS remains enabled globally.';

REVOKE ALL ON FUNCTION public.finza_dashboard_positions_as_of(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finza_dashboard_positions_as_of(uuid, date) TO anon;
GRANT EXECUTE ON FUNCTION public.finza_dashboard_positions_as_of(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finza_dashboard_positions_as_of(uuid, date) TO service_role;
