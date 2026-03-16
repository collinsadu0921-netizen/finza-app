-- ============================================================================
-- MIGRATION: Accounting Mode - Phase 2D: Carry-Forward Patch - Remove Equity Offset
-- ============================================================================
-- PATCH: Remove equity offset and include all balance-sheet accounts (system + non-system)
-- 
-- Changes:
-- 1. compute_ending_balances_for_carry_forward: Include system accounts (remove is_system = FALSE filter)
-- 2. apply_carry_forward: Remove p_equity_offset_account_id parameter and all offset logic
-- 3. Apply imbalance diagnostics if entry doesn't naturally balance
-- 
-- Goal: Carry-forward must be fully ledger-based and naturally balanced (no plug/offset)
-- ============================================================================

-- ============================================================================
-- STEP 1: UPDATE compute_ending_balances_for_carry_forward
-- ============================================================================
-- Remove the is_system = FALSE filter to include ALL balance-sheet accounts
-- (both system and non-system accounts)
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
    -- REMOVED: AND a.is_system = FALSE
    -- Now includes ALL balance-sheet accounts (system + non-system)
  ORDER BY a.code;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION compute_ending_balances_for_carry_forward IS 'Computes ending balances for ALL Balance Sheet accounts (asset/liability/equity, including system accounts) as of a given date. Used for carry-forward.';

-- ============================================================================
-- STEP 2: UPDATE apply_carry_forward - Remove Equity Offset
-- ============================================================================
-- Remove p_equity_offset_account_id parameter and all related validation/logic
-- Remove offset line creation logic
-- Add imbalance diagnostics if entry doesn't naturally balance
-- ============================================================================

CREATE OR REPLACE FUNCTION apply_carry_forward(
  p_business_id UUID,
  p_from_period_start DATE,
  p_to_period_start DATE,
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
  v_journal_lines JSONB := '[]'::JSONB;
  v_account_count INTEGER := 0;
  v_non_carry_forward_entry_count INTEGER;
  v_imbalance NUMERIC;
  v_diagnostics TEXT;
  v_top_accounts RECORD;
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
  -- COMPUTE ENDING BALANCES FOR ALL BALANCE-SHEET ACCOUNTS (including system)
  -- ========================================================================
  -- Use source period end date as as_of_date
  -- Include ALL Balance Sheet accounts (asset/liability/equity, system + non-system)
  -- Exclude Income/Expense (handled by year-end close)
  -- ========================================================================
  FOR v_account IN
    SELECT * FROM compute_ending_balances_for_carry_forward(p_business_id, v_from_period.period_end)
  LOOP
    -- Skip accounts with zero balance (optional, but cleaner)
    IF ABS(v_account.ending_balance) < 0.01 THEN
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
  -- VALIDATION 5: Check if entry naturally balances
  -- ========================================================================
  v_imbalance := v_debit - v_credit;

  -- If entry doesn't balance naturally, raise exception with diagnostics
  IF ABS(v_imbalance) > 0.01 THEN  -- Allow small rounding differences (0.01)
    -- Build diagnostics: top 10 accounts by absolute balance
    v_diagnostics := 'Carry-forward entry does not balance naturally. ';
    v_diagnostics := v_diagnostics || 'Debit: ' || v_debit::TEXT || ', Credit: ' || v_credit::TEXT || ', Imbalance: ' || v_imbalance::TEXT || '. ';
    v_diagnostics := v_diagnostics || 'Top 10 accounts by absolute balance: ';
    
    -- Get top 10 accounts by absolute balance for diagnostics
    FOR v_top_accounts IN
      SELECT 
        a.code,
        a.name,
        a.type,
        ABS(calculate_account_balance_as_of(p_business_id, a.id, v_from_period.period_end)) as abs_balance
      FROM accounts a
      WHERE a.business_id = p_business_id
        AND a.deleted_at IS NULL
        AND a.type IN ('asset', 'liability', 'equity')
      ORDER BY abs_balance DESC
      LIMIT 10
    LOOP
      v_diagnostics := v_diagnostics || v_top_accounts.code || ' (' || v_top_accounts.name || ', ' || v_top_accounts.type || ', ' || v_top_accounts.abs_balance::TEXT || '); ';
    END LOOP;
    
    RAISE EXCEPTION '%', v_diagnostics;
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
  -- Include ALL accounts (not skipping equity offset anymore)
  FOR v_account IN
    SELECT * FROM compute_ending_balances_for_carry_forward(p_business_id, v_from_period.period_end)
  LOOP
    -- Skip accounts with zero balance
    IF ABS(v_account.ending_balance) < 0.01 THEN
      CONTINUE;
    END IF;

    -- REMOVED: Skip equity offset account logic
    -- All accounts with non-zero balances are now included

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
COMMENT ON FUNCTION apply_carry_forward IS 'Atomically validates and applies carry-forward from source period to target period. Enforces target period status = ''open'', idempotency, account eligibility, and naturally balanced journal entry. Computes ending balances from ledger. Includes ALL balance-sheet accounts (system + non-system). No equity offset - entry must balance naturally.';
