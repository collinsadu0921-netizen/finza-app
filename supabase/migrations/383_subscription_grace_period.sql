-- Subscription MoMo payment grace period support.
--
-- When a Mobile Money subscription renewal payment fails, the billing
-- system sets subscription_grace_until = NOW() + INTERVAL '3 days'.
-- The service workspace checks this value:
--   NULL                  → active subscription, no restriction.
--   NOW() < grace_until   → 3-day grace period: warn the user but allow access.
--   NOW() >= grace_until  → grace period expired: lock tier-gated features.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS subscription_grace_until TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.businesses.subscription_grace_until IS
  'Set by billing when a MoMo subscription payment fails.
   NULL = active subscription.
   If NOW() < value  → 3-day grace period (warn but allow access).
   If NOW() >= value → grace period expired (block tier features).';
