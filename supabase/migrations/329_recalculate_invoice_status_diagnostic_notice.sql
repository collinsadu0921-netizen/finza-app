-- ============================================================================
-- Migration 329: Diagnostic — RAISE NOTICE in recalculate_invoice_status (temporary)
-- ============================================================================
-- Add a NOTICE to confirm the function runs and to log old_status, new_status,
-- total_paid, total_credits after a payment reversal. Check Supabase Dashboard
-- → Logs → Postgres for the output.
-- Remove this NOTICE (or revert the function to previous version) after debugging.
-- ============================================================================

CREATE OR REPLACE FUNCTION recalculate_invoice_status(p_invoice_id UUID)
RETURNS void AS $$
DECLARE
  invoice_record RECORD;
  total_paid NUMERIC := 0;
  total_credits NUMERIC := 0;
  outstanding_amount NUMERIC;
  new_status TEXT;
  invoice_due_date DATE;
BEGIN
  SELECT id, total, status, due_date, paid_at INTO invoice_record
  FROM invoices
  WHERE id = p_invoice_id
    AND deleted_at IS NULL;

  IF invoice_record IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO total_paid
  FROM payments
  WHERE invoice_id = p_invoice_id
    AND deleted_at IS NULL;

  SELECT COALESCE(SUM(total), 0) INTO total_credits
  FROM credit_notes
  WHERE invoice_id = p_invoice_id
    AND status = 'applied'
    AND deleted_at IS NULL;

  outstanding_amount := invoice_record.total - total_paid - total_credits;

  IF outstanding_amount <= 0 THEN
    new_status := 'paid';
  ELSIF total_paid > 0 OR total_credits > 0 THEN
    new_status := 'partially_paid';
  ELSE
    new_status := 'sent';
  END IF;

  invoice_due_date := invoice_record.due_date;
  IF new_status != 'paid' AND invoice_due_date IS NOT NULL THEN
    IF CURRENT_DATE > invoice_due_date THEN
      new_status := 'overdue';
    END IF;
  END IF;

  -- Diagnostic: log so we can confirm function ran and what it saw (Supabase Logs → Postgres)
  RAISE NOTICE 'recalculate_invoice_status: invoice=% old_status=% new_status=% total_paid=% total_credits=%',
    p_invoice_id,
    invoice_record.status,
    new_status,
    total_paid,
    total_credits;

  IF invoice_record.status != new_status THEN
    UPDATE invoices
    SET 
      status = new_status,
      paid_at = CASE 
        WHEN new_status = 'paid' AND invoice_record.paid_at IS NULL THEN NOW()
        ELSE invoice_record.paid_at
      END,
      updated_at = NOW()
    WHERE id = p_invoice_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION recalculate_invoice_status(UUID) IS
'Recalculates invoice status from payments + credit notes. Migration 329 adds temporary RAISE NOTICE for reversal debugging; remove after confirming.';
