-- ============================================================================
-- MIGRATION: Fix Journal Balance Enforcement (Hard Reset)
-- ============================================================================
-- REPLACES broken balance enforcement with correct statement-level trigger
-- 
-- Problem: Row-level trigger (migration 088) and attempted fix (migration 185)
-- both fail because post_journal_entry() inserts lines one-by-one in a loop.
-- Each INSERT is a separate statement, so triggers fire after each line,
-- causing false failures when entry isn't balanced until all lines exist.
--
-- Solution:
-- 1. Remove ALL existing balance triggers (row-level and statement-level)
-- 2. Create correct statement-level trigger that validates after ALL inserts
-- 3. Fix post_journal_entry() to use batch INSERT instead of loop
-- ============================================================================

-- ============================================================================
-- STEP 1: Remove broken triggers
-- ============================================================================
-- Drop both the row-level trigger (migration 088) and statement-level trigger (migration 185)
DROP TRIGGER IF EXISTS trigger_enforce_double_entry_balance ON journal_entry_lines;
DROP FUNCTION IF EXISTS enforce_double_entry_balance() CASCADE;
DROP FUNCTION IF EXISTS enforce_double_entry_balance_statement() CASCADE;

-- ============================================================================
-- STEP 2: Create correct statement-level balance enforcement
-- ============================================================================
-- Statement-level trigger validates balance AFTER all rows from the INSERT
-- statement are visible. This allows multi-line journal entries to be inserted
-- in a single statement and validated correctly.
CREATE OR REPLACE FUNCTION enforce_double_entry_balance_statement()
RETURNS TRIGGER AS $$
DECLARE
  journal_entry_id_val UUID;
  total_debit NUMERIC;
  total_credit NUMERIC;
  imbalance NUMERIC;
BEGIN
  -- For statement-level triggers, we validate balance for ALL journal entries
  -- that have lines. Since we're in a transaction, all inserts from the statement
  -- are visible. We only raise an error if an entry is actually imbalanced.
  FOR journal_entry_id_val IN 
    SELECT DISTINCT journal_entry_id
    FROM journal_entry_lines
  LOOP
    -- Calculate totals for all lines in this journal entry
    SELECT 
      COALESCE(SUM(debit), 0),
      COALESCE(SUM(credit), 0)
    INTO total_debit, total_credit
    FROM journal_entry_lines
    WHERE journal_entry_id = journal_entry_id_val;
    
    imbalance := ABS(total_debit - total_credit);
    
    -- Validate balance: Allow small rounding differences (0.01) but reject significant imbalances
    IF imbalance > 0.01 THEN
      RAISE EXCEPTION 'Journal entry is not balanced. Debit total: %, Credit total: %, Difference: %. Double-entry requires SUM(debit) = SUM(credit). Tip: Use post_journal_entry() function or insert all lines in a single INSERT statement.',
        total_debit, total_credit, imbalance;
    END IF;
  END LOOP;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create statement-level trigger
-- FOR EACH STATEMENT ensures trigger fires once after all rows are inserted
CREATE TRIGGER trigger_enforce_double_entry_balance
  AFTER INSERT ON journal_entry_lines
  FOR EACH STATEMENT
  EXECUTE FUNCTION enforce_double_entry_balance_statement();

COMMENT ON FUNCTION enforce_double_entry_balance_statement IS 
  'Statement-level trigger function that validates double-entry balance after all rows in an INSERT statement are inserted. Replaces broken row-level trigger. Works correctly with batch inserts from post_journal_entry().';

-- ============================================================================
-- STEP 3: Fix post_journal_entry() to use batch INSERT
-- ============================================================================
-- Drop all existing overloads first to avoid ambiguity
DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID) CASCADE;
DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID) CASCADE;
DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB) CASCADE;

