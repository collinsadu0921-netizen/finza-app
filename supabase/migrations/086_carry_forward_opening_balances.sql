-- Migration: Carry-forward & Opening Balances (Rules Only)
-- Defines how balances move from one period to the next without rewriting history
-- Core Principle: Closing a period does not move money. It only freezes the ledger
-- and defines the next period's opening position. Carry-forward is a derived snapshot,
-- not new "fake transactions" in the closed period.

-- ============================================================================
-- PERIOD_ACCOUNT_SNAPSHOT TABLE (Approach 1: Snapshot Table)
-- Stores deterministic snapshot at close time: period_id, account_id, ending_balance
-- This is a snapshot, not the source of truth. The ledger is the source of truth.
-- Snapshots must match ledger-derived values (integrity checked)
-- ============================================================================
CREATE TABLE IF NOT EXISTS period_account_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES accounting_periods(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ending_balance NUMERIC NOT NULL DEFAULT 0,
  computed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  verified_at TIMESTAMP WITH TIME ZONE, -- When integrity was last verified
  UNIQUE(period_id, account_id)
);

-- Keep old table name for backwards compatibility (if needed)
-- This is the new preferred name
CREATE TABLE IF NOT EXISTS period_closing_balances (
  LIKE period_account_snapshot INCLUDING ALL
);

-- ============================================================================
-- PERIOD_OPENING_BALANCES TABLE
-- Stores the opening balance snapshot for each period
-- This is a derived snapshot from prior period's ending balances
-- ============================================================================
CREATE TABLE IF NOT EXISTS period_opening_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES accounting_periods(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  opening_balance NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(period_id, account_id)
);

-- Indexes for period_account_snapshot
CREATE INDEX IF NOT EXISTS idx_period_account_snapshot_period_id ON period_account_snapshot(period_id);
CREATE INDEX IF NOT EXISTS idx_period_account_snapshot_account_id ON period_account_snapshot(account_id);
CREATE INDEX IF NOT EXISTS idx_period_account_snapshot_business_id ON period_account_snapshot(business_id);

-- Indexes for period_opening_balances
CREATE INDEX IF NOT EXISTS idx_period_opening_balances_period_id ON period_opening_balances(period_id);
CREATE INDEX IF NOT EXISTS idx_period_opening_balances_account_id ON period_opening_balances(account_id);
CREATE INDEX IF NOT EXISTS idx_period_opening_balances_business_id ON period_opening_balances(business_id);

-- ============================================================================
-- PERIOD_SUMMARY TABLE (Approach 1: Snapshot Table)
-- Stores deterministic snapshot at close time: period_id, net_income, retained_earnings_delta
-- This is a snapshot, not the source of truth. The ledger is the source of truth.
-- Snapshots must match ledger-derived values (integrity checked)
-- ============================================================================
CREATE TABLE IF NOT EXISTS period_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES accounting_periods(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  net_income NUMERIC NOT NULL DEFAULT 0, -- Computed: total_revenue - total_expenses
  retained_earnings_delta NUMERIC NOT NULL DEFAULT 0, -- Equals net_income
  computed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  verified_at TIMESTAMP WITH TIME ZONE, -- When integrity was last verified
  UNIQUE(period_id)
);

-- Indexes for period_summary
CREATE INDEX IF NOT EXISTS idx_period_summary_period_id ON period_summary(period_id);
CREATE INDEX IF NOT EXISTS idx_period_summary_business_id ON period_summary(business_id);

