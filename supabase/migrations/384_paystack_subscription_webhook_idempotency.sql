-- Idempotency + audit trail for Paystack subscription charges (no invoice / payments row).
-- Webhook handler uses service role; RLS enabled with no policies so only service role can access.

CREATE TABLE IF NOT EXISTS public.paystack_subscription_webhook_events (
  reference TEXT PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failed')),
  paystack_transaction_id TEXT,
  target_tier TEXT,
  billing_cycle TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS paystack_subscription_webhook_events_business_id_idx
  ON public.paystack_subscription_webhook_events (business_id);

COMMENT ON TABLE public.paystack_subscription_webhook_events IS
  'Paystack webhook idempotency when metadata.finza_purpose = service_subscription.';

ALTER TABLE public.paystack_subscription_webhook_events ENABLE ROW LEVEL SECURITY;
