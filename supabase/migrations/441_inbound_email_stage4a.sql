-- Stage 4A: inbound email foundation — routing, message persistence, attachment idempotency,
-- incoming_documents linkage + email context columns.

-- ── Business routing: one authoritative inbound address per business ─────────
CREATE TABLE IF NOT EXISTS public.business_inbound_email_routes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  recipient_address TEXT NOT NULL,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT business_inbound_email_routes_business_unique UNIQUE (business_id),
  CONSTRAINT business_inbound_email_routes_address_unique UNIQUE (recipient_address)
);

CREATE INDEX IF NOT EXISTS idx_business_inbound_email_routes_recipient_lower
  ON public.business_inbound_email_routes (LOWER(recipient_address));

COMMENT ON TABLE public.business_inbound_email_routes IS
  'Maps full inbound recipient address (lowercase) to a single business; used by inbound webhooks.';

CREATE OR REPLACE TRIGGER set_business_inbound_email_routes_updated_at
  BEFORE UPDATE ON public.business_inbound_email_routes
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

ALTER TABLE public.business_inbound_email_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "business_inbound_email_routes_select" ON public.business_inbound_email_routes;
CREATE POLICY "business_inbound_email_routes_select"
  ON public.business_inbound_email_routes FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

DROP POLICY IF EXISTS "business_inbound_email_routes_insert" ON public.business_inbound_email_routes;
CREATE POLICY "business_inbound_email_routes_insert"
  ON public.business_inbound_email_routes FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(business_id));

DROP POLICY IF EXISTS "business_inbound_email_routes_update" ON public.business_inbound_email_routes;
CREATE POLICY "business_inbound_email_routes_update"
  ON public.business_inbound_email_routes FOR UPDATE
  USING (public.finza_user_can_access_business(business_id))
  WITH CHECK (public.finza_user_can_access_business(business_id));

-- ── Inbound message envelope (idempotency anchor: provider + provider_message_id) ──
CREATE TABLE IF NOT EXISTS public.inbound_email_messages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL,
  provider_message_id   TEXT NOT NULL,
  recipient_address     TEXT,
  sender_address        TEXT,
  subject               TEXT,
  received_at           TIMESTAMPTZ NOT NULL,
  processing_status     TEXT NOT NULL DEFAULT 'pending' CHECK (processing_status IN (
                          'pending', 'processing', 'completed', 'failed', 'skipped'
                        )),
  snippet_text          TEXT,
  metadata_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inbound_email_messages_provider_message_unique UNIQUE (provider, provider_message_id)
);

CREATE INDEX IF NOT EXISTS idx_inbound_email_messages_business_id
  ON public.inbound_email_messages(business_id);
CREATE INDEX IF NOT EXISTS idx_inbound_email_messages_received_at
  ON public.inbound_email_messages(received_at DESC);

COMMENT ON TABLE public.inbound_email_messages IS
  'One row per provider-delivered inbound email; provider_message_id is the idempotency key.';

CREATE OR REPLACE TRIGGER set_inbound_email_messages_updated_at
  BEFORE UPDATE ON public.inbound_email_messages
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

ALTER TABLE public.inbound_email_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inbound_email_messages_select" ON public.inbound_email_messages;
CREATE POLICY "inbound_email_messages_select"
  ON public.inbound_email_messages FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

-- ── Per-attachment idempotency + linkage to incoming_documents ───────────────
CREATE TABLE IF NOT EXISTS public.inbound_email_attachments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id            UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  inbound_email_message_id UUID NOT NULL REFERENCES public.inbound_email_messages(id) ON DELETE CASCADE,
  provider_attachment_id TEXT NOT NULL,
  filename               TEXT,
  content_type           TEXT,
  storage_bucket         TEXT,
  storage_path           TEXT,
  incoming_document_id   UUID REFERENCES public.incoming_documents(id) ON DELETE SET NULL,
  ingestion_status       TEXT NOT NULL DEFAULT 'pending' CHECK (ingestion_status IN (
                           'pending', 'in_progress', 'stored', 'skipped', 'failed'
                         )),
  error_message          TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inbound_email_attachments_message_attachment_unique
    UNIQUE (inbound_email_message_id, provider_attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_inbound_email_attachments_business_id
  ON public.inbound_email_attachments(business_id);

CREATE OR REPLACE TRIGGER set_inbound_email_attachments_updated_at
  BEFORE UPDATE ON public.inbound_email_attachments
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

ALTER TABLE public.inbound_email_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inbound_email_attachments_select" ON public.inbound_email_attachments;
CREATE POLICY "inbound_email_attachments_select"
  ON public.inbound_email_attachments FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

-- ── incoming_documents: email source + optional linkage / display context ───
ALTER TABLE public.incoming_documents
  DROP CONSTRAINT IF EXISTS incoming_documents_source_type_check;

ALTER TABLE public.incoming_documents
  ADD CONSTRAINT incoming_documents_source_type_check
  CHECK (source_type IN (
    'manual_upload',
    'expense_form_upload',
    'bill_form_upload',
    'email_inbound'
  ));

ALTER TABLE public.incoming_documents
  ADD COLUMN IF NOT EXISTS inbound_email_message_id UUID REFERENCES public.inbound_email_messages(id) ON DELETE SET NULL;

ALTER TABLE public.incoming_documents
  ADD COLUMN IF NOT EXISTS source_email_sender TEXT;

ALTER TABLE public.incoming_documents
  ADD COLUMN IF NOT EXISTS source_email_subject TEXT;

CREATE INDEX IF NOT EXISTS idx_incoming_documents_inbound_email_message_id
  ON public.incoming_documents(inbound_email_message_id)
  WHERE inbound_email_message_id IS NOT NULL;

COMMENT ON COLUMN public.incoming_documents.inbound_email_message_id IS
  'FK to inbound envelope when this file was created from email ingestion.';
COMMENT ON COLUMN public.incoming_documents.source_email_sender IS
  'Denormalized sender for list UI when source_type = email_inbound.';
COMMENT ON COLUMN public.incoming_documents.source_email_subject IS
  'Denormalized subject for list UI when source_type = email_inbound.';
