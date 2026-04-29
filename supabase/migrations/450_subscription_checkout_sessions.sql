-- Hubtel-first foundation (phase 1): provider-neutral subscription checkout sessions.
-- Additive only; no existing flow replacement.

CREATE EXTENSION IF NOT EXISTS moddatetime WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.subscription_checkout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  plan_tier TEXT NOT NULL CHECK (plan_tier IN ('starter', 'professional', 'business')),
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'quarterly', 'annual')),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'GHS',
  provider TEXT NOT NULL CHECK (provider IN ('hubtel', 'paystack_test', 'mock')),
  provider_checkout_id TEXT,
  provider_transaction_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'expired')),
  raw_provider_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  CONSTRAINT subscription_checkout_sessions_provider_checkout_unique
    UNIQUE (provider, provider_checkout_id),
  CONSTRAINT subscription_checkout_sessions_provider_tx_unique
    UNIQUE (provider, provider_transaction_id)
);

COMMENT ON TABLE public.subscription_checkout_sessions IS
  'Provider-neutral checkout sessions for platform subscriptions. Hubtel-first target with temporary paystack_test/mock support.';

CREATE INDEX IF NOT EXISTS subscription_checkout_sessions_business_id_idx
  ON public.subscription_checkout_sessions (business_id);

CREATE INDEX IF NOT EXISTS subscription_checkout_sessions_status_idx
  ON public.subscription_checkout_sessions (status);

CREATE INDEX IF NOT EXISTS subscription_checkout_sessions_provider_idx
  ON public.subscription_checkout_sessions (provider);

CREATE INDEX IF NOT EXISTS subscription_checkout_sessions_created_at_idx
  ON public.subscription_checkout_sessions (created_at DESC);

CREATE TRIGGER subscription_checkout_sessions_updated_at
  BEFORE UPDATE ON public.subscription_checkout_sessions
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

ALTER TABLE public.subscription_checkout_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscription_checkout_sessions_select"
  ON public.subscription_checkout_sessions FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

CREATE POLICY "subscription_checkout_sessions_insert"
  ON public.subscription_checkout_sessions FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(business_id));

CREATE POLICY "subscription_checkout_sessions_update"
  ON public.subscription_checkout_sessions FOR UPDATE
  USING (public.finza_user_can_access_business(business_id))
  WITH CHECK (public.finza_user_can_access_business(business_id));

