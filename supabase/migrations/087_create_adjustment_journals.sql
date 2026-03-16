-- Migration: Adjustment Journals (Post-Close Corrections)
-- Defines how mistakes are corrected without reopening periods
-- Core Principle: Closed or locked periods are never edited. Ever.
-- All corrections are made via adjustment journals in a later open period.
--
-- ============================================================================
-- POSTING RULES FOR ADJUSTMENTS
-- ============================================================================
-- 4.1 Nature:
--   - Adjustments are normal double-entry postings (standard journal entries)
--   - They do not modify original entries (originals remain unchanged)
--   - They must reference what they correct (via original_period_id and 
--     optional original_journal_entry_id)
--
-- 4.2 Direction:
--   To correct an error:
--   1. Reverse the wrong effect
--   2. Post the correct effect
--
--   Example: Revenue overstated by 100
--     Adjustment entry:
--       Debit Revenue 100
--       Credit Retained Earnings or Correct Account 100
--     (depending on nature of correction)
--
-- ============================================================================
-- TAX ADJUSTMENTS
-- ============================================================================
-- Tax corrections follow special rules:
--   - Must carry corrected tax_lines (in journal entry description/metadata)
--   - Post difference only (delta) - not full recalculation
--   - Must reference original tax line codes (e.g., "NHIL", "VAT", "GETFund")
--   - No recalculation of historical tax (only post the difference)
--
-- Note: Tax adjustments use the same adjustment_journals structure. The
--       journal_entry_lines should reflect the tax correction deltas, and
--       the reason field should reference the original tax line codes.
--
-- ============================================================================
-- PERIOD & LOCK RULES
-- ============================================================================
--   - Adjustment period must be open (enforced by validation)
--   - Adjustments cannot be posted into closed or locked periods (enforced)
--   - Locking a period does not prevent adjustments to prior periods
--     (only direct edits are prevented; adjustments can still be created
--      for locked periods in later open periods)
--
-- ============================================================================
-- REPORTING IMPACT (Section 7)
-- ============================================================================
-- Reports must:
--   - Show original period results as locked ("As Reported")
--   - Show cumulative impact including adjustments ("As Adjusted")
--   - Clearly label both versions
--
-- This is essential for bokslut (year-end closing) and audits.
--
-- Implementation Note:
--   - "As Reported": Query journal_entries where date falls within period
--                    (excludes adjustments made in later periods)
--   - "As Adjusted": Include adjustments where original_period_id = period
--                    (shows cumulative effect including corrections)
--   - Reports should provide both views side-by-side or as toggle options
--
-- ============================================================================
-- AUDIT TRAIL (Section 8 - Mandatory)
-- ============================================================================
-- Each adjustment must expose (all fields are mandatory and enforced):
--   - WHO: created_by_accountant_id (the accountant who created the adjustment)
--   - WHEN: created_at (timestamp of creation)
--   - WHY: reason (mandatory text explaining the correction)
--   - WHAT IT AFFECTED: 
--       * original_period_id (the period being corrected)
--       * original_journal_entry_id (specific entry, if applicable)
--   - ORIGINAL REFERENCE: original_period_id, original_journal_entry_id
--
-- No silent fixes - all adjustments are fully auditable.
--
-- ============================================================================
-- HARD CONSTRAINTS (Section 9)
-- ============================================================================
-- System prevents (all enforced):
--   1. Editing original ledger rows
--      * Enforced: Cannot post journal entries to closed/locked periods
--      * Enforced: Period status transitions are forward-only (no reopening)
--
--   2. Deleting adjustment journals
--      * Enforced: No DELETE policy (default deny in RLS)
--      * Enforced: Adjustment journals are immutable audit records
--
--   3. Posting adjustments without reason
--      * Enforced: reason column is NOT NULL
--      * Enforced: Validation function rejects empty/whitespace-only reasons
--
--   4. Posting adjustments without accountant role
--      * Enforced: created_by_accountant_id is required (NOT NULL)
--      * Enforced: Validation function checks is_user_accountant()
--      * Enforced: RLS policy requires accountant role for INSERT

