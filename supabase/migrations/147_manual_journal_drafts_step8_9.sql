-- ============================================================================
-- MIGRATION: Step 8.9 - Manual Journal Drafts (Draft-First Model)
-- ============================================================================
-- This migration creates the draft layer for manual journal entries.
-- Drafts are separate from the canonical ledger and require approval before posting.
--
-- Scope: Accounting Workspace ONLY
-- ============================================================================

-- ============================================================================
-- STEP 1: CREATE MANUAL_JOURNAL_DRAFTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS manual_journal_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_firm_id UUID NOT NULL REFERENCES accounting_firms(id) ON DELETE CASCADE,
  client_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES accounting_periods(id) ON DELETE RESTRICT,
  
  -- Status lifecycle: draft → submitted → approved/rejected
  -- Approved drafts can be posted to ledger (separate action)
  status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')) DEFAULT 'draft',
  
  -- Journal entry data
  entry_date DATE NOT NULL,
  description TEXT NOT NULL,
  
  -- Lines stored as JSONB array: [{account_id, debit, credit, memo}]
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Totals (computed and validated)
  total_debit NUMERIC NOT NULL DEFAULT 0,
  total_credit NUMERIC NOT NULL DEFAULT 0,
  
  -- User tracking
  created_by UUID NOT NULL REFERENCES auth.users(id),
  submitted_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  rejected_by UUID REFERENCES auth.users(id),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  submitted_at TIMESTAMP WITH TIME ZONE,
  approved_at TIMESTAMP WITH TIME ZONE,
  rejected_at TIMESTAMP WITH TIME ZONE,
  
  -- Rejection reason (required when rejected)
  rejection_reason TEXT,
  
  -- Ledger reference (set when posted)
  journal_entry_id UUID REFERENCES journal_entries(id),
  posted_at TIMESTAMP WITH TIME ZONE,
  posted_by UUID REFERENCES auth.users(id),
  
  -- Constraints
  CONSTRAINT draft_balance_check CHECK (
    -- Debits must equal credits (with tolerance for floating point)
    ABS(total_debit - total_credit) < 0.01
  ),
  CONSTRAINT draft_lines_not_empty CHECK (
    jsonb_array_length(lines) > 0
  ),
  CONSTRAINT rejection_reason_required CHECK (
    -- If rejected, rejection_reason must be provided
    (status != 'rejected') OR (rejection_reason IS NOT NULL AND LENGTH(TRIM(rejection_reason)) > 0)
  )
);

-- ============================================================================
-- STEP 2: INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_manual_journal_drafts_firm_id 
  ON manual_journal_drafts(accounting_firm_id);
CREATE INDEX IF NOT EXISTS idx_manual_journal_drafts_business_id 
  ON manual_journal_drafts(client_business_id);
CREATE INDEX IF NOT EXISTS idx_manual_journal_drafts_period_id 
  ON manual_journal_drafts(period_id);
CREATE INDEX IF NOT EXISTS idx_manual_journal_drafts_status 
  ON manual_journal_drafts(status);
CREATE INDEX IF NOT EXISTS idx_manual_journal_drafts_created_by 
  ON manual_journal_drafts(created_by);
CREATE INDEX IF NOT EXISTS idx_manual_journal_drafts_entry_date 
  ON manual_journal_drafts(entry_date);
CREATE INDEX IF NOT EXISTS idx_manual_journal_drafts_journal_entry_id 
  ON manual_journal_drafts(journal_entry_id) WHERE journal_entry_id IS NOT NULL;

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_manual_journal_drafts_firm_business_status 
  ON manual_journal_drafts(accounting_firm_id, client_business_id, status);

-- ============================================================================
-- STEP 3: FUNCTIONS
-- ============================================================================

