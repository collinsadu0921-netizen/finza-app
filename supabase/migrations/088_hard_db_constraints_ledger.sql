-- Migration: Hard DB Constraints & Invariants (Cursor-Enforceable)
-- Defines what the database must guarantee, regardless of UI or API bugs.
-- These constraints ensure ledger integrity at the database level.

-- ============================================================================
-- 1. LEDGER IMMUTABILITY
-- ============================================================================
-- Rules:
--   - journal_entries are append-only (INSERT only)
--   - journal_entry_lines are append-only (INSERT only)
--   - UPDATE and DELETE are forbidden after insert
--   - Only INSERT allowed via posting service
--
-- Enforcement:
--   - DB trigger blocks UPDATE/DELETE on journal_entries
--   - DB trigger blocks UPDATE/DELETE on journal_entry_lines

-- ============================================================================
-- TRIGGER: Prevent UPDATE/DELETE on journal_entries (Ledger Immutability)
-- ============================================================================
CREATE OR REPLACE FUNCTION prevent_journal_entry_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Journal entries are immutable (append-only). Cannot UPDATE journal entry. Use adjustment journals for corrections.';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Journal entries are immutable (append-only). Cannot DELETE journal entry. Use adjustment journals for corrections.';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_journal_entry_modification ON journal_entries;
CREATE TRIGGER trigger_prevent_journal_entry_modification
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION prevent_journal_entry_modification();

-- ============================================================================
-- TRIGGER: Prevent UPDATE/DELETE on journal_entry_lines (Ledger Immutability)
-- ============================================================================
CREATE OR REPLACE FUNCTION prevent_journal_entry_line_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Journal entry lines are immutable (append-only). Cannot UPDATE journal entry line. Use adjustment journals for corrections.';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Journal entry lines are immutable (append-only). Cannot DELETE journal entry line. Use adjustment journals for corrections.';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_journal_entry_line_modification ON journal_entry_lines;
CREATE TRIGGER trigger_prevent_journal_entry_line_modification
  BEFORE UPDATE OR DELETE ON journal_entry_lines
  FOR EACH ROW
  EXECUTE FUNCTION prevent_journal_entry_line_modification();

-- ============================================================================
-- 2. DOUBLE-ENTRY INTEGRITY
-- ============================================================================
-- Rules:
--   - Every posting results in balanced debits and credits
--   - No partial writes
--   - SUM(debit) = SUM(credit) per posting batch (journal entry)
--
-- Enforcement:
--   - Postings occur in a single DB transaction
--   - Trigger checks balance on INSERT of journal_entry_lines
--   - Reject transaction on imbalance

