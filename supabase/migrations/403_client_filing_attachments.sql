-- ============================================================================
-- client_filing_attachments: files uploaded against a client filing
-- Reuses the "documents" storage bucket provisioned in migration 398.
-- Browser uploads directly to Supabase Storage; this table stores metadata.
-- Access is via signed URLs only — no public URLs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_filing_attachments (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id            UUID        NOT NULL
    REFERENCES public.client_filings(id)     ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_filing_attachments_filing_id
  ON public.client_filing_attachments(filing_id);
CREATE INDEX IF NOT EXISTS idx_filing_attachments_firm_id
  ON public.client_filing_attachments(firm_id);
CREATE INDEX IF NOT EXISTS idx_filing_attachments_firm_client
  ON public.client_filing_attachments(firm_id, client_business_id);
CREATE INDEX IF NOT EXISTS idx_filing_attachments_created_at
  ON public.client_filing_attachments(created_at ASC);

COMMENT ON TABLE public.client_filing_attachments
  IS 'File attachments on a client filing — uses documents bucket, signed URLs only, firm workspace';

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.client_filing_attachments ENABLE ROW LEVEL SECURITY;

-- SELECT: any firm member
DROP POLICY IF EXISTS "Firm members can select filing_attachments"
  ON public.client_filing_attachments;
CREATE POLICY "Firm members can select filing_attachments"
  ON public.client_filing_attachments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_filing_attachments.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- INSERT: firm member uploading as themselves
DROP POLICY IF EXISTS "Firm members can insert filing_attachments"
  ON public.client_filing_attachments;
CREATE POLICY "Firm members can insert filing_attachments"
  ON public.client_filing_attachments FOR INSERT
  WITH CHECK (
    uploaded_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_filing_attachments.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- No UPDATE or DELETE — attachments are immutable for this MVP
