-- Link proposals to estimates after staff conversion (accepted → draft estimate).

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS converted_estimate_id UUID REFERENCES public.estimates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.proposals.converted_estimate_id IS 'Draft (or other) estimate created from this proposal via Convert to Estimate';
COMMENT ON COLUMN public.proposals.converted_at IS 'When staff ran proposal → estimate conversion';

CREATE INDEX IF NOT EXISTS idx_proposals_converted_estimate_id
  ON public.proposals (converted_estimate_id)
  WHERE converted_estimate_id IS NOT NULL;