-- ============================================================================
-- ADJUSTMENT_JOURNALS TABLE
-- Each adjustment journal links a journal entry (the correction) to:
-- - The original period being corrected
-- - Optionally, the specific original journal entry being corrected
-- - The open period where the adjustment is posted
-- - A mandatory reason for audit trail
-- ============================================================================
CREATE TABLE IF NOT EXISTS adjustment_journals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  original_period_id UUID NOT NULL REFERENCES accounting_periods(id) ON DELETE RESTRICT,
  original_journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
  adjustment_period_id UUID NOT NULL REFERENCES accounting_periods(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  created_by_accountant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(journal_entry_id)
);

-- Indexes for adjustment_journals
CREATE INDEX IF NOT EXISTS idx_adjustment_journals_journal_entry_id ON adjustment_journals(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_adjustment_journals_original_period_id ON adjustment_journals(original_period_id);
CREATE INDEX IF NOT EXISTS idx_adjustment_journals_original_journal_entry_id ON adjustment_journals(original_journal_entry_id) WHERE original_journal_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_adjustment_journals_adjustment_period_id ON adjustment_journals(adjustment_period_id);
CREATE INDEX IF NOT EXISTS idx_adjustment_journals_created_by ON adjustment_journals(created_by_accountant_id);
CREATE INDEX IF NOT EXISTS idx_adjustment_journals_created_at ON adjustment_journals(created_at);

-- ============================================================================
-- FUNCTION: Validate adjustment journal creation
-- Ensures all business rules are met
-- ============================================================================
CREATE OR REPLACE FUNCTION validate_adjustment_journal(
  p_journal_entry_id UUID,
  p_original_period_id UUID,
  p_adjustment_period_id UUID,
  p_created_by_accountant_id UUID,
  p_reason TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  journal_entry_record RECORD;
  original_period_record RECORD;
  adjustment_period_record RECORD;
  business_id_val UUID;
  is_accountant BOOLEAN;
BEGIN
  -- Validate reason is not empty
  IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
    RAISE EXCEPTION 'Adjustment journal reason is mandatory and cannot be empty';
  END IF;

  -- Get journal entry and verify it exists
  SELECT * INTO journal_entry_record
  FROM journal_entries
  WHERE id = p_journal_entry_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry not found: %', p_journal_entry_id;
  END IF;
  
  business_id_val := journal_entry_record.business_id;

  -- Get original period and verify it is closed or locked
  SELECT * INTO original_period_record
  FROM accounting_periods
  WHERE id = p_original_period_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original period not found: %', p_original_period_id;
  END IF;
  
  IF original_period_record.status NOT IN ('closed', 'locked') THEN
    RAISE EXCEPTION 'Cannot create adjustment for period with status %. Original period must be closed or locked.', original_period_record.status;
  END IF;
  
  -- Verify original period belongs to same business
  IF original_period_record.business_id != business_id_val THEN
    RAISE EXCEPTION 'Original period does not belong to the same business as the journal entry';
  END IF;

  -- Get adjustment period and verify it is open
  SELECT * INTO adjustment_period_record
  FROM accounting_periods
  WHERE id = p_adjustment_period_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Adjustment period not found: %', p_adjustment_period_id;
  END IF;
  
  IF adjustment_period_record.status != 'open' THEN
    RAISE EXCEPTION 'Adjustment period must be open. Current status: %', adjustment_period_record.status;
  END IF;
  
  -- Verify adjustment period belongs to same business
  IF adjustment_period_record.business_id != business_id_val THEN
    RAISE EXCEPTION 'Adjustment period does not belong to the same business as the journal entry';
  END IF;

  -- Verify user is accountant
  is_accountant := is_user_accountant(p_created_by_accountant_id, business_id_val);
  
  IF NOT is_accountant THEN
    RAISE EXCEPTION 'Only accountants can create adjustment journals. User does not have accountant role for this business.';
  END IF;

  -- Verify journal entry date falls within adjustment period
  IF journal_entry_record.date < adjustment_period_record.start_date OR 
     journal_entry_record.date > adjustment_period_record.end_date THEN
    RAISE EXCEPTION 'Journal entry date (%) must fall within adjustment period date range (% to %)', 
      journal_entry_record.date, adjustment_period_record.start_date, adjustment_period_record.end_date;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Create adjustment journal (with validation)
-- This function validates and creates an adjustment journal record
-- ============================================================================
CREATE OR REPLACE FUNCTION create_adjustment_journal(
  p_journal_entry_id UUID,
  p_original_period_id UUID,
  p_adjustment_period_id UUID,
  p_reason TEXT,
  p_created_by_accountant_id UUID,
  p_original_journal_entry_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  adjustment_id UUID;
BEGIN
  -- Validate all business rules
  PERFORM validate_adjustment_journal(
    p_journal_entry_id,
    p_original_period_id,
    p_adjustment_period_id,
    p_created_by_accountant_id,
    p_reason
  );

  -- If original_journal_entry_id is provided, verify it exists and belongs to original period
  IF p_original_journal_entry_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM journal_entries je
      JOIN accounting_periods ap ON ap.id = p_original_period_id
      WHERE je.id = p_original_journal_entry_id
        AND je.date >= ap.start_date 
        AND je.date <= ap.end_date
        AND je.business_id = ap.business_id
    ) THEN
      RAISE EXCEPTION 'Original journal entry % does not exist or does not belong to the specified original period', p_original_journal_entry_id;
    END IF;
  END IF;

  -- Create adjustment journal record
  INSERT INTO adjustment_journals (
    journal_entry_id,
    original_period_id,
    original_journal_entry_id,
    adjustment_period_id,
    reason,
    created_by_accountant_id
  )
  VALUES (
    p_journal_entry_id,
    p_original_period_id,
    p_original_journal_entry_id,
    p_adjustment_period_id,
    p_reason,
    p_created_by_accountant_id
  )
  RETURNING id INTO adjustment_id;

  RETURN adjustment_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGER: Validate adjustment journal on insert/update
-- ============================================================================
CREATE OR REPLACE FUNCTION trigger_validate_adjustment_journal()
RETURNS TRIGGER AS $$
BEGIN
  -- Validate on insert
  IF TG_OP = 'INSERT' THEN
    PERFORM validate_adjustment_journal(
      NEW.journal_entry_id,
      NEW.original_period_id,
      NEW.adjustment_period_id,
      NEW.created_by_accountant_id,
      NEW.reason
    );
    
    -- If original_journal_entry_id is provided, verify it exists and belongs to original period
    IF NEW.original_journal_entry_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM journal_entries je
        JOIN accounting_periods ap ON ap.id = NEW.original_period_id
        WHERE je.id = NEW.original_journal_entry_id
          AND je.date >= ap.start_date 
          AND je.date <= ap.end_date
          AND je.business_id = ap.business_id
      ) THEN
        RAISE EXCEPTION 'Original journal entry does not exist or does not belong to the specified original period';
      END IF;
    END IF;
  END IF;

  -- Hard constraint (Section 9): Prevent updates to adjustment journals
  -- Adjustment journals are immutable audit records - no edits allowed
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Adjustment journals cannot be updated. They are immutable audit records.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_validate_adjustment_journal ON adjustment_journals;
CREATE TRIGGER trigger_validate_adjustment_journal
  BEFORE INSERT OR UPDATE ON adjustment_journals
  FOR EACH ROW
  EXECUTE FUNCTION trigger_validate_adjustment_journal();

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on adjustment_journals
ALTER TABLE adjustment_journals ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Accountants can view adjustment journals for their business" ON adjustment_journals;
DROP POLICY IF EXISTS "Accountants can create adjustment journals for their business" ON adjustment_journals;
DROP POLICY IF EXISTS "Accountants cannot delete adjustment journals" ON adjustment_journals;

-- View policy: Accountants (and business owners) can view adjustment journals for their business
CREATE POLICY "Accountants can view adjustment journals for their business"
  ON adjustment_journals FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM journal_entries je
      JOIN businesses b ON b.id = je.business_id
      WHERE je.id = adjustment_journals.journal_entry_id
        AND (
          b.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM business_users bu
            WHERE bu.business_id = b.id
              AND bu.user_id = auth.uid()
              AND bu.role = 'accountant'
          )
        )
    )
  );

