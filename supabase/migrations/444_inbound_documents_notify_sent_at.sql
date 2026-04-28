-- Idempotent outbound "new documents" email: set after successful send to avoid duplicate on rare retries.
ALTER TABLE public.inbound_email_messages
  ADD COLUMN IF NOT EXISTS documents_notify_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.inbound_email_messages.documents_notify_sent_at IS
  'When set, a "new inbound documents" notification email was sent for this message (at least one incoming_document created).';
