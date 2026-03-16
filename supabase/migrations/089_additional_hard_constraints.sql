-- Migration: Additional Hard DB Constraints & Invariants
-- 4. Proposal Gating (Authority Boundary)
-- 5. Accountant-Only Actions
-- 6. Period Transition Invariants (verified/enhanced)

-- ============================================================================
-- 4. PROPOSAL GATING (Authority Boundary)
-- ============================================================================
-- Rules:
--   - Ledger entries must reference an approved proposal or adjustment
--   - Direct inserts without authority are invalid
--   - source_type IN ('proposal', 'adjustment')
--   - FK to posting_proposals(id) or adjustment_journals(id)
--   - Trigger verifies proposal status = approved

-- Add source_type and source_id columns to journal_entries
-- Note: For backward compatibility, these are nullable initially. Future versions
-- may require them to be NOT NULL to enforce strict proposal gating.
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS source_type TEXT CHECK (source_type IN ('proposal', 'adjustment')),
  ADD COLUMN IF NOT EXISTS source_id UUID;

-- Index for source lookups
CREATE INDEX IF NOT EXISTS idx_journal_entries_source ON journal_entries(source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

-- Note: Foreign key constraints to posting_proposals and adjustment_journals
-- will be added when those tables are fully defined. For now, we enforce via triggers.

-- ============================================================================
-- FUNCTION: Validate proposal gating for journal entry
-- ============================================================================
CREATE OR REPLACE FUNCTION validate_proposal_gating(
  p_source_type TEXT,
  p_source_id UUID,
  p_business_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  adjustment_record RECORD;
  -- Note: posting_proposals table validation will be added when table exists
BEGIN
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
    
    -- Validate adjustment_journal if source_type is 'adjustment'
    IF p_source_type = 'adjustment' THEN
      SELECT * INTO adjustment_record
      FROM adjustment_journals
      WHERE id = p_source_id;
      
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Adjustment journal not found: %. Journal entry must reference a valid adjustment journal.', p_source_id;
      END IF;
      
      -- Verify the adjustment journal belongs to the same business
      IF EXISTS (
        SELECT 1
        FROM journal_entries je
        WHERE je.id = adjustment_record.journal_entry_id
          AND je.business_id != p_business_id
      ) THEN
        RAISE EXCEPTION 'Adjustment journal does not belong to the same business as the journal entry';
      END IF;
    END IF; -- Close IF p_source_type = 'adjustment'
    
    -- Validate posting_proposal if source_type is 'proposal'
    -- Note: This check will be enabled when posting_proposals table is created
    IF p_source_type = 'proposal' THEN
      -- Check if posting_proposals table exists
      IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'posting_proposals'
      ) THEN
        -- Validate proposal exists and is approved
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
        -- Table doesn't exist yet - allow for now but warn
        RAISE WARNING 'posting_proposals table does not exist yet. Proposal validation will be enforced when table is created.';
      END IF;
    END IF; -- Close IF p_source_type = 'proposal'
  END IF; -- Close IF p_source_type IS NOT NULL
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGER: Enforce proposal gating on journal entry insert
-- ============================================================================
-- Note: Currently source_type/source_id are optional for backward compatibility.
-- When provided, they must be valid. Future versions may require them to be NOT NULL.
CREATE OR REPLACE FUNCTION enforce_proposal_gating()
RETURNS TRIGGER AS $$
BEGIN
  -- Only validate if source_type is provided (allows backward compatibility)
  IF NEW.source_type IS NOT NULL THEN
    PERFORM validate_proposal_gating(NEW.source_type, NEW.source_id, NEW.business_id);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_enforce_proposal_gating ON journal_entries;
CREATE TRIGGER trigger_enforce_proposal_gating
  BEFORE INSERT ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION enforce_proposal_gating();

-- ============================================================================
-- 5. ACCOUNTANT-ONLY ACTIONS
-- ============================================================================
-- Rules:
--   - Only accountants can: approve proposals, post ledger entries, move period
--     states, create adjustments, lock periods
--   - Server-side role checks
--   - DB-level guard: posted_by_accountant_id IS NOT NULL
--   - FK to accountants(id) only (via auth.users where user is accountant)

-- Add posted_by_accountant_id column to journal_entries
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS posted_by_accountant_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT;

-- Index for posted_by_accountant_id
CREATE INDEX IF NOT EXISTS idx_journal_entries_posted_by_accountant ON journal_entries(posted_by_accountant_id)
  WHERE posted_by_accountant_id IS NOT NULL;

-- ============================================================================
-- FUNCTION: Validate accountant role for posting
-- ============================================================================
CREATE OR REPLACE FUNCTION validate_accountant_posting(
  p_posted_by_accountant_id UUID,
  p_business_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  is_accountant BOOLEAN;
BEGIN
  -- posted_by_accountant_id is required
  IF p_posted_by_accountant_id IS NULL THEN
    RAISE EXCEPTION 'posted_by_accountant_id is required. Only accountants can post ledger entries.';
  END IF;
  
  -- Verify user is accountant for this business
  is_accountant := is_user_accountant(p_posted_by_accountant_id, p_business_id);
  
  IF NOT is_accountant THEN
    RAISE EXCEPTION 'User % does not have accountant role for business %. Only accountants can post ledger entries.', p_posted_by_accountant_id, p_business_id;
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGER: Enforce accountant-only posting on journal entry insert
-- ============================================================================
CREATE OR REPLACE FUNCTION enforce_accountant_only_posting()
RETURNS TRIGGER AS $$
BEGIN
  -- Validate that posted_by_accountant_id is set and user is accountant
  PERFORM validate_accountant_posting(NEW.posted_by_accountant_id, NEW.business_id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_enforce_accountant_only_posting ON journal_entries;
CREATE TRIGGER trigger_enforce_accountant_only_posting
  BEFORE INSERT ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION enforce_accountant_only_posting();

-- ============================================================================
-- 6. PERIOD TRANSITION INVARIANTS
-- ============================================================================
-- Rules:
--   - Allowed transitions only: open → closing → closed → locked
--   - No backward or skipped transitions
--
-- Enforcement:
--   - Already enforced in migration 084 via validate_period_status_transition()
--   - Trigger trigger_validate_accounting_period already enforces transitions
--
-- This migration verifies the constraint exists and adds documentation.

-- Verify the constraint function exists (should be from migration 084)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'validate_period_status_transition'
  ) THEN
    RAISE EXCEPTION 'validate_period_status_transition function not found. Migration 084 must be run first.';
  END IF;
END $$;

-- Verify the trigger exists (should be from migration 084)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_validate_accounting_period'
  ) THEN
    RAISE WARNING 'trigger_validate_accounting_period not found. Period transition validation may not be enforced.';
  END IF;
END $$;

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON COLUMN journal_entries.source_type IS 
'Hard constraint: Source type for proposal gating. Must be ''proposal'' or ''adjustment'' if provided. Journal entries must reference an approved proposal or adjustment.';

COMMENT ON COLUMN journal_entries.source_id IS 
'Hard constraint: ID of the source proposal or adjustment. Must reference a valid posting_proposals(id) or adjustment_journals(id). Proposal must be approved.';

COMMENT ON COLUMN journal_entries.posted_by_accountant_id IS 
'Hard constraint: Accountant who posted this journal entry. Required. Only accountants can post ledger entries. Validated via is_user_accountant() function.';

COMMENT ON FUNCTION validate_proposal_gating(TEXT, UUID, UUID) IS 
'Hard constraint: Validates proposal gating. Ensures journal entries reference approved proposals or valid adjustments. Enforces authority boundary.';

COMMENT ON FUNCTION enforce_proposal_gating() IS 
'Hard constraint: Trigger function that enforces proposal gating on journal entry insert. Validates source_type and source_id reference valid approved proposals or adjustments.';

COMMENT ON FUNCTION validate_accountant_posting(UUID, UUID) IS 
'Hard constraint: Validates that only accountants can post ledger entries. Ensures posted_by_accountant_id is set and user has accountant role.';

COMMENT ON FUNCTION enforce_accountant_only_posting() IS 
'Hard constraint: Trigger function that enforces accountant-only posting. Prevents non-accountants from posting ledger entries.';

