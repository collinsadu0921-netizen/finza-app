-- ============================================================================
-- client_filings: accountant filing workflow records (firm workspace only)
-- Tracks what has been filed for a client per period/type.
-- No external submission — internal workflow tracking only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_filings (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id              UUID        NOT NULL
    REFERENCES public.accounting_firms(id)   ON DELETE CASCADE,
  client_business_id   UUID        NOT NULL
    REFERENCES public.businesses(id)         ON DELETE CASCADE,
  period_id            UUID        NULL
    REFERENCES public.accounting_periods(id) ON DELETE SET NULL,
  filing_type          TEXT        NOT NULL CHECK (length(trim(filing_type)) > 0),
  status               TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'filed', 'accepted', 'rejected', 'cancelled')),
  created_by_user_id   UUID        NOT NULL
    REFERENCES auth.users(id),
  filed_at             TIMESTAMPTZ NULL,
  metadata             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_filings_firm_id
  ON public.client_filings(firm_id);
CREATE INDEX IF NOT EXISTS idx_client_filings_client_business_id
  ON public.client_filings(client_business_id);
CREATE INDEX IF NOT EXISTS idx_client_filings_firm_client
  ON public.client_filings(firm_id, client_business_id);
CREATE INDEX IF NOT EXISTS idx_client_filings_status
  ON public.client_filings(status);
CREATE INDEX IF NOT EXISTS idx_client_filings_period_id
  ON public.client_filings(period_id);
CREATE INDEX IF NOT EXISTS idx_client_filings_created_at
  ON public.client_filings(created_at DESC);

CREATE OR REPLACE TRIGGER set_client_filings_updated_at
  BEFORE UPDATE ON public.client_filings
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

COMMENT ON TABLE public.client_filings
  IS 'Internal filing workflow records per client — no external submission, firm workspace only';
COMMENT ON COLUMN public.client_filings.filing_type
  IS 'e.g. VAT, CIT, PAYE, SSNIT, Annual Returns, GRA Audit Response';
COMMENT ON COLUMN public.client_filings.status
  IS 'pending | in_progress | filed | accepted | rejected | cancelled';
COMMENT ON COLUMN public.client_filings.filed_at
  IS 'Set when status transitions to filed — can be manually overridden for back-dating';

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.client_filings ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the same firm
DROP POLICY IF EXISTS "Firm members can select client_filings"
  ON public.client_filings;
CREATE POLICY "Firm members can select client_filings"
  ON public.client_filings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_filings.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- INSERT: firm member who is the creator
DROP POLICY IF EXISTS "Firm members can insert client_filings"
  ON public.client_filings;
CREATE POLICY "Firm members can insert client_filings"
  ON public.client_filings FOR INSERT
  WITH CHECK (
    created_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_filings.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- UPDATE: any firm member may update status/metadata (collaborative workflow)
DROP POLICY IF EXISTS "Firm members can update client_filings"
  ON public.client_filings;
CREATE POLICY "Firm members can update client_filings"
  ON public.client_filings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_filings.firm_id
        AND afu.user_id = auth.uid()
    )
  );
