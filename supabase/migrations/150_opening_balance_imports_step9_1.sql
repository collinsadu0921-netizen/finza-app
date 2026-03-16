-- ============================================================================
-- MIGRATION: Step 9.1 - Opening Balance Imports (Draft-First Model)
-- ============================================================================
-- This migration creates the opening balance import system for external
-- (non-Finza-operational) clients. Opening balances are the entry point
-- for Accountant-First mode.
--
-- Scope: Accounting Workspace ONLY
-- Mode: External / Accountant-First
-- ============================================================================

-- ============================================================================
-- STEP 1: CREATE opening_balance_imports TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS opening_balance_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_firm_id UUID NOT NULL REFERENCES accounting_firms(id) ON DELETE CASCADE,
  client_business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES accounting_periods(id) ON DELETE RESTRICT,
  
  -- Status lifecycle: draft → approved → posted
  -- Approved imports can be posted to ledger (separate Partner action)
  status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'posted')) DEFAULT 'draft',
  
  -- Source tracking
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'csv', 'excel')) DEFAULT 'manual',
  
  -- Lines stored as JSONB array: [{account_id, debit, credit, memo}]
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Totals (computed and validated)
  total_debit NUMERIC NOT NULL DEFAULT 0,
  total_credit NUMERIC NOT NULL DEFAULT 0,
  
  -- User tracking
  created_by UUID NOT NULL REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  posted_by UUID REFERENCES auth.users(id),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  approved_at TIMESTAMP WITH TIME ZONE,
  posted_at TIMESTAMP WITH TIME ZONE,
  
  -- Ledger reference (set when posted)
  journal_entry_id UUID REFERENCES journal_entries(id),
  
  -- Deterministic transformation hash (computed at approval time)
  input_hash TEXT,
  
  -- Constraints
  CONSTRAINT opening_balance_balance_check CHECK (
    -- Debits must equal credits (with tolerance for floating point)
    ABS(total_debit - total_credit) < 0.01
  ),
  CONSTRAINT opening_balance_lines_not_empty CHECK (
    jsonb_array_length(lines) > 0
  ),
  CONSTRAINT opening_balance_one_per_business UNIQUE (client_business_id),
  CONSTRAINT opening_balance_cannot_repost CHECK (
    -- Cannot post if already posted
    (status != 'posted') OR (journal_entry_id IS NOT NULL)
  )
);

-- ============================================================================
-- STEP 2: INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_opening_balance_imports_firm_id 
  ON opening_balance_imports(accounting_firm_id);
CREATE INDEX IF NOT EXISTS idx_opening_balance_imports_business_id 
  ON opening_balance_imports(client_business_id);
CREATE INDEX IF NOT EXISTS idx_opening_balance_imports_period_id 
  ON opening_balance_imports(period_id);
CREATE INDEX IF NOT EXISTS idx_opening_balance_imports_status 
  ON opening_balance_imports(status);
CREATE INDEX IF NOT EXISTS idx_opening_balance_imports_created_by 
  ON opening_balance_imports(created_by);
CREATE INDEX IF NOT EXISTS idx_opening_balance_imports_journal_entry_id 
  ON opening_balance_imports(journal_entry_id) WHERE journal_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opening_balance_imports_input_hash 
  ON opening_balance_imports(input_hash) WHERE input_hash IS NOT NULL;

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_opening_balance_imports_firm_business_status 
  ON opening_balance_imports(accounting_firm_id, client_business_id, status);

-- ============================================================================
-- STEP 3: FUNCTIONS
-- ============================================================================

-- Function to validate opening balance lines structure and balance
CREATE OR REPLACE FUNCTION validate_opening_balance_lines(p_lines JSONB)
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
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 'Opening balance must have at least one line'::TEXT;
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
      format('Opening balance is not balanced. Debits: %s, Credits: %s', debit_sum, credit_sum)::TEXT;
    RETURN;
  END IF;

  -- Valid
  RETURN QUERY SELECT TRUE, debit_sum, credit_sum, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Function to update opening balance totals (trigger helper)
CREATE OR REPLACE FUNCTION update_opening_balance_totals()
RETURNS TRIGGER AS $$
DECLARE
  validation_result RECORD;
BEGIN
  -- Validate lines and compute totals
  SELECT * INTO validation_result
  FROM validate_opening_balance_lines(NEW.lines);

  IF NOT validation_result.is_valid THEN
    RAISE EXCEPTION 'Invalid opening balance lines: %', validation_result.error_message;
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
CREATE TRIGGER trigger_update_opening_balance_totals
  BEFORE INSERT OR UPDATE OF lines ON opening_balance_imports
  FOR EACH ROW
  EXECUTE FUNCTION update_opening_balance_totals();

