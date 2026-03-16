-- Migration: Fix Invoice Status Sync with Payments/Credits
-- Ensures invoice status is always derived from ledger reality (payments + credit notes)
-- Ledger data is the source of truth, status is DERIVED

-- ============================================================================
-- FUNCTION: Centralized Invoice Status Recalculation
-- ============================================================================
-- This function recalculates invoice status based on actual payments and credit notes
-- Ledger reality (payments + credits) is the source of truth
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
  -- Get invoice details
  SELECT id, total, status, due_date, paid_at INTO invoice_record
  FROM invoices
  WHERE id = p_invoice_id
    AND deleted_at IS NULL;

  -- If invoice doesn't exist or is deleted, exit
  IF invoice_record IS NULL THEN
    RETURN;
  END IF;

  -- Sum all payments (excluding deleted)
  SELECT COALESCE(SUM(amount), 0) INTO total_paid
  FROM payments
  WHERE invoice_id = p_invoice_id
    AND deleted_at IS NULL;

  -- Sum all applied credit notes (excluding deleted)
  SELECT COALESCE(SUM(total), 0) INTO total_credits
  FROM credit_notes
  WHERE invoice_id = p_invoice_id
    AND status = 'applied'
    AND deleted_at IS NULL;

  -- Calculate outstanding amount (ledger reality)
  outstanding_amount := invoice_record.total - total_paid - total_credits;

  -- Determine status based on ledger reality
  -- CRITICAL: Status is DERIVED from financial state, never authoritative
  IF outstanding_amount <= 0 THEN
    -- Fully paid: outstanding_amount <= 0
    new_status := 'paid';
  ELSIF total_paid > 0 OR total_credits > 0 THEN
    -- Partially paid: has payments/credits but still outstanding
    new_status := 'partially_paid';
  ELSE
    -- Unpaid: no payments or credits
    new_status := 'sent';
  END IF;

  -- Check if overdue (only for unpaid/partial invoices)
  invoice_due_date := invoice_record.due_date;
  IF new_status != 'paid' AND invoice_due_date IS NOT NULL THEN
    IF CURRENT_DATE > invoice_due_date THEN
      new_status := 'overdue';
    END IF;
  END IF;

  -- Update invoice status ONLY if it changed
  -- This prevents unnecessary updates and audit log noise
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

-- ============================================================================
-- FUNCTION: Update Invoice Status (Trigger Function for Payments)
-- ============================================================================
-- Wrapper function that calls the centralized recalculation
CREATE OR REPLACE FUNCTION update_invoice_status_with_credits()
RETURNS TRIGGER AS $$
BEGIN
  -- Call centralized recalculation function
  PERFORM recalculate_invoice_status(NEW.invoice_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Update Invoice Status on Payment Delete
-- ============================================================================
-- Handles payment deletion (soft delete via deleted_at)
CREATE OR REPLACE FUNCTION update_invoice_status_on_payment_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- When a payment is deleted (soft delete), recalculate status
  -- OLD.invoice_id is the invoice that had the payment
  PERFORM recalculate_invoice_status(OLD.invoice_id);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Update Invoice Status on Credit Note Change
-- ============================================================================
CREATE OR REPLACE FUNCTION update_invoice_status_on_credit_note()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger when status changes to/from 'applied'
  IF (NEW.status = 'applied' AND (OLD.status IS NULL OR OLD.status != 'applied')) OR
     (OLD.status = 'applied' AND (NEW.status IS NULL OR NEW.status != 'applied')) THEN
    PERFORM recalculate_invoice_status(NEW.invoice_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Update Invoice Status on Credit Note Delete
-- ============================================================================
CREATE OR REPLACE FUNCTION update_invoice_status_on_credit_note_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- When a credit note is deleted (soft delete), recalculate status
  IF OLD.status = 'applied' THEN
    PERFORM recalculate_invoice_status(OLD.invoice_id);
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS: Payment Events
-- ============================================================================

-- Trigger on payment INSERT/UPDATE (when not deleted)
DROP TRIGGER IF EXISTS trigger_update_invoice_status ON payments;
CREATE TRIGGER trigger_update_invoice_status
  AFTER INSERT OR UPDATE ON payments
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NULL)
  EXECUTE FUNCTION update_invoice_status_with_credits();

-- Trigger on payment DELETE (soft delete via deleted_at)
DROP TRIGGER IF EXISTS trigger_update_invoice_status_on_delete ON payments;
CREATE TRIGGER trigger_update_invoice_status_on_delete
  AFTER UPDATE OF deleted_at ON payments
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION update_invoice_status_on_payment_delete();

-- ============================================================================
-- TRIGGERS: Credit Note Events
-- ============================================================================

-- Trigger on credit note status change
DROP TRIGGER IF EXISTS trigger_update_invoice_on_credit_note ON credit_notes;
CREATE TRIGGER trigger_update_invoice_on_credit_note
  AFTER UPDATE OF status ON credit_notes
  FOR EACH ROW
  WHEN (NEW.status = 'applied' OR OLD.status = 'applied')
  EXECUTE FUNCTION update_invoice_status_on_credit_note();

-- Trigger on credit note DELETE (soft delete)
DROP TRIGGER IF EXISTS trigger_update_invoice_on_credit_note_delete ON credit_notes;
CREATE TRIGGER trigger_update_invoice_on_credit_note_delete
  AFTER UPDATE OF deleted_at ON credit_notes
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND OLD.status = 'applied')
  EXECUTE FUNCTION update_invoice_status_on_credit_note_delete();

