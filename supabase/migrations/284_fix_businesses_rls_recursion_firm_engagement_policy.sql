-- ============================================================================
-- Migration: Fix infinite recursion in businesses RLS
-- ============================================================================
-- Cycle: businesses policy -> firm_client_engagements (inline EXISTS) -> RLS
-- on fce/join can re-enter businesses. Use SECURITY DEFINER helper so the
-- engagement check bypasses RLS and does not re-trigger businesses policies.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Helper: has_firm_engagement_with_business (SECURITY DEFINER, bypasses RLS)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_firm_engagement_with_business(_business_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.firm_client_engagements fce
    JOIN public.accounting_firm_users afu
      ON afu.firm_id = fce.accounting_firm_id
     AND afu.user_id = auth.uid()
    WHERE fce.client_business_id = _business_id
  );
$$;

COMMENT ON FUNCTION public.has_firm_engagement_with_business(uuid) IS
  'Used by businesses RLS policy "Firm users can select engaged client businesses" to avoid recursion: reads firm_client_engagements with definer rights so no RLS re-entry into businesses.';

-- ----------------------------------------------------------------------------
-- 2) Replace policy with function-based USING (no inline SELECT on fce)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Firm users can select engaged client businesses" ON public.businesses;

CREATE POLICY "Firm users can select engaged client businesses"
  ON public.businesses FOR SELECT TO authenticated
  USING (public.has_firm_engagement_with_business(businesses.id));

COMMENT ON POLICY "Firm users can select engaged client businesses" ON public.businesses IS
  'Firm users can read client business rows (e.g. id, name) for businesses their firm is engaged with; uses SECURITY DEFINER helper to avoid RLS recursion.';

-- ============================================================================
-- VERIFICATION (run manually after migration; no recursion error)
-- ============================================================================
-- 1) As owner: should see own business(es) only
--    SET request.jwt.claims = '{"sub": "<owner_user_id>"}';  -- or use session
--    SELECT id, name, owner_id FROM businesses WHERE owner_id = auth.uid();
--
-- 2) As firm user with engagement: should see engaged client business(es) only
--    SET request.jwt.claims = '{"sub": "<firm_user_id>"}';
--    SELECT id, name FROM businesses WHERE has_firm_engagement_with_business(id);
--
-- 3) Confirm no recursion: run as firm user; must not raise "infinite recursion"
--    SELECT id, name FROM businesses;  -- only rows allowed by policies
