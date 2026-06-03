-- Migration 487: Service trial lifecycle — read-only after grace (RLS defense in depth)
-- Aligns with resolveServiceEntitlement / finza_business_can_write_service_records.

-- ----------------------------------------------------------------------------
-- Write permission helper (service/professional industry only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finza_business_can_write_service_records(p_business_id uuid)
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
  v_subscription_started timestamptz;
  v_billing_exempt boolean;
  v_now timestamptz := now();
BEGIN
  IF p_business_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT
    lower(trim(coalesce(b.industry, ''))),
    lower(trim(coalesce(b.service_subscription_tier, ''))),
    lower(trim(coalesce(nullif(trim(b.service_subscription_status), ''), 'active'))),
    b.trial_ends_at,
    b.subscription_grace_until,
    b.subscription_started_at,
    coalesce(b.billing_exempt, false)
  INTO v_industry, v_raw_tier, v_status, v_trial_ends, v_grace_until,
       v_subscription_started, v_billing_exempt
  FROM public.businesses b
  WHERE b.id = p_business_id
    AND b.archived_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_billing_exempt THEN
    RETURN true;
  END IF;

  IF v_industry NOT IN ('service', 'professional') THEN
    RETURN true;
  END IF;

  IF v_status = 'locked' THEN
    RETURN false;
  END IF;

  IF v_grace_until IS NOT NULL AND v_now >= v_grace_until THEN
    RETURN false;
  END IF;

  -- Stale unpaid expired trial awaiting lifecycle cron (no grace row yet)
  IF v_status = 'trialing'
     AND v_subscription_started IS NULL
     AND v_trial_ends IS NOT NULL
     AND v_now >= v_trial_ends
     AND v_grace_until IS NULL THEN
    RETURN false;
  END IF;

  -- Unpaid trial grace expired (past_due but grace ended)
  IF v_subscription_started IS NULL
     AND v_trial_ends IS NOT NULL
     AND v_now >= v_trial_ends
     AND (v_grace_until IS NULL OR v_now >= v_grace_until) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.finza_business_can_write_service_records(uuid) IS
  'Service/professional: false when trial/post-payment grace expired or workspace locked. Other industries: true.';

GRANT EXECUTE ON FUNCTION public.finza_business_can_write_service_records(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- Tier helper: preserve raw tier during unpaid trial grace (no starter downgrade)
-- ----------------------------------------------------------------------------
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
  v_subscription_started timestamptz;
  v_effective text;
  v_min_rank int;
  v_eff_rank int;
BEGIN
  IF p_business_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT
    lower(trim(coalesce(b.industry, ''))),
    lower(trim(coalesce(b.service_subscription_tier, ''))),
    lower(trim(coalesce(nullif(trim(b.service_subscription_status), ''), 'active'))),
    b.trial_ends_at,
    b.subscription_grace_until,
    b.subscription_started_at
  INTO v_industry, v_raw_tier, v_status, v_trial_ends, v_grace_until, v_subscription_started
  FROM public.businesses b
  WHERE b.id = p_business_id
    AND b.archived_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_industry NOT IN ('service', 'professional') THEN
    RETURN true;
  END IF;

  IF v_status = 'locked'
     OR (v_grace_until IS NOT NULL AND now() >= v_grace_until) THEN
    RETURN false;
  END IF;

  IF v_status = 'trialing'
     AND v_subscription_started IS NULL
     AND v_trial_ends IS NOT NULL
     AND now() >= v_trial_ends
     AND v_grace_until IS NULL THEN
    RETURN false;
  END IF;

  IF v_raw_tier IN ('professional', 'growth', 'pro') THEN
    v_effective := 'professional';
  ELSIF v_raw_tier IN ('business', 'scale', 'enterprise') THEN
    v_effective := 'business';
  ELSIF v_raw_tier IN ('starter', 'essentials') THEN
    v_effective := 'starter';
  ELSE
    v_effective := 'starter';
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

-- ----------------------------------------------------------------------------
-- Expenses: require write permission on INSERT/UPDATE/DELETE
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "business members can insert expenses" ON public.expenses;
CREATE POLICY "business members can insert expenses"
ON public.expenses
FOR INSERT
WITH CHECK (
  public.finza_business_can_write_service_records(expenses.business_id)
  AND EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.business_id = expenses.business_id
      AND bu.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "business members can update expenses" ON public.expenses;
CREATE POLICY "business members can update expenses"
ON public.expenses
FOR UPDATE
USING (
  public.finza_business_can_write_service_records(expenses.business_id)
  AND EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.business_id = expenses.business_id
      AND bu.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "business members can delete expenses" ON public.expenses;
CREATE POLICY "business members can delete expenses"
ON public.expenses
FOR DELETE
USING (
  public.finza_business_can_write_service_records(expenses.business_id)
  AND EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.business_id = expenses.business_id
      AND bu.user_id = auth.uid()
  )
);
