-- 719_rls_products_services.sql
-- Final release continuation: tenant-scope public.products_services.
--
-- 718 is occupied by pre-existing unrelated work, so this release uses 719.
-- Reuses the 716 helpers; no new permission framework.
--
-- Access:
--   * anon/PUBLIC: none.
--   * read: business owner/member or active accounting-firm engagement.
--   * insert/update/delete: owner/admin/manager of the business, or an
--     accounting-firm engagement with write/approve access.
--   * staff/accountant/read-only/cashier cannot mutate the catalogue.
--   * service_role retains full access.
--
-- Protected fields (id, business_id, created_at) cannot be changed by clients.

ALTER TABLE public.products_services ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='products_services' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.products_services', r.policyname);
  END LOOP;
END $$;

REVOKE ALL ON TABLE public.products_services FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.products_services TO authenticated;
GRANT ALL ON TABLE public.products_services TO service_role;

CREATE POLICY products_services_select ON public.products_services
  FOR SELECT TO authenticated
  USING (
    public.finza_rls_can_read_business(business_id)
    OR public.finza_rls_has_engagement(business_id, 'read')
  );

CREATE POLICY products_services_insert ON public.products_services
  FOR INSERT TO authenticated
  WITH CHECK (
    public.finza_rls_can_manage_business(business_id)
    OR public.finza_rls_has_engagement(business_id, 'write')
  );

CREATE POLICY products_services_update ON public.products_services
  FOR UPDATE TO authenticated
  USING (
    public.finza_rls_can_manage_business(business_id)
    OR public.finza_rls_has_engagement(business_id, 'write')
  )
  WITH CHECK (
    public.finza_rls_can_manage_business(business_id)
    OR public.finza_rls_has_engagement(business_id, 'write')
  );

CREATE POLICY products_services_delete ON public.products_services
  FOR DELETE TO authenticated
  USING (
    public.finza_rls_can_manage_business(business_id)
    OR public.finza_rls_has_engagement(business_id, 'write')
  );

CREATE OR REPLACE FUNCTION public.finza_products_services_guard_write()
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

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.business_id IS DISTINCT FROM OLD.business_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'products_services protected fields cannot be changed'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_services_guard_write ON public.products_services;
CREATE TRIGGER trg_products_services_guard_write
  BEFORE UPDATE ON public.products_services
  FOR EACH ROW EXECUTE FUNCTION public.finza_products_services_guard_write();

COMMENT ON TABLE public.products_services IS
  'Tenant service/product catalogue. RLS 719: members read; owner/admin/manager or engaged firm write; protected identity fields immutable; anon denied.';
