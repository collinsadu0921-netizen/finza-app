-- ============================================================================
-- client_request_comments: internal thread on a client request (firm workspace)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_request_comments (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          UUID        NOT NULL
    REFERENCES public.client_requests(id)    ON DELETE CASCADE,
  firm_id             UUID        NOT NULL
    REFERENCES public.accounting_firms(id)   ON DELETE CASCADE,
  client_business_id  UUID        NOT NULL
    REFERENCES public.businesses(id)         ON DELETE CASCADE,
  author_user_id      UUID        NOT NULL
    REFERENCES auth.users(id),
  body                TEXT        NOT NULL CHECK (length(trim(body)) > 0),
  metadata            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_request_comments_request_id
  ON public.client_request_comments(request_id);
CREATE INDEX IF NOT EXISTS idx_client_request_comments_firm_id
  ON public.client_request_comments(firm_id);
CREATE INDEX IF NOT EXISTS idx_client_request_comments_client_business_id
  ON public.client_request_comments(client_business_id);
CREATE INDEX IF NOT EXISTS idx_client_request_comments_created_at
  ON public.client_request_comments(created_at ASC);

COMMENT ON TABLE public.client_request_comments
  IS 'Internal comment thread on a client request — visible to accountant firm members only';

-- updated_at trigger (reuse pattern from client_requests)
CREATE OR REPLACE FUNCTION public.update_client_request_comments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_client_request_comments_updated_at
  ON public.client_request_comments;
CREATE TRIGGER trigger_update_client_request_comments_updated_at
  BEFORE UPDATE ON public.client_request_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_client_request_comments_updated_at();

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.client_request_comments ENABLE ROW LEVEL SECURITY;

-- SELECT: any firm member who belongs to the same firm as the comment
DROP POLICY IF EXISTS "Firm members can select client_request_comments"
  ON public.client_request_comments;
CREATE POLICY "Firm members can select client_request_comments"
  ON public.client_request_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_request_comments.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- INSERT: firm member inserting their own comment (author_user_id = self)
DROP POLICY IF EXISTS "Firm members can insert client_request_comments"
  ON public.client_request_comments;
CREATE POLICY "Firm members can insert client_request_comments"
  ON public.client_request_comments FOR INSERT
  WITH CHECK (
    author_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_request_comments.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- No UPDATE or DELETE policies — comments are append-only for this MVP
