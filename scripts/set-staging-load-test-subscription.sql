-- Staging only: elevate load-test tenant subscription for k6 smoke / workday scenarios.
-- Project ref must be adonhhtooawkeemdqqeo — never run on production.
--
-- Run in Supabase SQL editor (staging) or:
--   npx supabase db query --linked -f scripts/set-staging-load-test-subscription.sql
--
-- Load-test business (Finza Load Test Services Ltd):
--   4e6cdfba-e2ab-4ee4-ac00-9b077d696544

UPDATE public.businesses
SET
  service_subscription_tier = 'business',
  service_subscription_status = 'active',
  subscription_started_at = COALESCE(subscription_started_at, NOW()),
  current_period_ends_at = '2099-12-31T23:59:59.000Z'::timestamptz,
  subscription_grace_until = NULL,
  trial_started_at = NULL,
  trial_ends_at = NULL,
  billing_cycle = COALESCE(NULLIF(trim(billing_cycle), ''), 'annual'),
  updated_at = NOW()
WHERE id = '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid
  AND archived_at IS NULL;

SELECT
  id,
  name,
  service_subscription_tier,
  service_subscription_status,
  billing_exempt,
  subscription_started_at,
  current_period_ends_at
FROM public.businesses
WHERE id = '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid;
