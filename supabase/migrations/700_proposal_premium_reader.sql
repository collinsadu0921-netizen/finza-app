-- ============================================================================
-- Proposal premium document system (Stage 01)
-- ============================================================================
-- Additive presentation settings for the digital proposal reader and PDF.
-- Existing proposals remain valid: all columns are nullable/defaulted and
-- `standard_v1` continues to be a supported template identifier.
-- ============================================================================

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS brand_accent_color TEXT,
  ADD COLUMN IF NOT EXISTS cover_asset_id UUID
    REFERENCES public.proposal_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS typography TEXT NOT NULL DEFAULT 'sans';

COMMENT ON COLUMN public.proposals.brand_accent_color IS
  'Optional proposal-level accent colour (hex, e.g. #0f766e). Null uses the template default.';
COMMENT ON COLUMN public.proposals.cover_asset_id IS
  'Optional cover image from proposal_assets. Must be an image belonging to this proposal.';
COMMENT ON COLUMN public.proposals.typography IS
  'Reader/PDF typography: sans, serif, or editorial.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.proposals'::regclass
      AND conname = 'proposals_brand_accent_color_hex_check'
  ) THEN
    ALTER TABLE public.proposals
      ADD CONSTRAINT proposals_brand_accent_color_hex_check
      CHECK (brand_accent_color IS NULL OR brand_accent_color ~ '^#[0-9a-fA-F]{6}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.proposals'::regclass
      AND conname = 'proposals_typography_check'
  ) THEN
    ALTER TABLE public.proposals
      ADD CONSTRAINT proposals_typography_check
      CHECK (typography IN ('sans', 'serif', 'editorial'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_proposals_cover_asset_id
  ON public.proposals (cover_asset_id)
  WHERE cover_asset_id IS NOT NULL;
