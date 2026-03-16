-- ============================================================================
-- MIGRATION: Accounting Mode - Phase 2D: Carry-Forward (Audit-Grade)
-- ============================================================================
-- Adds carry-forward functionality to generate next-period opening balances
-- from prior period ending balances, safely and idempotently
-- 
-- Scope: Generate next-period opening balances from ledger
-- Access: Admin/Owner/Accountant write only
-- Source period: At least soft_closed (recommended), locked allowed
-- Target period: ONLY open (not soft_closed or locked), must be empty
-- Idempotency: UNIQUE (business_id, from_period_start, to_period_start) enforced
-- ============================================================================

-- ============================================================================
-- STEP 1: CREATE CARRY-FORWARD TABLES
-- ============================================================================

-- Carry-Forward Batches (audit trail + idempotency)
CREATE TABLE IF NOT EXISTS carry_forward_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  from_period_start DATE NOT NULL,
  to_period_start DATE NOT NULL,
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  note TEXT,
  UNIQUE (business_id, from_period_start, to_period_start)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_carry_forward_batches_business_id ON carry_forward_batches(business_id);
CREATE INDEX IF NOT EXISTS idx_carry_forward_batches_from_period_start ON carry_forward_batches(from_period_start);
CREATE INDEX IF NOT EXISTS idx_carry_forward_batches_to_period_start ON carry_forward_batches(to_period_start);
CREATE INDEX IF NOT EXISTS idx_carry_forward_batches_journal_entry_id ON carry_forward_batches(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_carry_forward_batches_created_by ON carry_forward_batches(created_by);

-- Carry-Forward Lines (individual account balances carried forward)
CREATE TABLE IF NOT EXISTS carry_forward_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES carry_forward_batches(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_carry_forward_lines_batch_id ON carry_forward_lines(batch_id);
CREATE INDEX IF NOT EXISTS idx_carry_forward_lines_account_id ON carry_forward_lines(account_id);

-- Comments
COMMENT ON TABLE carry_forward_batches IS 'Audit trail for carry-forward batches. Enforces idempotency via UNIQUE (business_id, from_period_start, to_period_start).';
COMMENT ON TABLE carry_forward_lines IS 'Individual account balances carried forward from source period to target period. Cascade deletes with batch.';
COMMENT ON COLUMN carry_forward_batches.from_period_start IS 'Source period start date (YYYY-MM-01 format). Period should be at least soft_closed (recommended).';
COMMENT ON COLUMN carry_forward_batches.to_period_start IS 'Target period start date (YYYY-MM-01 format). Period must be open and empty.';
COMMENT ON COLUMN carry_forward_batches.journal_entry_id IS 'Reference to the journal entry created for carry-forward opening balances.';
COMMENT ON COLUMN carry_forward_lines.amount IS 'Ending balance amount (signed). Positive/negative determines debit/credit per account type.';

-- ============================================================================
-- STEP 2: HELPER FUNCTION - Compute ending balances for eligible accounts
-- ============================================================================
-- This helper function computes ending balances for Balance Sheet accounts
-- (Asset/Liability/Equity, non-system) as of a given date
-- Uses existing calculate_account_balance_as_of function
-- ============================================================================

CREATE OR REPLACE FUNCTION compute_ending_balances_for_carry_forward(
  p_business_id UUID,
  p_as_of_date DATE
)
RETURNS TABLE (
  account_id UUID,
  account_code TEXT,
  account_name TEXT,
  account_type TEXT,
  ending_balance NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.code,
    a.name,
    a.type,
    calculate_account_balance_as_of(p_business_id, a.id, p_as_of_date) as ending_balance
  FROM accounts a
  WHERE a.business_id = p_business_id
    AND a.deleted_at IS NULL
    AND a.type IN ('asset', 'liability', 'equity')
    AND a.is_system = FALSE
  ORDER BY a.code;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION compute_ending_balances_for_carry_forward IS 'Computes ending balances for eligible Balance Sheet accounts (asset/liability/equity, non-system) as of a given date. Used for carry-forward.';

-- ============================================================================
-- STEP 3: CANONICAL RPC FUNCTION - apply_carry_forward
-- ============================================================================
-- This function atomically validates and applies carry-forward
-- 
-- Business Rules:
-- 1. Source period must exist (status soft_closed or locked recommended)
-- 2. Target period must exist AND status == 'open' (not soft_closed or locked)
-- 3. Target period must be empty (no non-opening-balance and non-carry-forward entries)
-- 4. Compute ending balances for eligible accounts (asset/liability/equity, non-system)
-- 5. Exclude accounts with zero balance (optional, but cleaner)
-- 6. Choose equity offset account (eligible equity, non-system)
-- 7. Create journal entry with reference_type = 'carry_forward'
-- 8. All-or-nothing: Either all succeeds or all fails (atomic transaction)
-- 9. Idempotency: Reject if batch already exists for (business_id, from_period_start, to_period_start)
-- ============================================================================

CREATE OR REPLACE FUNCTION apply_carry_forward(
  p_business_id UUID,
  p_from_period_start DATE,
  p_to_period_start DATE,
  p_equity_offset_account_id UUID,
  p_created_by UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS TABLE (
  batch_id UUID,
  journal_entry_id UUID
) AS $$
DECLARE
  v_from_period RECORD;
  v_to_period RECORD;
  v_account RECORD;
  v_journal_entry_id UUID;
  v_batch_id UUID;
  v_debit NUMERIC := 0;
  v_credit NUMERIC := 0;
  v_account_type TEXT;
  v_ending_balance NUMERIC;
  v_equity_balance NUMERIC := 0;
  v_journal_lines JSONB := '[]'::JSONB;
  v_account_count INTEGER := 0;
  v_non_carry_forward_entry_count INTEGER;
  v_equity_account_type TEXT;
  v_equity_account_is_system BOOLEAN;
BEGIN
  -- ========================================================================
  -- VALIDATION 1: Source period exists
  -- ========================================================================
  SELECT * INTO v_from_period
  FROM accounting_periods
  WHERE business_id = p_business_id
    AND period_start = p_from_period_start;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source accounting period not found for from_period_start: %', p_from_period_start;
  END IF;

  -- Recommend source period is at least soft_closed, but allow open for flexibility
  -- (Note: In practice, carry-forward should be from a closed/locked period)
  IF v_from_period.status NOT IN ('open', 'soft_closed', 'locked') THEN
    RAISE EXCEPTION 'Source period has invalid status: %. Expected open, soft_closed, or locked.', v_from_period.status;
  END IF;

  -- ========================================================================
  -- VALIDATION 2: Target period exists and status == 'open'
  -- ========================================================================
  SELECT * INTO v_to_period
  FROM accounting_periods
  WHERE business_id = p_business_id
    AND period_start = p_to_period_start;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target accounting period not found for to_period_start: %', p_to_period_start;
  END IF;

  IF v_to_period.status != 'open' THEN
    RAISE EXCEPTION 'Carry-forward can only be applied to periods with status ''open''. Target period status: %.', v_to_period.status;
  END IF;

  -- ========================================================================
  -- VALIDATION 3: Check for existing non-carry-forward/non-opening-balance journal entries in target period
  -- ========================================================================
  SELECT COUNT(*) INTO v_non_carry_forward_entry_count
  FROM journal_entries
  WHERE business_id = p_business_id
    AND date >= v_to_period.period_start
    AND date <= v_to_period.period_end
    AND (reference_type IS NULL OR (reference_type != 'carry_forward' AND reference_type != 'opening_balance'));

  IF v_non_carry_forward_entry_count > 0 THEN
    RAISE EXCEPTION 'Cannot apply carry-forward. Target period already has % non-carry-forward/non-opening-balance journal entry(ies).', v_non_carry_forward_entry_count;
  END IF;

  -- ========================================================================
  -- VALIDATION 4: Idempotency check
  -- ========================================================================
  IF EXISTS (
    SELECT 1 FROM carry_forward_batches
    WHERE business_id = p_business_id
      AND from_period_start = p_from_period_start
      AND to_period_start = p_to_period_start
  ) THEN
    RAISE EXCEPTION 'Carry-forward already applied for from_period_start: % to to_period_start: %. Idempotency enforced - cannot apply twice.', p_from_period_start, p_to_period_start;
  END IF;

  -- ========================================================================
  -- VALIDATION 5: Validate equity offset account
  -- ========================================================================
  SELECT type, is_system INTO v_equity_account_type, v_equity_account_is_system
  FROM accounts
  WHERE id = p_equity_offset_account_id
    AND business_id = p_business_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Equity offset account not found: %', p_equity_offset_account_id;
  END IF;

  IF v_equity_account_type != 'equity' THEN
    RAISE EXCEPTION 'Equity offset account must be type ''equity''. Found: %.', v_equity_account_type;
  END IF;

  IF v_equity_account_is_system = TRUE THEN
    RAISE EXCEPTION 'Equity offset account cannot be a system account.';
  END IF;

  -- Use eligibility helper (reuse from Phase 2C)
  PERFORM assert_account_eligible_for_opening_balance(p_equity_offset_account_id, p_business_id);

  -- ========================================================================
  -- COMPUTE ENDING BALANCES FOR ELIGIBLE ACCOUNTS
  -- ========================================================================
  -- Use source period end date as as_of_date
  -- Only include eligible Balance Sheet accounts (asset/liability/equity, non-system)
  -- Exclude Income/Expense (handled by year-end close)
  -- ========================================================================
  FOR v_account IN
    SELECT * FROM compute_ending_balances_for_carry_forward(p_business_id, v_from_period.period_end)
  LOOP
    -- Skip accounts with zero balance (optional, but cleaner)
    IF ABS(v_account.ending_balance) < 0.01 THEN
      CONTINUE;
    END IF;

    -- Skip equity offset account (will be added as balancing line)
    IF v_account.account_id = p_equity_offset_account_id THEN
      CONTINUE;
    END IF;

    v_account_count := v_account_count + 1;
    v_account_type := v_account.account_type;
    v_ending_balance := v_account.ending_balance;

    -- Derive debit/credit based on account type and balance sign
    -- Asset: normal = DEBIT (positive = debit, negative = credit)
    -- Liability/Equity: normal = CREDIT (positive = credit, negative = debit)
    IF v_account_type = 'asset' THEN
      IF v_ending_balance >= 0 THEN
        v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_id', v_account.account_id,
          'debit', v_ending_balance,
          'credit', 0,
          'description', 'Carry-forward from ' || TO_CHAR(p_from_period_start, 'YYYY-MM')
        );
        v_debit := v_debit + v_ending_balance;
      ELSE
        v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_id', v_account.account_id,
          'debit', 0,
          'credit', ABS(v_ending_balance),
          'description', 'Carry-forward from ' || TO_CHAR(p_from_period_start, 'YYYY-MM')
        );
        v_credit := v_credit + ABS(v_ending_balance);
      END IF;
    ELSIF v_account_type IN ('liability', 'equity') THEN
      IF v_ending_balance >= 0 THEN
        v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_id', v_account.account_id,
          'debit', 0,
          'credit', v_ending_balance,
          'description', 'Carry-forward from ' || TO_CHAR(p_from_period_start, 'YYYY-MM')
        );
        v_credit := v_credit + v_ending_balance;
      ELSE
        v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_id', v_account.account_id,
          'debit', ABS(v_ending_balance),
          'credit', 0,
          'description', 'Carry-forward from ' || TO_CHAR(p_from_period_start, 'YYYY-MM')
        );
        v_debit := v_debit + ABS(v_ending_balance);
      END IF;
    END IF;
  END LOOP;

  -- If no accounts with non-zero balances, warn but allow (empty carry-forward)
  IF v_account_count = 0 THEN
    RAISE NOTICE 'No accounts with non-zero balances found for carry-forward. Creating empty carry-forward.';
  END IF;

  -- ========================================================================
  -- VALIDATION 6: Calculate equity balancing line
  -- ========================================================================
  v_equity_balance := v_debit - v_credit;

  -- Add equity offset line to balance the entry
  IF ABS(v_equity_balance) > 0.01 THEN  -- Allow small rounding differences
    IF v_equity_balance > 0 THEN
      -- Need credit to balance (debit > credit)
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_id', p_equity_offset_account_id,
        'debit', 0,
        'credit', v_equity_balance,
        'description', 'Carry-forward offset (equity) from ' || TO_CHAR(p_from_period_start, 'YYYY-MM')
      );
      v_credit := v_credit + v_equity_balance;
    ELSE
      -- Need debit to balance (credit > debit)
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_id', p_equity_offset_account_id,
        'debit', ABS(v_equity_balance),
        'credit', 0,
        'description', 'Carry-forward offset (equity) from ' || TO_CHAR(p_from_period_start, 'YYYY-MM')
      );
      v_debit := v_debit + ABS(v_equity_balance);
    END IF;
  END IF;

  -- Final balance check (should be balanced now)
  IF ABS(v_debit - v_credit) > 0.01 THEN
    RAISE EXCEPTION 'Carry-forward journal entry is not balanced. Debit: %, Credit: %, Difference: %', v_debit, v_credit, ABS(v_debit - v_credit);
  END IF;

  -- ========================================================================
  -- CREATE JOURNAL ENTRY (using existing post_journal_entry function)
  -- ========================================================================
  SELECT post_journal_entry(
    p_business_id,
    p_to_period_start,  -- entry_date = to_period_start (first day of target period)
    'Carry-forward from ' || TO_CHAR(p_from_period_start, 'YYYY-MM') || ' to ' || TO_CHAR(p_to_period_start, 'YYYY-MM'),
    'carry_forward',  -- reference_type marks this as carry-forward entry
    NULL,  -- reference_id is NULL (no related record)
    v_journal_lines
  ) INTO v_journal_entry_id;

  -- Update journal entry to set created_by (post_journal_entry doesn't set it)
  UPDATE journal_entries
  SET created_by = p_created_by
  WHERE id = v_journal_entry_id;

  -- ========================================================================
  -- CREATE BATCH RECORD (audit trail + idempotency)
  -- ========================================================================
  INSERT INTO carry_forward_batches (
    business_id,
    from_period_start,
    to_period_start,
    journal_entry_id,
    created_by,
    note
  )
  VALUES (
    p_business_id,
    p_from_period_start,
    p_to_period_start,
    v_journal_entry_id,
    p_created_by,
    p_note
  )
  RETURNING id INTO v_batch_id;

  -- ========================================================================
  -- CREATE LINE RECORDS (audit trail)
  -- ========================================================================
  FOR v_account IN
    SELECT * FROM compute_ending_balances_for_carry_forward(p_business_id, v_from_period.period_end)
  LOOP
    -- Skip accounts with zero balance
    IF ABS(v_account.ending_balance) < 0.01 THEN
      CONTINUE;
    END IF;

    -- Skip equity offset account (will be computed as balancing line)
    IF v_account.account_id = p_equity_offset_account_id THEN
      CONTINUE;
    END IF;

    INSERT INTO carry_forward_lines (
      batch_id,
      account_id,
      amount
    )
    VALUES (
      v_batch_id,
      v_account.account_id,
      v_account.ending_balance
    );
  END LOOP;

  -- ========================================================================
  -- RETURN RESULTS
  -- ========================================================================
  RETURN QUERY SELECT v_batch_id, v_journal_entry_id;

EXCEPTION
  WHEN unique_violation THEN
    -- Catch UNIQUE constraint violation (idempotency)
    IF SQLERRM LIKE '%carry_forward_batches_business_id_from_period_start_to_period_start_key%' THEN
      RAISE EXCEPTION 'Carry-forward already applied for from_period_start: % to to_period_start: %. Idempotency enforced.', p_from_period_start, p_to_period_start;
    ELSE
      RAISE;
    END IF;
  WHEN OTHERS THEN
    -- Re-raise with context
    RAISE EXCEPTION 'Failed to apply carry-forward: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON FUNCTION apply_carry_forward IS 'Atomically validates and applies carry-forward from source period to target period. Enforces target period status = ''open'', idempotency, account eligibility, and balanced journal entry. Computes ending balances from ledger.';
COMMENT ON FUNCTION compute_ending_balances_for_carry_forward IS 'Computes ending balances for eligible Balance Sheet accounts (asset/liability/equity, non-system) as of a given date. Excludes Income/Expense accounts.';
