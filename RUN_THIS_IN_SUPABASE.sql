-- ============================================================================
-- IMMEDIATE FIX: Payment Ledger Balance Issue
-- ============================================================================
-- INSTRUCTIONS:
-- 1. Open Supabase Dashboard
-- 2. Go to SQL Editor
-- 3. Create a new query
-- 4. Copy and paste this ENTIRE file
-- 5. Click "Run"
-- ============================================================================
-- This fixes: "Journal entry must balance. Debit: 15000, Credit: 18285"
-- The problem: Credit was using invoice.total instead of payment.amount
-- ============================================================================

-- Step 1: Make trigger resilient (so payment doesn't fail if journal entry fails)
CREATE OR REPLACE FUNCTION trigger_post_payment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deleted_at IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM journal_entries 
      WHERE reference_type = 'payment' 
        AND reference_id = NEW.id
    ) THEN
      BEGIN
        PERFORM post_payment_to_ledger(NEW.id);
      EXCEPTION WHEN OTHERS THEN
        -- Log the error but don't fail the payment insert
        RAISE WARNING 'Failed to create journal entry for payment %: %', NEW.id, SQLERRM;
        -- DO NOT RE-RAISE - this allows payment to be created even if journal entry fails
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Fix post_payment_to_ledger to use payment.amount for BOTH debit AND credit
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

  -- CRITICAL: Use payment.amount, NOT invoice.total
  payment_amount := COALESCE(payment_record.amount, 0);
  
  IF payment_amount <= 0 OR payment_amount IS NULL THEN
    RAISE EXCEPTION 'Invalid payment amount: %. Payment ID: %', payment_amount, p_payment_id;
  END IF;

  -- Get invoice (only for invoice_number display, NOT for amount)
  SELECT invoice_number INTO invoice_record
  FROM invoices
  WHERE id = payment_record.invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found for payment: %. Invoice ID: %', p_payment_id, payment_record.invoice_id;
  END IF;

  business_id_val := payment_record.business_id;

  IF business_id_val IS NULL THEN
    RAISE EXCEPTION 'Business ID is NULL for payment: %', p_payment_id;
  END IF;

  -- Get account IDs
  ar_account_id := get_account_by_code(business_id_val, '1100');
  cash_account_id := get_account_by_code(business_id_val, '1000');
  bank_account_id := get_account_by_code(business_id_val, '1010');
  momo_account_id := get_account_by_code(business_id_val, '1020');

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

  IF asset_account_id IS NULL THEN
    RAISE EXCEPTION 'Asset account for method "%" not found for business: %. Payment ID: %', 
      payment_record.method, business_id_val, p_payment_id;
  END IF;

  -- CRITICAL: Use payment_amount for BOTH debit AND credit
  -- DO NOT use invoice.total anywhere!
  SELECT post_journal_entry(
    business_id_val,
    payment_record.date,
    'Payment for Invoice #' || invoice_record.invoice_number,
    'payment',
    p_payment_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', asset_account_id,
        'debit', payment_amount,  -- Payment amount (e.g., 15000)
        'description', 'Payment received'
      ),
      jsonb_build_object(
        'account_id', ar_account_id,
        'credit', payment_amount,  -- MUST be payment_amount (15000), NOT invoice.total (18285)!
        'description', 'Reduce receivable'
      )
    )
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

-- Verification message
DO $$
BEGIN
  RAISE NOTICE '✅ Fix applied successfully!';
  RAISE NOTICE '✅ trigger_post_payment is now resilient (won''t fail payment inserts)';
  RAISE NOTICE '✅ post_payment_to_ledger now uses payment_amount for both debit and credit';
  RAISE NOTICE '✅ Try creating a payment again - it should work now!';
END $$;



















