-- ============================================================================
-- Migration 393: Customer credit liability + settlement flow
-- ============================================================================
-- Goals:
-- 1) When an applied credit note pushes an invoice below zero outstanding,
--    reclass only the over-credit portion from AR to customer credit liability.
-- 2) Add "customer_credit" as a payment method for settling future invoices
--    without cash movement (Dr Customer Credits Payable, Cr AR).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- STEP 1: Allow customer_credit method on payments
-- ---------------------------------------------------------------------------
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments
  ADD CONSTRAINT payments_method_check
  CHECK (method IN ('cash', 'bank', 'momo', 'card', 'cheque', 'paystack', 'other', 'customer_credit'));

-- ---------------------------------------------------------------------------
-- STEP 2: Post over-credit reclass on applied credit notes (if needed)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION post_credit_note_overcredit_reclass_to_ledger(p_credit_note_id UUID)
RETURNS UUID AS $$
DECLARE
  cn_record RECORD;
  invoice_record RECORD;
  ar_account_id UUID;
  customer_credit_liability_account_id UUID;
  total_paid NUMERIC := 0;
  total_applied_credits NUMERIC := 0;
  previous_applied_credits NUMERIC := 0;
  over_credit_before NUMERIC := 0;
  over_credit_after NUMERIC := 0;
  reclass_amount NUMERIC := 0;
  journal_id UUID;