-- ============================================================================
-- FUNCTION: Determine if account carries forward (Balance Sheet) or resets (Income Statement)
-- Balance Sheet accounts (asset, liability, equity) carry forward
-- Income Statement accounts (income, expense) reset to 0
-- ============================================================================
CREATE OR REPLACE FUNCTION account_carries_forward(
  p_account_type TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  -- Balance Sheet accounts carry forward
  IF p_account_type IN ('asset', 'liability', 'equity') THEN
    RETURN TRUE;
  END IF;
  
  -- Income Statement accounts reset
  IF p_account_type IN ('income', 'expense') THEN
    RETURN FALSE;
  END IF;
  
  -- Unknown type defaults to no carry-forward
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Calculate closing balance for an account as of period end date
-- Returns the balance that will be carried forward (for Balance Sheet accounts)
-- or reset to 0 (for Income Statement accounts)
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_period_closing_balance(
  p_business_id UUID,
  p_account_id UUID,
  p_period_end_date DATE
)
RETURNS NUMERIC AS $$
DECLARE
  account_type TEXT;
  balance NUMERIC;
BEGIN
  -- Use existing function to calculate balance as of period end
  balance := calculate_account_balance_as_of(
    p_business_id,
    p_account_id,
    p_period_end_date
  );
  
  RETURN COALESCE(balance, 0);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Calculate net income/loss from Income Statement accounts for a period
-- Sum of Income - Sum of Expenses = Net Income (or Net Loss if negative)
-- This becomes the change to Retained Earnings
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_period_net_income(
  p_business_id UUID,
  p_period_start_date DATE,
  p_period_end_date DATE
)
RETURNS NUMERIC AS $$
DECLARE
  total_income NUMERIC := 0;
  total_expenses NUMERIC := 0;
  net_income NUMERIC := 0;
BEGIN
  -- Calculate total income (revenue accounts)
  -- Income: credit - debit (normal balance is credit)
  SELECT COALESCE(SUM(jel.credit - jel.debit), 0)
  INTO total_income
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a ON a.id = jel.account_id
  WHERE je.business_id = p_business_id
    AND a.type = 'income'
    AND a.deleted_at IS NULL
    AND je.date >= p_period_start_date
    AND je.date <= p_period_end_date;

  -- Calculate total expenses (expense accounts)
  -- Expenses: debit - credit (normal balance is debit)
  SELECT COALESCE(SUM(jel.debit - jel.credit), 0)
  INTO total_expenses
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a ON a.id = jel.account_id
  WHERE je.business_id = p_business_id
    AND a.type = 'expense'
    AND a.deleted_at IS NULL
    AND je.date >= p_period_start_date
    AND je.date <= p_period_end_date;

  -- Net Income = Income - Expenses
  net_income := total_income - total_expenses;

  RETURN net_income;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Compute and store closing balances when period moves to Closed
-- This is called automatically when period status changes to 'closed'
-- Computes: ending_balance for all Balance Sheet accounts, net_income, retained_earnings_delta
-- All values are reproducible from the ledger at any time
-- ============================================================================
CREATE OR REPLACE FUNCTION compute_period_closing_balances(
  p_period_id UUID,
  p_business_id UUID,
  p_period_start_date DATE,
  p_period_end_date DATE,
  p_retained_earnings_account_code TEXT DEFAULT '3100'
)
RETURNS TABLE (
  account_id UUID,
  ending_balance NUMERIC,
  account_type TEXT
) AS $$
DECLARE
  account_record RECORD;
  ending_balance NUMERIC;
  net_income NUMERIC;
  retained_earnings_account_id UUID;
  retained_earnings_ending_balance NUMERIC;
BEGIN
  -- Get Retained Earnings account ID
  SELECT id INTO retained_earnings_account_id
  FROM accounts
  WHERE business_id = p_business_id
    AND code = p_retained_earnings_account_code
    AND type = 'equity'
    AND deleted_at IS NULL;

  IF retained_earnings_account_id IS NULL THEN
    RAISE EXCEPTION 'Retained Earnings account (code: %) not found for business', p_retained_earnings_account_code;
  END IF;

  -- Calculate net_income = total_revenue - total_expenses for the period
  SELECT calculate_period_net_income(
    p_business_id,
    p_period_start_date,
    p_period_end_date
  ) INTO net_income;

  -- Store net_income and retained_earnings_delta in period_summary (Approach 1: Snapshot Table)
  INSERT INTO period_summary (
    period_id,
    business_id,
    net_income,
    retained_earnings_delta
  )
  VALUES (
    p_period_id,
    p_business_id,
    net_income,
    net_income
  )
  ON CONFLICT (period_id) DO UPDATE
  SET
    net_income = EXCLUDED.net_income,
    retained_earnings_delta = EXCLUDED.net_income,
    computed_at = NOW();

  -- Also update accounting_periods for backwards compatibility
  UPDATE accounting_periods
  SET
    net_income = net_income,
    retained_earnings_delta = net_income
  WHERE id = p_period_id;

  -- Compute ending balances for all Balance Sheet accounts
  FOR account_record IN
    SELECT id, type, code, name
    FROM accounts
    WHERE business_id = p_business_id
      AND deleted_at IS NULL
      AND account_carries_forward(type) = TRUE -- Only Balance Sheet accounts
    ORDER BY code
  LOOP
    -- Calculate ending_balance from ledger (reproducible at any time)
    ending_balance := calculate_period_closing_balance(
      p_business_id,
      account_record.id,
      p_period_end_date
    );

    -- Special handling for Retained Earnings: Add net_income
    IF account_record.id = retained_earnings_account_id THEN
      ending_balance := ending_balance + net_income;
    END IF;

    -- Store ending balance in period_account_snapshot (Approach 1: Snapshot Table)
    INSERT INTO period_account_snapshot (
      period_id,
      account_id,
      business_id,
      ending_balance
    )
    VALUES (
      p_period_id,
      account_record.id,
      p_business_id,
      ending_balance
    )
    ON CONFLICT (period_id, account_id) DO UPDATE
    SET ending_balance = EXCLUDED.ending_balance,
        computed_at = NOW();
    
    -- Also store in period_closing_balances for backwards compatibility
    INSERT INTO period_closing_balances (
      period_id,
      account_id,
      business_id,
      ending_balance
    )
    VALUES (
      p_period_id,
      account_record.id,
      p_business_id,
      ending_balance
    )
    ON CONFLICT (period_id, account_id) DO UPDATE
    SET ending_balance = EXCLUDED.ending_balance;

    RETURN QUERY SELECT account_record.id, ending_balance, account_record.type;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Create opening balances for next period from prior period's ending balances
-- Called when the next period is created or opened
-- For Balance Sheet accounts: opening_balance = prior_period.ending_balance
-- For Retained Earnings: opening_balance += prior_period.net_income (already included in ending_balance)
-- Income Statement accounts don't carry forward (opening_balance = 0)
-- ============================================================================
-- Drop old version if it exists with different signature
DROP FUNCTION IF EXISTS create_period_opening_balances(UUID, UUID, DATE, TEXT);

CREATE OR REPLACE FUNCTION create_period_opening_balances(
  p_period_id UUID,
  p_business_id UUID,
  p_prior_period_id UUID
)
RETURNS TABLE (
  account_id UUID,
  opening_balance NUMERIC,
  carried_forward BOOLEAN
) AS $$
DECLARE
  account_record RECORD;
  prior_ending_balance NUMERIC;
BEGIN
  -- Verify prior period exists and is closed
  IF NOT EXISTS (
    SELECT 1 FROM accounting_periods
    WHERE id = p_prior_period_id
      AND business_id = p_business_id
      AND status = 'closed'
  ) THEN
    RAISE EXCEPTION 'Prior period must be closed before creating opening balances for next period';
  END IF;

  -- Process all accounts
  FOR account_record IN
    SELECT id, type, code, name
    FROM accounts
    WHERE business_id = p_business_id
      AND deleted_at IS NULL
    ORDER BY code
  LOOP
    -- Skip if already has opening balance for this period
    IF EXISTS (
      SELECT 1 FROM period_opening_balances
      WHERE period_id = p_period_id
        AND account_id = account_record.id
    ) THEN
      CONTINUE;
    END IF;

    -- Determine if account carries forward
    IF account_carries_forward(account_record.type) THEN
      -- Balance Sheet account: Get prior period's ending_balance from snapshot
      SELECT ending_balance INTO prior_ending_balance
      FROM period_account_snapshot
      WHERE period_id = p_prior_period_id
        AND account_id = account_record.id;

      -- If no ending balance found, default to 0 (account may not have existed in prior period)
      prior_ending_balance := COALESCE(prior_ending_balance, 0);

      -- Insert opening balance = prior period's ending balance
      INSERT INTO period_opening_balances (
        period_id,
        account_id,
        business_id,
        opening_balance
      )
      VALUES (
        p_period_id,
        account_record.id,
        p_business_id,
        prior_ending_balance
      )
      ON CONFLICT (period_id, account_id) DO UPDATE
      SET opening_balance = EXCLUDED.opening_balance;

      RETURN QUERY SELECT account_record.id, prior_ending_balance, TRUE::BOOLEAN;
    ELSE
      -- Income Statement account: Reset to 0 (no carry forward)
      INSERT INTO period_opening_balances (
        period_id,
        account_id,
        business_id,
        opening_balance
      )
      VALUES (
        p_period_id,
        account_record.id,
        p_business_id,
        0
      )
      ON CONFLICT (period_id, account_id) DO UPDATE
      SET opening_balance = 0;

      RETURN QUERY SELECT account_record.id, 0::NUMERIC, FALSE::BOOLEAN;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Get opening balance for an account in a period
-- Returns 0 if no opening balance snapshot exists
-- ============================================================================
CREATE OR REPLACE FUNCTION get_account_opening_balance(
  p_period_id UUID,
  p_account_id UUID
)
RETURNS NUMERIC AS $$
DECLARE
  opening_bal NUMERIC;
BEGIN
  SELECT opening_balance INTO opening_bal
  FROM period_opening_balances
  WHERE period_id = p_period_id
    AND account_id = p_account_id;

  RETURN COALESCE(opening_bal, 0);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Calculate account balance for a period including opening balance
-- This is the balance as of a date within the period, including the opening balance
-- from the period's opening balance snapshot
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_account_balance_in_period(
  p_business_id UUID,
  p_account_id UUID,
  p_period_id UUID,
  p_as_of_date DATE
)
RETURNS NUMERIC AS $$
DECLARE
  period_start_date DATE;
  opening_balance NUMERIC := 0;
  period_activity NUMERIC := 0;
  account_type TEXT;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  final_balance NUMERIC := 0;
BEGIN
  -- Get period start date
  SELECT start_date INTO period_start_date
  FROM accounting_periods
  WHERE id = p_period_id
    AND business_id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Accounting period not found: %', p_period_id;
  END IF;

  -- Get opening balance from snapshot
  opening_balance := get_account_opening_balance(p_period_id, p_account_id);

  -- Get account type
  SELECT type INTO account_type
  FROM accounts
  WHERE id = p_account_id
    AND business_id = p_business_id;

  IF account_type IS NULL THEN
    RETURN 0;
  END IF;

  -- Calculate activity in this period (from period start to as_of_date)
  SELECT
    COALESCE(SUM(jel.debit), 0),
    COALESCE(SUM(jel.credit), 0)
  INTO total_debit, total_credit
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  WHERE je.business_id = p_business_id
    AND jel.account_id = p_account_id
    AND je.date >= period_start_date
    AND je.date <= p_as_of_date;

  -- Calculate period activity balance based on account type
  IF account_type IN ('asset', 'expense') THEN
    period_activity := total_debit - total_credit;
  ELSE
    period_activity := total_credit - total_debit;
  END IF;

  -- Final balance = Opening Balance + Period Activity
  final_balance := opening_balance + period_activity;

  RETURN final_balance;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Period Account Snapshot
ALTER TABLE period_account_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view account snapshots for their business" ON period_account_snapshot;
CREATE POLICY "Users can view account snapshots for their business"
  ON period_account_snapshot FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = period_account_snapshot.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- Only system functions can insert/update account snapshots (not users directly)
DROP POLICY IF EXISTS "Users cannot modify account snapshots" ON period_account_snapshot;
CREATE POLICY "Users cannot modify account snapshots"
  ON period_account_snapshot FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);

