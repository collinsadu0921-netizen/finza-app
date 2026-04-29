-- Hubtel-first foundation (phase 1): provider-neutral subscription payment attempts.
-- Additive only; checkout session may have multiple attempts.

CREATE EXTENSION IF NOT EXISTS moddatetime WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.subscription_payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_session_id UUID NOT NULL REFERENCES public.subscription_checkout_sessions(id) ON DELETE CASCADE,
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
  CONSTRAINT subscription_payment_attempts_provider_checkout_unique
    UNIQUE (provider, provider_checkout_id),
  CONSTRAINT subscription_payment_attempts_provider_tx_unique
    UNIQUE (provider, provider_transaction_id)
);

COMMENT ON TABLE public.subscription_payment_attempts IS
  'Each provider interaction attempt for a subscription checkout session.';

CREATE INDEX IF NOT EXISTS subscription_payment_attempts_checkout_session_id_idx
  ON public.subscription_payment_attempts (checkout_session_id);

CREATE INDEX IF NOT EXISTS subscription_payment_attempts_business_id_idx
  ON public.subscription_payment_attempts (business_id);

CREATE INDEX IF NOT EXISTS subscription_payment_attempts_status_idx
  ON public.subscription_payment_attempts (status);

CREATE INDEX IF NOT EXISTS subscription_payment_attempts_created_at_idx
  ON public.subscription_payment_attempts (created_at DESC);

CREATE TRIGGER subscription_payment_attempts_updated_at
  BEFORE UPDATE ON public.subscription_payment_attempts
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

ALTER TABLE public.subscription_payment_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscription_payment_attempts_select"
  ON public.subscription_payment_attempts FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

CREATE POLICY "subscription_payment_attempts_insert"
  ON public.subscription_payment_attempts FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(business_id));

CREATE POLICY "subscription_payment_attempts_update"
  ON public.subscription_payment_attempts FOR UPDATE
  USING (public.finza_user_can_access_business(business_id))
  WITH CHECK (public.finza_user_can_access_business(business_id));

