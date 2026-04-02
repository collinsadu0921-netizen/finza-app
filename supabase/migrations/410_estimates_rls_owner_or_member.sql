-- Estimates / estimate_items RLS: allow business owner OR business_users member.
-- Previous policies only checked business_users, so pure owners (no team row) could not
-- read/write via the browser Supabase client.

-- Requires public.finza_user_can_access_business (382_payroll_rls_business_members.sql).

-- 1. estimates
DROP POLICY IF EXISTS "Users can view estimates for their business" ON estimates;
CREATE POLICY "Users can view estimates for their business"
  ON estimates FOR SELECT
  USING (public.finza_user_can_access_business(estimates.business_id));

DROP POLICY IF EXISTS "Users can insert estimates for their business" ON estimates;
CREATE POLICY "Users can insert estimates for their business"
  ON estimates FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(estimates.business_id));

DROP POLICY IF EXISTS "Users can update estimates for their business" ON estimates;
CREATE POLICY "Users can update estimates for their business"
  ON estimates FOR UPDATE
  USING (public.finza_user_can_access_business(estimates.business_id))
  WITH CHECK (public.finza_user_can_access_business(estimates.business_id));

DROP POLICY IF EXISTS "Users can delete estimates for their business" ON estimates;
CREATE POLICY "Users can delete estimates for their business"
  ON estimates FOR DELETE
  USING (public.finza_user_can_access_business(estimates.business_id));

-- 2. estimate_items (inherit tenant via parent estimate)
DROP POLICY IF EXISTS "Users can view estimate items for their business estimates" ON estimate_items;
CREATE POLICY "Users can view estimate items for their business estimates"
  ON estimate_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM estimates e
      WHERE e.id = estimate_items.estimate_id
        AND public.finza_user_can_access_business(e.business_id)
    )
  );

DROP POLICY IF EXISTS "Users can insert estimate items for their business estimates" ON estimate_items;
CREATE POLICY "Users can insert estimate items for their business estimates"
  ON estimate_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM estimates e
      WHERE e.id = estimate_items.estimate_id
        AND public.finza_user_can_access_business(e.business_id)
    )
  );

DROP POLICY IF EXISTS "Users can update estimate items for their business estimates" ON estimate_items;
CREATE POLICY "Users can update estimate items for their business estimates"
  ON estimate_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM estimates e
      WHERE e.id = estimate_items.estimate_id
        AND public.finza_user_can_access_business(e.business_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM estimates e
      WHERE e.id = estimate_items.estimate_id
        AND public.finza_user_can_access_business(e.business_id)
    )
  );

DROP POLICY IF EXISTS "Users can delete estimate items for their business estimates" ON estimate_items;
CREATE POLICY "Users can delete estimate items for their business estimates"
  ON estimate_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM estimates e
      WHERE e.id = estimate_items.estimate_id
        AND public.finza_user_can_access_business(e.business_id)
    )
  );