-- Insert policy: Only accountants can create adjustment journals
CREATE POLICY "Accountants can create adjustment journals for their business"
  ON adjustment_journals FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM journal_entries je
      JOIN businesses b ON b.id = je.business_id
      WHERE je.id = adjustment_journals.journal_entry_id
        AND (
          b.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM business_users bu
            WHERE bu.business_id = b.id
              AND bu.user_id = auth.uid()
              AND bu.role = 'accountant'
          )
        )
        AND adjustment_journals.created_by_accountant_id = auth.uid()
    )
  );

-- Delete policy: No one can delete adjustment journals (immutable audit records)
-- Hard constraint (Section 9): Deleting adjustment journals is prevented.
-- No DELETE policy means no one can delete (default deny in RLS).
-- This ensures audit trail integrity - adjustments are permanent records.

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE adjustment_journals IS 
'Adjustment journals for post-close corrections. Closed or locked periods are never edited. All corrections are made via adjustment journals in later open periods. Adjustments are normal double-entry postings that reverse wrong effects and post correct effects. They do not modify original entries. For tax adjustments, only deltas are posted (difference only), and original tax line codes must be referenced. Reports must show both "As Reported" (original locked results) and "As Adjusted" (including adjustments) views. All adjustments are fully auditable with mandatory who/when/why/what/original reference fields. Hard constraints prevent editing originals, deleting adjustments, posting without reason, and posting without accountant role.';

