-- ============================================================================
-- Proposal editable "Prepared by" byline
-- ============================================================================
-- Additive and backwards compatible: NULL keeps the existing business-profile
-- fallback, so historical proposals keep their current cover appearance.
-- ============================================================================

BEGIN;

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS prepared_by_name TEXT;

COMMENT ON COLUMN public.proposals.prepared_by_name IS
  'Optional per-proposal cover byline. NULL falls back to the business trading/legal/display name.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.proposals'::regclass
      AND conname = 'proposals_prepared_by_name_length_check'
  ) THEN
    ALTER TABLE public.proposals
      ADD CONSTRAINT proposals_prepared_by_name_length_check
      CHECK (prepared_by_name IS NULL OR char_length(prepared_by_name) <= 200);
  END IF;
END $$;

COMMIT;
