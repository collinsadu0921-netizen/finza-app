-- 716_rls_all_public_tables.sql
-- Coordinated database access security for the 36 production tables identified
-- in the audit. Forward-only. Reuses the existing staging business_users RLS
-- migration (580) and the existing active firm/engagement model.
--
-- Design:
--   * anon/PUBLIC: no privileges on any of the 36 tables.
--   * authenticated: tenant-scoped, role-aware access for active business data.
--   * legacy/internal/debug tables: no direct client access; service_role only.
--   * service_role: unchanged full access (BYPASSRLS).
--
-- This migration does not change calculations, postings, balances or data.

-- ---------------------------------------------------------------------------
-- 1. Drop any pre-existing policies on the 36 tables so the resulting policy
--    set is explicit and reviewable. business_users is recreated from 580.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  t text;
  tables text[] := ARRAY[
    'accountant_client_access','accountant_firm_users','accountant_firms',
    'accounting_adjustment_audit','accounting_adjustments','accounting_exceptions',
    'accounting_invariant_runs','accounting_period_actions','adjusting_journal_drafts',
    'backfill_audit_log','business_users','cash_drops','cashier_sessions','categories',
    'chart_of_accounts','chart_of_accounts_control_map','clients','coa_mapping_lines',
    'customer_notes','diagnostic_journal_lines_log','internal_alerts','items',
    'opening_balance_batches','opening_balance_lines','overrides','parked_sales',
    'period_close_attempts','quick_keys','reconciliation_resolutions','register_variances',
    'retail_cost_updates','retail_posting_debug_log','rider_deliveries','riders',
    'salon_services','users'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOR r IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Helpers. New names avoid overwriting existing production functions.
--    All are SECURITY DEFINER so policy checks do not recurse through RLS.
-- ---------------------------------------------------------------------------

-- Reuse of staging 580: caller role for a business.
CREATE OR REPLACE FUNCTION public.finza_caller_membership_role(p_business_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR p_business_id IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = p_business_id AND b.owner_id = auth.uid()
    ) THEN 'owner'
    ELSE (
      SELECT bu.role
      FROM public.business_users bu
      WHERE bu.business_id = p_business_id AND bu.user_id = auth.uid()
      LIMIT 1
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.finza_rls_business_role(p_business_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.finza_caller_membership_role(p_business_id);
$$;

CREATE OR REPLACE FUNCTION public.finza_rls_is_readonly_accountant(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT bu.accountant_readonly
    FROM public.business_users bu
    WHERE bu.business_id = p_business_id AND bu.user_id = auth.uid()
    LIMIT 1
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.finza_rls_can_read_business(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.finza_rls_business_role(p_business_id) IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.finza_rls_can_manage_business(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.finza_rls_business_role(p_business_id) IN ('owner','admin','manager');
$$;

CREATE OR REPLACE FUNCTION public.finza_rls_can_write_retail(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.finza_business_can_write_service_records(p_business_id)
     AND public.finza_rls_business_role(p_business_id) IN ('owner','admin','manager','cashier','staff')
     AND NOT public.finza_rls_is_readonly_accountant(p_business_id);
$$;

CREATE OR REPLACE FUNCTION public.finza_rls_can_write_accounting(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.finza_business_can_write_service_records(p_business_id)
     AND public.finza_rls_business_role(p_business_id) IN ('owner','admin','manager','accountant')
     AND NOT public.finza_rls_is_readonly_accountant(p_business_id);
$$;

CREATE OR REPLACE FUNCTION public.finza_rls_has_engagement(p_business_id uuid, p_required text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.accounting_firm_users afu
    JOIN public.firm_client_engagements fce
      ON fce.accounting_firm_id = afu.firm_id
    WHERE afu.user_id = auth.uid()
      AND fce.client_business_id = p_business_id
      AND fce.status IN ('accepted','active')
      AND fce.effective_from <= CURRENT_DATE
      AND (fce.effective_to IS NULL OR fce.effective_to >= CURRENT_DATE)
      AND (p_required = 'read' OR fce.access_level IN ('write','approve'))
  );
$$;

CREATE OR REPLACE FUNCTION public.finza_rls_can_read_accounting_business(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.finza_rls_can_read_business(p_business_id)
      OR public.finza_rls_has_engagement(p_business_id, 'read');
$$;

CREATE OR REPLACE FUNCTION public.finza_rls_can_write_accounting_business(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.finza_rls_can_write_accounting(p_business_id)
      OR (
        public.finza_business_can_write_service_records(p_business_id)
        AND public.finza_rls_has_engagement(p_business_id, 'write')
      );
$$;

CREATE OR REPLACE FUNCTION public.finza_rls_can_access_sale(p_sale_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = p_sale_id
      AND (
        public.finza_rls_can_read_business(s.business_id)
        OR public.finza_rls_has_engagement(s.business_id, 'read')
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.finza_rls_can_access_session(p_session_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cashier_sessions s
    WHERE s.id = p_session_id
      AND public.finza_rls_can_read_business(s.business_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.finza_rls_can_write_session(p_session_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cashier_sessions s
    WHERE s.id = p_session_id
      AND public.finza_rls_can_write_retail(s.business_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.finza_rls_can_manage_session(p_session_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cashier_sessions s
    WHERE s.id = p_session_id
      AND public.finza_rls_can_manage_business(s.business_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.finza_rls_can_access_account(p_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chart_of_accounts coa
    WHERE coa.id = p_account_id
      AND public.finza_rls_can_read_accounting_business(coa.business_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.finza_rls_batch_business_id(p_batch_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.business_id
  FROM public.opening_balance_batches b
  WHERE b.id = p_batch_id;
$$;

CREATE OR REPLACE FUNCTION public.finza_rls_can_manage_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_users me
    JOIN public.business_users them
      ON them.business_id = me.business_id
    WHERE me.user_id = auth.uid()
      AND them.user_id = p_user_id
      AND me.role IN ('owner','admin')
  )
  OR EXISTS (
    SELECT 1
    FROM public.businesses b
    JOIN public.business_users them ON them.business_id = b.id
    WHERE b.owner_id = auth.uid()
      AND them.user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.finza_rls_can_see_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.business_users me
    JOIN public.business_users them ON them.business_id = me.business_id
    WHERE me.user_id = auth.uid() AND them.user_id = p_user_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.businesses b
    JOIN public.business_users me ON me.business_id = b.id
    WHERE me.user_id = auth.uid() AND b.owner_id = p_user_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.businesses b
    JOIN public.business_users them ON them.business_id = b.id
    WHERE b.owner_id = auth.uid() AND them.user_id = p_user_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.accounting_firm_users me
    JOIN public.accounting_firm_users them ON them.firm_id = me.firm_id
    WHERE me.user_id = auth.uid() AND them.user_id = p_user_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.accounting_firm_users afu
    JOIN public.firm_client_engagements fce
      ON fce.accounting_firm_id = afu.firm_id
    JOIN public.businesses b ON b.id = fce.client_business_id
    WHERE afu.user_id = auth.uid()
      AND b.owner_id = p_user_id
      AND fce.status IN ('accepted','active')
      AND fce.effective_from <= CURRENT_DATE
      AND (fce.effective_to IS NULL OR fce.effective_to >= CURRENT_DATE)
  )
  OR EXISTS (
    SELECT 1
    FROM public.accounting_firm_users afu
    JOIN public.firm_client_engagements fce
      ON fce.accounting_firm_id = afu.firm_id
    JOIN public.business_users them ON them.business_id = fce.client_business_id
    WHERE afu.user_id = auth.uid()
      AND them.user_id = p_user_id
      AND fce.status IN ('accepted','active')
      AND fce.effective_from <= CURRENT_DATE
      AND (fce.effective_to IS NULL OR fce.effective_to >= CURRENT_DATE)
  )
  OR EXISTS (
    SELECT 1
    FROM public.accounting_firm_users afu
    JOIN public.firm_client_engagements fce
      ON fce.accounting_firm_id = afu.firm_id
    JOIN public.businesses b ON b.id = fce.client_business_id
    WHERE afu.user_id = p_user_id
      AND b.owner_id = auth.uid()
      AND fce.status IN ('accepted','active')
      AND fce.effective_from <= CURRENT_DATE
      AND (fce.effective_to IS NULL OR fce.effective_to >= CURRENT_DATE)
  )
  OR EXISTS (
    SELECT 1
    FROM public.accounting_firm_users afu
    JOIN public.firm_client_engagements fce
      ON fce.accounting_firm_id = afu.firm_id
    JOIN public.business_users me ON me.business_id = fce.client_business_id
    WHERE afu.user_id = p_user_id
      AND me.user_id = auth.uid()
      AND fce.status IN ('accepted','active')
      AND fce.effective_from <= CURRENT_DATE
      AND (fce.effective_to IS NULL OR fce.effective_to >= CURRENT_DATE)
  );
$$;

REVOKE ALL ON FUNCTION public.finza_caller_membership_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finza_caller_membership_role(uuid) TO authenticated, service_role;

DO $$
DECLARE
  f text;
  fns text[] := ARRAY[
    'finza_rls_business_role(uuid)',
    'finza_rls_is_readonly_accountant(uuid)',
    'finza_rls_can_read_business(uuid)',
    'finza_rls_can_manage_business(uuid)',
    'finza_rls_can_write_retail(uuid)',
    'finza_rls_can_write_accounting(uuid)',
    'finza_rls_has_engagement(uuid,text)',
    'finza_rls_can_read_accounting_business(uuid)',
    'finza_rls_can_write_accounting_business(uuid)',
    'finza_rls_can_access_sale(uuid)',
    'finza_rls_can_access_session(uuid)',
    'finza_rls_can_write_session(uuid)',
    'finza_rls_can_manage_session(uuid)',
    'finza_rls_can_access_account(uuid)',
    'finza_rls_batch_business_id(uuid)',
    'finza_rls_can_manage_user(uuid)',
    'finza_rls_can_see_user(uuid)'
  ];
BEGIN
  FOREACH f IN ARRAY fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. business_users: reuse staging 580 exactly.
-- ---------------------------------------------------------------------------
ALTER TABLE public.business_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_users FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_users FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_users TO authenticated;
GRANT ALL ON TABLE public.business_users TO service_role;

CREATE POLICY business_users_select_member
  ON public.business_users
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.finza_caller_membership_role(business_id) IS NOT NULL
  );

CREATE POLICY business_users_insert_own_admin
  ON public.business_users
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_id
        AND b.owner_id = auth.uid()
        AND b.archived_at IS NULL
    )
  );

CREATE POLICY business_users_update_managed
  ON public.business_users
  FOR UPDATE TO authenticated
  USING (
    user_id IS DISTINCT FROM auth.uid()
    AND public.finza_caller_membership_role(business_id) IN ('owner','admin','manager')
  )
  WITH CHECK (
    user_id IS DISTINCT FROM auth.uid()
    AND public.finza_caller_membership_role(business_id) IN ('owner','admin','manager')
  );

CREATE POLICY business_users_delete_managed
  ON public.business_users
  FOR DELETE TO authenticated
  USING (
    user_id IS DISTINCT FROM auth.uid()
    AND user_id IS DISTINCT FROM (
      SELECT b.owner_id FROM public.businesses b WHERE b.id = business_users.business_id
    )
    AND (
      (public.finza_caller_membership_role(business_id) = 'owner'
        AND role IN ('admin','manager','cashier','accountant','staff'))
      OR (public.finza_caller_membership_role(business_id) = 'admin'
        AND role IN ('manager','cashier'))
      OR (public.finza_caller_membership_role(business_id) = 'manager'
        AND role = 'cashier')
    )
  );

CREATE OR REPLACE FUNCTION public.finza_business_users_guard_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor text;
BEGIN
  IF current_user IN ('service_role','postgres','supabase_admin') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS DISTINCT FROM auth.uid() OR NEW.role IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'business_users insert is not allowed for this membership'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.business_id IS DISTINCT FROM OLD.business_id THEN
      RAISE EXCEPTION 'business_users identity cannot be changed' USING ERRCODE = '42501';
    END IF;
    IF OLD.user_id = auth.uid() AND (
      NEW.role IS DISTINCT FROM OLD.role
      OR NEW.custom_permissions IS DISTINCT FROM OLD.custom_permissions
    ) THEN
      RAISE EXCEPTION 'cannot change your own membership role or permissions' USING ERRCODE = '42501';
    END IF;

    v_actor := public.finza_caller_membership_role(OLD.business_id);
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'business_users update is not allowed' USING ERRCODE = '42501';
    END IF;

    IF NEW.role IS DISTINCT FROM OLD.role OR NEW.custom_permissions IS DISTINCT FROM OLD.custom_permissions THEN
      IF v_actor = 'owner' THEN
        IF NEW.role NOT IN ('admin','manager','cashier','accountant','staff') THEN
          RAISE EXCEPTION 'owner cannot assign this membership role' USING ERRCODE = '42501';
        END IF;
      ELSIF v_actor = 'admin' THEN
        IF OLD.role NOT IN ('manager','cashier') OR NEW.role NOT IN ('manager','cashier') THEN
          RAISE EXCEPTION 'admin cannot change this membership' USING ERRCODE = '42501';
        END IF;
      ELSIF v_actor = 'manager' THEN
        IF OLD.role IS DISTINCT FROM 'cashier' OR NEW.role IS DISTINCT FROM 'cashier' THEN
          RAISE EXCEPTION 'manager cannot change this membership' USING ERRCODE = '42501';
        END IF;
      ELSE
        RAISE EXCEPTION 'this role cannot manage memberships' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_business_users_guard_write ON public.business_users;
CREATE TRIGGER trg_business_users_guard_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.business_users
  FOR EACH ROW EXECUTE FUNCTION public.finza_business_users_guard_write();

-- ---------------------------------------------------------------------------
-- 4. users: shared-tenant identity reads; self insert; protected update.
--    pin_code is never granted to authenticated. The PIN login route uses
--    service_role and is unaffected.
-- ---------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, email, full_name, created_at, store_id) ON public.users TO authenticated;
GRANT INSERT (id, email, full_name) ON public.users TO authenticated;
GRANT UPDATE (full_name, store_id) ON public.users TO authenticated;
GRANT ALL ON TABLE public.users TO service_role;

CREATE POLICY users_select_visible
  ON public.users FOR SELECT TO authenticated
  USING (public.finza_rls_can_see_user(id));

CREATE POLICY users_insert_self
  ON public.users FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.uid()
    AND lower(email) = lower(coalesce(auth.jwt()->>'email',''))
  );

CREATE POLICY users_update_self_or_manager
  ON public.users FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.finza_rls_can_manage_user(id))
  WITH CHECK (id = auth.uid() OR public.finza_rls_can_manage_user(id));

CREATE OR REPLACE FUNCTION public.finza_users_guard_profile_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('service_role','postgres','supabase_admin')
     OR coalesce(auth.role(),'') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.pin_code IS DISTINCT FROM OLD.pin_code
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'protected user identity fields cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    IF OLD.id = auth.uid() OR NOT public.finza_rls_can_manage_user(OLD.id) THEN
      RAISE EXCEPTION 'store assignment cannot be changed by this role'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_guard_profile_write ON public.users;
CREATE TRIGGER trg_users_guard_profile_write
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.finza_users_guard_profile_write();

-- ---------------------------------------------------------------------------
-- 5. Accounting/audit tables that keep direct client access.
-- ---------------------------------------------------------------------------
ALTER TABLE public.accounting_adjustment_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.accounting_adjustment_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.accounting_adjustment_audit TO authenticated;
GRANT ALL ON TABLE public.accounting_adjustment_audit TO service_role;
CREATE POLICY accounting_adjustment_audit_select ON public.accounting_adjustment_audit
  FOR SELECT TO authenticated USING (public.finza_rls_can_read_accounting_business(business_id));
CREATE POLICY accounting_adjustment_audit_insert ON public.accounting_adjustment_audit
  FOR INSERT TO authenticated WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));

ALTER TABLE public.accounting_exceptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.accounting_exceptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.accounting_exceptions TO authenticated;
GRANT ALL ON TABLE public.accounting_exceptions TO service_role;
CREATE POLICY accounting_exceptions_select ON public.accounting_exceptions
  FOR SELECT TO authenticated USING (public.finza_rls_can_read_accounting_business(business_id));
CREATE POLICY accounting_exceptions_insert ON public.accounting_exceptions
  FOR INSERT TO authenticated WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));
CREATE POLICY accounting_exceptions_update ON public.accounting_exceptions
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(business_id))
  WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));

ALTER TABLE public.accounting_period_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.accounting_period_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.accounting_period_actions TO authenticated;
GRANT ALL ON TABLE public.accounting_period_actions TO service_role;
CREATE POLICY accounting_period_actions_select ON public.accounting_period_actions
  FOR SELECT TO authenticated USING (public.finza_rls_can_read_accounting_business(business_id));
CREATE POLICY accounting_period_actions_insert ON public.accounting_period_actions
  FOR INSERT TO authenticated WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));

ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chart_of_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.chart_of_accounts TO authenticated;
GRANT ALL ON TABLE public.chart_of_accounts TO service_role;
CREATE POLICY chart_of_accounts_select ON public.chart_of_accounts
  FOR SELECT TO authenticated USING (public.finza_rls_can_read_accounting_business(business_id));
CREATE POLICY chart_of_accounts_insert ON public.chart_of_accounts
  FOR INSERT TO authenticated WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));
CREATE POLICY chart_of_accounts_update ON public.chart_of_accounts
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(business_id))
  WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));