COMMENT ON COLUMN adjustment_journals.id IS 'Primary key of the adjustment journal record';
COMMENT ON COLUMN adjustment_journals.journal_entry_id IS 'Reference to the journal entry that represents the adjustment (the correction). This is a normal double-entry journal entry with debit/credit lines. It reverses the wrong effect and posts the correct effect. Used in "As Adjusted" reporting.';
COMMENT ON COLUMN adjustment_journals.original_period_id IS 'The closed or locked period being corrected. Must be in closed or locked status. The original entries in this period remain unchanged; this adjustment corrects the error in a later period. Required for audit trail (WHAT IT AFFECTED) and reporting ("As Adjusted" view).';
COMMENT ON COLUMN adjustment_journals.original_journal_entry_id IS 'Optional: The specific journal entry being corrected. NULL for bulk adjustments or when correcting aggregate errors. Used to explicitly reference what is being corrected. Part of audit trail (ORIGINAL REFERENCE).';
COMMENT ON COLUMN adjustment_journals.adjustment_period_id IS 'The open period where the adjustment is posted. Must be in open status. Adjustments cannot be posted into closed or locked periods. Locking a period prevents direct edits but does not prevent adjustments to prior periods in later open periods.';
COMMENT ON COLUMN adjustment_journals.reason IS 'Mandatory reason for the adjustment. Visible in audit trail (WHY). Cannot be empty or whitespace-only. Should describe what error is being corrected. For tax adjustments, should reference the original tax line codes (e.g., "NHIL", "VAT"). Hard constraint: Required for all adjustments.';
COMMENT ON COLUMN adjustment_journals.created_by_accountant_id IS 'The accountant who created this adjustment (WHO in audit trail). Only accountants can create adjustments. Hard constraint: Required and validated via is_user_accountant() function.';
COMMENT ON COLUMN adjustment_journals.created_at IS 'Timestamp when the adjustment was created (WHEN in audit trail). Automatically set on insert. Part of mandatory audit trail.';

