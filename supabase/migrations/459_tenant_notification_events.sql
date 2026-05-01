-- Idempotent log for tenant/onboarding transactional emails (welcome, internal alerts, etc.).
-- Separate from subscription_notification_events. RLS on, no policies: service role only.

CREATE TABLE IF NOT EXISTS public.tenant_notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  lifecycle_key TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  error_message TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenant_notification_events_status_check
    CHECK (status IN ('sent', 'failed')),
  CONSTRAINT tenant_notification_events_dedup UNIQUE (business_id, event_type, lifecycle_key, recipient_email)
);

CREATE INDEX IF NOT EXISTS tenant_notification_events_business_id_idx
  ON public.tenant_notification_events (business_id);

CREATE INDEX IF NOT EXISTS tenant_notification_events_event_type_idx
  ON public.tenant_notification_events (event_type);

CREATE INDEX IF NOT EXISTS tenant_notification_events_sent_at_idx
  ON public.tenant_notification_events (sent_at DESC);

COMMENT ON TABLE public.tenant_notification_events IS
  'Deduped log for tenant onboarding / customer-success emails (service role writes only).';

ALTER TABLE public.tenant_notification_events ENABLE ROW LEVEL SECURITY;