-- ============================================================================
-- ONE-TIME DATA REPAIR: Fix Existing Invoices
-- ============================================================================
-- For each invoice where status suggests unpaid but ledger says paid
-- Update status to match ledger reality

DO $$
DECLARE
  invoice_record RECORD;
  total_paid NUMERIC;
  total_credits NUMERIC;
  outstanding_amount NUMERIC;
  new_status TEXT;
  fixed_count INTEGER := 0;
BEGIN
  -- Process invoices that might be out of sync
  -- Focus on invoices with status 'sent', 'partially_paid', 'overdue'
  -- that might actually be fully paid
  FOR invoice_record IN
    SELECT id, invoice_number, total, status, due_date, paid_at
    FROM invoices
    WHERE deleted_at IS NULL
      AND status IN ('sent', 'partially_paid', 'overdue')
  LOOP
    -- Calculate actual outstanding amount
    SELECT COALESCE(SUM(amount), 0) INTO total_paid
    FROM payments
    WHERE invoice_id = invoice_record.id
      AND deleted_at IS NULL;

    SELECT COALESCE(SUM(total), 0) INTO total_credits
    FROM credit_notes
    WHERE invoice_id = invoice_record.id
      AND status = 'applied'
      AND deleted_at IS NULL;

    outstanding_amount := invoice_record.total - total_paid - total_credits;

    -- Determine correct status
    IF outstanding_amount <= 0 THEN
      new_status := 'paid';
    ELSIF total_paid > 0 OR total_credits > 0 THEN
      new_status := 'partially_paid';
    ELSE
      new_status := 'sent';
    END IF;

    -- Check overdue
    IF new_status != 'paid' AND invoice_record.due_date IS NOT NULL THEN
      IF CURRENT_DATE > invoice_record.due_date THEN
        new_status := 'overdue';
      END IF;
    END IF;

    -- Update if status is wrong
    IF invoice_record.status != new_status THEN
      UPDATE invoices
      SET 
        status = new_status,
        paid_at = CASE 
          WHEN new_status = 'paid' AND invoice_record.paid_at IS NULL THEN NOW()
          ELSE invoice_record.paid_at
        END,
        updated_at = NOW()
      WHERE id = invoice_record.id;

      fixed_count := fixed_count + 1;
      
      -- Log the fix (optional, can be removed if too verbose)
      RAISE NOTICE 'Fixed invoice %: % -> % (outstanding: %)', 
        invoice_record.invoice_number, 
        invoice_record.status, 
        new_status, 
        outstanding_amount;
    END IF;
  END LOOP;

  RAISE NOTICE 'Invoice status repair complete. Fixed % invoices.', fixed_count;
END $$;

-- ============================================================================
-- COMMENT: Document the rule
-- ============================================================================
COMMENT ON FUNCTION recalculate_invoice_status(UUID) IS 
'Recalculates invoice status based on ledger reality (payments + credit notes). 
Ledger data is the source of truth, status is DERIVED. 
Status rules:
- outstanding_amount <= 0 → paid
- payments/credits > 0 AND outstanding_amount > 0 → partially_paid
- no payments/credits → sent
- unpaid AND due_date < today → overdue';



