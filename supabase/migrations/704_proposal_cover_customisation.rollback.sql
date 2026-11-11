-- ============================================================================
-- Emergency rollback for 704_proposal_cover_customisation
-- ============================================================================
-- WARNING: drops all saved cover colour/image-position snapshots and the
-- business default. Prefer a forward fix. Only use under incident command.
-- ============================================================================

BEGIN;

ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_cover_background_color_check,
  DROP CONSTRAINT IF EXISTS proposals_cover_image_position_check,
  DROP COLUMN IF EXISTS cover_background_color,
  DROP COLUMN IF EXISTS cover_image_position;

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_proposal_cover_color_check,
  DROP COLUMN IF EXISTS proposal_cover_color;

COMMIT;