ALTER TABLE public.chart_of_accounts_control_map ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chart_of_accounts_control_map FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.chart_of_accounts_control_map TO authenticated;
GRANT ALL ON TABLE public.chart_of_accounts_control_map TO service_role;
CREATE POLICY chart_of_accounts_control_map_select ON public.chart_of_accounts_control_map
  FOR SELECT TO authenticated USING (public.finza_rls_can_read_accounting_business(business_id));
CREATE POLICY chart_of_accounts_control_map_insert ON public.chart_of_accounts_control_map
  FOR INSERT TO authenticated WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));
CREATE POLICY chart_of_accounts_control_map_update ON public.chart_of_accounts_control_map
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_write_accounting_business(business_id))
  WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));

ALTER TABLE public.coa_mapping_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.coa_mapping_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.coa_mapping_lines TO authenticated;
GRANT ALL ON TABLE public.coa_mapping_lines TO service_role;
CREATE POLICY coa_mapping_lines_select ON public.coa_mapping_lines
  FOR SELECT TO authenticated USING (public.finza_rls_can_access_account(account_id));

ALTER TABLE public.opening_balance_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.opening_balance_batches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.opening_balance_batches TO authenticated;
GRANT ALL ON TABLE public.opening_balance_batches TO service_role;
CREATE POLICY opening_balance_batches_select ON public.opening_balance_batches
  FOR SELECT TO authenticated USING (public.finza_rls_can_read_accounting_business(business_id));