-- ============================================================================
-- STEP 5: ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE opening_balance_imports ENABLE ROW LEVEL SECURITY;

-- Policy: Firm users can view opening balance imports for their firm's clients
CREATE POLICY "Firm users can view opening balance imports for their firm's clients"
  ON opening_balance_imports FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = opening_balance_imports.accounting_firm_id
        AND accounting_firm_users.user_id = auth.uid()
    )
  );

-- Policy: Firm users can create opening balance imports (with write access)
CREATE POLICY "Firm users with write access can create opening balance imports"
  ON opening_balance_imports FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = opening_balance_imports.accounting_firm_id
        AND accounting_firm_users.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM firm_client_engagements
      WHERE firm_client_engagements.accounting_firm_id = opening_balance_imports.accounting_firm_id
        AND firm_client_engagements.client_business_id = opening_balance_imports.client_business_id
        AND firm_client_engagements.status = 'active'
        AND firm_client_engagements.access_level IN ('write', 'approve')
        AND firm_client_engagements.effective_from <= CURRENT_DATE
        AND (firm_client_engagements.effective_to IS NULL OR firm_client_engagements.effective_to >= CURRENT_DATE)
    )
  );

-- Policy: Draft creators can update their own drafts (if status is draft)
CREATE POLICY "Draft creators can update their own opening balance imports"
  ON opening_balance_imports FOR UPDATE
  USING (
    created_by = auth.uid()
    AND status = 'draft'
  )
  WITH CHECK (
    created_by = auth.uid()
    AND status = 'draft'
  );

-- Policy: Partner can approve opening balance imports
CREATE POLICY "Partner can approve opening balance imports"
  ON opening_balance_imports FOR UPDATE
  USING (
    status = 'draft'
    AND EXISTS (
      SELECT 1 FROM accounting_firm_users
      WHERE accounting_firm_users.firm_id = opening_balance_imports.accounting_firm_id
        AND accounting_firm_users.user_id = auth.uid()
        AND accounting_firm_users.role = 'partner'
    )
    AND EXISTS (
      SELECT 1 FROM firm_client_engagements
      WHERE firm_client_engagements.accounting_firm_id = opening_balance_imports.accounting_firm_id
        AND firm_client_engagements.client_business_id = opening_balance_imports.client_business_id
        AND firm_client_engagements.status = 'active'
        AND firm_client_engagements.access_level = 'approve'
        AND firm_client_engagements.effective_from <= CURRENT_DATE
        AND (firm_client_engagements.effective_to IS NULL OR firm_client_engagements.effective_to >= CURRENT_DATE)
    )
  )
  WITH CHECK (
    status = 'approved'
  );

-- ============================================================================
-- STEP 6: COMMENTS
-- ============================================================================

COMMENT ON TABLE opening_balance_imports IS 
'Opening balance imports for external (non-Finza-operational) clients. Entry point for Accountant-First mode. One per business.';

COMMENT ON COLUMN opening_balance_imports.status IS 
'Lifecycle: draft → approved → posted. Approved imports can be posted to ledger (separate Partner action).';

COMMENT ON COLUMN opening_balance_imports.source_type IS 
'Source of opening balance data: manual (entered via UI), csv (imported from CSV), excel (imported from Excel).';

COMMENT ON COLUMN opening_balance_imports.lines IS 
'JSONB array of opening balance lines: [{account_id: UUID, debit: NUMERIC, credit: NUMERIC, memo: TEXT}]. Must balance.';

COMMENT ON COLUMN opening_balance_imports.journal_entry_id IS 
'Reference to journal_entries.id after import is posted to ledger. NULL until posted.';

COMMENT ON COLUMN opening_balance_imports.input_hash IS 
'Deterministic hash of canonical opening balance payload. Computed at approval time. Used for idempotency.';

COMMENT ON COLUMN opening_balance_imports.client_business_id IS 
'Unique constraint ensures one opening balance per business. Opening balances are posted once per business.';

COMMENT ON FUNCTION validate_opening_balance_lines(JSONB) IS 
'Validates opening balance lines structure and balance. Returns validation result with totals and error message.';

COMMENT ON FUNCTION update_opening_balance_totals() IS 
'Trigger function that validates and updates opening balance totals when lines change.';
