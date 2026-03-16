-- ============================================================================
-- MIGRATION: Accounting Mode - Adjustment Journals v1
-- ============================================================================
-- This migration introduces adjustment journals so accountants can correct,
-- reclassify, or true-up balances WITHOUT mutating original ledger entries.
--
-- Scope: Accounting Mode ONLY
-- No UI changes, no report changes, no tax changes, no settlement changes
-- ============================================================================

-- ============================================================================
-- STEP 1: ADJUSTMENT JOURNAL TYPE
-- ============================================================================
-- Adjustment journals use reference_type = 'adjustment' in journal_entries
-- No schema change to existing journals required - using existing reference_type field
-- ============================================================================

-- ============================================================================
-- STEP 2: ADJUSTMENT METADATA TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS accounting_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  adjustment_date DATE NOT NULL,
  period_start DATE NOT NULL,
  reason TEXT NOT NULL,
  reference_journal_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_accounting_adjustments_business_id ON accounting_adjustments(business_id);
CREATE INDEX IF NOT EXISTS idx_accounting_adjustments_adjustment_date ON accounting_adjustments(adjustment_date);
CREATE INDEX IF NOT EXISTS idx_accounting_adjustments_period_start ON accounting_adjustments(period_start);
CREATE INDEX IF NOT EXISTS idx_accounting_adjustments_reference_journal_id ON accounting_adjustments(reference_journal_id) WHERE reference_journal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_accounting_adjustments_created_by ON accounting_adjustments(created_by);

-- Comments
COMMENT ON TABLE accounting_adjustments IS 'Metadata table for accounting adjustments. Descriptive only - ledger impact comes from journal entries with reference_type = adjustment';
COMMENT ON COLUMN accounting_adjustments.reference_journal_id IS 'Optional: Reference to a specific journal_entry being corrected. NULL if adjusting a whole period or aggregate error';

-- ============================================================================
-- STEP 3: ADJUSTMENT POSTING FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION post_adjustment_to_ledger(
  p_business_id UUID,
  p_adjustment_date DATE,
  p_lines JSONB,
  p_reason TEXT,
  p_reference_journal_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  journal_id UUID;
  adjustment_id UUID;
  line JSONB;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  account_id UUID;
  account_code TEXT;
  period_start_date DATE;
BEGIN
  -- Validate reason is not empty
  IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
    RAISE EXCEPTION 'Adjustment reason is mandatory and cannot be empty';
  END IF;

  -- Validate period using assert_accounting_period_is_open
  -- Adjustments CANNOT be posted into locked periods
  PERFORM assert_accounting_period_is_open(p_business_id, p_adjustment_date);

  -- Resolve period_start from adjustment_date
  period_start_date := DATE_TRUNC('month', p_adjustment_date)::DATE;

  -- Validate that adjustments MUST balance (total debit = total credit)
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    total_debit := total_debit + COALESCE((line->>'debit_amount')::NUMERIC, 0);
    total_credit := total_credit + COALESCE((line->>'credit_amount')::NUMERIC, 0);
  END LOOP;

  IF ABS(total_debit - total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Adjustment journal entry must balance. Debit: %, Credit: %', total_debit, total_credit;
  END IF;

  -- Create journal entry with reference_type = 'adjustment'
  INSERT INTO journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    created_by
  )
  VALUES (
    p_business_id,
    p_adjustment_date,
    'Adjustment: ' || p_reason,
    'adjustment',
    NULL, -- reference_id is NULL for adjustments (metadata stored in accounting_adjustments)
    auth.uid() -- Use current user from auth context
  )
  RETURNING id INTO journal_id;

  -- Create journal entry lines
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    account_code := line->>'account_code';
    
    IF account_code IS NULL THEN
      RAISE EXCEPTION 'Account code is required for each adjustment line';
    END IF;

    -- Get account ID by code
    account_id := get_account_by_code(p_business_id, account_code);

    IF account_id IS NULL THEN
      RAISE EXCEPTION 'Account with code % not found for business: %', account_code, p_business_id;
    END IF;

    INSERT INTO journal_entry_lines (
      journal_entry_id,
      account_id,
      debit,
      credit,
      description
    )
    VALUES (
      journal_id,
      account_id,
      COALESCE((line->>'debit_amount')::NUMERIC, 0),
      COALESCE((line->>'credit_amount')::NUMERIC, 0),
      line->>'description'
    );
  END LOOP;

  -- Store metadata row in accounting_adjustments
  INSERT INTO accounting_adjustments (
    business_id,
    adjustment_date,
    period_start,
    reason,
    reference_journal_id,
    created_by
  )
  VALUES (
    p_business_id,
    p_adjustment_date,
    period_start_date,
    p_reason,
    p_reference_journal_id,
    auth.uid()
  )
  RETURNING id INTO adjustment_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- VERIFICATION: Functions created successfully
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Accounting Mode A2: Adjustment journals functions created';
  RAISE NOTICE '  - accounting_adjustments table: Metadata storage for adjustments';
  RAISE NOTICE '  - post_adjustment_to_ledger: Creates adjustment journal entries';
  RAISE NOTICE '  - Adjustments use reference_type = adjustment in journal_entries';
  RAISE NOTICE '  - Period validation: Adjustments blocked in locked periods';
  RAISE NOTICE '  - Balancing: Adjustments must balance (debit = credit)';
  RAISE NOTICE '  - Immutability: Original journals remain untouched';
END;
$$;

