-- ============================================================================
-- client_notes: internal accountant notes on clients (firm workspace only)
-- Internal, append-only for this MVP (no edit/delete).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_notes (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id             UUID        NOT NULL
    REFERENCES public.accounting_firms(id) ON DELETE CASCADE,
  client_business_id  UUID        NOT NULL
    REFERENCES public.businesses(id)       ON DELETE CASCADE,
  author_user_id      UUID        NOT NULL
    REFERENCES auth.users(id),
  body                TEXT        NOT NULL CHECK (length(trim(body)) > 0),
  metadata            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_notes_firm_id
  ON public.client_notes(firm_id);
CREATE INDEX IF NOT EXISTS idx_client_notes_client_business_id
  ON public.client_notes(client_business_id);
CREATE INDEX IF NOT EXISTS idx_client_notes_firm_client
  ON public.client_notes(firm_id, client_business_id);
CREATE INDEX IF NOT EXISTS idx_client_notes_created_at
  ON public.client_notes(created_at DESC);

-- Keep updated_at in sync on any future updates
CREATE OR REPLACE TRIGGER set_client_notes_updated_at
  BEFORE UPDATE ON public.client_notes
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

COMMENT ON TABLE public.client_notes
  IS 'Internal accountant notes on a client business — firm workspace, append-only MVP';

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.client_notes ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the same firm
DROP POLICY IF EXISTS "Firm members can select client_notes"
  ON public.client_notes;
CREATE POLICY "Firm members can select client_notes"
  ON public.client_notes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_notes.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- INSERT: firm member adding their own note
DROP POLICY IF EXISTS "Firm members can insert client_notes"
  ON public.client_notes;
CREATE POLICY "Firm members can insert client_notes"
  ON public.client_notes FOR INSERT
  WITH CHECK (
    author_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_notes.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- No UPDATE or DELETE policies — notes are immutable for this MVP
