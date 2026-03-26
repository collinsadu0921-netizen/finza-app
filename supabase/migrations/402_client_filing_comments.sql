-- ============================================================================
-- client_filing_comments: internal discussion thread per filing
-- Plain text only; append-only for this MVP (no edit/delete).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_filing_comments (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id            UUID        NOT NULL
    REFERENCES public.client_filings(id)     ON DELETE CASCADE,
  firm_id              UUID        NOT NULL
    REFERENCES public.accounting_firms(id)   ON DELETE CASCADE,
  client_business_id   UUID        NOT NULL
    REFERENCES public.businesses(id)         ON DELETE CASCADE,
  author_user_id       UUID        NOT NULL
    REFERENCES auth.users(id),
  body                 TEXT        NOT NULL CHECK (length(trim(body)) > 0),
  metadata             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_filing_comments_filing_id
  ON public.client_filing_comments(filing_id);
CREATE INDEX IF NOT EXISTS idx_filing_comments_firm_id
  ON public.client_filing_comments(firm_id);
CREATE INDEX IF NOT EXISTS idx_filing_comments_firm_client
  ON public.client_filing_comments(firm_id, client_business_id);
CREATE INDEX IF NOT EXISTS idx_filing_comments_created_at
  ON public.client_filing_comments(created_at ASC);

CREATE OR REPLACE TRIGGER set_filing_comments_updated_at
  BEFORE UPDATE ON public.client_filing_comments
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

COMMENT ON TABLE public.client_filing_comments
  IS 'Internal discussion thread per filing — firm workspace, plain text, append-only MVP';

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.client_filing_comments ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the same firm
DROP POLICY IF EXISTS "Firm members can select filing_comments"
  ON public.client_filing_comments;
CREATE POLICY "Firm members can select filing_comments"
  ON public.client_filing_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_filing_comments.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- INSERT: firm member posting as themselves
DROP POLICY IF EXISTS "Firm members can insert filing_comments"
  ON public.client_filing_comments;
CREATE POLICY "Firm members can insert filing_comments"
  ON public.client_filing_comments FOR INSERT
  WITH CHECK (
    author_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_filing_comments.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- No UPDATE or DELETE policies — comments are immutable in this MVP
