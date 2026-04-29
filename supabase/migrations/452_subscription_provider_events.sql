-- Hubtel-first foundation (phase 1): provider-neutral subscription event log / webhook storage.
-- Additive only. Store events first; idempotency is handled in processing logic.

CREATE EXTENSION IF NOT EXISTS moddatetime WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.subscription_provider_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_session_id UUID REFERENCES public.subscription_checkout_sessions(id) ON DELETE SET NULL,
  payment_attempt_id UUID REFERENCES public.subscription_payment_attempts(id) ON DELETE SET NULL,
  business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('hubtel', 'paystack_test', 'mock')),
  provider_event_id TEXT,
  provider_reference TEXT,
  event_type TEXT,
  payload_hash TEXT,
  processing_status TEXT NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received', 'ignored', 'processed', 'failed')),
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subscription_provider_events_provider_event_unique
    UNIQUE (provider, provider_event_id)
);

COMMENT ON TABLE public.subscription_provider_events IS
  'Provider event/webhook trail for subscriptions. Stores raw incoming events even when business/session mapping is unresolved.';

CREATE INDEX IF NOT EXISTS subscription_provider_events_business_id_idx
  ON public.subscription_provider_events (business_id);

CREATE INDEX IF NOT EXISTS subscription_provider_events_provider_idx
  ON public.subscription_provider_events (provider);

CREATE INDEX IF NOT EXISTS subscription_provider_events_provider_reference_idx
  ON public.subscription_provider_events (provider, provider_reference);

CREATE INDEX IF NOT EXISTS subscription_provider_events_payload_hash_idx
  ON public.subscription_provider_events (payload_hash);

CREATE INDEX IF NOT EXISTS subscription_provider_events_received_at_idx
  ON public.subscription_provider_events (received_at DESC);

CREATE INDEX IF NOT EXISTS subscription_provider_events_processing_status_idx
  ON public.subscription_provider_events (processing_status);

CREATE TRIGGER subscription_provider_events_updated_at
  BEFORE UPDATE ON public.subscription_provider_events
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

ALTER TABLE public.subscription_provider_events ENABLE ROW LEVEL SECURITY;

-- Service-role can bypass RLS for webhook ingestion.
-- Authenticated users can read only mapped events for accessible businesses.
CREATE POLICY "subscription_provider_events_select"
  ON public.subscription_provider_events FOR SELECT
  USING (
    business_id IS NOT NULL
    AND public.finza_user_can_access_business(business_id)
  );

CREATE POLICY "subscription_provider_events_update"
  ON public.subscription_provider_events FOR UPDATE
  USING (
    business_id IS NOT NULL
    AND public.finza_user_can_access_business(business_id)
  )
  WITH CHECK (
    business_id IS NOT NULL
    AND public.finza_user_can_access_business(business_id)
  );

-- Grant posture: no direct user inserts/deletes for provider events.
REVOKE ALL ON TABLE public.subscription_provider_events FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.subscription_provider_events FROM authenticated;
GRANT SELECT ON TABLE public.subscription_provider_events TO authenticated;

