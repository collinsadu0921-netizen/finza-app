-- ============================================================================
-- MIGRATION: STEP 5 - Payment Settlement Ledger Posting
-- ============================================================================
-- This migration ensures payment settlement functions comply with STEP 5 rules:
-- 1. Customer payment (Invoice settlement): Debit Cash/Bank/Clearing, Credit AR
-- 2. Supplier payment (Bill settlement): Debit AP, Credit Cash/Bank/Clearing
-- 3. NO tax lines or tax account references
-- 4. NO revenue or expense recognition
-- 5. Proper validation and error handling
-- ============================================================================

-- ============================================================================
-- FUNCTION: Post invoice payment to ledger (Customer payment → AR)
-- ============================================================================
CREATE OR REPLACE FUNCTION post_invoice_payment_to_ledger(p_payment_id UUID)
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

  -- Validate and use payment amount (NOT invoice total!)
  payment_amount := COALESCE(payment_record.amount, 0);
  IF payment_amount <= 0 OR payment_amount IS NULL THEN
    RAISE EXCEPTION 'Invalid payment amount: %. Payment ID: %', payment_amount, p_payment_id;
  END IF;

  -- Get invoice details (only for invoice_number, NOT for amount)
  SELECT invoice_number INTO invoice_record
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
  -- Card and cheque payments use bank account (clearing)
  CASE payment_record.method
    WHEN 'cash' THEN asset_account_id := cash_account_id;
    WHEN 'bank' THEN asset_account_id := bank_account_id;
    WHEN 'momo' THEN asset_account_id := momo_account_id;
    WHEN 'card' THEN asset_account_id := bank_account_id; -- Card payments clear through bank
    WHEN 'cheque' THEN asset_account_id := bank_account_id; -- Cheque payments clear through bank
    ELSE asset_account_id := cash_account_id; -- Default to cash for 'other'
  END CASE;

  -- Validate asset account exists
  IF asset_account_id IS NULL THEN
    RAISE EXCEPTION 'Asset account for method "%" not found for business: %. Payment ID: %. Cash: %, Bank: %, MoMo: %', 
      payment_record.method, business_id_val, p_payment_id, cash_account_id, bank_account_id, momo_account_id;
  END IF;

  -- Post journal entry: Debit Cash/Bank/Clearing, Credit AR
  -- STEP 5 RULE: NO revenue lines, NO tax lines
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

-- ============================================================================
-- FUNCTION: Post bill payment to ledger (Supplier payment → AP)
-- ============================================================================
CREATE OR REPLACE FUNCTION post_bill_payment_to_ledger(p_bill_payment_id UUID)
RETURNS UUID AS $$
DECLARE
  payment_record RECORD;
  bill_record RECORD;
  business_id_val UUID;
  ap_account_id UUID;
  cash_account_id UUID;
  bank_account_id UUID;
  momo_account_id UUID;
  journal_id UUID;
  asset_account_id UUID;
  payment_amount NUMERIC;
BEGIN
  -- Get payment details
  SELECT 
    bp.business_id,
    bp.bill_id,
    bp.amount,
    bp.method,
    bp.date
  INTO payment_record
  FROM bill_payments bp
  WHERE bp.id = p_bill_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill payment not found: %', p_bill_payment_id;
  END IF;

  -- Validate and use payment amount
  payment_amount := COALESCE(payment_record.amount, 0);
  IF payment_amount <= 0 OR payment_amount IS NULL THEN
    RAISE EXCEPTION 'Invalid payment amount: %. Bill Payment ID: %', payment_amount, p_bill_payment_id;
  END IF;

  -- Get bill details (only for bill_number, NOT for amount)
  SELECT bill_number INTO bill_record
  FROM bills
  WHERE id = payment_record.bill_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found for payment: %. Bill ID: %', p_bill_payment_id, payment_record.bill_id;
  END IF;

  business_id_val := payment_record.business_id;

  -- Validate business_id
  IF business_id_val IS NULL THEN
    RAISE EXCEPTION 'Business ID is NULL for bill payment: %', p_bill_payment_id;
  END IF;

  -- Get account IDs
  ap_account_id := get_account_by_code(business_id_val, '2000');
  cash_account_id := get_account_by_code(business_id_val, '1000');
  bank_account_id := get_account_by_code(business_id_val, '1010');
  momo_account_id := get_account_by_code(business_id_val, '1020');

  -- Validate AP account exists
  IF ap_account_id IS NULL THEN
    RAISE EXCEPTION 'AP account (2000) not found for business: %. Bill Payment ID: %', business_id_val, p_bill_payment_id;
  END IF;

  -- Determine asset account based on payment method
  -- Card and cheque payments use bank account (clearing)
  CASE payment_record.method
    WHEN 'cash' THEN asset_account_id := cash_account_id;
    WHEN 'bank' THEN asset_account_id := bank_account_id;
    WHEN 'momo' THEN asset_account_id := momo_account_id;
    WHEN 'card' THEN asset_account_id := bank_account_id; -- Card payments clear through bank
    WHEN 'cheque' THEN asset_account_id := bank_account_id; -- Cheque payments clear through bank
    ELSE asset_account_id := cash_account_id; -- Default to cash for 'other'
  END CASE;

  -- Validate asset account exists
  IF asset_account_id IS NULL THEN
    RAISE EXCEPTION 'Asset account for method "%" not found for business: %. Bill Payment ID: %. Cash: %, Bank: %, MoMo: %', 
      payment_record.method, business_id_val, p_bill_payment_id, cash_account_id, bank_account_id, momo_account_id;
  END IF;

  -- Post journal entry: Debit AP, Credit Cash/Bank/Clearing
  -- STEP 5 RULE: NO expense lines, NO tax lines
  SELECT post_journal_entry(
    business_id_val,
    payment_record.date,
    'Payment for Bill #' || bill_record.bill_number,
    'bill_payment',
    p_bill_payment_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', ap_account_id,
        'debit', payment_amount,
        'description', 'Reduce payable'
      ),
      jsonb_build_object(
        'account_id', asset_account_id,
        'credit', payment_amount,
        'description', 'Payment made'
      )
    )
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ALIAS: post_payment_to_ledger → post_invoice_payment_to_ledger
-- ============================================================================
-- For backward compatibility, create an alias function
CREATE OR REPLACE FUNCTION post_payment_to_ledger(p_payment_id UUID)
RETURNS UUID AS $$
BEGIN
  RETURN post_invoice_payment_to_ledger(p_payment_id);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VERIFICATION: Functions created successfully
-- ============================================================================
-- Both settlement functions are now compliant with STEP 5:
-- ✅ post_invoice_payment_to_ledger: Debit Cash/Bank/Clearing, Credit AR (no tax)
-- ✅ post_bill_payment_to_ledger: Debit AP, Credit Cash/Bank/Clearing (no tax)
-- ✅ post_payment_to_ledger: Alias for backward compatibility
-- ============================================================================

