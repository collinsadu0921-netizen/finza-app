-- ============================================================================
-- client_request_attachments: file attachments on client requests (firm workspace)
-- + provision the "documents" storage bucket (private, 20 MB limit)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Storage bucket — documents (private)
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false,      -- private bucket; access via signed URLs only
  20971520,   -- 20 MB per file
  null        -- all MIME types allowed
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: scope access to authenticated users only.
-- Finer-grained firm-membership authorization is enforced at the API layer
-- before signed URLs are generated or metadata records are created.

DROP POLICY IF EXISTS "Authenticated users can upload to documents bucket"
  ON storage.objects;
CREATE POLICY "Authenticated users can upload to documents bucket"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'documents'
    AND auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "Authenticated users can read from documents bucket"
  ON storage.objects;
CREATE POLICY "Authenticated users can read from documents bucket"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents'
    AND auth.uid() IS NOT NULL
  );

-- ----------------------------------------------------------------------------
-- 2) client_request_attachments
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_request_attachments (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id           UUID        NOT NULL
    REFERENCES public.client_requests(id)    ON DELETE CASCADE,
  firm_id              UUID        NOT NULL
    REFERENCES public.accounting_firms(id)   ON DELETE CASCADE,
  client_business_id   UUID        NOT NULL
    REFERENCES public.businesses(id)         ON DELETE CASCADE,
  uploaded_by_user_id  UUID        NOT NULL
    REFERENCES auth.users(id),
  file_name            TEXT        NOT NULL CHECK (length(trim(file_name)) > 0),
  storage_path         TEXT        NOT NULL CHECK (length(trim(storage_path)) > 0),
  mime_type            TEXT        NOT NULL DEFAULT '',
  file_size            BIGINT      NOT NULL DEFAULT 0,
  metadata             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_request_attachments_request_id
  ON public.client_request_attachments(request_id);
CREATE INDEX IF NOT EXISTS idx_client_request_attachments_firm_id
  ON public.client_request_attachments(firm_id);
CREATE INDEX IF NOT EXISTS idx_client_request_attachments_client_business_id
  ON public.client_request_attachments(client_business_id);
CREATE INDEX IF NOT EXISTS idx_client_request_attachments_created_at
  ON public.client_request_attachments(created_at ASC);

COMMENT ON TABLE public.client_request_attachments
  IS 'File attachments uploaded against a client request — firm workspace only';

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.client_request_attachments ENABLE ROW LEVEL SECURITY;

-- SELECT: any firm member of the same firm
DROP POLICY IF EXISTS "Firm members can select client_request_attachments"
  ON public.client_request_attachments;
CREATE POLICY "Firm members can select client_request_attachments"
  ON public.client_request_attachments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_request_attachments.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- INSERT: firm member uploading their own attachment
DROP POLICY IF EXISTS "Firm members can insert client_request_attachments"
  ON public.client_request_attachments;
CREATE POLICY "Firm members can insert client_request_attachments"
  ON public.client_request_attachments FOR INSERT
  WITH CHECK (
    uploaded_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_request_attachments.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- No UPDATE or DELETE policies — attachments are immutable for this MVP