-- Period Summary
ALTER TABLE period_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view period summary for their business" ON period_summary;
CREATE POLICY "Users can view period summary for their business"
  ON period_summary FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = period_summary.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- Only system functions can insert/update period summary (not users directly)
DROP POLICY IF EXISTS "Users cannot modify period summary" ON period_summary;
CREATE POLICY "Users cannot modify period summary"
  ON period_summary FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);

-- Period Closing Balances (backwards compatibility)
ALTER TABLE period_closing_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view closing balances for their business" ON period_closing_balances;
CREATE POLICY "Users can view closing balances for their business"
  ON period_closing_balances FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = period_closing_balances.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- Only system functions can insert/update closing balances (not users directly)
DROP POLICY IF EXISTS "Users cannot modify closing balances" ON period_closing_balances;
CREATE POLICY "Users cannot modify closing balances"
  ON period_closing_balances FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);

-- Period Opening Balances
ALTER TABLE period_opening_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view opening balances for their business" ON period_opening_balances;
CREATE POLICY "Users can view opening balances for their business"
  ON period_opening_balances FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = period_opening_balances.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- Only system functions can insert/update opening balances (not users directly)
DROP POLICY IF EXISTS "Users cannot modify opening balances" ON period_opening_balances;
CREATE POLICY "Users cannot modify opening balances"
  ON period_opening_balances FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE period_account_snapshot IS 
