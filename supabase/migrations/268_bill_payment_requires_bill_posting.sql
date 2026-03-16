-- ============================================================================
-- Enforce: Bill payment cannot post unless the bill is posted to the ledger.
-- ============================================================================
-- If no journal entry exists for the bill (reference_type = 'bill', reference_id = bill_id),
-- we call post_bill_to_ledger(bill_id) before building the payment JE.
-- Ledger remains immutable; post_journal_entry unchanged; minimal diff.
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
  cash_account_code TEXT;
  bank_account_code TEXT;
  ap_account_code TEXT;
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

  -- Dependency Enforcement:
  -- Payment cannot exist without bill posting.
  -- Safe due to post_bill_to_ledger idempotency.
  IF NOT EXISTS (
    SELECT 1
    FROM journal_entries
    WHERE reference_type = 'bill'
      AND reference_id = payment_record.bill_id
  ) THEN
    PERFORM post_bill_to_ledger(payment_record.bill_id);
  END IF;

  -- COA GUARD: Resolve and validate all account codes BEFORE any inserts
  ap_account_code := get_control_account_code(business_id_val, 'AP');
  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  bank_account_code := get_control_account_code(business_id_val, 'BANK');
  
  -- Validate all account codes that will be used
  PERFORM assert_account_exists(business_id_val, ap_account_code);
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, bank_account_code);
  PERFORM assert_account_exists(business_id_val, '1020'); -- MoMo (hardcoded, not a control key)

  -- Get account IDs using control keys
  ap_account_id := get_account_by_control_key(business_id_val, 'AP');
  cash_account_id := get_account_by_code(business_id_val, cash_account_code);
  bank_account_id := get_account_by_code(business_id_val, bank_account_code);
  momo_account_id := get_account_by_code(business_id_val, '1020'); -- MoMo not a control key

  -- Validate AP account exists
  IF ap_account_id IS NULL THEN
    RAISE EXCEPTION 'AP account not found for business: %. Bill Payment ID: %', business_id_val, p_bill_payment_id;
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

  -- Post journal entry with EXPLICIT posting_source = 'system'
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
    ),
    FALSE,  -- p_is_adjustment
    NULL,   -- p_adjustment_reason
    NULL,   -- p_adjustment_ref
    NULL,   -- p_created_by
    NULL,   -- p_entry_type
    NULL,   -- p_backfill_reason
    NULL,   -- p_backfill_actor
    NULL,   -- p_posted_by_accountant_id (not required for system postings)
    'system'  -- EXPLICIT: Bill payment postings are system-generated
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_bill_payment_to_ledger(UUID) IS
  'Posts bill payment to ledger. Ensures bill is posted first (calls post_bill_to_ledger if missing). posting_source = system.';
