-- ============================================================================
-- Migration 185: Fix Ledger Balance Enforcement - Statement-Level Trigger
-- ============================================================================
-- FIX: Replace row-level trigger with statement-level trigger
-- 
-- Root Cause: Row-level AFTER INSERT trigger validates balance after EACH
-- row insert, making multi-line journal entries impossible. First line creates
-- imbalance, trigger fires, transaction aborts before subsequent lines insert.
-- 
-- Solution: Statement-level trigger validates balance AFTER all rows in the
-- statement are inserted, allowing multi-line balanced entries.
-- ============================================================================

-- Drop the existing row-level trigger
DROP TRIGGER IF EXISTS trigger_enforce_double_entry_balance ON journal_entry_lines;

-- Create new statement-level trigger function
-- Statement-level trigger validates balance AFTER all rows in the INSERT statement are inserted
CREATE OR REPLACE FUNCTION enforce_double_entry_balance_statement()
RETURNS TRIGGER AS $$
DECLARE
  journal_entry_id_val UUID;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  imbalance NUMERIC;
BEGIN
  -- For statement-level triggers, validate balance for all journal entries
  -- that have lines. Since we're in a transaction, all inserts from the statement
  -- are visible. We only raise an error if an entry is actually imbalanced.
  FOR journal_entry_id_val IN 
    SELECT DISTINCT journal_entry_id
    FROM journal_entry_lines
  LOOP
    -- Calculate totals for all lines in this journal entry
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
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
CREATE TRIGGER trigger_enforce_double_entry_balance
  AFTER INSERT ON journal_entry_lines
  FOR EACH STATEMENT
  EXECUTE FUNCTION enforce_double_entry_balance_statement();

COMMENT ON FUNCTION enforce_double_entry_balance_statement() IS 
'Statement-level trigger function that validates double-entry balance after all rows in an INSERT statement are inserted. Replaces row-level trigger that was blocking multi-line journal entries.';
