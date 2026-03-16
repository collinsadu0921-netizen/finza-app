-- ============================================================================
-- MIGRATION: Step 9.1 Batch C - Opening Balance Posting & Idempotency
-- ============================================================================
-- This migration adds the posting function for opening balance imports with
-- row locking, idempotency checks, and audit linkage.
--
-- Scope: Accounting Workspace ONLY
-- Mode: External / Accountant-First
--
-- DEPENDENCIES (must run in order):
--   150_opening_balance_imports_step9_1.sql (creates opening_balance_imports)
-- ============================================================================

-- ============================================================================
-- STEP 1: EXTEND journal_entries FOR OPENING BALANCE POSTING
-- ============================================================================

-- Add 'opening_balance' to source_type constraint
ALTER TABLE journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;

ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_source_type_check
  CHECK (source_type IS NULL OR source_type IN ('proposal', 'adjustment', 'manual_draft', 'opening_balance'));

-- Add source_import_id column for opening balance imports (similar to source_draft_id)
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS source_import_id UUID;

-- Add index for opening balance import lookups
CREATE INDEX IF NOT EXISTS idx_journal_entries_source_import_id 
  ON journal_entries(source_import_id) 
  WHERE source_import_id IS NOT NULL;

-- Unique constraint: One opening balance import → one ledger entry
-- Only applies when source_type = 'opening_balance'
CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_unique_source_import_id
  ON journal_entries(source_import_id)
  WHERE source_type = 'opening_balance' AND source_import_id IS NOT NULL;

-- ============================================================================
-- STEP 2: FUNCTION - POST OPENING BALANCE IMPORT TO LEDGER (IDEMPOTENT)
-- ============================================================================
-- REQUIRED DEPENDENCIES:
--   - firm_client_engagements table
--   - opening_balance_imports table (migration 150)
--   - accounting_periods table
--   - journal_entries table
--   - journal_entry_lines table
--
-- Note: PostgreSQL allows function creation even if referenced tables don't exist yet
-- The function will only fail when called, not when created

CREATE OR REPLACE FUNCTION post_opening_balance_import_to_ledger(
  p_import_id UUID,
  p_posted_by UUID
)
RETURNS UUID AS $$
DECLARE
  import_record RECORD;
  period_record RECORD;
  engagement_record RECORD;
  existing_entry_id UUID;
  journal_entry_id UUID;
  input_hash_val TEXT;
  canonical_lines JSONB;
  line_record JSONB;
  other_entry_count INTEGER;
  first_period_id UUID;
