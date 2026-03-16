-- Payment trigger must not swallow period enforcement or other posting errors.
-- Migrations 073/075 wrapped post_payment_to_ledger in EXCEPTION WHEN OTHERS and RAISE WARNING,
-- allowing the payment row to commit when ledger posting failed (e.g. LOCKED/SOFT_CLOSED period).
-- This migration restores fail-fast: any exception from post_payment_to_ledger propagates and
-- aborts the transaction, so the INSERT into payments is rolled back.
--
-- Active trigger definition before this change: 075_fix_payment_ledger_final.sql lines 10–31.

CREATE OR REPLACE FUNCTION trigger_post_payment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deleted_at IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM journal_entries
      WHERE reference_type = 'payment'
        AND reference_id = NEW.id
    ) THEN
      PERFORM post_payment_to_ledger(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
