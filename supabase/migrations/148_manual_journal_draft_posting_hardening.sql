-- ============================================================================
-- MIGRATION: Step 8.9 Batch D - Manual Journal Draft Posting Hardening
-- ============================================================================
-- This migration adds the required schema changes and constraints for
-- deterministic, idempotent posting of manual journal drafts to the ledger.
--
-- Scope: Accounting Workspace ONLY
--
-- DEPENDENCIES (must run in order):
--   146_firm_client_engagements_step8_8_batch2.sql (creates firm_client_engagements)
--   147_manual_journal_drafts_step8_9.sql (creates manual_journal_drafts)
-- ============================================================================

-- ============================================================================
-- STEP 1: EXTEND journal_entries FOR MANUAL DRAFT POSTING
-- ============================================================================

-- Add 'manual_draft' to source_type constraint
ALTER TABLE journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;

ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_source_type_check
  CHECK (source_type IS NULL OR source_type IN ('proposal', 'adjustment', 'manual_draft'));

-- Add columns for manual draft posting metadata
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS source_draft_id UUID,
  ADD COLUMN IF NOT EXISTS input_hash TEXT,
  ADD COLUMN IF NOT EXISTS accounting_firm_id UUID REFERENCES accounting_firms(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS period_id UUID REFERENCES accounting_periods(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS posted_by UUID REFERENCES auth.users(id);

-- Add indexes for idempotency checks
CREATE INDEX IF NOT EXISTS idx_journal_entries_source_draft_id 
  ON journal_entries(source_draft_id) 
  WHERE source_draft_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_input_hash 
  ON journal_entries(input_hash) 
  WHERE input_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_firm_id 
  ON journal_entries(accounting_firm_id) 
  WHERE accounting_firm_id IS NOT NULL;

-- ============================================================================
-- STEP 2: UNIQUE CONSTRAINTS FOR IDEMPOTENCY
-- ============================================================================

-- Unique constraint: One draft → one ledger entry (via source_draft_id)
-- Only applies when source_type = 'manual_draft'
CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_unique_source_draft_id
  ON journal_entries(source_draft_id)
  WHERE source_type = 'manual_draft' AND source_draft_id IS NOT NULL;

-- Unique constraint: Same input hash → same ledger entry
-- Prevents duplicate posts with same canonical payload
CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_unique_input_hash
  ON journal_entries(input_hash)
  WHERE source_type = 'manual_draft' AND input_hash IS NOT NULL;

-- ============================================================================
-- STEP 3: ADD input_hash TO manual_journal_drafts
-- ============================================================================

-- Add input_hash column to drafts (computed at approval time)
-- Only if table exists (migration 147 must run first)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'manual_journal_drafts'
  ) THEN
    ALTER TABLE manual_journal_drafts
      ADD COLUMN IF NOT EXISTS input_hash TEXT;

    CREATE INDEX IF NOT EXISTS idx_manual_journal_drafts_input_hash
      ON manual_journal_drafts(input_hash)
      WHERE input_hash IS NOT NULL;
  ELSE
    RAISE WARNING 'Table manual_journal_drafts does not exist. Please run migration 147_manual_journal_drafts_step8_9.sql first.';
  END IF;
END $$;

-- ============================================================================
-- STEP 4: FUNCTION - POST MANUAL JOURNAL DRAFT TO LEDGER (IDEMPOTENT)
-- ============================================================================
-- REQUIRED DEPENDENCIES:
--   - firm_client_engagements table (migration 146)
--   - manual_journal_drafts table (migration 147)
--   - accounting_periods table
--   - journal_entries table
--   - journal_entry_lines table
--
-- Note: PostgreSQL allows function creation even if referenced tables don't exist yet
-- The function will only fail when called, not when created
-- However, some database tools may validate functions during creation

CREATE OR REPLACE FUNCTION post_manual_journal_draft_to_ledger(
  p_draft_id UUID,
  p_posted_by UUID
)
RETURNS UUID AS $$
DECLARE
  draft_record RECORD;
  period_record RECORD;
  engagement_record RECORD;
  existing_entry_id UUID;
  journal_entry_id UUID;
  input_hash_val TEXT;
  canonical_lines JSONB;
  line_record JSONB;
BEGIN
  -- ========================================================================
  -- STEP 1: LOCK DRAFT ROW (FOR UPDATE)
  -- ========================================================================
  SELECT * INTO draft_record
  FROM manual_journal_drafts
  WHERE id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft not found: %', p_draft_id;
  END IF;

  -- ========================================================================
  -- STEP 2: IDEMPOTENCY CHECK - If already posted, return existing
  -- ========================================================================
  IF draft_record.journal_entry_id IS NOT NULL THEN
    -- Verify the ledger entry still exists
    SELECT id INTO existing_entry_id
    FROM journal_entries
    WHERE id = draft_record.journal_entry_id;

    IF existing_entry_id IS NOT NULL THEN
      RETURN existing_entry_id;
    END IF;
    -- If ledger entry was deleted (shouldn't happen), continue to repost
  END IF;

  -- ========================================================================
  -- STEP 3: RE-VALIDATE DRAFT STATE
  -- ========================================================================
  IF draft_record.status != 'approved' THEN
    RAISE EXCEPTION 'Draft must be approved before posting. Current status: %', draft_record.status;
  END IF;

  -- ========================================================================
  -- STEP 4: VALIDATE PERIOD STATE
  -- ========================================================================
  SELECT * INTO period_record
  FROM accounting_periods
  WHERE id = draft_record.period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Period not found: %', draft_record.period_id;
  END IF;

  IF period_record.status = 'locked' THEN
    RAISE EXCEPTION 'Cannot post to locked period: %', draft_record.period_id;
  END IF;

  -- ========================================================================
  -- STEP 5: VALIDATE ENGAGEMENT (active + effective)
  -- ========================================================================
  SELECT * INTO engagement_record
  FROM firm_client_engagements
  WHERE accounting_firm_id = draft_record.accounting_firm_id
    AND client_business_id = draft_record.client_business_id
    AND status = 'active'
    AND effective_from <= CURRENT_DATE
    AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
  ORDER BY effective_from DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active engagement found for firm % and client %', 
      draft_record.accounting_firm_id, draft_record.client_business_id;
  END IF;

  IF engagement_record.access_level != 'approve' THEN
    RAISE EXCEPTION 'Engagement access level must be "approve" to post. Current: %', 
      engagement_record.access_level;
  END IF;

  -- ========================================================================
  -- STEP 6: COMPUTE INPUT HASH (if not already set)
  -- ========================================================================
  -- Note: Input hash should be computed at approval time, but we compute it here
  -- if missing for backward compatibility
  IF draft_record.input_hash IS NULL THEN
    -- Build canonical hash from draft data
    -- This matches the client-side hash computation
    canonical_lines := jsonb_build_array();
    FOR line_record IN SELECT * FROM jsonb_array_elements(draft_record.lines)
    LOOP
      canonical_lines := canonical_lines || jsonb_build_object(
        'account_id', line_record->>'account_id',
        'debit', ROUND((line_record->>'debit')::NUMERIC, 2)::TEXT,
        'credit', ROUND((line_record->>'credit')::NUMERIC, 2)::TEXT,
        'memo', COALESCE(TRIM(line_record->>'memo'), '')
      );
    END LOOP;

    input_hash_val := encode(
      digest(
        format(
          '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
          draft_record.id,
          draft_record.accounting_firm_id,
          draft_record.client_business_id,
          draft_record.period_id,
          draft_record.entry_date::TEXT,
          draft_record.description,
          canonical_lines::TEXT,
          ROUND(draft_record.total_debit, 2)::TEXT,
          ROUND(draft_record.total_credit, 2)::TEXT,
          COALESCE(draft_record.approved_by::TEXT, '')
        ),
        'sha256'
      ),
      'hex'
    );
  ELSE
    input_hash_val := draft_record.input_hash;
  END IF;

  -- ========================================================================
  -- STEP 7: IDEMPOTENCY CHECK - Check if ledger entry exists with same hash
  -- ========================================================================
  SELECT id INTO existing_entry_id
  FROM journal_entries
  WHERE source_type = 'manual_draft'
    AND input_hash = input_hash_val
  LIMIT 1;

  IF existing_entry_id IS NOT NULL THEN
    -- Link draft to existing ledger entry
    UPDATE manual_journal_drafts
    SET 
      journal_entry_id = existing_entry_id,
      posted_at = NOW(),
      posted_by = p_posted_by
    WHERE id = p_draft_id;

    RETURN existing_entry_id;
  END IF;

  -- ========================================================================
  -- STEP 8: CREATE LEDGER ENTRY + LINES (ATOMIC)
  -- ========================================================================
  INSERT INTO journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    source_type,
    source_id,
    source_draft_id,
    input_hash,
    accounting_firm_id,
    period_id,
    created_by,
    posted_by
  ) VALUES (
    draft_record.client_business_id,
    draft_record.entry_date,
    draft_record.description,
    'manual',
    draft_record.id,
    'manual_draft',
    draft_record.id,
    draft_record.id,
    input_hash_val,
    draft_record.accounting_firm_id,
    draft_record.period_id,
    draft_record.created_by,
    p_posted_by
  )
  RETURNING id INTO journal_entry_id;

  -- Create journal entry lines
  FOR line_record IN SELECT * FROM jsonb_array_elements(draft_record.lines)
  LOOP
    INSERT INTO journal_entry_lines (
      journal_entry_id,
      account_id,
      debit,
      credit,
      description
    ) VALUES (
      journal_entry_id,
      (line_record->>'account_id')::UUID,
      COALESCE((line_record->>'debit')::NUMERIC, 0),
      COALESCE((line_record->>'credit')::NUMERIC, 0),
      line_record->>'memo'
    );
  END LOOP;

  -- ========================================================================
  -- STEP 9: UPDATE DRAFT (LINK TO LEDGER ENTRY)
  -- ========================================================================
  UPDATE manual_journal_drafts
  SET 
    journal_entry_id = journal_entry_id,
    posted_at = NOW(),
    posted_by = p_posted_by,
    input_hash = input_hash_val
  WHERE id = p_draft_id;

  RETURN journal_entry_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 5: COMMENTS
-- ============================================================================

COMMENT ON FUNCTION post_manual_journal_draft_to_ledger(UUID, UUID) IS 
'Idempotent function to post manual journal draft to ledger. Returns existing entry if already posted. Ensures exactly one ledger entry per draft.';

COMMENT ON COLUMN journal_entries.source_draft_id IS 
'For manual_draft source_type: ID of the manual_journal_drafts record. Unique constraint ensures one draft → one ledger entry.';

COMMENT ON COLUMN journal_entries.input_hash IS 
'Deterministic hash of canonical posting payload. Used for duplicate detection and audit trail. Same inputs → same hash → same ledger entry.';

COMMENT ON COLUMN journal_entries.accounting_firm_id IS 
'For manual_draft source_type: ID of the accounting firm that posted this entry.';

COMMENT ON COLUMN journal_entries.period_id IS 
'For manual_draft source_type: ID of the accounting period this entry belongs to.';

COMMENT ON COLUMN journal_entries.posted_by IS 
'For manual_draft source_type: User who posted this entry to the ledger.';

COMMENT ON COLUMN manual_journal_drafts.input_hash IS 
'Deterministic hash computed at approval time. Used for idempotent posting and audit trail.';
