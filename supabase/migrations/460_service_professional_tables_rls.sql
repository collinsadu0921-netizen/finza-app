-- ============================================================================
-- Phase 3: RLS hardening for Professional-only Service workspace tables
--
-- Adds public.finza_business_has_service_min_tier(business_id, min_tier) and
-- tightens RLS on staff + service inventory/job tables so Essentials cannot
-- bypass TierGate via direct Supabase client calls.
--
-- Industry scope: only businesses with lower(industry) in ('service','professional')
-- get tier checks. Retail and other industries: helper returns true (unchanged).
--
-- Tier / lock semantics mirror lib/serviceWorkspace/resolveServiceEntitlement.ts:
-- - effectiveTier = starter when status=trialing AND trial_ends_at <= now()
-- - otherwise effectiveTier from service_subscription_tier (aliases normalized)
-- - subscription blocked when status='locked' OR subscription_grace_until <= now()
-- - past_due without expired grace does NOT block here (matches API)
-- - current_period_ends_at / period expiry is NOT enforced in this helper (warning-only in app)
--
-- Server / service-role: bypasses RLS (unchanged).
--
-- ROLLBACK (manual — apply only if reverting this migration):
--   1. DROP policies listed under "New policies" below and recreate prior definitions
--      from migrations 382_payroll_rls_business_members.sql + 409_service_inventory_rls_owner_or_member.sql
--      (membership only, no tier helper).
--   2. DROP FUNCTION public.finza_business_has_service_min_tier(uuid, text);
--   Note: Re-adding legacy owner-only policies from 321_service_inventory.sql would weaken security;
--   prefer restoring only the 409 policy bodies if rolling back tier logic.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.finza_business_has_service_min_tier(
  p_business_id uuid,
  p_min_tier text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_industry text;
  v_raw_tier text;
  v_status text;
  v_trial_ends timestamptz;
  v_grace_until timestamptz;
  v_effective text;
  v_min_rank int;
  v_eff_rank int;
  v_locked boolean;
BEGIN
  IF p_business_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT
    lower(trim(coalesce(b.industry, ''))),
    lower(trim(coalesce(b.service_subscription_tier, ''))),
    lower(trim(coalesce(nullif(trim(b.service_subscription_status), ''), 'active'))),
    b.trial_ends_at,
    b.subscription_grace_until
  INTO v_industry, v_raw_tier, v_status, v_trial_ends, v_grace_until
  FROM public.businesses b
  WHERE b.id = p_business_id
    AND b.archived_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Retail / non-Service workspaces: do not tier-gate these rows at RLS layer
  IF v_industry NOT IN ('service', 'professional') THEN
    RETURN true;
  END IF;

  -- Payment lock (matches resolveServiceEntitlement.isSubscriptionLocked)
  v_locked :=
    (v_status = 'locked')
    OR (v_grace_until IS NOT NULL AND now() >= v_grace_until);

  IF v_locked THEN
    RETURN false;
  END IF;

  -- Effective tier (trial expiry → silent downgrade to starter)
  IF v_status = 'trialing'
     AND v_trial_ends IS NOT NULL
     AND now() >= v_trial_ends THEN
    v_effective := 'starter';
  ELSE
    IF v_raw_tier IN ('professional', 'growth', 'pro') THEN
      v_effective := 'professional';
    ELSIF v_raw_tier IN ('business', 'scale', 'enterprise') THEN
      v_effective := 'business';
    ELSIF v_raw_tier IN ('starter', 'essentials') THEN
      v_effective := 'starter';
    ELSE
      -- Unknown / empty → fail-safe starter (matches DEFAULT_SERVICE_SUBSCRIPTION_TIER)
      v_effective := 'starter';
    END IF;
  END IF;

  v_min_rank := CASE lower(trim(coalesce(p_min_tier, 'starter')))
    WHEN 'starter' THEN 0
    WHEN 'professional' THEN 1
    WHEN 'business' THEN 2
    ELSE 0
  END;

  v_eff_rank := CASE v_effective
    WHEN 'starter' THEN 0
    WHEN 'professional' THEN 1
    WHEN 'business' THEN 2
    ELSE 0
  END;

  RETURN v_eff_rank >= v_min_rank;
END;
$$;

COMMENT ON FUNCTION public.finza_business_has_service_min_tier(uuid, text) IS
  'Service/professional industry: false when subscription locked or effective tier below p_min_tier; other industries always true. Aligns with resolveServiceEntitlement (not period-expiry UX warnings).';

GRANT EXECUTE ON FUNCTION public.finza_business_has_service_min_tier(uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- Remove duplicate legacy owner-only policies (321) that OR with 409 policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "service_material_inventory_select_own_business" ON public.service_material_inventory;
DROP POLICY IF EXISTS "service_material_inventory_insert_own_business" ON public.service_material_inventory;
DROP POLICY IF EXISTS "service_material_inventory_update_own_business" ON public.service_material_inventory;
DROP POLICY IF EXISTS "service_material_inventory_delete_own_business" ON public.service_material_inventory;

DROP POLICY IF EXISTS "service_material_movements_select_own_business" ON public.service_material_movements;
DROP POLICY IF EXISTS "service_material_movements_insert_own_business" ON public.service_material_movements;

DROP POLICY IF EXISTS "service_jobs_select_own_business" ON public.service_jobs;
DROP POLICY IF EXISTS "service_jobs_insert_own_business" ON public.service_jobs;
DROP POLICY IF EXISTS "service_jobs_update_own_business" ON public.service_jobs;
DROP POLICY IF EXISTS "service_jobs_delete_own_business" ON public.service_jobs;

DROP POLICY IF EXISTS "service_job_material_usage_select_own_business" ON public.service_job_material_usage;
DROP POLICY IF EXISTS "service_job_material_usage_insert_own_business" ON public.service_job_material_usage;
DROP POLICY IF EXISTS "service_job_material_usage_update_own_business" ON public.service_job_material_usage;
DROP POLICY IF EXISTS "service_job_material_usage_delete_own_business" ON public.service_job_material_usage;

-- ----------------------------------------------------------------------------
-- Replace membership-only policies (382 staff, 409 service tables)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view staff for their business" ON public.staff;
DROP POLICY IF EXISTS "Users can insert staff for their business" ON public.staff;
DROP POLICY IF EXISTS "Users can update staff for their business" ON public.staff;
DROP POLICY IF EXISTS "Users can delete staff for their business" ON public.staff;

CREATE POLICY "Users can view staff for their business"
  ON public.staff FOR SELECT
  USING (
    public.finza_user_can_access_business(staff.business_id)
    AND public.finza_business_has_service_min_tier(staff.business_id, 'professional')
  );

CREATE POLICY "Users can insert staff for their business"
  ON public.staff FOR INSERT
  WITH CHECK (
    public.finza_user_can_access_business(staff.business_id)
    AND public.finza_business_has_service_min_tier(staff.business_id, 'professional')
  );

CREATE POLICY "Users can update staff for their business"
  ON public.staff FOR UPDATE
  USING (
    public.finza_user_can_access_business(staff.business_id)
    AND public.finza_business_has_service_min_tier(staff.business_id, 'professional')
  )
  WITH CHECK (
    public.finza_user_can_access_business(staff.business_id)
    AND public.finza_business_has_service_min_tier(staff.business_id, 'professional')
  );

CREATE POLICY "Users can delete staff for their business"
  ON public.staff FOR DELETE
  USING (
    public.finza_user_can_access_business(staff.business_id)
    AND public.finza_business_has_service_min_tier(staff.business_id, 'professional')
  );

-- service_material_inventory
DROP POLICY IF EXISTS "Users can view service_material_inventory for their business" ON public.service_material_inventory;
DROP POLICY IF EXISTS "Users can insert service_material_inventory for their business" ON public.service_material_inventory;
DROP POLICY IF EXISTS "Users can update service_material_inventory for their business" ON public.service_material_inventory;
DROP POLICY IF EXISTS "Users can delete service_material_inventory for their business" ON public.service_material_inventory;

CREATE POLICY "Users can view service_material_inventory for their business"
  ON public.service_material_inventory FOR SELECT
  USING (
    public.finza_user_can_access_business(service_material_inventory.business_id)
    AND public.finza_business_has_service_min_tier(service_material_inventory.business_id, 'professional')
  );

CREATE POLICY "Users can insert service_material_inventory for their business"
  ON public.service_material_inventory FOR INSERT
  WITH CHECK (
    public.finza_user_can_access_business(service_material_inventory.business_id)
    AND public.finza_business_has_service_min_tier(service_material_inventory.business_id, 'professional')
  );

CREATE POLICY "Users can update service_material_inventory for their business"
  ON public.service_material_inventory FOR UPDATE
  USING (
    public.finza_user_can_access_business(service_material_inventory.business_id)
    AND public.finza_business_has_service_min_tier(service_material_inventory.business_id, 'professional')
  )
  WITH CHECK (
    public.finza_user_can_access_business(service_material_inventory.business_id)
    AND public.finza_business_has_service_min_tier(service_material_inventory.business_id, 'professional')
  );

CREATE POLICY "Users can delete service_material_inventory for their business"
  ON public.service_material_inventory FOR DELETE
  USING (
    public.finza_user_can_access_business(service_material_inventory.business_id)
    AND public.finza_business_has_service_min_tier(service_material_inventory.business_id, 'professional')
  );

-- service_material_movements
DROP POLICY IF EXISTS "Users can view service_material_movements for their business" ON public.service_material_movements;
DROP POLICY IF EXISTS "Users can insert service_material_movements for their business" ON public.service_material_movements;

CREATE POLICY "Users can view service_material_movements for their business"
  ON public.service_material_movements FOR SELECT
  USING (
    public.finza_user_can_access_business(service_material_movements.business_id)
    AND public.finza_business_has_service_min_tier(service_material_movements.business_id, 'professional')
  );

CREATE POLICY "Users can insert service_material_movements for their business"
  ON public.service_material_movements FOR INSERT
  WITH CHECK (
    public.finza_user_can_access_business(service_material_movements.business_id)
    AND public.finza_business_has_service_min_tier(service_material_movements.business_id, 'professional')
  );

-- service_jobs
DROP POLICY IF EXISTS "Users can view service_jobs for their business" ON public.service_jobs;
DROP POLICY IF EXISTS "Users can insert service_jobs for their business" ON public.service_jobs;
DROP POLICY IF EXISTS "Users can update service_jobs for their business" ON public.service_jobs;
DROP POLICY IF EXISTS "Users can delete service_jobs for their business" ON public.service_jobs;

CREATE POLICY "Users can view service_jobs for their business"
  ON public.service_jobs FOR SELECT
  USING (
    public.finza_user_can_access_business(service_jobs.business_id)
    AND public.finza_business_has_service_min_tier(service_jobs.business_id, 'professional')
  );

CREATE POLICY "Users can insert service_jobs for their business"
  ON public.service_jobs FOR INSERT
  WITH CHECK (
    public.finza_user_can_access_business(service_jobs.business_id)
    AND public.finza_business_has_service_min_tier(service_jobs.business_id, 'professional')
  );

CREATE POLICY "Users can update service_jobs for their business"
  ON public.service_jobs FOR UPDATE
  USING (
    public.finza_user_can_access_business(service_jobs.business_id)
    AND public.finza_business_has_service_min_tier(service_jobs.business_id, 'professional')
  )
  WITH CHECK (
    public.finza_user_can_access_business(service_jobs.business_id)
    AND public.finza_business_has_service_min_tier(service_jobs.business_id, 'professional')
  );

CREATE POLICY "Users can delete service_jobs for their business"
  ON public.service_jobs FOR DELETE
  USING (
    public.finza_user_can_access_business(service_jobs.business_id)
    AND public.finza_business_has_service_min_tier(service_jobs.business_id, 'professional')
  );

-- service_job_material_usage
DROP POLICY IF EXISTS "Users can view service_job_material_usage for their business" ON public.service_job_material_usage;
DROP POLICY IF EXISTS "Users can insert service_job_material_usage for their business" ON public.service_job_material_usage;
DROP POLICY IF EXISTS "Users can update service_job_material_usage for their business" ON public.service_job_material_usage;
DROP POLICY IF EXISTS "Users can delete service_job_material_usage for their business" ON public.service_job_material_usage;

CREATE POLICY "Users can view service_job_material_usage for their business"
  ON public.service_job_material_usage FOR SELECT
  USING (
    public.finza_user_can_access_business(service_job_material_usage.business_id)
    AND public.finza_business_has_service_min_tier(service_job_material_usage.business_id, 'professional')
  );

CREATE POLICY "Users can insert service_job_material_usage for their business"
  ON public.service_job_material_usage FOR INSERT
  WITH CHECK (
    public.finza_user_can_access_business(service_job_material_usage.business_id)
    AND public.finza_business_has_service_min_tier(service_job_material_usage.business_id, 'professional')
  );

CREATE POLICY "Users can update service_job_material_usage for their business"
  ON public.service_job_material_usage FOR UPDATE
  USING (
    public.finza_user_can_access_business(service_job_material_usage.business_id)
    AND public.finza_business_has_service_min_tier(service_job_material_usage.business_id, 'professional')
  )
  WITH CHECK (
    public.finza_user_can_access_business(service_job_material_usage.business_id)
    AND public.finza_business_has_service_min_tier(service_job_material_usage.business_id, 'professional')
  );

CREATE POLICY "Users can delete service_job_material_usage for their business"
  ON public.service_job_material_usage FOR DELETE
  USING (
    public.finza_user_can_access_business(service_job_material_usage.business_id)
    AND public.finza_business_has_service_min_tier(service_job_material_usage.business_id, 'professional')
  );

-- ============================================================================
-- Verification queries (run manually after migrate):
--
-- 1) Policies on hardened tables:
--    SELECT tablename, policyname, cmd, permissive, roles, qual, with_check
--    FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN (
--        'staff','service_jobs','service_job_material_usage',
--        'service_material_inventory','service_material_movements'
--      )
--    ORDER BY tablename, policyname;
--
-- 2) Helper smoke tests (substitute real business UUIDs):
--    SELECT finza_business_has_service_min_tier('<svc_starter_uuid>', 'professional');  -- expect false
--    SELECT finza_business_has_service_min_tier('<svc_pro_uuid>', 'professional');       -- expect true
--    SELECT finza_business_has_service_min_tier('<retail_uuid>', 'professional');      -- expect true
--
-- 3) Confirm no stray *_own_business policies remain:
--    SELECT policyname FROM pg_policies
--    WHERE schemaname='public' AND policyname LIKE '%own_business%';
-- ============================================================================
