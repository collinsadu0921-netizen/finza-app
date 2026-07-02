-- ============================================================================
-- Tenant support requests (Help Center contact form)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.support_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  category TEXT NOT NULL,
  subject TEXT,
  message TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'normal',
  route TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  CONSTRAINT support_requests_urgency_check CHECK (urgency IN ('normal', 'urgent')),
  CONSTRAINT support_requests_status_check CHECK (
    status IN ('open', 'in_progress', 'resolved', 'closed')
  )
);

CREATE INDEX IF NOT EXISTS idx_support_requests_business_created
  ON public.support_requests (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_requests_status_created
  ON public.support_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_requests_category_created
  ON public.support_requests (category, created_at DESC);

COMMENT ON TABLE public.support_requests IS
  'In-app Help Center contact support submissions; tenant-scoped via RLS.';

ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_requests_select ON public.support_requests;
CREATE POLICY support_requests_select ON public.support_requests
  FOR SELECT
  USING (public.finza_user_can_access_business(business_id));

DROP POLICY IF EXISTS support_requests_insert ON public.support_requests;
CREATE POLICY support_requests_insert ON public.support_requests
  FOR INSERT
  WITH CHECK (
    public.finza_user_can_access_business(business_id)
    AND user_id = auth.uid()
  );

GRANT SELECT, INSERT ON public.support_requests TO authenticated;
