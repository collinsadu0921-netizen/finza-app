-- Ordinary authenticated clients cannot activate Retail or rewrite billing.
-- Service signup may still INSERT a Service trial. Paystack and trusted
-- provisioning run as service_role and are not blocked.
-- Existing rows are not updated by this migration.

CREATE OR REPLACE FUNCTION public.finza_guard_business_protected_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin')
    OR coalesce(auth.role(), '') = 'service_role'
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF lower(coalesce(NEW.industry, '')) = 'retail' THEN
      RAISE EXCEPTION 'retail businesses cannot be created by this role'
        USING ERRCODE = '42501';
    END IF;
    IF coalesce(NEW.billing_exempt, false) IS TRUE THEN
      RAISE EXCEPTION 'billing exemption cannot be set by this role'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.billing_exempt_reason IS NOT NULL THEN
      RAISE EXCEPTION 'billing exemption cannot be set by this role'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.subscription_started_at IS NOT NULL OR NEW.current_period_ends_at IS NOT NULL THEN
      RAISE EXCEPTION 'paid subscription dates cannot be set by this role'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.subscription_grace_until IS NOT NULL THEN
      RAISE EXCEPTION 'subscription grace cannot be set by this role'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.industry IS DISTINCT FROM OLD.industry
    OR NEW.service_subscription_tier IS DISTINCT FROM OLD.service_subscription_tier
    OR NEW.service_subscription_status IS DISTINCT FROM OLD.service_subscription_status
    OR NEW.trial_started_at IS DISTINCT FROM OLD.trial_started_at
    OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
    OR NEW.subscription_started_at IS DISTINCT FROM OLD.subscription_started_at
    OR NEW.current_period_ends_at IS DISTINCT FROM OLD.current_period_ends_at
    OR NEW.subscription_grace_until IS DISTINCT FROM OLD.subscription_grace_until
    OR NEW.billing_cycle IS DISTINCT FROM OLD.billing_cycle
    OR NEW.billing_exempt IS DISTINCT FROM OLD.billing_exempt
    OR NEW.billing_exempt_reason IS DISTINCT FROM OLD.billing_exempt_reason
  THEN
    RAISE EXCEPTION 'protected business fields cannot be changed by this role'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_finza_guard_business_protected_fields ON public.businesses;
CREATE TRIGGER trg_finza_guard_business_protected_fields
  BEFORE INSERT OR UPDATE ON public.businesses
  FOR EACH ROW
  EXECUTE FUNCTION public.finza_guard_business_protected_fields();

COMMENT ON FUNCTION public.finza_guard_business_protected_fields() IS
  'Blocks authenticated industry=retail inserts and authenticated updates of industry, Service subscription, trial, grace, and billing-exemption columns.';
