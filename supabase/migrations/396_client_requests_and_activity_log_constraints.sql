-- ============================================================================
-- client_requests: accountant document / info requests per client engagement
-- + Relax accounting_firm_activity_logs CHECK constraints (non-empty text only)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) client_requests
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES public.accounting_firms(id) ON DELETE CASCADE,
  client_business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  engagement_id UUID NOT NULL REFERENCES public.firm_client_engagements(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  document_type TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_requests_firm_id ON public.client_requests(firm_id);
CREATE INDEX IF NOT EXISTS idx_client_requests_client_business_id ON public.client_requests(client_business_id);
CREATE INDEX IF NOT EXISTS idx_client_requests_engagement_id ON public.client_requests(engagement_id);
CREATE INDEX IF NOT EXISTS idx_client_requests_status ON public.client_requests(status);
CREATE INDEX IF NOT EXISTS idx_client_requests_created_at ON public.client_requests(created_at DESC);

COMMENT ON TABLE public.client_requests IS 'Accountant-initiated requests for information or documents per client (firm workspace)';

CREATE OR REPLACE FUNCTION public.update_client_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_client_requests_updated_at ON public.client_requests;
CREATE TRIGGER trigger_update_client_requests_updated_at
  BEFORE UPDATE ON public.client_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_client_requests_updated_at();

ALTER TABLE public.client_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Firm members can select client_requests" ON public.client_requests;
CREATE POLICY "Firm members can select client_requests"
  ON public.client_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_requests.firm_id
        AND afu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Firm members can insert client_requests" ON public.client_requests;
CREATE POLICY "Firm members can insert client_requests"
  ON public.client_requests FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_requests.firm_id
        AND afu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Firm members can update client_requests" ON public.client_requests;
CREATE POLICY "Firm members can update client_requests"
  ON public.client_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_requests.firm_id
        AND afu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_requests.firm_id
        AND afu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Firm members can delete client_requests" ON public.client_requests;
CREATE POLICY "Firm members can delete client_requests"
  ON public.client_requests FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.accounting_firm_users afu
      WHERE afu.firm_id = client_requests.firm_id
        AND afu.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 2) Relax accounting_firm_activity_logs enumerated CHECKs (avoid insert failures)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'accounting_firm_activity_logs'
  ) THEN
    ALTER TABLE public.accounting_firm_activity_logs
      DROP CONSTRAINT IF EXISTS accounting_firm_activity_logs_action_type_check;
    ALTER TABLE public.accounting_firm_activity_logs
      DROP CONSTRAINT IF EXISTS accounting_firm_activity_logs_entity_type_check;

    ALTER TABLE public.accounting_firm_activity_logs
      ADD CONSTRAINT accounting_firm_activity_logs_action_type_nonempty
      CHECK (length(trim(action_type)) > 0);

    ALTER TABLE public.accounting_firm_activity_logs
      ADD CONSTRAINT accounting_firm_activity_logs_entity_type_nonempty
      CHECK (length(trim(entity_type)) > 0);
  END IF;
END $$;