CREATE POLICY opening_balance_batches_insert ON public.opening_balance_batches
  FOR INSERT TO authenticated WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));

ALTER TABLE public.opening_balance_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.opening_balance_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.opening_balance_lines TO authenticated;
GRANT ALL ON TABLE public.opening_balance_lines TO service_role;
CREATE POLICY opening_balance_lines_select ON public.opening_balance_lines
  FOR SELECT TO authenticated
  USING (public.finza_rls_can_read_accounting_business(public.finza_rls_batch_business_id(batch_id)));
CREATE POLICY opening_balance_lines_insert ON public.opening_balance_lines
  FOR INSERT TO authenticated
  WITH CHECK (public.finza_rls_can_write_accounting_business(public.finza_rls_batch_business_id(batch_id)));

ALTER TABLE public.period_close_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.period_close_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.period_close_attempts TO authenticated;
GRANT ALL ON TABLE public.period_close_attempts TO service_role;
CREATE POLICY period_close_attempts_select ON public.period_close_attempts
  FOR SELECT TO authenticated USING (public.finza_rls_can_read_accounting_business(business_id));
CREATE POLICY period_close_attempts_insert ON public.period_close_attempts
  FOR INSERT TO authenticated WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));

ALTER TABLE public.reconciliation_resolutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reconciliation_resolutions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.reconciliation_resolutions TO authenticated;
GRANT ALL ON TABLE public.reconciliation_resolutions TO service_role;
CREATE POLICY reconciliation_resolutions_select ON public.reconciliation_resolutions
  FOR SELECT TO authenticated USING (public.finza_rls_can_read_accounting_business(business_id));
