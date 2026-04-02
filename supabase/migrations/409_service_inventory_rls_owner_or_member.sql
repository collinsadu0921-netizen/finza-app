-- Service workspace inventory/jobs RLS: allow business owner OR business_users member.
-- Previous policies only checked business_users, so pure owners (no team row) could not
-- read/update service_jobs etc. via the browser Supabase client.

-- Requires public.finza_user_can_access_business (382_payroll_rls_business_members.sql).

-- 1. service_catalog
DROP POLICY IF EXISTS "Users can view service_catalog for their business" ON service_catalog;
CREATE POLICY "Users can view service_catalog for their business"
  ON service_catalog FOR SELECT
  USING (public.finza_user_can_access_business(service_catalog.business_id));

DROP POLICY IF EXISTS "Users can insert service_catalog for their business" ON service_catalog;
CREATE POLICY "Users can insert service_catalog for their business"
  ON service_catalog FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(service_catalog.business_id));

DROP POLICY IF EXISTS "Users can update service_catalog for their business" ON service_catalog;
CREATE POLICY "Users can update service_catalog for their business"
  ON service_catalog FOR UPDATE
  USING (public.finza_user_can_access_business(service_catalog.business_id))
  WITH CHECK (public.finza_user_can_access_business(service_catalog.business_id));

DROP POLICY IF EXISTS "Users can delete service_catalog for their business" ON service_catalog;
CREATE POLICY "Users can delete service_catalog for their business"
  ON service_catalog FOR DELETE
  USING (public.finza_user_can_access_business(service_catalog.business_id));

-- 2. service_material_inventory
DROP POLICY IF EXISTS "Users can view service_material_inventory for their business" ON service_material_inventory;
CREATE POLICY "Users can view service_material_inventory for their business"
  ON service_material_inventory FOR SELECT
  USING (public.finza_user_can_access_business(service_material_inventory.business_id));

DROP POLICY IF EXISTS "Users can insert service_material_inventory for their business" ON service_material_inventory;
CREATE POLICY "Users can insert service_material_inventory for their business"
  ON service_material_inventory FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(service_material_inventory.business_id));

DROP POLICY IF EXISTS "Users can update service_material_inventory for their business" ON service_material_inventory;
CREATE POLICY "Users can update service_material_inventory for their business"
  ON service_material_inventory FOR UPDATE
  USING (public.finza_user_can_access_business(service_material_inventory.business_id))
  WITH CHECK (public.finza_user_can_access_business(service_material_inventory.business_id));

DROP POLICY IF EXISTS "Users can delete service_material_inventory for their business" ON service_material_inventory;
CREATE POLICY "Users can delete service_material_inventory for their business"
  ON service_material_inventory FOR DELETE
  USING (public.finza_user_can_access_business(service_material_inventory.business_id));

-- 3. service_material_movements
DROP POLICY IF EXISTS "Users can view service_material_movements for their business" ON service_material_movements;
CREATE POLICY "Users can view service_material_movements for their business"
  ON service_material_movements FOR SELECT
  USING (public.finza_user_can_access_business(service_material_movements.business_id));

DROP POLICY IF EXISTS "Users can insert service_material_movements for their business" ON service_material_movements;
CREATE POLICY "Users can insert service_material_movements for their business"
  ON service_material_movements FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(service_material_movements.business_id));

-- 4. service_jobs
DROP POLICY IF EXISTS "Users can view service_jobs for their business" ON service_jobs;
CREATE POLICY "Users can view service_jobs for their business"
  ON service_jobs FOR SELECT
  USING (public.finza_user_can_access_business(service_jobs.business_id));

DROP POLICY IF EXISTS "Users can insert service_jobs for their business" ON service_jobs;
CREATE POLICY "Users can insert service_jobs for their business"
  ON service_jobs FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(service_jobs.business_id));

DROP POLICY IF EXISTS "Users can update service_jobs for their business" ON service_jobs;
CREATE POLICY "Users can update service_jobs for their business"
  ON service_jobs FOR UPDATE
  USING (public.finza_user_can_access_business(service_jobs.business_id))
  WITH CHECK (public.finza_user_can_access_business(service_jobs.business_id));

DROP POLICY IF EXISTS "Users can delete service_jobs for their business" ON service_jobs;
CREATE POLICY "Users can delete service_jobs for their business"
  ON service_jobs FOR DELETE
  USING (public.finza_user_can_access_business(service_jobs.business_id));

-- 5. service_job_material_usage
DROP POLICY IF EXISTS "Users can view service_job_material_usage for their business" ON service_job_material_usage;
CREATE POLICY "Users can view service_job_material_usage for their business"
  ON service_job_material_usage FOR SELECT
  USING (public.finza_user_can_access_business(service_job_material_usage.business_id));

DROP POLICY IF EXISTS "Users can insert service_job_material_usage for their business" ON service_job_material_usage;
CREATE POLICY "Users can insert service_job_material_usage for their business"
  ON service_job_material_usage FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(service_job_material_usage.business_id));

DROP POLICY IF EXISTS "Users can update service_job_material_usage for their business" ON service_job_material_usage;
CREATE POLICY "Users can update service_job_material_usage for their business"
  ON service_job_material_usage FOR UPDATE
  USING (public.finza_user_can_access_business(service_job_material_usage.business_id))
  WITH CHECK (public.finza_user_can_access_business(service_job_material_usage.business_id));

DROP POLICY IF EXISTS "Users can delete service_job_material_usage for their business" ON service_job_material_usage;
CREATE POLICY "Users can delete service_job_material_usage for their business"
  ON service_job_material_usage FOR DELETE
  USING (public.finza_user_can_access_business(service_job_material_usage.business_id));