-- Replace loop-based INSERT with single batch INSERT statement
-- This ensures all lines are inserted in one statement, so statement-level
-- trigger validates correctly after all lines exist.
CREATE OR REPLACE FUNCTION post_journal_entry(
  p_business_id UUID,
  p_date DATE,
  p_description TEXT,
  p_reference_type TEXT,
  p_reference_id UUID,
  p_lines JSONB,
  p_is_adjustment BOOLEAN DEFAULT FALSE,
  p_adjustment_reason TEXT DEFAULT NULL,
  p_adjustment_ref TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL,
  p_posted_by_accountant_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  journal_id UUID;
  line JSONB;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  account_id UUID;
  system_accountant_id UUID;
BEGIN
  -- PHASE 6: Validate adjustment metadata
  IF p_is_adjustment = TRUE THEN
    IF p_adjustment_reason IS NULL OR TRIM(p_adjustment_reason) = '' THEN
      RAISE EXCEPTION 'Adjustment entries require a non-empty adjustment_reason';
    END IF;
    IF p_reference_type != 'adjustment' THEN
      RAISE EXCEPTION 'Adjustment entries must have reference_type = ''adjustment''. Found: %', p_reference_type;
    END IF;
    IF p_reference_id IS NOT NULL THEN
      RAISE EXCEPTION 'Adjustment entries must have reference_id = NULL. Adjustments are standalone entries.';
    END IF;
  ELSE
    IF p_adjustment_reason IS NOT NULL OR p_adjustment_ref IS NOT NULL THEN
      RAISE EXCEPTION 'Non-adjustment entries cannot have adjustment_reason or adjustment_ref';
    END IF;
  END IF;

  -- PHASE 12: Backfill entries must have reason and actor
  IF p_entry_type = 'backfill' THEN
    IF p_backfill_reason IS NULL OR TRIM(p_backfill_reason) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_reason';
    END IF;
    IF p_backfill_actor IS NULL OR TRIM(p_backfill_actor) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_actor';
    END IF;
  END IF;

  -- Validate that debits equal credits BEFORE inserting
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    total_debit := total_debit + COALESCE((line->>'debit')::NUMERIC, 0);
    total_credit := total_credit + COALESCE((line->>'credit')::NUMERIC, 0);
  END LOOP;

  IF ABS(total_debit - total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry must balance. Debit: %, Credit: %', total_debit, total_credit;
  END IF;

  -- Get system accountant (for retail posting)
  IF p_posted_by_accountant_id IS NOT NULL THEN
    system_accountant_id := p_posted_by_accountant_id;
  ELSE
    -- Default to business owner as system accountant
    SELECT owner_id INTO system_accountant_id
    FROM businesses
    WHERE id = p_business_id;
    
    IF system_accountant_id IS NULL THEN
      RAISE EXCEPTION 'Cannot post journal entry: Business owner not found for business %. System accountant required for automatic posting.', p_business_id;
    END IF;
  END IF;

  -- Create journal entry
  INSERT INTO journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    created_by,
    is_adjustment,
    adjustment_reason,
    adjustment_ref,
    entry_type,
    backfill_reason,
    backfill_actor
  )
  VALUES (
    p_business_id,
    p_date,
    p_description,
    p_reference_type,
    p_reference_id,
    COALESCE(p_created_by, system_accountant_id),
    p_is_adjustment,
    p_adjustment_reason,
    p_adjustment_ref,
    p_entry_type,
    p_backfill_reason,
    p_backfill_actor
  )
  RETURNING id INTO journal_id;

  -- CRITICAL FIX: Insert ALL lines in a SINGLE batch INSERT statement
  -- This ensures statement-level trigger validates after all lines exist
  INSERT INTO journal_entry_lines (
    journal_entry_id,
    account_id,
    debit,
    credit,
    description
  )
  SELECT
    journal_id,
    (line->>'account_id')::UUID,
    COALESCE((line->>'debit')::NUMERIC, 0),
    COALESCE((line->>'credit')::NUMERIC, 0),
    line->>'description'
  FROM jsonb_array_elements(p_lines) AS line;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID) IS 
  'FIX: Posts journal entry with batch INSERT for all lines. Uses statement-level trigger for balance validation. Validates balance before inserting, then inserts all lines in single statement. Works correctly with multi-line entries.';

-- ============================================================================
-- STEP 4: Recreate 10-parameter wrapper (for backward compatibility)
-- ============================================================================
CREATE OR REPLACE FUNCTION post_journal_entry(
  p_business_id UUID,
  p_date DATE,
  p_description TEXT,
  p_reference_type TEXT,
  p_reference_id UUID,
  p_lines JSONB,
  p_is_adjustment BOOLEAN,
  p_adjustment_reason TEXT,
  p_adjustment_ref TEXT,
  p_created_by UUID
)
RETURNS UUID AS $$
BEGIN
  -- Call the 14-parameter version with explicit parameter names to avoid ambiguity
  -- Pass NULL for posted_by_accountant_id (will default to business owner)
  RETURN post_journal_entry(
    p_business_id => p_business_id,
    p_date => p_date,
    p_description => p_description,
    p_reference_type => p_reference_type,
    p_reference_id => p_reference_id,
    p_lines => p_lines,
    p_is_adjustment => p_is_adjustment,
    p_adjustment_reason => p_adjustment_reason,
    p_adjustment_ref => p_adjustment_ref,
    p_created_by => p_created_by,
    p_entry_type => NULL::TEXT,
    p_backfill_reason => NULL::TEXT,
    p_backfill_actor => NULL::TEXT,
    p_posted_by_accountant_id => NULL::UUID
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID) IS 
  'Backward compatibility wrapper for 10-parameter post_journal_entry. Calls 14-parameter version with trailing NULLs.';
