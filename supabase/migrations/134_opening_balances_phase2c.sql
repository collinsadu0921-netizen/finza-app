-- ============================================================================
-- MIGRATION: Accounting Mode - Phase 2C: Opening Balances (Audit-Grade)
-- ============================================================================
-- Adds opening balances functionality with strict validation and idempotency
-- 
-- Scope: Create + apply opening balances safely using ledger posting
-- Access: Admin/Owner/Accountant write only
-- Period constraint: ONLY open periods (not soft_closed or locked)
-- Idempotency: UNIQUE (business_id, period_start) enforced
-- ============================================================================

-- ============================================================================
-- STEP 1: CREATE OPENING BALANCE TABLES
-- ============================================================================

-- Opening Balance Batches (audit trail + idempotency)
CREATE TABLE IF NOT EXISTS opening_balance_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  equity_offset_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  applied_by UUID NOT NULL REFERENCES auth.users(id),
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (business_id, period_start)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_opening_balance_batches_business_id ON opening_balance_batches(business_id);
CREATE INDEX IF NOT EXISTS idx_opening_balance_batches_period_start ON opening_balance_batches(period_start);
CREATE INDEX IF NOT EXISTS idx_opening_balance_batches_journal_entry_id ON opening_balance_batches(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_opening_balance_batches_applied_by ON opening_balance_batches(applied_by);

-- Opening Balance Lines (individual account balances)
CREATE TABLE IF NOT EXISTS opening_balance_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES opening_balance_batches(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_opening_balance_lines_batch_id ON opening_balance_lines(batch_id);
CREATE INDEX IF NOT EXISTS idx_opening_balance_lines_account_id ON opening_balance_lines(account_id);

-- Comments
COMMENT ON TABLE opening_balance_batches IS 'Audit trail for opening balance batches. Enforces idempotency via UNIQUE (business_id, period_start).';
COMMENT ON TABLE opening_balance_lines IS 'Individual account opening balance lines. Cascade deletes with batch.';
COMMENT ON COLUMN opening_balance_batches.period_start IS 'Period start date (YYYY-MM-01 format). Must match accounting_periods.period_start.';
COMMENT ON COLUMN opening_balance_batches.equity_offset_account_id IS 'Equity account used to balance the opening balance journal entry.';
COMMENT ON COLUMN opening_balance_batches.journal_entry_id IS 'Reference to the journal entry created for opening balances.';
COMMENT ON COLUMN opening_balance_lines.amount IS 'Opening balance amount (signed). Positive/negative determines debit/credit per account type.';

-- ============================================================================
-- STEP 2: HELPER FUNCTION - assert_account_eligible_for_opening_balance
-- ============================================================================
-- This helper function validates account eligibility for opening balances
-- Must be created before apply_opening_balances function
-- ============================================================================

CREATE OR REPLACE FUNCTION assert_account_eligible_for_opening_balance(
  p_account_id UUID,
  p_business_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_account RECORD;
BEGIN
  -- Fetch account
  SELECT id, code, name, type, is_system INTO v_account
  FROM accounts
  WHERE id = p_account_id
    AND business_id = p_business_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found: %', p_account_id;
  END IF;

  -- Check account type (allowed: asset, liability, equity)
  IF v_account.type NOT IN ('asset', 'liability', 'equity') THEN
    RAISE EXCEPTION 'Account % (%) is of type ''%'' and cannot be used for opening balances. Only asset, liability, and equity accounts are allowed.', 
      v_account.code, v_account.name, v_account.type;
  END IF;

  -- Check if system account
  IF v_account.is_system = TRUE THEN
    RAISE EXCEPTION 'Account % (%) is a system account and cannot be used for opening balances.', 
      v_account.code, v_account.name;
  END IF;

  -- Account is eligible
  RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION assert_account_eligible_for_opening_balance IS 'Validates that an account is eligible for opening balances (asset/liability/equity, non-system).';

-- ============================================================================
-- STEP 3: CANONICAL RPC FUNCTION - apply_opening_balances
-- ============================================================================
-- This function atomically validates and applies opening balances
-- 
-- Business Rules:
-- 1. Period must exist AND status == 'open' (not soft_closed or locked)
-- 2. Period must have no non-opening-balance journal entries
-- 3. All account_ids must be eligible (asset/liability/equity, non-system)
-- 4. Equity offset account must be eligible AND equity type AND non-system
-- 5. Equity offset account cannot be in user-entered lines
-- 6. Idempotency: Reject if batch already exists for (business_id, period_start)
-- 7. Journal entry marked with reference_type = 'opening_balance'
-- 8. All-or-nothing: Either all succeeds or all fails (atomic transaction)
-- ============================================================================

CREATE OR REPLACE FUNCTION apply_opening_balances(
  p_business_id UUID,
  p_period_start DATE,
  p_equity_offset_account_id UUID,
  p_lines JSONB,  -- Array of { account_id: uuid, amount: numeric }
  p_applied_by UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS TABLE (
  batch_id UUID,
  journal_entry_id UUID
) AS $$
DECLARE
  v_period RECORD;
  v_account RECORD;
  v_line JSONB;
  v_journal_entry_id UUID;
  v_batch_id UUID;
  v_debit NUMERIC := 0;
  v_credit NUMERIC := 0;
  v_account_type TEXT;
  v_amount NUMERIC;
  v_account_id UUID;
  v_equity_account_type TEXT;
  v_equity_account_is_system BOOLEAN;
  v_journal_lines JSONB := '[]'::JSONB;
  v_equity_balance NUMERIC := 0;
  v_non_opening_balance_entry_count INTEGER;
BEGIN
  -- ========================================================================
  -- VALIDATION 1: Period exists and status == 'open'
  -- ========================================================================
  SELECT * INTO v_period
  FROM accounting_periods
  WHERE business_id = p_business_id
    AND period_start = p_period_start
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Accounting period not found for period_start: %', p_period_start;
  END IF;

  IF v_period.status != 'open' THEN
    RAISE EXCEPTION 'Opening balances can only be applied to periods with status ''open''. Current status: %.', v_period.status;
  END IF;

  -- ========================================================================
  -- VALIDATION 2: Check for existing non-opening-balance journal entries
  -- ========================================================================
  SELECT COUNT(*) INTO v_non_opening_balance_entry_count
  FROM journal_entries
  WHERE business_id = p_business_id
    AND date >= v_period.period_start
    AND date <= v_period.period_end
    AND (reference_type IS NULL OR reference_type != 'opening_balance');

  IF v_non_opening_balance_entry_count > 0 THEN
    RAISE EXCEPTION 'Cannot apply opening balances. Period already has % non-opening-balance journal entry(ies).', v_non_opening_balance_entry_count;
  END IF;

  -- ========================================================================
  -- VALIDATION 3: Idempotency check
  -- ========================================================================
  IF EXISTS (
    SELECT 1 FROM opening_balance_batches
    WHERE business_id = p_business_id
      AND period_start = p_period_start
  ) THEN
    RAISE EXCEPTION 'Opening balances already applied for period_start: %. Idempotency enforced - cannot apply twice.', p_period_start;
  END IF;

  -- ========================================================================
  -- VALIDATION 4: Validate equity offset account
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

  -- Use eligibility helper (reuse existing function from Phase 2B)
  -- Note: We already checked type='equity' and is_system=false above
  -- Call helper for consistency with Phase 2B eligibility rules (will confirm non-system)
  PERFORM assert_account_eligible_for_opening_balance(p_equity_offset_account_id, p_business_id);

  -- ========================================================================
  -- VALIDATION 5: Validate all user-entered lines and build journal_lines
  -- ========================================================================
  IF jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one opening balance line is required.';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    -- Extract account_id and amount
    v_account_id := (v_line->>'account_id')::UUID;
    v_amount := COALESCE((v_line->>'amount')::NUMERIC, 0);

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'Invalid line: account_id is required.';
    END IF;

    -- Check if equity offset account is in user-entered lines (forbidden)
    IF v_account_id = p_equity_offset_account_id THEN
      RAISE EXCEPTION 'Equity offset account cannot be included in opening balance lines.';
    END IF;

    -- Validate account eligibility (function will raise exception if not eligible)
    PERFORM assert_account_eligible_for_opening_balance(v_account_id, p_business_id);

    -- Get account type for side derivation
    SELECT type INTO v_account_type
    FROM accounts
    WHERE id = v_account_id;

    -- Derive debit/credit based on account type and amount sign
    -- Asset: normal = DEBIT (positive = debit, negative = credit)
    -- Liability/Equity: normal = CREDIT (positive = credit, negative = debit)
    IF v_account_type = 'asset' THEN
      IF v_amount >= 0 THEN
        v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_id', v_account_id,
          'debit', v_amount,
          'credit', 0,
          'description', 'Opening balance'
        );
        v_debit := v_debit + v_amount;
      ELSE
        v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_id', v_account_id,
          'debit', 0,
          'credit', ABS(v_amount),
          'description', 'Opening balance'
        );
        v_credit := v_credit + ABS(v_amount);
      END IF;
    ELSIF v_account_type IN ('liability', 'equity') THEN
      IF v_amount >= 0 THEN
        v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_id', v_account_id,
          'debit', 0,
          'credit', v_amount,
          'description', 'Opening balance'
        );
        v_credit := v_credit + v_amount;
      ELSE
        v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_id', v_account_id,
          'debit', ABS(v_amount),
          'credit', 0,
          'description', 'Opening balance'
        );
        v_debit := v_debit + ABS(v_amount);
      END IF;
    ELSE
      RAISE EXCEPTION 'Invalid account type for opening balance: % (should have been caught by eligibility check)', v_account_type;
    END IF;
  END LOOP;

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
        'description', 'Opening balance offset (equity)'
      );
      v_credit := v_credit + v_equity_balance;
    ELSE
      -- Need debit to balance (credit > debit)
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_id', p_equity_offset_account_id,
        'debit', ABS(v_equity_balance),
        'credit', 0,
        'description', 'Opening balance offset (equity)'
      );
      v_debit := v_debit + ABS(v_equity_balance);
    END IF;
  END IF;

  -- Final balance check (should be balanced now)
  IF ABS(v_debit - v_credit) > 0.01 THEN
    RAISE EXCEPTION 'Opening balance journal entry is not balanced. Debit: %, Credit: %, Difference: %', v_debit, v_credit, ABS(v_debit - v_credit);
  END IF;

  -- ========================================================================
  -- CREATE JOURNAL ENTRY (using existing post_journal_entry function)
  -- ========================================================================
  SELECT post_journal_entry(
    p_business_id,
    p_period_start,  -- entry_date = period_start (first day of period)
    'Opening balances for ' || TO_CHAR(p_period_start, 'YYYY-MM'),
    'opening_balance',  -- reference_type marks this as opening balance entry
    NULL,  -- reference_id is NULL (no related record)
    v_journal_lines
  ) INTO v_journal_entry_id;

  -- Update journal entry to set created_by (post_journal_entry doesn't set it)
  UPDATE journal_entries
  SET created_by = p_applied_by
  WHERE id = v_journal_entry_id;

  -- ========================================================================
  -- CREATE BATCH RECORD (audit trail + idempotency)
  -- ========================================================================
  INSERT INTO opening_balance_batches (
    business_id,
    period_start,
    equity_offset_account_id,
    journal_entry_id,
    applied_by,
    note
  )
  VALUES (
    p_business_id,
    p_period_start,
    p_equity_offset_account_id,
    v_journal_entry_id,
    p_applied_by,
    p_note
  )
  RETURNING id INTO v_batch_id;

  -- ========================================================================
  -- CREATE LINE RECORDS (audit trail)
  -- ========================================================================
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO opening_balance_lines (
      batch_id,
      account_id,
      amount
    )
    VALUES (
      v_batch_id,
      (v_line->>'account_id')::UUID,
      COALESCE((v_line->>'amount')::NUMERIC, 0)
    );
  END LOOP;

  -- ========================================================================
  -- RETURN RESULTS
  -- ========================================================================
  RETURN QUERY SELECT v_batch_id, v_journal_entry_id;

EXCEPTION
  WHEN unique_violation THEN
    -- Catch UNIQUE constraint violation (idempotency)
    IF SQLERRM LIKE '%opening_balance_batches_business_id_period_start_key%' THEN
      RAISE EXCEPTION 'Opening balances already applied for period_start: %. Idempotency enforced.', p_period_start;
    ELSE
      RAISE;
    END IF;
  WHEN OTHERS THEN
    -- Re-raise with context
    RAISE EXCEPTION 'Failed to apply opening balances: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON FUNCTION apply_opening_balances IS 'Atomically validates and applies opening balances. Enforces period status = ''open'', idempotency, account eligibility, and balanced journal entry.';
