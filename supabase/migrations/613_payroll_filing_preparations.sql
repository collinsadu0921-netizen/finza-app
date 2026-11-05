-- ============================================================================
-- Migration 613: Audited late GRA filing preparation
-- ============================================================================
-- Payroll approval no longer requires employee filing TIN / GRA position
-- (migration 612). When those details are completed later, GRA DT 107A
-- preparation must be possible without a new payroll run, using the approved
-- payroll amounts plus the current filing identity.
--
-- This table captures that corrected filing identity separately. It never
-- updates payroll_export_snapshots or any approved payroll calculation.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.payroll_filing_preparations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  export_type TEXT NOT NULL DEFAULT 'gra_dt107a',
  prepared_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  business_tin TEXT NULL,
  identity_payload JSONB NOT NULL,
  identity_sha256 TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL,
  content TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_filing_preparations_content
  ON public.payroll_filing_preparations(business_id, payroll_run_id, export_type, content_sha256);

CREATE INDEX IF NOT EXISTS ix_payroll_filing_preparations_run
  ON public.payroll_filing_preparations(business_id, payroll_run_id, prepared_at DESC);

ALTER TABLE public.payroll_filing_preparations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payroll_filing_preparations_select"
  ON public.payroll_filing_preparations;
CREATE POLICY "payroll_filing_preparations_select"
  ON public.payroll_filing_preparations FOR SELECT
  USING (
    public.finza_user_can_access_business(business_id)
    AND public.finza_user_has_permission(business_id, 'payroll.view')
  );

-- No write policies: preparation records are inserted by trusted server code.

COMMENT ON TABLE public.payroll_filing_preparations IS
  'Audited GRA filing preparation using corrected filing identity after payroll approval. Does not alter approved payroll calculations or immutable approval snapshots.';

NOTIFY pgrst, 'reload schema';
