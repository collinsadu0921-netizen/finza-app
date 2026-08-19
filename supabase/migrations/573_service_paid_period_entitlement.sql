-- Migration 573: Paid subscription period entitlement (defense in depth)
--
-- current_period_ends_at is the paid-through boundary.
-- Paid grace is capped at current_period_ends_at + INTERVAL '3 days'.
-- Cron state is normalization, not the sole security boundary.
--
-- TypeScript (resolveServiceEntitlement / paidSubscriptionPeriod) and these
-- helpers MUST agree:
--   now <  period_end + 3 days  => grace active (writes + paid tier retained)
--   now >= period_end + 3 days  => expired / read-only
-- even when service_subscription_status is still 'active' or
-- subscription_grace_until is NULL or erroneously later.
--
-- Do not edit 487/488. This replaces the central helpers only.
-- Legacy paid rows with current_period_ends_at IS NULL are not newly locked.

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
  v_period_ends timestamptz;
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
    b.current_period_ends_at,
    coalesce(b.billing_exempt, false)
  INTO v_industry, v_raw_tier, v_status, v_trial_ends, v_grace_until,
       v_subscription_started, v_period_ends, v_billing_exempt
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

  -- Paid subscription with a known paid-through date.
  -- DB subscription_grace_until must not extend past period_end + 3 days.
  IF v_subscription_started IS NOT NULL AND v_period_ends IS NOT NULL THEN
    IF v_now < v_period_ends THEN
      RETURN true;
    END IF;
    IF v_now < v_period_ends + INTERVAL '3 days' THEN
      RETURN true;
    END IF;
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
  'Service/professional: false when unpaid trial grace expired, workspace locked, or a known paid period is past current_period_ends_at + 3 days. Paid grace is capped at that deadline. Cron is not the sole security boundary. Other industries: true. billing_exempt: true.';

GRANT EXECUTE ON FUNCTION public.finza_business_can_write_service_records(uuid) TO authenticated;

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
  v_period_ends timestamptz;
  v_billing_exempt boolean;
  v_now timestamptz := now();
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
    b.subscription_started_at,
    b.current_period_ends_at,
    coalesce(b.billing_exempt, false)
  INTO v_industry, v_raw_tier, v_status, v_trial_ends, v_grace_until,
       v_subscription_started, v_period_ends, v_billing_exempt
  FROM public.businesses b
  WHERE b.id = p_business_id
    AND b.archived_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_industry NOT IN ('service', 'professional') THEN
    RETURN true;
  END IF;

  IF NOT v_billing_exempt THEN
    IF v_status = 'locked' THEN
      RETURN false;
    END IF;

    -- After paid grace, stale active must not grant paid feature entitlement.
    -- During the legitimate 3-day grace, paid tier is retained below.
    IF v_subscription_started IS NOT NULL AND v_period_ends IS NOT NULL THEN
      IF v_now >= v_period_ends + INTERVAL '3 days' THEN
        RETURN false;
      END IF;
    ELSE
      IF v_grace_until IS NOT NULL AND v_now >= v_grace_until THEN
        RETURN false;
      END IF;

      IF v_status = 'trialing'
         AND v_subscription_started IS NULL
         AND v_trial_ends IS NOT NULL
         AND v_now >= v_trial_ends
         AND v_grace_until IS NULL THEN
        RETURN false;
      END IF;
    END IF;
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

COMMENT ON FUNCTION public.finza_business_has_service_min_tier(uuid, text) IS
  'Service/professional: false after paid grace (current_period_ends_at + 3 days) even if status remains active. Paid tier is retained during that grace. billing_exempt skips lock/period denials then evaluates stored tier. Other industries: true.';

GRANT EXECUTE ON FUNCTION public.finza_business_has_service_min_tier(uuid, text) TO authenticated;
