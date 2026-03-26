-- ============================================================================
-- client_filing_checklist_items: pre/post-filing task checklist per filing
-- Scoped to a filing_id; firm workspace only; no templates in this MVP.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_filing_checklist_items (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id            UUID        NOT NULL
    REFERENCES public.client_filings(id)     ON DELETE CASCADE,
  firm_id              UUID        NOT NULL
    REFERENCES public.accounting_firms(id)   ON DELETE CASCADE,
  client_business_id   UUID        NOT NULL
    REFERENCES public.businesses(id)         ON DELETE CASCADE,
  title                TEXT        NOT NULL CHECK (length(trim(title)) > 0),
  status               TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'na')),
  note                 TEXT        NOT NULL DEFAULT '',
  created_by_user_id   UUID        NOT NULL
    REFERENCES auth.users(id),
  completed_at         TIMESTAMPTZ NULL,
  metadata             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_filing_checklist_items_filing_id
  ON public.client_filing_checklist_items(filing_id);
CREATE INDEX IF NOT EXISTS idx_filing_checklist_items_firm_id
  ON public.client_filing_checklist_items(firm_id);
CREATE INDEX IF NOT EXISTS idx_filing_checklist_items_firm_client
  ON public.client_filing_checklist_items(firm_id, client_business_id);
CREATE INDEX IF NOT EXISTS idx_filing_checklist_items_created_at
  ON public.client_filing_checklist_items(created_at ASC);

CREATE OR REPLACE TRIGGER set_filing_checklist_items_updated_at
  BEFORE UPDATE ON public.client_filing_checklist_items
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

COMMENT ON TABLE public.client_filing_checklist_items
  IS 'Pre/post-filing task checklist per filing — firm workspace, no templates in MVP';
COMMENT ON COLUMN public.client_filing_checklist_items.status
  IS 'pending | done | na (not applicable)';
COMMENT ON COLUMN public.client_filing_checklist_items.note
  IS 'Optional inline note — stored as plain text; empty string when not set';
COMMENT ON COLUMN public.client_filing_checklist_items.completed_at
  IS 'Set automatically when status transitions to done; cleared when reverted';

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.client_filing_checklist_items ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the same firm
DROP POLICY IF EXISTS "Firm members can select filing_checklist_items"
  ON public.client_filing_checklist_items;
CREATE POLICY "Firm members can select filing_checklist_items"
  ON public.client_filing_checklist_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_filing_checklist_items.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- INSERT: firm member who is the creator
DROP POLICY IF EXISTS "Firm members can insert filing_checklist_items"
  ON public.client_filing_checklist_items;
CREATE POLICY "Firm members can insert filing_checklist_items"
  ON public.client_filing_checklist_items FOR INSERT
  WITH CHECK (
    created_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_filing_checklist_items.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- UPDATE: any firm member may check/uncheck or add a note (collaborative)
DROP POLICY IF EXISTS "Firm members can update filing_checklist_items"
  ON public.client_filing_checklist_items;
CREATE POLICY "Firm members can update filing_checklist_items"
  ON public.client_filing_checklist_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_filing_checklist_items.firm_id
        AND afu.user_id = auth.uid()
    )
  );