CREATE POLICY reconciliation_resolutions_insert ON public.reconciliation_resolutions
  FOR INSERT TO authenticated WITH CHECK (public.finza_rls_can_write_accounting_business(business_id));

-- ---------------------------------------------------------------------------
-- 6. Retail/business data.
-- ---------------------------------------------------------------------------
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.categories FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.categories TO authenticated;
GRANT ALL ON TABLE public.categories TO service_role;
CREATE POLICY categories_select ON public.categories
  FOR SELECT TO authenticated USING (public.finza_rls_can_read_business(business_id));
CREATE POLICY categories_insert ON public.categories
  FOR INSERT TO authenticated WITH CHECK (public.finza_rls_can_write_retail(business_id));
CREATE POLICY categories_update ON public.categories
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_write_retail(business_id))
  WITH CHECK (public.finza_rls_can_write_retail(business_id));
CREATE POLICY categories_delete ON public.categories
  FOR DELETE TO authenticated USING (public.finza_rls_can_write_retail(business_id));

ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.items TO authenticated;
GRANT ALL ON TABLE public.items TO service_role;
CREATE POLICY items_select ON public.items
  FOR SELECT TO authenticated USING (public.finza_rls_can_read_business(business_id));

ALTER TABLE public.customer_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customer_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_notes TO authenticated;
GRANT ALL ON TABLE public.customer_notes TO service_role;
CREATE POLICY customer_notes_select ON public.customer_notes
  FOR SELECT TO authenticated USING (public.finza_rls_can_read_business(business_id));
