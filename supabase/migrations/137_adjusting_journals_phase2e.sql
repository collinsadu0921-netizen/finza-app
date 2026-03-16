-- ============================================================================
-- MIGRATION: Accounting Mode - Phase 2E: Adjusting Journals (Canonical)
-- ============================================================================
-- Adds canonical manual adjusting journal workflow that allows accountants/admins to:
-- - Post correcting entries
-- - Accrue or defer amounts
-- - Reclassify balances
-- 
-- All adjustments must:
-- - Be fully audited
-- - Respect period controls (ONLY open periods)
-- - Never alter historical entries (always creates new journal entry)
-- 
-- Scope: PERIOD-AWARE, AUDITED, LEDGER-ONLY
-- Mode: CONTROLLED BATCH (no drift, no shortcuts)
-- ============================================================================

-- ============================================================================
-- STEP 1: CANONICAL ADJUSTING JOURNAL FUNCTION
-- ============================================================================
-- Creates a new journal entry marked as adjustment
-- Uses reference_type = 'adjustment' in journal_entries table
-- Reuses existing journal_entries and journal_entry_lines tables (no new tables)
-- ============================================================================

CREATE OR REPLACE FUNCTION apply_adjusting_journal(
  p_business_id UUID,
  p_period_start DATE,
  p_entry_date DATE,
  p_description TEXT,
  p_lines JSONB,
  p_created_by UUID
)
RETURNS UUID AS $$
DECLARE
  v_period RECORD;
  v_account RECORD;
  v_journal_entry_id UUID;
  v_line JSONB;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_account_id UUID;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_line_count INTEGER := 0;
BEGIN
  -- ========================================================================
  -- VALIDATION 1: Period exists and status == 'open' (NOT soft_closed or locked)
  -- ========================================================================
  SELECT * INTO v_period
  FROM accounting_periods
  WHERE business_id = p_business_id
    AND period_start = p_period_start;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Accounting period not found for period_start: %', p_period_start;
  END IF;

  -- CRITICAL: Adjusting journals may ONLY be posted into 'open' periods
  -- NOT into 'soft_closed' or 'locked' periods
  IF v_period.status != 'open' THEN
    RAISE EXCEPTION 'Adjusting journals can only be posted into periods with status ''open''. Period status: %.', v_period.status;
  END IF;

  -- ========================================================================
  -- VALIDATION 2: entry_date must fall within period [period_start, period_end]
  -- ========================================================================
  IF p_entry_date < v_period.period_start OR p_entry_date > v_period.period_end THEN
    RAISE EXCEPTION 'Entry date % must fall within period [%, %]', p_entry_date, v_period.period_start, v_period.period_end;
  END IF;

  -- ========================================================================
  -- VALIDATION 3: At least 2 lines required
  -- ========================================================================
  v_line_count := jsonb_array_length(p_lines);
  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'Adjusting journal must have at least 2 lines. Found: %', v_line_count;
  END IF;

  -- ========================================================================
  -- VALIDATION 4: Validate accounts and compute totals
  -- ========================================================================
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    -- Validate required fields
    IF NOT (v_line ? 'account_id') THEN
      RAISE EXCEPTION 'Each line must have an account_id';
    END IF;

    v_account_id := (v_line->>'account_id')::UUID;

    -- Validate account exists and belongs to business
    SELECT * INTO v_account
    FROM accounts
    WHERE id = v_account_id
      AND business_id = p_business_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Account not found or does not belong to business: %', v_account_id;
    END IF;

    -- Validate debit/credit fields
    v_debit := COALESCE((v_line->>'debit')::NUMERIC, 0);
    v_credit := COALESCE((v_line->>'credit')::NUMERIC, 0);

    -- VALIDATION 5: All amounts must be > 0 (no zero amounts)
    IF v_debit <= 0 AND v_credit <= 0 THEN
      RAISE EXCEPTION 'Each line must have either debit > 0 or credit > 0. Account: %', v_account.code;
    END IF;

    -- VALIDATION 6: Exactly one of debit or credit per line (not both)
    IF v_debit > 0 AND v_credit > 0 THEN
      RAISE EXCEPTION 'Each line must have exactly one of debit or credit (not both). Account: %', v_account.code;
    END IF;

    -- Accumulate totals
    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  END LOOP;

  -- ========================================================================
  -- VALIDATION 7: Debit/credit totals must balance exactly
  -- ========================================================================
  IF ABS(v_total_debit - v_total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Adjusting journal entry must balance. Debit: %, Credit: %, Difference: %', v_total_debit, v_total_credit, ABS(v_total_debit - v_total_credit);
  END IF;

  -- ========================================================================
  -- CREATE JOURNAL ENTRY (using existing post_journal_entry function)
  -- ========================================================================
  -- Mark with reference_type = 'adjustment' and reference_id = NULL
  SELECT post_journal_entry(
    p_business_id,
    p_entry_date,
    p_description,
    'adjustment',  -- reference_type marks this as adjustment
    NULL,  -- reference_id is NULL (adjustments are standalone entries)
    p_lines
  ) INTO v_journal_entry_id;

  -- Update journal entry to set created_by (post_journal_entry doesn't set it)
  UPDATE journal_entries
  SET created_by = p_created_by
  WHERE id = v_journal_entry_id;

  -- ========================================================================
  -- RETURN JOURNAL ENTRY ID
  -- ========================================================================
  RETURN v_journal_entry_id;

EXCEPTION
  WHEN OTHERS THEN
    -- Re-raise with context
    RAISE EXCEPTION 'Failed to apply adjusting journal: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON FUNCTION apply_adjusting_journal IS 'Atomically validates and applies adjusting journal entry. Enforces period status = ''open'' (not soft_closed or locked), entry_date within period, account validation, balanced entry, and minimum 2 lines. Creates new journal entry marked with reference_type = ''adjustment''. Adjustments are permanent and auditable.';
