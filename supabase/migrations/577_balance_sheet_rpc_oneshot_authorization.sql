-- ============================================================================
-- 577: Balance Sheet RPCs — SECURITY DEFINER + one-shot persisted auth
-- ============================================================================
-- Why:
--   get_balance_sheet_as_of and get_cumulative_net_income_as_of are SECURITY
--   INVOKER. Under authenticated, table RLS re-evaluates
--   finza_user_can_access_business (plus firm OR-branches) on every journal
--   header and journal line (~3044 loops). That is the Balance Sheet
--   saturation bottleneck. Privileged SQL is ~4 ms / ~1.6 ms; authenticated
--   is ~278 ms / ~121 ms.
--
-- What changes:
--   Both functions become SECURITY DEFINER (owner postgres) with
--   search_path=pg_catalog. Authorization is evaluated ONCE from persisted
--   identity, then the existing accounting SELECT runs without per-row RLS.
--
-- Authorization (same contract as 576):
--   A. auth.uid() + public.finza_user_can_access_business(p_business_id)
--   B. OR dated Practice engagement (accepted/active + date window)
--   Does NOT trust app.current_business_id, JWT role GUCs, or service_role
--   JWT-as-bypass.
--
-- service_role:
--   No application path calls these RPCs with a service-role client that
--   also supplies persisted auth.uid() authority.
--   The Service Balance Sheet route uses createSupabaseServerClient (user JWT).
--   Practice HTTP uses an admin client after a separate app-layer authority
--   check; that client has no auth.uid(). Per 576 Option A, a service_role
--   call without persisted uid returns the unauthorized result (empty / 0).
--   EXECUTE grant for service_role is retained for API compatibility only.
--
-- Unchanged:
--   signatures, return types, VOLATILE, accounting formulas, as-of semantics,
--   contra-asset sign, earnings math, table RLS policies, request graph.
--
-- Unauthorized observable contract (matches current INVOKER + RLS for
-- unrelated/anon):
--   get_balance_sheet_as_of → zero rows
--   get_cumulative_net_income_as_of → 0
-- ============================================================================

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
    RETURN;
  END IF;

  RETURN QUERY
  WITH account_balances AS (
    SELECT
      jel.account_id,
      COALESCE(pg_catalog.sum(jel.debit), 0::numeric) AS total_debit,
      COALESCE(pg_catalog.sum(jel.credit), 0::numeric) AS total_credit
    FROM public.journal_entries AS je
    JOIN public.journal_entry_lines AS jel
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
        COALESCE(ab.total_debit, 0::numeric) - COALESCE(ab.total_credit, 0::numeric)
      WHEN a.type = 'contra_asset' THEN
        -(
          COALESCE(ab.total_credit, 0::numeric) - COALESCE(ab.total_debit, 0::numeric)
        )
      ELSE
        COALESCE(ab.total_credit, 0::numeric) - COALESCE(ab.total_debit, 0::numeric)
    END AS balance
  FROM public.accounts AS a
  LEFT JOIN account_balances AS ab
    ON ab.account_id = a.id
  WHERE a.business_id = p_business_id
    AND a.type IN ('asset', 'contra_asset', 'liability', 'equity')
    AND a.deleted_at IS NULL
    AND (
      CASE
        WHEN a.type = 'asset' THEN
          COALESCE(ab.total_debit, 0::numeric) - COALESCE(ab.total_credit, 0::numeric)
        WHEN a.type = 'contra_asset' THEN
          -(
            COALESCE(ab.total_credit, 0::numeric) - COALESCE(ab.total_debit, 0::numeric)
          )
        ELSE
          COALESCE(ab.total_credit, 0::numeric) - COALESCE(ab.total_debit, 0::numeric)
      END
    ) != 0
  ORDER BY a.type, a.code;
END;
$function$;

COMMENT ON FUNCTION public.get_balance_sheet_as_of(uuid, date) IS
  'Cumulative balance sheet from ledger (je.date <= as_of). One-shot persisted authorization (owner/member OR dated Practice engagement), then the existing journal-first aggregation as SECURITY DEFINER. Does not trust app.current_business_id or JWT role GUCs. Table RLS remains enabled globally.';

CREATE OR REPLACE FUNCTION public.get_cumulative_net_income_as_of(
  p_business_id uuid,
  p_as_of_date date
)
RETURNS numeric
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_uid uuid;
  v_authorized boolean;
  v_net numeric := 0;
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
    RETURN 0;
  END IF;

  SELECT COALESCE(pg_catalog.sum(
    CASE
      WHEN a.type IN ('income', 'revenue') THEN
        COALESCE(jel.credit, 0::numeric) - COALESCE(jel.debit, 0::numeric)
      WHEN a.type = 'expense' THEN
        -(COALESCE(jel.debit, 0::numeric) - COALESCE(jel.credit, 0::numeric))
      ELSE
        0::numeric
    END
  ), 0::numeric)
  INTO v_net
  FROM public.accounts AS a
  INNER JOIN public.journal_entry_lines AS jel ON jel.account_id = a.id
  INNER JOIN public.journal_entries AS je ON je.id = jel.journal_entry_id
    AND je.business_id = p_business_id
    AND je.date <= p_as_of_date
  WHERE a.business_id = p_business_id
    AND a.type IN ('income', 'expense', 'revenue')
    AND a.deleted_at IS NULL;

  RETURN COALESCE(v_net, 0::numeric);
END;
$function$;

COMMENT ON FUNCTION public.get_cumulative_net_income_as_of(uuid, date) IS
  'Cumulative net income (income − expense) through as_of_date. One-shot persisted authorization (owner/member OR dated Practice engagement), then the existing inception-to-as-of aggregation as SECURITY DEFINER. Does not trust app.current_business_id or JWT role GUCs.';

ALTER FUNCTION public.get_balance_sheet_as_of(uuid, date) OWNER TO postgres;
ALTER FUNCTION public.get_cumulative_net_income_as_of(uuid, date) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_balance_sheet_as_of(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_balance_sheet_as_of(uuid, date) TO anon;
GRANT EXECUTE ON FUNCTION public.get_balance_sheet_as_of(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_balance_sheet_as_of(uuid, date) TO service_role;

REVOKE ALL ON FUNCTION public.get_cumulative_net_income_as_of(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cumulative_net_income_as_of(uuid, date) TO anon;
GRANT EXECUTE ON FUNCTION public.get_cumulative_net_income_as_of(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cumulative_net_income_as_of(uuid, date) TO service_role;

-- ============================================================================
-- Rollback 577 (STAGING ONLY — do not execute unless 577 fails)
-- Restores exact pre-577 INVOKER bodies, VOLATILE, PUBLIC EXECUTE ACL.
-- See supabase/migrations/577_balance_sheet_rpc_oneshot_authorization.rollback.sql
-- ============================================================================
