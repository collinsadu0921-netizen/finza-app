-- ============================================================================
-- MIGRATION: Allow manual_draft and opening_balance in proposal gating
-- ============================================================================
-- Trigger trigger_enforce_proposal_gating (089) calls validate_proposal_gating.
-- That function previously allowed only source_type IN ('proposal','adjustment'),
-- causing "source_type must be 'proposal' or 'adjustment', got: manual_draft"
-- on post_manual_journal_draft_to_ledger / post_opening_balance_import_to_ledger.
--
-- This migration updates validate_proposal_gating so that manual_draft and
-- opening_balance skip proposal gating (early return). Proposal and adjustment
-- behavior is unchanged. Trigger is not removed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_proposal_gating(
  p_source_type TEXT,
  p_source_id UUID,
  p_business_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  adjustment_record RECORD;
  -- Note: posting_proposals table validation will be added when table exists
BEGIN
  -- manual_draft and opening_balance are allowed; no proposal gating (aligned with journal_entries_source_type_check)
  IF p_source_type IN ('manual_draft', 'opening_balance') THEN
    RETURN TRUE;
  END IF;

  -- If source_type is provided, source_id must also be provided (and vice versa)
  IF (p_source_type IS NULL) != (p_source_id IS NULL) THEN
    RAISE EXCEPTION 'source_type and source_id must both be provided or both be NULL';
  END IF;

  -- If source_type is provided, validate it
  IF p_source_type IS NOT NULL THEN
    -- source_type must be 'proposal' or 'adjustment'
    IF p_source_type NOT IN ('proposal', 'adjustment') THEN
      RAISE EXCEPTION 'source_type must be ''proposal'' or ''adjustment'', got: %', p_source_type;
    END IF;

    -- Validate adjustment_journal if source_type = 'adjustment'
    IF p_source_type = 'adjustment' THEN
      SELECT * INTO adjustment_record
      FROM adjustment_journals
      WHERE id = p_source_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Adjustment journal not found: %. Journal entry must reference a valid adjustment journal.', p_source_id;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM journal_entries je
        WHERE je.id = adjustment_record.journal_entry_id
          AND je.business_id != p_business_id
      ) THEN
        RAISE EXCEPTION 'Adjustment journal does not belong to the same business as the journal entry';
      END IF;
    END IF;

    -- Validate posting_proposal if source_type = 'proposal'
    IF p_source_type = 'proposal' THEN
      IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'posting_proposals'
      ) THEN
        IF NOT EXISTS (
          SELECT 1
          FROM posting_proposals
          WHERE id = p_source_id
            AND status = 'approved'
            AND business_id = p_business_id
        ) THEN
          RAISE EXCEPTION 'Posting proposal not found or not approved: %. Journal entry must reference an approved posting proposal.', p_source_id;
        END IF;
      ELSE
        RAISE WARNING 'posting_proposals table does not exist yet. Proposal validation will be enforced when table is created.';
      END IF;
    END IF;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.validate_proposal_gating(TEXT, UUID, UUID) IS
'Validates proposal gating for journal entry insert. manual_draft and opening_balance skip gating; proposal and adjustment are validated as before.';