CREATE POLICY customer_notes_insert ON public.customer_notes
  FOR INSERT TO authenticated WITH CHECK (public.finza_rls_can_write_retail(business_id));
CREATE POLICY customer_notes_update ON public.customer_notes
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_write_retail(business_id))
  WITH CHECK (public.finza_rls_can_write_retail(business_id));
CREATE POLICY customer_notes_delete ON public.customer_notes
  FOR DELETE TO authenticated USING (public.finza_rls_can_write_retail(business_id));

ALTER TABLE public.internal_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.internal_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.internal_alerts TO authenticated;
GRANT ALL ON TABLE public.internal_alerts TO service_role;
CREATE POLICY internal_alerts_select ON public.internal_alerts
  FOR SELECT TO authenticated USING (public.finza_rls_can_read_business(business_id));
CREATE POLICY internal_alerts_update ON public.internal_alerts
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_read_business(business_id))
  WITH CHECK (public.finza_rls_can_read_business(business_id));

ALTER TABLE public.cashier_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cashier_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cashier_sessions TO authenticated;
GRANT ALL ON TABLE public.cashier_sessions TO service_role;
CREATE POLICY cashier_sessions_select ON public.cashier_sessions
  FOR SELECT TO authenticated USING (public.finza_rls_can_read_business(business_id));
