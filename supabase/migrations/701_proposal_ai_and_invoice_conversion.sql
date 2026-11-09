-- ============================================================================
-- Proposal AI builder + proposal → draft invoice traceability (Stage 02)
-- ============================================================================
-- Additive only. Existing proposals and invoices remain valid.
-- `proposals.converted_invoice_id` links an accepted proposal to the draft
-- invoice created from it. `invoices.source_proposal_id` preserves the reverse
-- trace without changing invoice posting behaviour.
-- ============================================================================

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS converted_invoice_id UUID
    REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_invoice_at TIMESTAMPTZ;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS source_proposal_id UUID
    REFERENCES public.proposals(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.proposals.converted_invoice_id IS
  'Draft invoice created directly from this accepted proposal. Prevents duplicate proposal-to-invoice conversion.';
COMMENT ON COLUMN public.proposals.converted_invoice_at IS
  'When the proposal was converted to a draft invoice.';
COMMENT ON COLUMN public.invoices.source_proposal_id IS
  'Accepted proposal that produced this invoice, when created through proposal conversion.';

CREATE INDEX IF NOT EXISTS idx_proposals_converted_invoice_id
  ON public.proposals (converted_invoice_id)
  WHERE converted_invoice_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_source_proposal_unique
  ON public.invoices (source_proposal_id)
  WHERE source_proposal_id IS NOT NULL;
