-- Staging-first least privilege for public.business_users.
-- Anonymous clients lose every privilege. Authenticated clients keep only
-- the membership actions the product already performs, enforced by RLS.
-- service_role bypasses RLS and remains the path for staff provisioning.

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
      SELECT 1
      FROM public.businesses b
      WHERE b.id = p_business_id
        AND b.owner_id = auth.uid()
    ) THEN 'owner'
    ELSE (
      SELECT bu.role
      FROM public.business_users bu
      WHERE bu.business_id = p_business_id
        AND bu.user_id = auth.uid()
      LIMIT 1
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.finza_caller_membership_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finza_caller_membership_role(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.finza_caller_membership_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finza_caller_membership_role(uuid) TO service_role;

COMMENT ON FUNCTION public.finza_caller_membership_role(uuid) IS
  'Caller role for business_users policies. Owner comes from businesses.owner_id. Does not use user_metadata.';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'business_users'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.business_users', r.policyname);
  END LOOP;
END $$;

ALTER TABLE public.business_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_users FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_users FROM PUBLIC;
REVOKE ALL ON TABLE public.business_users FROM anon;
REVOKE ALL ON TABLE public.business_users FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_users TO authenticated;
GRANT ALL ON TABLE public.business_users TO service_role;

DROP POLICY IF EXISTS business_users_select_member ON public.business_users;
CREATE POLICY business_users_select_member
  ON public.business_users
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.finza_caller_membership_role(business_id) IS NOT NULL
  );

DROP POLICY IF EXISTS business_users_insert_own_admin ON public.business_users;
CREATE POLICY business_users_insert_own_admin
  ON public.business_users
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'admin'
    AND EXISTS (
      SELECT 1
      FROM public.businesses b
      WHERE b.id = business_id
        AND b.owner_id = auth.uid()
        AND b.archived_at IS NULL
    )
  );

DROP POLICY IF EXISTS business_users_update_managed ON public.business_users;
CREATE POLICY business_users_update_managed
  ON public.business_users
  FOR UPDATE
  TO authenticated
  USING (
    user_id IS DISTINCT FROM auth.uid()
    AND public.finza_caller_membership_role(business_id) IN ('owner', 'admin', 'manager')
  )
  WITH CHECK (
    user_id IS DISTINCT FROM auth.uid()
    AND public.finza_caller_membership_role(business_id) IN ('owner', 'admin', 'manager')
  );

DROP POLICY IF EXISTS business_users_delete_managed ON public.business_users;
CREATE POLICY business_users_delete_managed
  ON public.business_users
  FOR DELETE
  TO authenticated
  USING (
    user_id IS DISTINCT FROM auth.uid()
    AND user_id IS DISTINCT FROM (
      SELECT b.owner_id FROM public.businesses b WHERE b.id = business_users.business_id
    )
    AND (
      (
        public.finza_caller_membership_role(business_id) = 'owner'
        AND role IN ('admin', 'manager', 'cashier', 'accountant', 'staff')
      )
      OR (
        public.finza_caller_membership_role(business_id) = 'admin'
        AND role IN ('manager', 'cashier')
      )
      OR (
        public.finza_caller_membership_role(business_id) = 'manager'
        AND role = 'cashier'
      )
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
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
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
      RAISE EXCEPTION 'business_users identity cannot be changed'
        USING ERRCODE = '42501';
    END IF;
    IF OLD.user_id = auth.uid() AND (
      NEW.role IS DISTINCT FROM OLD.role
      OR NEW.custom_permissions IS DISTINCT FROM OLD.custom_permissions
    ) THEN
      RAISE EXCEPTION 'cannot change your own membership role or permissions'
        USING ERRCODE = '42501';
    END IF;

    v_actor := public.finza_caller_membership_role(OLD.business_id);
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'business_users update is not allowed'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.role IS DISTINCT FROM OLD.role OR NEW.custom_permissions IS DISTINCT FROM OLD.custom_permissions THEN
      IF v_actor = 'owner' THEN
        IF NEW.role NOT IN ('admin', 'manager', 'cashier', 'accountant', 'staff') THEN
          RAISE EXCEPTION 'owner cannot assign this membership role'
            USING ERRCODE = '42501';
        END IF;
      ELSIF v_actor = 'admin' THEN
        IF OLD.role NOT IN ('manager', 'cashier') OR NEW.role NOT IN ('manager', 'cashier') THEN
          RAISE EXCEPTION 'admin cannot change this membership'
            USING ERRCODE = '42501';
        END IF;
      ELSIF v_actor = 'manager' THEN
        IF OLD.role IS DISTINCT FROM 'cashier' OR NEW.role IS DISTINCT FROM 'cashier' THEN
          RAISE EXCEPTION 'manager cannot change this membership'
            USING ERRCODE = '42501';
        END IF;
      ELSE
        RAISE EXCEPTION 'this role cannot manage memberships'
          USING ERRCODE = '42501';
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
  FOR EACH ROW
  EXECUTE FUNCTION public.finza_business_users_guard_write();

COMMENT ON TABLE public.business_users IS
  'Tenant membership. RLS: members read their tenant; owners insert only their own admin row; owners/admins/managers manage other members within product role rules. Anonymous access revoked.';