CREATE POLICY cashier_sessions_insert ON public.cashier_sessions
  FOR INSERT TO authenticated
  WITH CHECK (public.finza_rls_can_write_retail(business_id) AND user_id = auth.uid());
CREATE POLICY cashier_sessions_update ON public.cashier_sessions
  FOR UPDATE TO authenticated
  USING (
    public.finza_rls_can_write_retail(business_id)
    AND (user_id = auth.uid() OR public.finza_rls_can_manage_business(business_id))
  )
  WITH CHECK (
    public.finza_rls_can_write_retail(business_id)
    AND (user_id = auth.uid() OR public.finza_rls_can_manage_business(business_id))
  );
CREATE POLICY cashier_sessions_delete ON public.cashier_sessions
  FOR DELETE TO authenticated USING (public.finza_rls_can_manage_business(business_id));

ALTER TABLE public.cash_drops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cash_drops FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cash_drops TO authenticated;
GRANT ALL ON TABLE public.cash_drops TO service_role;
CREATE POLICY cash_drops_select ON public.cash_drops
  FOR SELECT TO authenticated USING (public.finza_rls_can_access_session(session_id));
CREATE POLICY cash_drops_insert ON public.cash_drops
  FOR INSERT TO authenticated WITH CHECK (public.finza_rls_can_write_session(session_id));
CREATE POLICY cash_drops_update ON public.cash_drops
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_write_session(session_id))
  WITH CHECK (public.finza_rls_can_write_session(session_id));
CREATE POLICY cash_drops_delete ON public.cash_drops
  FOR DELETE TO authenticated USING (public.finza_rls_can_write_session(session_id));

ALTER TABLE public.register_variances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.register_variances FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.register_variances TO authenticated;
GRANT ALL ON TABLE public.register_variances TO service_role;
CREATE POLICY register_variances_select ON public.register_variances
  FOR SELECT TO authenticated USING (public.finza_rls_can_access_session(session_id));
CREATE POLICY register_variances_insert ON public.register_variances
  FOR INSERT TO authenticated WITH CHECK (public.finza_rls_can_manage_session(session_id));
CREATE POLICY register_variances_update ON public.register_variances
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_manage_session(session_id))
  WITH CHECK (public.finza_rls_can_manage_session(session_id));
CREATE POLICY register_variances_delete ON public.register_variances
  FOR DELETE TO authenticated USING (public.finza_rls_can_manage_session(session_id));

