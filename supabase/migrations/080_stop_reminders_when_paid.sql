-- Migration: Stop Reminders When Invoice is Fully Paid
-- Updates next_reminder_date to NULL when invoice becomes fully paid

-- ============================================================================
-- FUNCTION: Clear next reminder date when invoice is fully paid
-- ============================================================================

CREATE OR REPLACE FUNCTION clear_reminders_when_paid()
RETURNS TRIGGER AS $$
DECLARE
  invoice_total NUMERIC;
  total_paid NUMERIC := 0;
  total_credits NUMERIC := 0;
  outstanding_amount NUMERIC;
BEGIN
  -- Get invoice total
  SELECT total INTO invoice_total
  FROM invoices
  WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id)
    AND deleted_at IS NULL;

  IF invoice_total IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Sum all payments
  SELECT COALESCE(SUM(amount), 0) INTO total_paid
  FROM payments
  WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id)
    AND deleted_at IS NULL;

  -- Sum all applied credit notes
  SELECT COALESCE(SUM(total), 0) INTO total_credits
  FROM credit_notes
  WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id)
    AND status = 'applied'
    AND deleted_at IS NULL;

  -- Calculate outstanding amount
  outstanding_amount := invoice_total - total_paid - total_credits;

  -- If invoice is fully paid (outstanding <= 0), clear next reminder date
  IF outstanding_amount <= 0 THEN
    UPDATE invoice_reminders
    SET next_reminder_date = NULL
    WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id)
      AND next_reminder_date IS NOT NULL;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS: Clear reminders when payments or credit notes are added
-- ============================================================================

-- Trigger when payment is added/updated/deleted
DROP TRIGGER IF EXISTS trigger_clear_reminders_on_payment ON payments;
CREATE TRIGGER trigger_clear_reminders_on_payment
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW
  WHEN (COALESCE(NEW.invoice_id, OLD.invoice_id) IS NOT NULL)
  EXECUTE FUNCTION clear_reminders_when_paid();

-- Trigger when credit note is applied/updated
DROP TRIGGER IF EXISTS trigger_clear_reminders_on_credit_note ON credit_notes;
CREATE TRIGGER trigger_clear_reminders_on_credit_note
  AFTER INSERT OR UPDATE ON credit_notes
  FOR EACH ROW
  WHEN (NEW.status = 'applied' AND NEW.invoice_id IS NOT NULL)
  EXECUTE FUNCTION clear_reminders_when_paid();













