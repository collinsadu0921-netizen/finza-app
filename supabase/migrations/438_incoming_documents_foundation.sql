-- ============================================================================
-- Incoming documents + extraction runs (Stage 1 foundation)
-- Persists receipt OCR metadata and results; scoped by business via RLS.
-- ============================================================================

-- Parent first (latest_extraction_id FK added after child table exists)
CREATE TABLE IF NOT EXISTS public.incoming_documents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source_type           TEXT NOT NULL CHECK (source_type IN (
                          'manual_upload',
                          'expense_form_upload',
                          'bill_form_upload'
                        )),
  document_kind         TEXT NOT NULL DEFAULT 'unknown' CHECK (document_kind IN (
                          'expense_receipt',
                          'supplier_bill_attachment',
                          'unknown'
                        )),
  storage_bucket        TEXT NOT NULL,
  storage_path          TEXT NOT NULL,
  file_name             TEXT,
  mime_type             TEXT,
  file_size             BIGINT,
  status                TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN (
                          'uploaded',
                          'extracting',
                          'extracted',
                          'needs_review',
                          'failed',
                          'linked'
                        )),
  linked_entity_type    TEXT CHECK (linked_entity_type IS NULL OR linked_entity_type IN ('expense', 'bill')),
  linked_entity_id      UUID,
  latest_extraction_id  UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.incoming_document_extractions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      UUID NOT NULL REFERENCES public.incoming_documents(id) ON DELETE CASCADE,
  business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  provider           TEXT NOT NULL,
  provider_version TEXT,
  parser_version   TEXT,
  status           TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed')),
  raw_text         TEXT,
  parsed_json      JSONB,
  confidence_json  JSONB,
  error_message    TEXT,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.incoming_documents
  DROP CONSTRAINT IF EXISTS incoming_documents_latest_extraction_fk;

ALTER TABLE public.incoming_documents
  ADD CONSTRAINT incoming_documents_latest_extraction_fk
  FOREIGN KEY (latest_extraction_id)
  REFERENCES public.incoming_document_extractions(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_incoming_documents_business_id
  ON public.incoming_documents(business_id);
CREATE INDEX IF NOT EXISTS idx_incoming_documents_status
  ON public.incoming_documents(status);
CREATE INDEX IF NOT EXISTS idx_incoming_documents_linked
  ON public.incoming_documents(linked_entity_type, linked_entity_id);

CREATE INDEX IF NOT EXISTS idx_incoming_document_extractions_document_id
  ON public.incoming_document_extractions(document_id);
CREATE INDEX IF NOT EXISTS idx_incoming_document_extractions_business_id
  ON public.incoming_document_extractions(business_id);
CREATE INDEX IF NOT EXISTS idx_incoming_document_extractions_status
  ON public.incoming_document_extractions(status);
CREATE INDEX IF NOT EXISTS idx_incoming_document_extractions_created_at
  ON public.incoming_document_extractions(created_at DESC);

CREATE OR REPLACE TRIGGER set_incoming_documents_updated_at
  BEFORE UPDATE ON public.incoming_documents
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

COMMENT ON TABLE public.incoming_documents IS 'Uploaded files pending or completed OCR; links to expense/bill when saved.';
COMMENT ON TABLE public.incoming_document_extractions IS 'One row per OCR/extraction attempt on an incoming document.';

ALTER TABLE public.incoming_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incoming_document_extractions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "incoming_documents_select" ON public.incoming_documents;
CREATE POLICY "incoming_documents_select"
  ON public.incoming_documents FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

DROP POLICY IF EXISTS "incoming_documents_insert" ON public.incoming_documents;
CREATE POLICY "incoming_documents_insert"
  ON public.incoming_documents FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(business_id));

DROP POLICY IF EXISTS "incoming_documents_update" ON public.incoming_documents;
CREATE POLICY "incoming_documents_update"
  ON public.incoming_documents FOR UPDATE
  USING (public.finza_user_can_access_business(business_id))
  WITH CHECK (public.finza_user_can_access_business(business_id));

DROP POLICY IF EXISTS "incoming_document_extractions_select" ON public.incoming_document_extractions;
CREATE POLICY "incoming_document_extractions_select"
  ON public.incoming_document_extractions FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

DROP POLICY IF EXISTS "incoming_document_extractions_insert" ON public.incoming_document_extractions;
CREATE POLICY "incoming_document_extractions_insert"
  ON public.incoming_document_extractions FOR INSERT
  WITH CHECK (public.finza_user_can_access_business(business_id));

DROP POLICY IF EXISTS "incoming_document_extractions_update" ON public.incoming_document_extractions;
CREATE POLICY "incoming_document_extractions_update"
  ON public.incoming_document_extractions FOR UPDATE
  USING (public.finza_user_can_access_business(business_id))
  WITH CHECK (public.finza_user_can_access_business(business_id));