'Approach 1: Snapshot Table - Stores deterministic snapshot at close time.
Stores: period_id, account_id, ending_balance.
Pros: fast reporting, stable closing artifacts. Cons: must be integrity-checked.
IMPORTANT: Snapshots are NOT the source of truth. The ledger is.
Snapshots must match ledger-derived values. If mismatch → period cannot be locked.';

COMMENT ON COLUMN period_account_snapshot.ending_balance IS 
'Ending balance for the account at period end (from ledger).
For Retained Earnings, this includes net_income from the period.
This is a snapshot, not the source of truth. Must match ledger-derived values.';

COMMENT ON COLUMN period_account_snapshot.verified_at IS 
'Timestamp when integrity was last verified. NULL means not yet verified.
Verification recomputes from ledger and checks for mismatches.';

COMMENT ON TABLE period_summary IS 
'Approach 1: Snapshot Table - Stores deterministic snapshot at close time.
Stores: period_id, net_income, retained_earnings_delta.
Pros: fast reporting, stable closing artifacts. Cons: must be integrity-checked.
IMPORTANT: Snapshots are NOT the source of truth. The ledger is.
Snapshots must match ledger-derived values. If mismatch → period cannot be locked.';

COMMENT ON COLUMN period_summary.net_income IS 
'Computed when period moves to Closed: net_income = total_revenue - total_expenses.
This is a snapshot, not the source of truth. Must match ledger-derived values.
Reproducible from the ledger at any time.';

