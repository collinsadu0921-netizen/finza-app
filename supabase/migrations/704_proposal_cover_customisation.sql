-- ============================================================================
-- Release 10: proposal cover colour and image-position customisation
-- ============================================================================
-- Additive only. NULL means "use the template default" and preserves the
-- appearance of every existing proposal. The business column is an optional
-- default snapped into new proposals at creation time; it never rewrites
-- existing proposal snapshots.
-- ============================================================================

BEGIN;

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS proposal_cover_color TEXT;

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS cover_background_color TEXT,
  ADD COLUMN IF NOT EXISTS cover_image_position TEXT;

COMMENT ON COLUMN public.businesses.proposal_cover_color IS
  'Optional default cover background colour for newly created proposals. Existing proposal snapshots are unchanged.';
COMMENT ON COLUMN public.proposals.cover_background_color IS
  'Optional per-proposal cover background colour snapshot; NULL uses the template default.';
COMMENT ON COLUMN public.proposals.cover_image_position IS
  'Optional object-position for the proposal cover image: center, top, bottom, left, right.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.businesses'::regclass
      AND conname = 'businesses_proposal_cover_color_check'
  ) THEN
    ALTER TABLE public.businesses
      ADD CONSTRAINT businesses_proposal_cover_color_check
      CHECK (proposal_cover_color IS NULL OR proposal_cover_color ~ '^#[0-9a-fA-F]{6}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.proposals'::regclass
      AND conname = 'proposals_cover_background_color_check'
  ) THEN
    ALTER TABLE public.proposals
      ADD CONSTRAINT proposals_cover_background_color_check
      CHECK (cover_background_color IS NULL OR cover_background_color ~ '^#[0-9a-fA-F]{6}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.proposals'::regclass
      AND conname = 'proposals_cover_image_position_check'
  ) THEN
    ALTER TABLE public.proposals
      ADD CONSTRAINT proposals_cover_image_position_check
      CHECK (cover_image_position IS NULL OR cover_image_position IN ('center','top','bottom','left','right'));
  END IF;
END $$;

COMMIT;
