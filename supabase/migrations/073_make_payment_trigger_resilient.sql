-- ============================================================================
-- MIGRATION: Make payment trigger resilient to journal entry failures
-- ============================================================================
-- This migration updates the payment trigger to catch and log errors
-- when creating journal entries, so that payment creation doesn't fail
-- if journal entry creation fails. This allows us to debug the issue
-- without blocking payment creation.
-- ============================================================================

-- ============================================================================
-- FUNCTION: Trigger to post payment (updated with error handling)
-- ============================================================================
CREATE OR REPLACE FUNCTION trigger_post_payment()
RETURNS TRIGGER AS $$
DECLARE
  journal_entry_error TEXT;
BEGIN
  IF NEW.deleted_at IS NULL THEN
    -- Check if already posted
    IF NOT EXISTS (
      SELECT 1 FROM journal_entries 
      WHERE reference_type = 'payment' 
        AND reference_id = NEW.id
    ) THEN
      BEGIN
        PERFORM post_payment_to_ledger(NEW.id);
      EXCEPTION WHEN OTHERS THEN
        -- Log the error but don't fail the payment insert
        -- In production, you might want to use a logging table instead
        RAISE WARNING 'Failed to create journal entry for payment %: %', NEW.id, SQLERRM;
        -- Optionally, you could insert into an error log table here
        -- INSERT INTO journal_entry_errors (payment_id, error_message) 
        -- VALUES (NEW.id, SQLERRM);
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;



















