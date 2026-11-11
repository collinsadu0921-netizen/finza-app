-- ============================================================================
-- Emergency rollback for 703_proposal_rich_text_sender
-- ============================================================================
-- WARNING: dropping these columns permanently discards sender snapshots.
-- Prefer a forward fix. Only run under an explicit incident decision.
-- ============================================================================

BEGIN;

ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_prepared_by_name_length_check,
  DROP CONSTRAINT IF EXISTS proposals_prepared_by_title_length_check,
  DROP CONSTRAINT IF EXISTS proposals_prepared_by_email_length_check,
  DROP CONSTRAINT IF EXISTS proposals_prepared_by_phone_length_check,
  DROP COLUMN IF EXISTS prepared_by_name,
  DROP COLUMN IF EXISTS prepared_by_title,
  DROP COLUMN IF EXISTS prepared_by_email,
  DROP COLUMN IF EXISTS prepared_by_phone;

COMMIT;
