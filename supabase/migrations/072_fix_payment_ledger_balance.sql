-- ============================================================================
-- MIGRATION: Fix payment ledger balance issue
-- ============================================================================
-- This migration fixes the issue where payment journal entries are unbalanced.
-- The problem occurs when account IDs are NULL or payment amounts are incorrect.
-- We add validation to ensure:
-- 1. Account IDs exist before creating journal entries
-- 2. Payment amount is properly validated
-- 3. Better error messages for debugging
-- ============================================================================

-- ============================================================================
-- FUNCTION: Post payment to ledger (updated with validation)
-- ============================================================================
CREATE OR REPLACE FUNCTION post_payment_to_ledger(p_payment_id UUID)
RETURNS UUID AS $$
DECLARE
  payment_record RECORD;
  invoice_record RECORD;
  business_id_val UUID;
  ar_account_id UUID;
  cash_account_id UUID;
  bank_account_id UUID;
  momo_account_id UUID;
  journal_id UUID;
  asset_account_id UUID;
  payment_amount NUMERIC;
BEGIN
  -- Get payment details
  SELECT 
    p.business_id,
    p.invoice_id,
    p.amount,
    p.method,
    p.date
  INTO payment_record
  FROM payments p
  WHERE p.id = p_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found: %', p_payment_id;
  END IF;

  -- Validate payment amount
  payment_amount := COALESCE(payment_record.amount, 0);
  IF payment_amount <= 0 OR payment_amount IS NULL THEN
    RAISE EXCEPTION 'Invalid payment amount: %. Payment ID: %', payment_amount, p_payment_id;
  END IF;

  -- Get invoice details
  SELECT invoice_number, total INTO invoice_record
  FROM invoices
  WHERE id = payment_record.invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found for payment: %. Invoice ID: %', p_payment_id, payment_record.invoice_id;
  END IF;

  business_id_val := payment_record.business_id;

  -- Validate business_id
  IF business_id_val IS NULL THEN
    RAISE EXCEPTION 'Business ID is NULL for payment: %', p_payment_id;
  END IF;

  -- Get account IDs
  ar_account_id := get_account_by_code(business_id_val, '1100');
  cash_account_id := get_account_by_code(business_id_val, '1000');
  bank_account_id := get_account_by_code(business_id_val, '1010');
  momo_account_id := get_account_by_code(business_id_val, '1020');

  -- Validate AR account exists
  IF ar_account_id IS NULL THEN
    RAISE EXCEPTION 'AR account (1100) not found for business: %. Payment ID: %', business_id_val, p_payment_id;
  END IF;

  -- Determine asset account based on payment method
  CASE payment_record.method
    WHEN 'cash' THEN asset_account_id := cash_account_id;
    WHEN 'bank' THEN asset_account_id := bank_account_id;
    WHEN 'momo' THEN asset_account_id := momo_account_id;
    ELSE asset_account_id := cash_account_id; -- Default to cash
  END CASE;

  -- Validate asset account exists
  IF asset_account_id IS NULL THEN
    RAISE EXCEPTION 'Asset account for method "%" not found for business: %. Payment ID: %. Cash: %, Bank: %, MoMo: %', 
      payment_record.method, business_id_val, p_payment_id, cash_account_id, bank_account_id, momo_account_id;
  END IF;

  -- Post journal entry with validated amounts
  SELECT post_journal_entry(
    business_id_val,
    payment_record.date,
    'Payment for Invoice #' || invoice_record.invoice_number,
    'payment',
    p_payment_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', asset_account_id,
        'debit', payment_amount,
        'description', 'Payment received'
      ),
      jsonb_build_object(
        'account_id', ar_account_id,
        'credit', payment_amount,
        'description', 'Reduce receivable'
      )
    )
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;



















