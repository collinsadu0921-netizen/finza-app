-- Client decision timestamps for proposals (accept / reject)

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_reason TEXT;

COMMENT ON COLUMN public.proposals.accepted_at IS 'When the client accepted via public link';
COMMENT ON COLUMN public.proposals.rejected_at IS 'When the client rejected via public link';
COMMENT ON COLUMN public.proposals.rejected_reason IS 'Optional client-provided reason for rejection';