BEGIN
  -- ========================================================================
  -- STEP 1: LOCK IMPORT ROW (FOR UPDATE)
  -- ========================================================================
  SELECT * INTO import_record
  FROM opening_balance_imports
  WHERE id = p_import_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opening balance import not found: %', p_import_id;
  END IF;

  -- ========================================================================
  -- STEP 2: IDEMPOTENCY CHECK - If already posted, return existing
  -- ========================================================================
  IF import_record.journal_entry_id IS NOT NULL THEN
    -- Verify the ledger entry still exists
    SELECT id INTO existing_entry_id
    FROM journal_entries
    WHERE id = import_record.journal_entry_id;

    IF existing_entry_id IS NOT NULL THEN
      RETURN existing_entry_id;
    END IF;
    -- If ledger entry was deleted (shouldn't happen), continue to repost
  END IF;

  -- ========================================================================
  -- STEP 3: RE-VALIDATE IMPORT STATE
  -- ========================================================================
  IF import_record.status != 'approved' THEN
    RAISE EXCEPTION 'Opening balance import must be approved before posting. Current status: %', import_record.status;
  END IF;

  -- ========================================================================
  -- STEP 4: VALIDATE PERIOD STATE
  -- ========================================================================
  SELECT * INTO period_record
  FROM accounting_periods
  WHERE id = import_record.period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Period not found: %', import_record.period_id;
  END IF;

  IF period_record.status = 'locked' THEN
    RAISE EXCEPTION 'Cannot post opening balance to locked period: %', import_record.period_id;
  END IF;

  -- ========================================================================
  -- STEP 5: VALIDATE PERIOD IS FIRST OPEN PERIOD
  -- ========================================================================
  -- Opening balances must be posted to the first open period for the business
  SELECT id INTO first_period_id
  FROM accounting_periods
  WHERE business_id = import_record.client_business_id
    AND status = 'open'
  ORDER BY period_start ASC
  LIMIT 1;

  IF first_period_id IS NULL THEN
    RAISE EXCEPTION 'No open period found for business: %', import_record.client_business_id;
  END IF;

  IF first_period_id != import_record.period_id THEN
    RAISE EXCEPTION 'Opening balance must be posted to first open period. Expected: %, Got: %', 
      first_period_id, import_record.period_id;
  END IF;

  -- ========================================================================
  -- STEP 6: ENSURE NO OTHER JOURNAL ENTRIES EXIST IN PERIOD
  -- ========================================================================
  -- Opening balances must be the first entry in the period
  SELECT COUNT(*) INTO other_entry_count
  FROM journal_entries
  WHERE business_id = import_record.client_business_id
    AND period_id = import_record.period_id
    AND (source_type IS NULL OR source_type != 'opening_balance');

  IF other_entry_count > 0 THEN
    RAISE EXCEPTION 'Cannot post opening balance. Period already has % other journal entry(ies). Opening balances must be posted first.', 
      other_entry_count;
  END IF;

  -- ========================================================================
  -- STEP 7: VALIDATE ENGAGEMENT (active + effective)
  -- ========================================================================
  SELECT * INTO engagement_record
  FROM firm_client_engagements
  WHERE accounting_firm_id = import_record.accounting_firm_id
    AND client_business_id = import_record.client_business_id
    AND status = 'active'
    AND effective_from <= CURRENT_DATE
    AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
  ORDER BY effective_from DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active engagement found for firm % and client %', 
      import_record.accounting_firm_id, import_record.client_business_id;
  END IF;

  IF engagement_record.access_level != 'approve' THEN
    RAISE EXCEPTION 'Engagement access level must be "approve" to post. Current: %', 
      engagement_record.access_level;
  END IF;

  -- ========================================================================
  -- STEP 8: COMPUTE INPUT HASH (if not already set)
  -- ========================================================================
  -- Note: Input hash should be computed at approval time, but we compute it here
  -- if missing for backward compatibility
  IF import_record.input_hash IS NULL THEN
    -- Build canonical hash from import data
    -- This matches the client-side hash computation
    canonical_lines := jsonb_build_array();
    FOR line_record IN SELECT * FROM jsonb_array_elements(import_record.lines)
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
          '%s|%s|%s|%s|%s|%s|%s|%s|%s',
          import_record.id,
          import_record.accounting_firm_id,
          import_record.client_business_id,
          import_record.period_id,
          import_record.source_type,
          canonical_lines::TEXT,
          ROUND(import_record.total_debit, 2)::TEXT,
          ROUND(import_record.total_credit, 2)::TEXT,
          COALESCE(import_record.approved_by::TEXT, '')
        ),
        'sha256'
      ),
      'hex'
    );
  ELSE
    input_hash_val := import_record.input_hash;
  END IF;

  -- ========================================================================
  -- STEP 9: IDEMPOTENCY CHECK - Check if ledger entry exists with same hash
  -- ========================================================================
  SELECT id INTO existing_entry_id
  FROM journal_entries
  WHERE source_type = 'opening_balance'
    AND input_hash = input_hash_val
  LIMIT 1;

  IF existing_entry_id IS NOT NULL THEN
    -- Link import to existing ledger entry
    UPDATE opening_balance_imports
    SET 
      journal_entry_id = existing_entry_id,
      posted_at = NOW(),
      posted_by = p_posted_by,
      status = 'posted',
      input_hash = input_hash_val
    WHERE id = p_import_id;

    RETURN existing_entry_id;
  END IF;

  -- ========================================================================
  -- STEP 10: CREATE LEDGER ENTRY + LINES (ATOMIC)
  -- ========================================================================
  -- Use period start date as the entry date for opening balances
  INSERT INTO journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    source_type,
    source_id,
    source_import_id,
    input_hash,
    accounting_firm_id,
    period_id,
    created_by,
    posted_by
  ) VALUES (
    import_record.client_business_id,
    period_record.period_start,
    'Opening Balance (as of ' || TO_CHAR(period_record.period_start, 'YYYY-MM-DD') || ')',
    'opening_balance',
    import_record.id,
    'opening_balance',
    import_record.id,
    import_record.id,
    input_hash_val,
    import_record.accounting_firm_id,
    import_record.period_id,
    import_record.created_by,
    p_posted_by
  )
  RETURNING id INTO journal_entry_id;

  -- Create journal entry lines
  FOR line_record IN SELECT * FROM jsonb_array_elements(import_record.lines)
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
  -- STEP 11: UPDATE IMPORT (LINK TO LEDGER ENTRY)
  -- ========================================================================
  UPDATE opening_balance_imports
  SET 
    journal_entry_id = journal_entry_id,
    posted_at = NOW(),
    posted_by = p_posted_by,
    status = 'posted',
    input_hash = input_hash_val
  WHERE id = p_import_id;

  RETURN journal_entry_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 3: COMMENTS
-- ============================================================================

COMMENT ON FUNCTION post_opening_balance_import_to_ledger(UUID, UUID) IS 
'Idempotent function to post opening balance import to ledger. Returns existing entry if already posted. Ensures exactly one ledger entry per import. Opening balances must be posted to the first open period and must be the first entry in that period.';

COMMENT ON COLUMN journal_entries.source_import_id IS 
'For opening_balance source_type: ID of the opening_balance_imports record. Unique constraint ensures one import → one ledger entry.';

COMMENT ON COLUMN journal_entries.source_type IS 
'Source of journal entry: proposal, adjustment, manual_draft, or opening_balance. Opening balances are posted once per business.';
