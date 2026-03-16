-- ============================================================================
-- MIGRATION: Accounting Mode - Opening Balances v1
-- ============================================================================
-- This migration adds a safe mechanism to import/record opening balances:
-- - One-time entry per business (or per onboarding event)
-- - Posts a balanced journal
-- - Clearly labeled as "opening_balance"
-- - Can be locked immediately after posting
--
-- Scope: Accounting Mode ONLY
-- No UI changes, no report changes, no tax changes, no settlement changes
-- ============================================================================

-- ============================================================================
-- STEP 1: OPENING BALANCE METADATA TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS accounting_opening_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  as_of_date DATE NOT NULL,
  period_start DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (business_id) -- v1: only one opening balance event per business
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_accounting_opening_balances_business_id ON accounting_opening_balances(business_id);
CREATE INDEX IF NOT EXISTS idx_accounting_opening_balances_as_of_date ON accounting_opening_balances(as_of_date);
CREATE INDEX IF NOT EXISTS idx_accounting_opening_balances_period_start ON accounting_opening_balances(period_start);

-- Constraint: as_of_date must be <= period_end of resolved period
-- This will be enforced in the function logic

-- Comments
COMMENT ON TABLE accounting_opening_balances IS 'Metadata for opening balance entries. One-time cut-over event per business. Opening balances are NOT revenue/expense recognition.';
COMMENT ON COLUMN accounting_opening_balances.source IS 'Source of opening balance data: manual, excel, migration (future)';
COMMENT ON COLUMN accounting_opening_balances.as_of_date IS 'Date as of which opening balances are recorded';
COMMENT ON COLUMN accounting_opening_balances.period_start IS 'First day of the month containing as_of_date';

-- ============================================================================
-- STEP 2: POSTING FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION post_opening_balance_to_ledger(
  p_business_id UUID,
  p_as_of_date DATE,
  p_lines JSONB,
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  journal_id UUID;
  opening_balance_id UUID;
  line JSONB;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  account_id UUID;
  account_code TEXT;
  period_start_date DATE;
  period_end_date DATE;
  period_record accounting_periods;
  existing_opening_balance UUID;
BEGIN
  -- Rule 1: Enforce period policy
  -- Must pass assert_accounting_period_is_open - NOT allowed in locked period
  PERFORM assert_accounting_period_is_open(p_business_id, p_as_of_date);

  -- Resolve period_start from p_as_of_date
  period_start_date := DATE_TRUNC('month', p_as_of_date)::DATE;
  period_end_date := (DATE_TRUNC('month', p_as_of_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  -- Validate as_of_date <= period_end
  IF p_as_of_date > period_end_date THEN
    RAISE EXCEPTION 'as_of_date (%) must be <= period_end (%)', p_as_of_date, period_end_date;
  END IF;

  -- Rule 2: One-time rule
  -- If accounting_opening_balances already exists for business → RAISE EXCEPTION
  SELECT id INTO existing_opening_balance
  FROM accounting_opening_balances
  WHERE business_id = p_business_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Opening balance already exists for this business.';
  END IF;

  -- Rule 3: Balancing rule
  -- Sum(debits) must equal Sum(credits)
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    total_debit := total_debit + COALESCE((line->>'debit_amount')::NUMERIC, 0);
    total_credit := total_credit + COALESCE((line->>'credit_amount')::NUMERIC, 0);
  END LOOP;

  IF ABS(total_debit - total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Opening balance journal must balance.';
  END IF;

  -- Rule 4: Journal creation
  -- Insert a NEW journal entry with reference_type = 'opening_balance'
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
    p_as_of_date,
    'Opening Balance (as of ' || TO_CHAR(p_as_of_date, 'YYYY-MM-DD') || ')',
    'opening_balance',
    NULL,
    p_created_by
  )
  RETURNING id INTO journal_id;

  -- Insert journal lines per p_lines
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    account_code := line->>'account_code';
    
    IF account_code IS NULL THEN
      RAISE EXCEPTION 'Account code is required for each opening balance line';
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
      COALESCE(line->>'description', 'Opening balance')
    );
  END LOOP;

  -- Rule 5: Metadata row
  -- Insert into accounting_opening_balances
  INSERT INTO accounting_opening_balances (
    business_id,
    as_of_date,
    period_start,
    source,
    notes,
    created_by
  )
  VALUES (
    p_business_id,
    p_as_of_date,
    period_start_date,
    'manual',
    p_notes,
    p_created_by
  )
  RETURNING id INTO opening_balance_id;

  -- STEP 3: Optional immediate soft-close
  -- After posting opening balance, immediately soft-close the period
  -- Get the period record
  SELECT * INTO period_record
  FROM accounting_periods
  WHERE business_id = p_business_id
    AND period_start = period_start_date
  LIMIT 1;

  -- If period exists and is open, soft-close it
  IF FOUND AND period_record.status = 'open' THEN
    UPDATE accounting_periods
    SET 
      status = 'soft_closed',
      closed_at = NOW(),
      closed_by = p_created_by
    WHERE id = period_record.id;
  END IF;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- VERIFICATION: Functions created successfully
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Accounting Mode A3: Opening balances functions created';
  RAISE NOTICE '  - accounting_opening_balances table: One-time opening balance metadata';
  RAISE NOTICE '  - post_opening_balance_to_ledger: Creates opening balance journal entries';
  RAISE NOTICE '  - One-time rule: Only one opening balance per business';
  RAISE NOTICE '  - Period validation: Blocked in locked periods';
  RAISE NOTICE '  - Balancing: Opening balance must balance (debit = credit)';
  RAISE NOTICE '  - Auto soft-close: Period soft-closed after posting';
  RAISE NOTICE '  - Immutability: Original ledger untouched';
END;
$$;

