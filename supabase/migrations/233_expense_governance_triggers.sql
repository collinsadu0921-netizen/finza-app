-- ============================================================================
-- Expense governance: freeze after posting + closed-period immutability
-- ============================================================================
-- STEP 1: Posted expenses are immutable (no UPDATE/DELETE once JE exists).
-- STEP 2: Expenses in closed/locked period cannot be inserted/updated/deleted.
-- No ledger changes. No soft deletes. Document-layer only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- BEFORE UPDATE OR DELETE: block if posted; else block if period closed/locked
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_expense_immutable_after_posting()
RETURNS TRIGGER AS $$
BEGIN
  -- Block if expense has any journal entry (posted)
  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE reference_type = 'expense' AND reference_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Posted expenses are immutable. Create a correcting expense or adjustment.';
  END IF;

  -- Block if expense date falls in closed or locked period
  BEGIN
    PERFORM assert_accounting_period_is_open(OLD.business_id, OLD.date);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Cannot modify expenses in a closed or locked accounting period.';
  END;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- BEFORE INSERT: block if expense date in closed or locked period
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_expense_period_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  BEGIN
    PERFORM assert_accounting_period_is_open(NEW.business_id, NEW.date);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Cannot modify expenses in a closed or locked accounting period.';
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Triggers
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS guard_expense_immutable ON expenses;
CREATE TRIGGER guard_expense_immutable
  BEFORE UPDATE OR DELETE ON expenses
  FOR EACH ROW
  EXECUTE FUNCTION guard_expense_immutable_after_posting();

DROP TRIGGER IF EXISTS guard_expense_period_insert ON expenses;
CREATE TRIGGER guard_expense_period_insert
  BEFORE INSERT ON expenses
  FOR EACH ROW
  EXECUTE FUNCTION guard_expense_period_on_insert();

COMMENT ON FUNCTION guard_expense_immutable_after_posting IS
  'Blocks UPDATE/DELETE on expenses that have a journal entry (posted). Blocks UPDATE/DELETE when expense date is in closed/locked period.';
COMMENT ON FUNCTION guard_expense_period_on_insert IS
  'Blocks INSERT when expense date is in closed or locked accounting period.';
