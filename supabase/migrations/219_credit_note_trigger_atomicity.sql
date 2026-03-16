-- Credit note trigger must not swallow period enforcement or other posting errors.
-- The current definition in 043_accounting_core.sql already has no EXCEPTION block;
-- this migration re-states it explicitly so failures in post_credit_note_to_ledger
-- (e.g. assert_accounting_period_is_open for LOCKED/SOFT_CLOSED) abort the transaction
-- and the UPDATE to status = 'applied' is rolled back. No "credit note row applied
-- without journal entry".
--
-- Active trigger definition: 043_accounting_core.sql:979–994 (unchanged behavior).

CREATE OR REPLACE FUNCTION trigger_post_credit_note()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'applied' AND (OLD.status IS NULL OR OLD.status != 'applied') THEN
    IF NOT EXISTS (
      SELECT 1 FROM journal_entries
      WHERE reference_type = 'credit_note'
        AND reference_id = NEW.id
    ) THEN
      PERFORM post_credit_note_to_ledger(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
