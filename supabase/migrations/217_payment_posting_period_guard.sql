-- Add period guard to payment posting: block LOCKED and SOFT_CLOSED (payments are not adjustments).
-- Uses payment_record.date. assert_accounting_period_is_open(business_id, date) uses 3-arg with default
-- p_is_adjustment FALSE, so regular postings are blocked in soft_closed; both functions get the guard.

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
  cash_account_code TEXT;
  bank_account_code TEXT;
  ar_account_code TEXT;
BEGIN
  SELECT p.business_id, p.invoice_id, p.amount, p.method, p.date
  INTO payment_record FROM payments p WHERE p.id = p_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found: %', p_payment_id;
  END IF;

  payment_amount := COALESCE(payment_record.amount, 0);
  IF payment_amount <= 0 OR payment_amount IS NULL THEN
    RAISE EXCEPTION 'Invalid payment amount: %. Payment ID: %', payment_amount, p_payment_id;
  END IF;

  SELECT invoice_number, id INTO invoice_record FROM invoices WHERE id = payment_record.invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found for payment: %. Invoice ID: %', p_payment_id, payment_record.invoice_id;
  END IF;

  business_id_val := payment_record.business_id;
  IF business_id_val IS NULL THEN
    RAISE EXCEPTION 'Business ID is NULL for payment: %', p_payment_id;
  END IF;

  PERFORM assert_accounting_period_is_open(business_id_val, payment_record.date);

  ar_account_code := get_control_account_code(business_id_val, 'AR');
  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  bank_account_code := get_control_account_code(business_id_val, 'BANK');
  PERFORM assert_account_exists(business_id_val, ar_account_code);
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, bank_account_code);
  PERFORM assert_account_exists(business_id_val, '1020');

  ar_account_id := get_account_by_control_key(business_id_val, 'AR');
  cash_account_id := get_account_by_code(business_id_val, cash_account_code);
  bank_account_id := get_account_by_code(business_id_val, bank_account_code);
  momo_account_id := get_account_by_code(business_id_val, '1020');

  IF ar_account_id IS NULL THEN
    RAISE EXCEPTION 'AR account not found for business: %. Payment ID: %', business_id_val, p_payment_id;
  END IF;

  CASE payment_record.method
    WHEN 'cash' THEN asset_account_id := cash_account_id;
    WHEN 'bank' THEN asset_account_id := bank_account_id;
    WHEN 'momo' THEN asset_account_id := momo_account_id;
    WHEN 'card' THEN asset_account_id := bank_account_id;
    WHEN 'cheque' THEN asset_account_id := bank_account_id;
    ELSE asset_account_id := cash_account_id;
  END CASE;

  IF asset_account_id IS NULL THEN
    RAISE EXCEPTION 'Asset account for method "%" not found for business: %. Payment ID: %. Cash: %, Bank: %, MoMo: %',
      payment_record.method, business_id_val, p_payment_id, cash_account_id, bank_account_id, momo_account_id;
  END IF;

  SELECT post_journal_entry(
    business_id_val, payment_record.date,
    'Payment for Invoice #' || COALESCE(invoice_record.invoice_number, invoice_record.id::text), 'payment', p_payment_id,
    jsonb_build_array(
      jsonb_build_object('account_id', asset_account_id, 'debit', payment_amount, 'description', 'Payment received'),
      jsonb_build_object('account_id', ar_account_id, 'credit', payment_amount, 'description', 'Reduce receivable')
    ),
    FALSE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'system'
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION post_payment_to_ledger(
  p_payment_id UUID,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL
)
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
  ar_account_code TEXT;
  cash_account_code TEXT;
  bank_account_code TEXT;
BEGIN
  SELECT p.business_id, p.invoice_id, p.amount, p.method, p.date
  INTO payment_record FROM payments p WHERE p.id = p_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found: %', p_payment_id;
  END IF;

  payment_amount := COALESCE(payment_record.amount, 0);
  IF payment_amount <= 0 OR payment_amount IS NULL THEN
    RAISE EXCEPTION 'Invalid payment amount: %. Payment ID: %', payment_amount, p_payment_id;
  END IF;

  SELECT invoice_number, id INTO invoice_record FROM invoices WHERE id = payment_record.invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found for payment: %. Invoice ID: %', p_payment_id, payment_record.invoice_id;
  END IF;

  business_id_val := payment_record.business_id;
  IF business_id_val IS NULL THEN
    RAISE EXCEPTION 'Business ID is NULL for payment: %', p_payment_id;
  END IF;

  PERFORM assert_accounting_period_is_open(business_id_val, payment_record.date);

  ar_account_code := get_control_account_code(business_id_val, 'AR');
  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  bank_account_code := get_control_account_code(business_id_val, 'BANK');
  PERFORM assert_account_exists(business_id_val, ar_account_code);
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, bank_account_code);
  PERFORM assert_account_exists(business_id_val, '1020');

  ar_account_id := get_account_by_control_key(business_id_val, 'AR');
  cash_account_id := get_account_by_code(business_id_val, cash_account_code);
  bank_account_id := get_account_by_code(business_id_val, bank_account_code);
  momo_account_id := get_account_by_code(business_id_val, '1020');

  IF ar_account_id IS NULL THEN
    RAISE EXCEPTION 'AR account not found for business: %. Payment ID: %', business_id_val, p_payment_id;
  END IF;

  CASE payment_record.method
    WHEN 'cash' THEN asset_account_id := cash_account_id;
    WHEN 'bank' THEN asset_account_id := bank_account_id;
    WHEN 'momo' THEN asset_account_id := momo_account_id;
    WHEN 'card' THEN asset_account_id := bank_account_id;
    WHEN 'cheque' THEN asset_account_id := bank_account_id;
    ELSE asset_account_id := cash_account_id;
  END CASE;

  IF asset_account_id IS NULL THEN
    RAISE EXCEPTION 'Asset account not found for payment method: %. Payment ID: %', payment_record.method, p_payment_id;
  END IF;

  SELECT post_journal_entry(
    business_id_val, payment_record.date,
    'Payment for Invoice #' || COALESCE(invoice_record.invoice_number, invoice_record.id::text), 'payment', p_payment_id,
    jsonb_build_array(
      jsonb_build_object('account_id', ar_account_id, 'credit', payment_amount, 'description', 'Reduce receivable'),
      jsonb_build_object('account_id', asset_account_id, 'debit', payment_amount, 'description', 'Payment received')
    ),
    FALSE, NULL, NULL, NULL, p_entry_type, p_backfill_reason, p_backfill_actor, NULL, 'system'
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;
