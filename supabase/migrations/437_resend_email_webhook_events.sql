-- Resend webhook delivery events (bounced, complained, delivered, opened, clicked).
-- Populated by POST /api/webhooks/resend using service role. payload_safe excludes recipient/sender/subject and raw URLs.
-- For business_id: add Resend tag finza_business_id=<uuid> on outbound sends (optional until send flows are updated).

CREATE TABLE IF NOT EXISTS public.resend_email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  svix_message_id TEXT NOT NULL,
  resend_email_id TEXT,
  event_type TEXT NOT NULL,
  business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
  event_occurred_at TIMESTAMPTZ,
  payload_safe JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT resend_email_events_svix_message_id_key UNIQUE (svix_message_id)
);

CREATE INDEX IF NOT EXISTS resend_email_events_resend_email_id_idx
  ON public.resend_email_events (resend_email_id);

CREATE INDEX IF NOT EXISTS resend_email_events_business_occurred_idx
  ON public.resend_email_events (business_id, event_occurred_at DESC NULLS LAST);

COMMENT ON TABLE public.resend_email_events IS
  'Append-only Resend email lifecycle events from webhooks. Deduped by svix_message_id.';

ALTER TABLE public.resend_email_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY resend_email_events_select_member
  ON public.resend_email_events FOR SELECT
  USING (
    business_id IS NOT NULL
    AND public.finza_user_can_access_business(business_id)
  );

GRANT SELECT ON public.resend_email_events TO authenticated;
