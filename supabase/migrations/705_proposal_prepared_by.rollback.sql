-- ============================================================================
-- Emergency rollback for 705_proposal_prepared_by
-- ============================================================================
-- WARNING: drops all per-proposal prepared-by values. Prefer a forward fix.
-- ============================================================================

BEGIN;

ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_prepared_by_name_length_check,
  DROP COLUMN IF EXISTS prepared_by_name;

COMMIT;
