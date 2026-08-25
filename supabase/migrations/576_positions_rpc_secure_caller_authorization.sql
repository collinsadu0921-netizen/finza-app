-- ============================================================================
-- 576: Positions RPC — remove forgeable DEFINER caller authorization
-- ============================================================================
-- Why:
--   Migration 575 made finza_dashboard_positions_as_of SECURITY DEFINER and
--   authorized via two caller-writable session settings:
--     1. app.current_business_id
--     2. request.jwt.claim.role / request.jwt.claims->>'role' = service_role
--   An unrelated authenticated SQL caller can set_config those values and
--   receive another business's balances. Those are not safe trust anchors
--   inside a privileged DEFINER function.
--
-- What changes:
--   Authorization is persisted identity only:
--     A. public.finza_user_can_access_business(p_business_id) via auth.uid()
--        (owner OR business_users member)
--     B. OR dated Practice engagement (accepted/active + date window)
--   Removed: app.current_business_id
--   Removed: JWT-GUC service_role bypass
--
-- service_role decision (Option A):
--   No Finza application path requires service_role to execute this RPC.
--   The live caller is createSupabaseServerClient (user JWT / authenticated).
--   DEFINER current_user is always the owner (postgres), so current_user
--   cannot identify service_role. current_setting('role') is a GUC and is
--   not an unforgeable SET ROLE signal. Therefore no privileged bypass.
--   EXECUTE grant for service_role is retained (existing API surface) but
--   a service_role call without persisted auth.uid() authority returns zeros.
--
-- Unchanged:
--   signature, return type, STABLE, SECURITY DEFINER, owner postgres,
--   search_path=pg_catalog, 524/575 aggregation, table RLS, ACL hardening.
--
-- 575 remains in schema_migrations. This is an additive correction.
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
  v_authorized boolean;
BEGIN
  v_uid := auth.uid();

  v_authorized := COALESCE(
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
  'Dashboard KPI positions: cumulative cash/AR/AP. One-shot persisted authorization (owner/member OR dated Practice engagement), then the 524 SUM(CASE) aggregation as SECURITY DEFINER. Does not trust app.current_business_id or JWT role GUCs. Table RLS remains enabled globally.';

REVOKE ALL ON FUNCTION public.finza_dashboard_positions_as_of(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finza_dashboard_positions_as_of(uuid, date) TO anon;
GRANT EXECUTE ON FUNCTION public.finza_dashboard_positions_as_of(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finza_dashboard_positions_as_of(uuid, date) TO service_role;

-- ============================================================================
-- Rollback 576 only (STAGING DIAGNOSTIC ONLY — NOT SAFE FOR PRODUCTION)
-- Restores the 575 body including forgeable GUC / JWT-role branches.
-- ============================================================================
-- CREATE OR REPLACE the exact function from
--   supabase/migrations/575_positions_rpc_oneshot_authorization.sql
-- then:
--   ALTER FUNCTION public.finza_dashboard_positions_as_of(uuid, date) OWNER TO postgres;
--   REVOKE ALL ON FUNCTION public.finza_dashboard_positions_as_of(uuid, date) FROM PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.finza_dashboard_positions_as_of(uuid, date) TO anon;
--   GRANT EXECUTE ON FUNCTION public.finza_dashboard_positions_as_of(uuid, date) TO authenticated;
--   GRANT EXECUTE ON FUNCTION public.finza_dashboard_positions_as_of(uuid, date) TO service_role;
--
-- Full security rollback (524 SECURITY INVOKER + hardened ACL):
--   restore supabase/migrations/524_fix_dashboard_positions_ar_sum.sql body
--   LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
--   OWNER TO postgres
--   REVOKE ALL FROM PUBLIC
--   GRANT EXECUTE TO anon, authenticated, service_role
-- Do not execute either rollback from this migration.
-- ============================================================================