-- Function to validate draft lines structure and balance
CREATE OR REPLACE FUNCTION validate_draft_lines(p_lines JSONB)
RETURNS TABLE (
  is_valid BOOLEAN,
  total_debit NUMERIC,
  total_credit NUMERIC,
  error_message TEXT
) AS $$
DECLARE
  line_record JSONB;
  debit_sum NUMERIC := 0;
  credit_sum NUMERIC := 0;
  line_debit NUMERIC;
  line_credit NUMERIC;
BEGIN
  -- Check if lines is an array
  IF jsonb_typeof(p_lines) != 'array' THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 'Lines must be a JSON array'::TEXT;
    RETURN;
  END IF;

  -- Check if array is not empty
  IF jsonb_array_length(p_lines) = 0 THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 'Draft must have at least one line'::TEXT;
    RETURN;
  END IF;

  -- Validate each line and sum totals
  FOR line_record IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    -- Check required fields
    IF NOT (line_record ? 'account_id') THEN
      RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 'Each line must have account_id'::TEXT;
      RETURN;
    END IF;

    -- Get debit and credit (default to 0 if not present)
    line_debit := COALESCE((line_record->>'debit')::NUMERIC, 0);
    line_credit := COALESCE((line_record->>'credit')::NUMERIC, 0);

    -- Validate that at least one is non-zero
    IF line_debit = 0 AND line_credit = 0 THEN
      RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 'Each line must have either debit or credit'::TEXT;
      RETURN;
    END IF;

    -- Validate that not both are non-zero
    IF line_debit != 0 AND line_credit != 0 THEN
      RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 'Each line cannot have both debit and credit'::TEXT;
      RETURN;
    END IF;

    -- Sum totals
    debit_sum := debit_sum + line_debit;
    credit_sum := credit_sum + line_credit;
  END LOOP;

  -- Check balance (with tolerance for floating point)
  IF ABS(debit_sum - credit_sum) >= 0.01 THEN
    RETURN QUERY SELECT FALSE, debit_sum, credit_sum, 
      format('Draft is not balanced. Debits: %s, Credits: %s', debit_sum, credit_sum)::TEXT;
    RETURN;
  END IF;

  -- Valid
  RETURN QUERY SELECT TRUE, debit_sum, credit_sum, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Function to update draft totals (trigger helper)
CREATE OR REPLACE FUNCTION update_draft_totals()
RETURNS TRIGGER AS $$
DECLARE
  validation_result RECORD;
BEGIN
  -- Validate lines and compute totals
  SELECT * INTO validation_result
  FROM validate_draft_lines(NEW.lines);

  IF NOT validation_result.is_valid THEN
    RAISE EXCEPTION 'Invalid draft lines: %', validation_result.error_message;
  END IF;

  -- Update totals
  NEW.total_debit := validation_result.total_debit;
  NEW.total_credit := validation_result.total_credit;
  NEW.updated_at := NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 4: TRIGGERS
-- ============================================================================

-- Trigger to automatically update totals when lines change
CREATE TRIGGER trigger_update_draft_totals
  BEFORE INSERT OR UPDATE OF lines ON manual_journal_drafts
  FOR EACH ROW
  EXECUTE FUNCTION update_draft_totals();

-- ============================================================================
-- STEP 5: ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE manual_journal_drafts ENABLE ROW LEVEL SECURITY;

-- Policy: Firm users can view drafts for their firm's clients
CREATE POLICY "Firm users can view drafts for their firm's clients"
  ON manual_journal_drafts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = manual_journal_drafts.accounting_firm_id
        AND accounting_firm_users.user_id = auth.uid()
    )
  );

-- Policy: Firm users can create drafts (with write access)
CREATE POLICY "Firm users with write access can create drafts"
  ON manual_journal_drafts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = manual_journal_drafts.accounting_firm_id
        AND accounting_firm_users.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM firm_client_engagements
      WHERE firm_client_engagements.accounting_firm_id = manual_journal_drafts.accounting_firm_id
        AND firm_client_engagements.client_business_id = manual_journal_drafts.client_business_id
        AND firm_client_engagements.status = 'active'
        AND firm_client_engagements.access_level IN ('write', 'approve')
        AND firm_client_engagements.effective_from <= CURRENT_DATE
        AND (firm_client_engagements.effective_to IS NULL OR firm_client_engagements.effective_to >= CURRENT_DATE)
    )
  );