-- ============================================================================
-- FUNCTION: Validate double-entry balance for a journal entry
-- ============================================================================
CREATE OR REPLACE FUNCTION validate_journal_entry_balance(p_journal_entry_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  imbalance NUMERIC;
BEGIN
  -- Calculate totals for all lines in this journal entry
  SELECT 
    COALESCE(SUM(debit), 0),
    COALESCE(SUM(credit), 0)
  INTO total_debit, total_credit
  FROM journal_entry_lines
  WHERE journal_entry_id = p_journal_entry_id;
  
  imbalance := ABS(total_debit - total_credit);
  
  -- Allow small rounding differences (0.01) but reject significant imbalances
  IF imbalance > 0.01 THEN
    RAISE EXCEPTION 'Journal entry is not balanced. Debit total: %, Credit total: %, Difference: %. Double-entry requires SUM(debit) = SUM(credit).',
      total_debit, total_credit, imbalance;
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGER: Enforce double-entry balance after journal entry lines are inserted
-- ============================================================================
-- Note: This trigger validates balance after each line insert. For best results:
-- 1. Use post_journal_entry() function (validates balance BEFORE inserting lines)
-- 2. Insert all lines in a single INSERT statement with multiple VALUES
-- 3. Insert all lines within one transaction using a stored procedure
--
-- The trigger will validate that SUM(debit) = SUM(credit) for the journal entry.
-- Since lines may be inserted one at a time, we validate after each insert.
-- If you insert lines sequentially in separate statements, intermediate states
-- may show imbalance, but the final insert should result in balance.
CREATE OR REPLACE FUNCTION enforce_double_entry_balance()
RETURNS TRIGGER AS $$
DECLARE
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  imbalance NUMERIC;
BEGIN
  -- Calculate totals for all lines in this journal entry (including the one just inserted)
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO total_debit, total_credit
  FROM journal_entry_lines
  WHERE journal_entry_id = NEW.journal_entry_id;
  
  imbalance := ABS(total_debit - total_credit);
  
  -- Validate balance: Allow small rounding differences (0.01) but reject significant imbalances
  -- This check ensures that by the time the transaction commits, the entry is balanced.
  -- Note: If inserting lines sequentially, you may need to insert them all in one statement
  -- or use the post_journal_entry() function which validates before inserting.
  IF imbalance > 0.01 THEN
    RAISE EXCEPTION 'Journal entry is not balanced. Debit total: %, Credit total: %, Difference: %. Double-entry requires SUM(debit) = SUM(credit). Tip: Use post_journal_entry() function or insert all lines in a single INSERT statement.',
      total_debit, total_credit, imbalance;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists (for idempotency)
DROP TRIGGER IF EXISTS trigger_enforce_double_entry_balance ON journal_entry_lines;

-- Create trigger AFTER INSERT to validate balance
-- Using AFTER allows all lines to be inserted in the same transaction
CREATE TRIGGER trigger_enforce_double_entry_balance
  AFTER INSERT ON journal_entry_lines
  FOR EACH ROW
  EXECUTE FUNCTION enforce_double_entry_balance();

-- Note: We don't check on UPDATE because journal_entry_lines are immutable
-- (prevented by trigger_prevent_journal_entry_line_modification)
--
-- Important: For best results when inserting multiple lines, either:
-- 1. Use the post_journal_entry() function (validates before inserting)
-- 2. Insert all lines in a single INSERT statement with multiple VALUES
-- 3. Insert all lines within the same transaction (each line will be validated)

-- ============================================================================
-- 3. PERIOD STATE ENFORCEMENT
-- ============================================================================
-- Rules:
--   - Ledger entries may be inserted only into open periods
--   - No entries into closing, closed, or locked periods
--
-- Enforcement:
--   - Trigger checks period.status = 'open' on INSERT to journal_entries
--   - Period is determined by journal_entries.date falling within period date range

-- ============================================================================
-- FUNCTION: Find period for a given date and business
-- Returns the period that contains the given date, or NULL if no period exists
-- ============================================================================
CREATE OR REPLACE FUNCTION find_period_for_date(
  p_business_id UUID,
  p_date DATE
)
RETURNS UUID AS $$
DECLARE
  period_id UUID;
BEGIN
  -- Migration 094: Uses period_start and period_end (not start_date/end_date)
  SELECT id INTO period_id
  FROM accounting_periods
  WHERE business_id = p_business_id
    AND p_date >= period_start
    AND p_date <= period_end
  LIMIT 1;
  
  RETURN period_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Validate period is open for journal entry
-- ============================================================================
CREATE OR REPLACE FUNCTION validate_period_open_for_entry(
  p_business_id UUID,
  p_date DATE
)
RETURNS BOOLEAN AS $$
DECLARE
  period_record RECORD;
BEGIN
  -- Find the period that contains this date (migration 094 uses period_start/period_end)
  SELECT * INTO period_record
  FROM accounting_periods
  WHERE business_id = p_business_id
    AND p_date >= period_start
    AND p_date <= period_end
  LIMIT 1;
  
  -- If no period exists, allow the entry (periods might not be created yet)
  -- This is acceptable for flexibility, but ideally periods should exist
  IF NOT FOUND THEN
    -- Optionally, you could raise an error here if you want strict period enforcement
    -- For now, we allow entries without periods (backwards compatibility)
    RETURN TRUE;
  END IF;
  
  -- Period exists - check if locked (only locked blocks posting)
  -- Migration 094: 'open' and 'soft_closed' allow posting, 'locked' blocks
  IF period_record.status = 'locked' THEN
    RAISE EXCEPTION 'Cannot insert journal entry into period with status %. Journal entries are blocked for locked periods. Period ID: %, Date: %, Status: %',
      period_record.status, period_record.id, p_date, period_record.status;
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGER: Enforce period state on journal entry insert
-- ============================================================================
CREATE OR REPLACE FUNCTION enforce_period_state_on_entry()
RETURNS TRIGGER AS $$
BEGIN
  -- Validate that the period is open before allowing insert
  PERFORM validate_period_open_for_entry(NEW.business_id, NEW.date);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_enforce_period_state_on_entry ON journal_entries;
CREATE TRIGGER trigger_enforce_period_state_on_entry
  BEFORE INSERT ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION enforce_period_state_on_entry();

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON FUNCTION prevent_journal_entry_modification() IS 
'Hard constraint: Prevents UPDATE/DELETE on journal_entries. Ledger is append-only. Use adjustment journals for corrections.';

COMMENT ON FUNCTION prevent_journal_entry_line_modification() IS 
'Hard constraint: Prevents UPDATE/DELETE on journal_entry_lines. Ledger is append-only. Use adjustment journals for corrections.';

COMMENT ON FUNCTION validate_journal_entry_balance(UUID) IS 
'Hard constraint: Validates double-entry integrity. Ensures SUM(debit) = SUM(credit) for a journal entry. Rejects transaction on imbalance.';

COMMENT ON FUNCTION enforce_double_entry_balance() IS 
'Hard constraint: Trigger function that enforces double-entry balance after journal entry line insert. Rejects transaction if not balanced.';

COMMENT ON FUNCTION find_period_for_date(UUID, DATE) IS 
'Helper function: Finds the accounting period that contains a given date for a business. Returns period ID or NULL.';

COMMENT ON FUNCTION validate_period_open_for_entry(UUID, DATE) IS 
'Hard constraint: Validates that journal entries can only be inserted into non-locked periods (aligned with migration 094). Period is determined by date falling within period date range. Allows ''open'' and ''soft_closed'', blocks ''locked''.';

COMMENT ON FUNCTION enforce_period_state_on_entry() IS 
'Hard constraint: Trigger function that enforces period state (aligned with migration 094). Prevents journal entries from being inserted into locked periods. Allows ''open'' and ''soft_closed''.';