BEGIN
  -- Idempotency guard: do not post duplicate reclass JEs for the same credit note
  SELECT je.id
  INTO journal_id
  FROM journal_entries je
  WHERE je.reference_type = 'credit_note'
    AND je.reference_id = p_credit_note_id
    AND je.description LIKE 'Credit Note Reclass #%'
  LIMIT 1;

  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  SELECT
    cn.id,
    cn.business_id,
    cn.invoice_id,
    cn.total,
    cn.credit_number,
    cn.date
  INTO cn_record
  FROM credit_notes cn
  WHERE cn.id = p_credit_note_id
    AND cn.status = 'applied'
    AND cn.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Applied credit note not found: %', p_credit_note_id;
  END IF;

  SELECT i.id, i.invoice_number, i.total
  INTO invoice_record
  FROM invoices i
  WHERE i.id = cn_record.invoice_id
    AND i.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found for credit note reclass: %. Invoice ID: %', p_credit_note_id, cn_record.invoice_id;
  END IF;

  -- If invoice total is invalid, skip reclass (main credit note posting still controls)
  IF COALESCE(invoice_record.total, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(p.amount), 0)
  INTO total_paid
  FROM payments p
  WHERE p.invoice_id = cn_record.invoice_id
    AND p.deleted_at IS NULL;

  SELECT COALESCE(SUM(cn.total), 0)
  INTO total_applied_credits
  FROM credit_notes cn
  WHERE cn.invoice_id = cn_record.invoice_id
    AND cn.status = 'applied'
    AND cn.deleted_at IS NULL;

  previous_applied_credits := GREATEST(0, total_applied_credits - COALESCE(cn_record.total, 0));
  over_credit_before := GREATEST(0, total_paid + previous_applied_credits - invoice_record.total);
  over_credit_after := GREATEST(0, total_paid + total_applied_credits - invoice_record.total);
  reclass_amount := ROUND(GREATEST(0, over_credit_after - over_credit_before), 2);

  IF reclass_amount <= 0 THEN
    RETURN NULL;
  END IF;

  ar_account_id := get_account_by_control_key(cn_record.business_id, 'AR');
  IF ar_account_id IS NULL THEN
    RAISE EXCEPTION 'AR account not found for business: %. Credit Note ID: %', cn_record.business_id, p_credit_note_id;
  END IF;

  -- Ensure customer credit liability account exists
  SELECT a.id
  INTO customer_credit_liability_account_id
  FROM accounts a
  WHERE a.business_id = cn_record.business_id
    AND a.code = '2810'
    AND a.deleted_at IS NULL
  ORDER BY a.created_at
  LIMIT 1;

  IF customer_credit_liability_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, sub_type, description, is_system)
    VALUES (
      cn_record.business_id,
      'Customer Credits Payable',
      '2810',
      'liability',
      'deferred_revenue',
      'Credits owed to customers from overpaid/over-credited invoices',
      TRUE
    )
    RETURNING id INTO customer_credit_liability_account_id;
  END IF;

  SELECT post_journal_entry(
    p_business_id => cn_record.business_id,
    p_date => cn_record.date,
    p_description => 'Credit Note Reclass #' || cn_record.credit_number || ' for Invoice #' || invoice_record.invoice_number,
    p_reference_type => 'credit_note',
    p_reference_id => p_credit_note_id,
    p_lines => jsonb_build_array(
      jsonb_build_object(
        'account_id', ar_account_id,
        'debit', reclass_amount,
        'description', 'Reclass over-credit from AR'
      ),
      jsonb_build_object(
        'account_id', customer_credit_liability_account_id,
        'credit', reclass_amount,
        'description', 'Recognize customer credit liability'
      )
    ),
    p_posting_source => 'system'
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_credit_note_overcredit_reclass_to_ledger(UUID) IS
'Posts AR -> customer credit liability reclass for the over-credit portion created by an applied credit note. Idempotent per credit note.';

-- Ensure trigger posts both base credit-note JE and reclass JE (if any)
CREATE OR REPLACE FUNCTION trigger_post_credit_note()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'applied' AND (OLD.status IS NULL OR OLD.status != 'applied') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM journal_entries
      WHERE reference_type = 'credit_note'
        AND reference_id = NEW.id
        AND description NOT LIKE 'Credit Note Reclass #%'
    ) THEN
      PERFORM post_credit_note_to_ledger(NEW.id);
    END IF;

    -- Non-blocking idempotency is handled inside function; posting errors must abort.
    PERFORM post_credit_note_overcredit_reclass_to_ledger(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- STEP 3: Customer credit settlement posting for future invoices
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION post_invoice_customer_credit_payment_to_ledger(p_payment_id UUID)
RETURNS UUID AS $$
DECLARE
  payment_record RECORD;
  invoice_record RECORD;
  business_id_val UUID;
  payment_amount NUMERIC;
  ar_account_id UUID;
  customer_credit_liability_account_id UUID;
  journal_id UUID;
BEGIN
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

  IF payment_record.method IS DISTINCT FROM 'customer_credit' THEN
    RAISE EXCEPTION 'Payment % is not customer_credit method.', p_payment_id;
  END IF;

  payment_amount := COALESCE(payment_record.amount, 0);
  IF payment_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid payment amount: %. Payment ID: %', payment_amount, p_payment_id;
  END IF;

  SELECT id, invoice_number, status
  INTO invoice_record
  FROM invoices
  WHERE id = payment_record.invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found for payment: %. Invoice ID: %', p_payment_id, payment_record.invoice_id;
  END IF;

  IF invoice_record.status = 'draft' THEN
    RAISE EXCEPTION 'Cannot post customer credit settlement for draft invoice. Issue the invoice first.';
  END IF;

  business_id_val := payment_record.business_id;
  IF business_id_val IS NULL THEN
    RAISE EXCEPTION 'Business ID is NULL for payment: %', p_payment_id;
  END IF;

  ar_account_id := get_account_by_control_key(business_id_val, 'AR');
  IF ar_account_id IS NULL THEN
    RAISE EXCEPTION 'AR account not found for business: %. Payment ID: %', business_id_val, p_payment_id;
  END IF;

  SELECT a.id
  INTO customer_credit_liability_account_id
  FROM accounts a
  WHERE a.business_id = business_id_val
    AND a.code = '2810'
    AND a.deleted_at IS NULL
  ORDER BY a.created_at
  LIMIT 1;

  IF customer_credit_liability_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, sub_type, description, is_system)
    VALUES (
      business_id_val,
      'Customer Credits Payable',
      '2810',
      'liability',
      'deferred_revenue',
      'Credits owed to customers from overpaid/over-credited invoices',
      TRUE
    )
    RETURNING id INTO customer_credit_liability_account_id;
  END IF;

  SELECT post_journal_entry(
    p_business_id => business_id_val,
    p_date => payment_record.date,
    p_description => 'Customer credit applied to Invoice #' || invoice_record.invoice_number,
    p_reference_type => 'payment',
    p_reference_id => p_payment_id,
    p_lines => jsonb_build_array(
      jsonb_build_object(
        'account_id', customer_credit_liability_account_id,
        'debit', payment_amount,
        'description', 'Apply customer credit balance'
      ),
      jsonb_build_object(
        'account_id', ar_account_id,
        'credit', payment_amount,
        'description', 'Reduce receivable using customer credit'
      )
    ),
    p_posting_source => 'system'
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_invoice_customer_credit_payment_to_ledger(UUID) IS
'Posts customer credit settlement for an invoice payment: Dr Customer Credits Payable (2810), Cr AR. No cash movement.';

-- Extend payment posting guard wrapper to delegate customer_credit settlements
CREATE OR REPLACE FUNCTION post_payment_to_ledger(p_payment_id UUID)
RETURNS UUID AS $$
DECLARE
  payment_record  RECORD;
  invoice_record  RECORD;
  business_id_val UUID;
  journal_id      UUID;
BEGIN
  -- Fetch payment for guard checks
  SELECT p.business_id, p.invoice_id, p.amount, p.date, p.method
  INTO payment_record
  FROM payments p
  WHERE p.id = p_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found: %', p_payment_id;
  END IF;

  IF COALESCE(payment_record.amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Invalid payment amount: %. Payment ID: %', payment_record.amount, p_payment_id;
  END IF;

  -- Fetch invoice for draft guard
  SELECT id, status
  INTO invoice_record
  FROM invoices
  WHERE id = payment_record.invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found for payment: %', p_payment_id;
  END IF;

  IF invoice_record.status = 'draft' THEN
    RAISE EXCEPTION 'Cannot post payment for draft invoice. Issue the invoice first.';
  END IF;

  business_id_val := payment_record.business_id;
  IF business_id_val IS NULL THEN
    RAISE EXCEPTION 'Business ID is NULL for payment: %', p_payment_id;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(business_id_val::text),
    hashtext(p_payment_id::text)
  );

  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'payment'
    AND reference_id = p_payment_id
  LIMIT 1;

  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  PERFORM assert_accounting_period_is_open(business_id_val, payment_record.date);

  IF payment_record.method = 'customer_credit' THEN
    RETURN post_invoice_customer_credit_payment_to_ledger(p_payment_id);
  END IF;

  RETURN post_invoice_payment_to_ledger(p_payment_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_payment_to_ledger(UUID) IS
'Guard wrapper for invoice payment postings. Supports cash/bank/momo/card/cheque/paystack/other via post_invoice_payment_to_ledger and customer_credit via post_invoice_customer_credit_payment_to_ledger.';
