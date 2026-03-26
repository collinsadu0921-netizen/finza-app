-- ============================================================================
-- client_documents: permanent document vault per client (firm workspace)
-- Reuses the "documents" storage bucket provisioned in migration 398.
-- Uploads are browser-direct to Supabase Storage; metadata stored here.
-- Access via signed URLs only — no public URLs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_documents (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id              UUID        NOT NULL
    REFERENCES public.accounting_firms(id)   ON DELETE CASCADE,
  client_business_id   UUID        NOT NULL
    REFERENCES public.businesses(id)         ON DELETE CASCADE,
  uploaded_by_user_id  UUID        NOT NULL
    REFERENCES auth.users(id),
  title                TEXT        NOT NULL CHECK (length(trim(title)) > 0),
  category             TEXT        NOT NULL DEFAULT '',
  note                 TEXT        NOT NULL DEFAULT '',
  file_name            TEXT        NOT NULL CHECK (length(trim(file_name)) > 0),
  storage_path         TEXT        NOT NULL CHECK (length(trim(storage_path)) > 0),
  mime_type            TEXT        NOT NULL DEFAULT '',
  file_size            BIGINT      NOT NULL DEFAULT 0,
  metadata             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_documents_firm_id
  ON public.client_documents(firm_id);
CREATE INDEX IF NOT EXISTS idx_client_documents_client_business_id
  ON public.client_documents(client_business_id);
CREATE INDEX IF NOT EXISTS idx_client_documents_firm_client
  ON public.client_documents(firm_id, client_business_id);
CREATE INDEX IF NOT EXISTS idx_client_documents_category
  ON public.client_documents(firm_id, client_business_id, category);
CREATE INDEX IF NOT EXISTS idx_client_documents_created_at
  ON public.client_documents(created_at DESC);

CREATE OR REPLACE TRIGGER set_client_documents_updated_at
  BEFORE UPDATE ON public.client_documents
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

COMMENT ON TABLE public.client_documents
  IS 'Permanent document vault per client — uses documents bucket, signed URLs only, firm workspace';
COMMENT ON COLUMN public.client_documents.category
  IS 'e.g. Tax Returns, Financial Statements, Bank Statements, Contracts, ID Documents, Other';
COMMENT ON COLUMN public.client_documents.storage_path
  IS 'Must start with accounting-documents/{client_business_id}/';

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.client_documents ENABLE ROW LEVEL SECURITY;

-- SELECT: any firm member
DROP POLICY IF EXISTS "Firm members can select client_documents"
  ON public.client_documents;
CREATE POLICY "Firm members can select client_documents"
  ON public.client_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_documents.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- INSERT: firm member uploading as themselves
DROP POLICY IF EXISTS "Firm members can insert client_documents"
  ON public.client_documents;
CREATE POLICY "Firm members can insert client_documents"
  ON public.client_documents FOR INSERT
  WITH CHECK (
    uploaded_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_documents.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- No UPDATE or DELETE policies — vault records are immutable for this MVP