-- Policy: Draft creators can update their own drafts (if status is draft)
CREATE POLICY "Draft creators can update their own drafts"
  ON manual_journal_drafts FOR UPDATE
  USING (
    created_by = auth.uid()
    AND status = 'draft'
  )
  WITH CHECK (
    created_by = auth.uid()
    AND status = 'draft'
  );

-- Policy: Firm users with write access can submit drafts
CREATE POLICY "Firm users with write access can submit drafts"
  ON manual_journal_drafts FOR UPDATE
  USING (
    status = 'draft'
    AND EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = manual_journal_drafts.accounting_firm_id
        AND accounting_firm_users.user_id = auth.uid()
        AND accounting_firm_users.role IN ('junior', 'senior', 'partner')
    )
    AND EXISTS (
      SELECT 1 FROM firm_client_engagements
      WHERE firm_client_engagements.accounting_firm_id = manual_journal_drafts.accounting_firm_id
        AND firm_client_engagements.client_business_id = manual_journal_drafts.client_business_id
        AND firm_client_engagements.status = 'active'
        AND firm_client_engagements.access_level IN ('write', 'approve')
        AND firm_client_engagements.effective_from <= CURRENT_DATE
        AND (firm_client_engagements.effective_to IS NULL OR firm_client_engagements.effective_to >= CURRENT_DATE)
    )
  )
  WITH CHECK (
    status IN ('submitted', 'draft') -- Can submit or keep as draft
  );

-- Policy: Senior/Partner can approve/reject submitted drafts
CREATE POLICY "Senior/Partner can approve or reject drafts"
  ON manual_journal_drafts FOR UPDATE
  USING (
    status = 'submitted'
    AND EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = manual_journal_drafts.accounting_firm_id
        AND accounting_firm_users.user_id = auth.uid()
        AND accounting_firm_users.role IN ('senior', 'partner')
    )
    AND EXISTS (
      SELECT 1 FROM firm_client_engagements
      WHERE firm_client_engagements.accounting_firm_id = manual_journal_drafts.accounting_firm_id
        AND firm_client_engagements.client_business_id = manual_journal_drafts.client_business_id
        AND firm_client_engagements.status = 'active'
        AND firm_client_engagements.access_level = 'approve'
        AND firm_client_engagements.effective_from <= CURRENT_DATE
        AND (firm_client_engagements.effective_to IS NULL OR firm_client_engagements.effective_to >= CURRENT_DATE)
    )
  )
  WITH CHECK (
    status IN ('approved', 'rejected', 'submitted') -- Can approve, reject, or keep as submitted
  );

-- ============================================================================
-- STEP 6: COMMENTS
-- ============================================================================

COMMENT ON TABLE manual_journal_drafts IS 
'Draft layer for manual journal entries. Drafts are separate from the canonical ledger and require approval before posting.';

COMMENT ON COLUMN manual_journal_drafts.status IS 
'Lifecycle: draft → submitted → approved/rejected. Approved drafts can be posted to ledger (separate Partner action).';

COMMENT ON COLUMN manual_journal_drafts.lines IS 
'JSONB array of journal lines: [{account_id: UUID, debit: NUMERIC, credit: NUMERIC, memo: TEXT}]. Must balance.';

COMMENT ON COLUMN manual_journal_drafts.journal_entry_id IS 
'Reference to journal_entries.id after draft is posted to ledger. NULL until posted.';

COMMENT ON FUNCTION validate_draft_lines(JSONB) IS 
'Validates draft lines structure and balance. Returns validation result with totals and error message.';

COMMENT ON FUNCTION update_draft_totals() IS 
'Trigger function that validates and updates draft totals when lines change.';
