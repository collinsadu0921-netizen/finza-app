-- Mark a service workspace business as billing-exempt (internal / founder).
-- Requires migration 485_business_billing_exempt.sql applied first.
--
-- IMPORTANT: Use the raw UUID only — no angle brackets.
--   WRONG: '<534c1dc1-15a5-42b7-8c44-3194bbfb7a46>'
--   RIGHT: '534c1dc1-15a5-42b7-8c44-3194bbfb7a46'
--
-- List ids: node scripts/set-service-subscription-tier.mjs list
-- CLI (no angle brackets): node scripts/mark-billing-exempt.mjs <uuid>
--
-- Finza internal accounts:
--   Finza (demo / admin@finza.africa)  2abf2da3-12dc-4ec6-b547-89900d67e5e9
--   Support (support@finza.africa)     d5391d1c-ace5-4f42-a49a-2d1897f0ef1e

UPDATE public.businesses
SET
  billing_exempt = true,
  billing_exempt_reason = 'founder_internal_account',
  service_subscription_tier = 'business',
  service_subscription_status = 'active',
  billing_cycle = 'annual',
  current_period_ends_at = '2099-12-31T23:59:59.000Z',
  subscription_grace_until = NULL,
  trial_started_at = NULL,
  trial_ends_at = NULL,
  updated_at = NOW()
WHERE id IN (
  '2abf2da3-12dc-4ec6-b547-89900d67e5e9',
  'd5391d1c-ace5-4f42-a49a-2d1897f0ef1e'
)
  AND archived_at IS NULL;

SELECT id, name, email, billing_exempt, billing_exempt_reason,
       service_subscription_tier, service_subscription_status,
       current_period_ends_at
FROM public.businesses
WHERE id IN (
  '2abf2da3-12dc-4ec6-b547-89900d67e5e9',
  'd5391d1c-ace5-4f42-a49a-2d1897f0ef1e'
);