ALTER TABLE public.overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.overrides FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.overrides TO authenticated;
GRANT ALL ON TABLE public.overrides TO service_role;
CREATE POLICY overrides_select ON public.overrides
  FOR SELECT TO authenticated USING (public.finza_rls_can_access_sale(reference_id));

ALTER TABLE public.parked_sales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.parked_sales FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.parked_sales TO authenticated;
GRANT ALL ON TABLE public.parked_sales TO service_role;
CREATE POLICY parked_sales_select ON public.parked_sales
  FOR SELECT TO authenticated USING (public.finza_rls_can_read_business(business_id));
CREATE POLICY parked_sales_insert ON public.parked_sales
  FOR INSERT TO authenticated WITH CHECK (public.finza_rls_can_write_retail(business_id));
CREATE POLICY parked_sales_update ON public.parked_sales
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_write_retail(business_id))
  WITH CHECK (public.finza_rls_can_write_retail(business_id));
CREATE POLICY parked_sales_delete ON public.parked_sales
  FOR DELETE TO authenticated USING (public.finza_rls_can_write_retail(business_id));

ALTER TABLE public.quick_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quick_keys FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quick_keys TO authenticated;
GRANT ALL ON TABLE public.quick_keys TO service_role;
CREATE POLICY quick_keys_select ON public.quick_keys
  FOR SELECT TO authenticated USING (public.finza_rls_can_read_business(business_id));
CREATE POLICY quick_keys_insert ON public.quick_keys
  FOR INSERT TO authenticated WITH CHECK (public.finza_rls_can_write_retail(business_id));
CREATE POLICY quick_keys_update ON public.quick_keys
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_write_retail(business_id))
  WITH CHECK (public.finza_rls_can_write_retail(business_id));
CREATE POLICY quick_keys_delete ON public.quick_keys
  FOR DELETE TO authenticated USING (public.finza_rls_can_write_retail(business_id));

ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.riders FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.riders TO authenticated;
GRANT ALL ON TABLE public.riders TO service_role;
CREATE POLICY riders_select ON public.riders
  FOR SELECT TO authenticated USING (public.finza_rls_can_read_business(business_id));
CREATE POLICY riders_insert ON public.riders
  FOR INSERT TO authenticated WITH CHECK (public.finza_rls_can_write_retail(business_id));
CREATE POLICY riders_update ON public.riders
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_write_retail(business_id))
  WITH CHECK (public.finza_rls_can_write_retail(business_id));
CREATE POLICY riders_delete ON public.riders
  FOR DELETE TO authenticated USING (public.finza_rls_can_write_retail(business_id));

ALTER TABLE public.rider_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rider_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rider_deliveries TO authenticated;
GRANT ALL ON TABLE public.rider_deliveries TO service_role;
CREATE POLICY rider_deliveries_select ON public.rider_deliveries
  FOR SELECT TO authenticated USING (public.finza_rls_can_read_business(business_id));
CREATE POLICY rider_deliveries_insert ON public.rider_deliveries
  FOR INSERT TO authenticated WITH CHECK (public.finza_rls_can_write_retail(business_id));
CREATE POLICY rider_deliveries_update ON public.rider_deliveries
  FOR UPDATE TO authenticated
  USING (public.finza_rls_can_write_retail(business_id))
  WITH CHECK (public.finza_rls_can_write_retail(business_id));
CREATE POLICY rider_deliveries_delete ON public.rider_deliveries
  FOR DELETE TO authenticated USING (public.finza_rls_can_write_retail(business_id));

-- ---------------------------------------------------------------------------
-- 7. Legacy / internal / debug tables: no direct client access.
--    RLS is enabled and no authenticated/anon privileges remain; service_role
--    retains full access for backend, RPC and migration work.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'accountant_client_access','accountant_firm_users','accountant_firms',
    'accounting_adjustments','accounting_invariant_runs','adjusting_journal_drafts',
    'backfill_audit_log','clients','diagnostic_journal_lines_log','retail_cost_updates',
    'retail_posting_debug_log','salon_services'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

COMMENT ON TABLE public.business_users IS
  'Tenant membership. RLS 716 reuses 580: members read their tenant; owners insert only their own admin row; owners/admins/managers manage other members within product role rules. Anonymous access revoked.';
COMMENT ON TABLE public.users IS
  'Identity mirror. RLS 716: shared-tenant/firm visibility; self insert; protected identity fields (id/email/pin_code/created_at) are server-controlled; pin_code is not granted to authenticated.';
