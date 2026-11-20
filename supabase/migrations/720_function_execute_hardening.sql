-- 720_function_execute_hardening.sql
-- Final coverage correction.
--
-- Confirmed during the 716/717/719 verification:
--   * create_audit_log was executable by anon (and authenticated) and inserted
--     audit rows for any business without an authorization check.
--   * initialize_business_accounting_period was executable by anon and created
--     accounting periods for any existing business.
--   * Many SECURITY DEFINER financial/worker/trigger functions still inherited
--     PUBLIC execute grants (and therefore anon execute) from PostgreSQL.
--
-- This migration does not change any table or calculation. It:
--   * adds business-access guards to create_audit_log and
--     initialize_business_accounting_period;
--   * revokes PUBLIC/anon EXECUTE from the high-risk financial/worker/trigger
--     function surface and restores only the grants the application needs;
--   * keeps intentionally public token functions untouched.

-- ---------------------------------------------------------------------------
-- 1. Guarded audit write.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_audit_log(
  p_business_id uuid,
  p_user_id uuid,
  p_action_type text,
  p_entity_type text,
  p_entity_id uuid DEFAULT NULL,
  p_old_values jsonb DEFAULT NULL,
  p_new_values jsonb DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  log_id UUID;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role'
     AND NOT (auth.role() IS NULL AND session_user IN ('postgres','supabase_admin')) THEN
    IF auth.uid() IS NULL OR NOT public.finza_user_can_access_business(p_business_id) THEN
      RAISE EXCEPTION 'Not authorized to write audit logs for this business'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO audit_logs (
    business_id, user_id, action_type, entity_type, entity_id,
    old_values, new_values, ip_address, user_agent, description
  ) VALUES (
    p_business_id, p_user_id, p_action_type, p_entity_type, p_entity_id,
    p_old_values, p_new_values, p_ip_address, p_user_agent, p_description
  )
  RETURNING id INTO log_id;

  RETURN log_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Guarded accounting-period initialization.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.initialize_business_accounting_period(
  p_business_id uuid,
  p_start_date date DEFAULT CURRENT_DATE
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  period_exists BOOLEAN;
  period_start_date DATE;
  period_end_date DATE;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role'
     AND NOT (auth.role() IS NULL AND session_user IN ('postgres','supabase_admin')) THEN
    IF auth.uid() IS NULL
       OR coalesce(public.finza_caller_membership_role(p_business_id), '') NOT IN ('owner','admin') THEN
      RAISE EXCEPTION 'Not authorized to initialize accounting for this business'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM businesses WHERE id = p_business_id) THEN
    RAISE EXCEPTION 'Business not found: %', p_business_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM accounting_periods WHERE business_id = p_business_id
  ) INTO period_exists;

  IF period_exists THEN
    RETURN;
  END IF;

  period_start_date := DATE_TRUNC('month', p_start_date)::DATE;
  period_end_date := (DATE_TRUNC('month', p_start_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  INSERT INTO accounting_periods (business_id, period_start, period_end, status)
  VALUES (p_business_id, period_start_date, period_end_date, 'open');

  PERFORM public.finza_worker_write_zero_period_snapshots(
    p_business_id, period_start_date, period_end_date
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Close inheritance of PUBLIC/anon execute on high-risk definer functions.
--    Trigger and worker functions become service-only; user-facing financial
--    functions remain callable by authenticated users and service_role.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  sig text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prokind = 'f'
      AND p.proname ~* '(post_|ledger|journal|period|payroll|asset|invoice|bill|vat|wht|cit|audit|worker|snapshot|claim|complete|fail|initialize|ensure|backfill|delete|update|insert|approve|void|refund|payment|loan|tax|refresh|try_refresh|_refresh|_upsert|_service_material|enforce_)'
  LOOP
    sig := r.oid::regprocedure;
    IF r.proname ~ '^(finza_worker_|claim_|complete_|fail_|enqueue_|coalesce_|recover_|requeue_|invoke_|test_|tr_|trg_|_refresh_|_upsert_|_service_material_|refresh_|try_refresh_|get_accounting_snapshot_|audit_business_user_changes$|enforce_|payroll_.*_enforce_|finza_proposal_assets_guard$)' THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
    ELSE
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', sig);
    END IF;
  END LOOP;
END $$;

-- Remaining anon-executable definer functions from the final scan.
-- Helpers used by RLS/storage remain available to authenticated callers;
-- true backend/worker/test functions become service-only.
DO $$
DECLARE
  f text;
  fns text[];
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'check_user_in_firm(uuid,uuid)',
    'check_user_is_partner_in_firm(uuid,uuid)',
    'has_firm_engagement_with_business(uuid)',
    'get_customer_sale_stats(uuid,uuid)',
    'finza_dashboard_positions_as_of(uuid,date)',
    'process_retail_purchase_order_receipt(uuid,uuid,uuid,uuid,jsonb)'
  ] LOOP
    IF to_regprocedure('public.' || f) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
    END IF;
  END LOOP;

  FOREACH f IN ARRAY ARRAY[
    'diagnose_service_job_material_returns(uuid)',
    'run_forensic_accounting_verification(uuid)',
    'test_service_job_material_usage_return()',
    'prevent_duplicate_service_manual_reversal()'
  ] LOOP
    IF to_regprocedure('public.' || f) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
    END IF;
  END LOOP;
END $$;

-- Production carries a few additional SECURITY DEFINER helpers whose names did
-- not match the earlier pattern (service-return, COGS reversal, payroll advance
-- and accounting-authorization helpers). They were still anon-executable on a
-- production-schema clone, so close them explicitly by name. Matching on
-- proname handles any signature differences between environments.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prokind = 'f'
      AND p.proname IN (
        'finza_assert_accounting_write_authorized',
        'finza_user_has_permission',
        'has_forensic_monitoring_access',
        'return_service_job_material_usage',
        'reverse_service_job_cogs',
        'salary_advance_apply_posted_balance',
        'salary_advance_stop_recurring_deduction'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.oid::regprocedure);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Period-control authorization.
--    Staff could soft-close and lock an accounting period because existing
--    permissive accounting_periods policies only require business membership.
--    Restrictive policies AND these checks onto every existing write policy.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS accounting_periods_write_accounting_role_insert ON public.accounting_periods;
DROP POLICY IF EXISTS accounting_periods_write_accounting_role_update ON public.accounting_periods;
DROP POLICY IF EXISTS accounting_periods_write_accounting_role_delete ON public.accounting_periods;

CREATE POLICY accounting_periods_write_accounting_role_insert
  ON public.accounting_periods AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));

CREATE POLICY accounting_periods_write_accounting_role_update
  ON public.accounting_periods AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(business_id))
  WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));

CREATE POLICY accounting_periods_write_accounting_role_delete
  ON public.accounting_periods AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(business_id));

-- Private read-only helpers that should not be anonymous even though some
-- already return no rows when auth.uid() is null.
DO $$
DECLARE
  f text;
  fns text[] := ARRAY[
    'get_balance_sheet_as_of(uuid,date)',
    'get_cumulative_net_income_as_of(uuid,date)',
    'get_customer_sale_history(uuid,uuid,integer)',
    'get_service_materials_workspace(uuid,text,text,text,integer,integer)',
    'get_service_dashboard_business_has_ledger_movement(uuid)',
    'get_accounting_snapshot_health()',
    'get_accounting_snapshot_queue_diagnostics(uuid)'
  ];
BEGIN
  FOREACH f IN ARRAY fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;
