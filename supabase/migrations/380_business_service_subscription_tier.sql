-- Service workspace SaaS tier (three levels). UI reads this for sidebar/feature gating; billing can update later.
-- Default "business" keeps existing workspaces on full access until you assign lower tiers.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS service_subscription_tier TEXT;

UPDATE public.businesses
SET service_subscription_tier = 'business'
WHERE service_subscription_tier IS NULL OR trim(service_subscription_tier) = '';

ALTER TABLE public.businesses
  ALTER COLUMN service_subscription_tier SET DEFAULT 'business';

ALTER TABLE public.businesses
  ALTER COLUMN service_subscription_tier SET NOT NULL;

COMMENT ON COLUMN public.businesses.service_subscription_tier IS
  'Service workspace plan: starter | professional | business (see lib/serviceWorkspace/subscriptionTiers.ts).';

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_service_subscription_tier_check;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_service_subscription_tier_check
  CHECK (lower(trim(service_subscription_tier)) IN ('starter', 'professional', 'business'));