COMMENT ON COLUMN period_summary.retained_earnings_delta IS 
'Computed when period moves to Closed: retained_earnings_delta = net_income.
This is a snapshot, not the source of truth. Must match ledger-derived values.
Reproducible from the ledger at any time.
NOTE: Retained earnings is NOT posted as a journal entry in the closed period.
It is applied as part of the opening balance logic for the next period.';

COMMENT ON COLUMN period_summary.verified_at IS 
'Timestamp when integrity was last verified. NULL means not yet verified.
Verification recomputes from ledger and checks for mismatches.';

COMMENT ON TABLE period_closing_balances IS 
'DEPRECATED: Use period_account_snapshot instead. Kept for backwards compatibility.
Ending balances for Balance Sheet accounts when period is closed.';

COMMENT ON TABLE period_opening_balances IS 
'Opening balance snapshots for each period. These are derived from prior period''s ending balances.
When next period is created/opened: Balance Sheet accounts get opening_balance = prior_period.ending_balance.
Retained Earnings opening includes prior period net_income (already in ending_balance).
Income Statement accounts don''t carry forward (opening_balance = 0).';

COMMENT ON COLUMN period_opening_balances.opening_balance IS 
'Opening balance for the account in this period. For Balance Sheet accounts, this equals prior_period.ending_balance.
For Income Statement accounts, this is always 0 (they reset each period).';

COMMENT ON FUNCTION compute_period_closing_balances IS 
'Computes and stores closing balances when period moves to Closed (Approach 1: Snapshot Table).
Computes: ending_balance for all Balance Sheet accounts, net_income, retained_earnings_delta.
All values are reproducible from the ledger at any time.
Stores snapshots in period_account_snapshot and period_summary tables.
Snapshots are NOT the source of truth - the ledger is. Snapshots must be integrity-checked.';

COMMENT ON FUNCTION create_period_opening_balances IS 
'Creates opening balances for next period from prior period''s ending balances.
Called when next period is created/opened. For Balance Sheet: opening_balance = prior_period.ending_balance.
For Retained Earnings: opening includes prior net_income (already in ending_balance).
Income Statement accounts don''t carry forward.';

COMMENT ON FUNCTION account_carries_forward IS 
'Determines if an account type carries forward (Balance Sheet: asset, liability, equity) or resets (Income Statement: income, expense).';

COMMENT ON FUNCTION verify_period_snapshot_integrity IS 
'Integrity Rule (Non-Negotiable): Verifies snapshots match ledger-derived values.
Snapshots are NOT the source of truth. The ledger is.
Returns is_valid=true if all snapshots match ledger, false if any mismatch.
If mismatch occurs → period cannot be locked. Accountant must resolve mismatch.';

COMMENT ON FUNCTION calculate_period_net_income IS 
'Calculates net_income = total_revenue - total_expenses for the period. This equals retained_earnings_delta.
Reproducible from the ledger at any time. This is the source of truth, not snapshots.';

