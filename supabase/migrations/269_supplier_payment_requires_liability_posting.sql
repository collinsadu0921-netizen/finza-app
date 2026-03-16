-- ============================================================================
-- Enforce: Supplier payment cannot post unless supplier liability is posted.
-- ============================================================================
-- Supplier payments reduce AP; the originating liability (supplier_invoice or
-- linked bill) must have a journal entry before the payment JE is created.
-- No schema changes. No new tables or columns. Reuses existing posting logic.
-- ============================================================================

CREATE OR REPLACE FUNCTION post_supplier_payment_to_ledger(p_supplier_payment_id UUID)
RETURNS UUID AS $$
DECLARE
  payment_record RECORD;
  supplier_record RECORD;
  business_id_val UUID;
  payment_account_id UUID;
  payment_account_code TEXT;
  ap_account_code TEXT;
  ap_account_id UUID;
  journal_id UUID;
  journal_lines JSONB;
BEGIN
  -- IDEMPOTENCY GUARD: Check if journal entry already exists
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'supplier_payment'
    AND reference_id = p_supplier_payment_id
    LIMIT 1;

  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  -- Get payment details
  SELECT 
    sp.id,
    sp.business_id,
    sp.supplier_id,
    sp.amount,
    sp.payment_method,
    sp.payment_reference,
    sp.payment_date,
    sp.supplier_invoice_id,
    sp.purchase_order_id
  INTO payment_record
  FROM supplier_payments sp
  WHERE sp.id = p_supplier_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier payment not found: %', p_supplier_payment_id;
  END IF;

  -- Get supplier name
  SELECT name INTO supplier_record
  FROM suppliers
  WHERE id = payment_record.supplier_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier not found for payment %', p_supplier_payment_id;
  END IF;

  business_id_val := payment_record.business_id;

  -- Dependency Enforcement:
  -- Supplier payments must only reduce AP that exists in ledger.
  -- Safe because supplier invoice posting is idempotent.
  -- Prevents balance sheet corruption across tenants.
  IF payment_record.supplier_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Supplier payment must be allocated to supplier liability before posting.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM journal_entries
    WHERE reference_type IN ('supplier_invoice', 'bill')
      AND reference_id = payment_record.supplier_invoice_id
  ) THEN
    -- No post_supplier_invoice_to_ledger in this codebase; enforce by blocking.
    RAISE EXCEPTION 'Supplier invoice must be posted to ledger before payment. Post the supplier invoice first. Supplier invoice id: %', payment_record.supplier_invoice_id;
  END IF;

  -- GUARD: Assert accounting period is open
  PERFORM assert_accounting_period_is_open(business_id_val, payment_record.payment_date);

  -- COA: Resolve AP via control mapping (same pattern as post_bill_payment_to_ledger)
  ap_account_code := get_control_account_code(business_id_val, 'AP');
  PERFORM assert_account_exists(business_id_val, ap_account_code);
  ap_account_id := get_account_by_control_key(business_id_val, 'AP');

  IF ap_account_id IS NULL THEN
    RAISE EXCEPTION 'AP account not found for business: %. Supplier Payment ID: %', business_id_val, p_supplier_payment_id;
  END IF;

  -- Resolve payment account
  SELECT 
    resolved.payment_account_id,
    resolved.payment_account_code
  INTO payment_account_id, payment_account_code
  FROM resolve_payment_account_from_method(business_id_val, payment_record.payment_method) AS resolved;

  IF payment_account_id IS NULL THEN
    RAISE EXCEPTION 'Payment account not found for method: %', payment_record.payment_method;
  END IF;

  -- Build journal entry lines: Dr AP, Cr Cash/Bank/Clearing
  journal_lines := jsonb_build_array(
    -- DEBIT: Accounts Payable (control mapping)
    jsonb_build_object(
      'account_id', ap_account_id,
      'debit', payment_record.amount,
      'description', 'Supplier Payment: ' || supplier_record.name ||
                     COALESCE(' (Ref: ' || payment_record.payment_reference || ')', '')
    ),
    -- CREDIT: Payment account (Cash/Bank/Clearing)
    jsonb_build_object(
      'account_id', payment_account_id,
      'credit', payment_record.amount,
      'description', 'Supplier Payment: ' || COALESCE(payment_account_code, 'Payment') ||
                     COALESCE(' (Ref: ' || payment_record.payment_reference || ')', '')
    )
  );

  -- Post journal entry (unchanged contract)
  SELECT post_journal_entry(
    business_id_val,
    payment_record.payment_date,
    'Supplier Payment: ' || supplier_record.name ||
    COALESCE(' (Ref: ' || payment_record.payment_reference || ')', ''),
    'supplier_payment',
    p_supplier_payment_id,
    journal_lines,
    FALSE,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'system'
  ) INTO journal_id;

  IF journal_id IS NULL THEN
    RAISE EXCEPTION 'Failed to create journal entry for supplier payment %', p_supplier_payment_id;
  END IF;

  -- Update supplier invoice status if linked
  IF payment_record.supplier_invoice_id IS NOT NULL THEN
    -- Check if invoice is fully paid (sum of all payments >= invoice total)
    DECLARE
      total_paid NUMERIC;
      invoice_total NUMERIC;
    BEGIN
      SELECT COALESCE(SUM(amount), 0)
      INTO total_paid
      FROM supplier_payments
      WHERE supplier_invoice_id = payment_record.supplier_invoice_id;

      SELECT total_amount
      INTO invoice_total
      FROM supplier_invoices
      WHERE id = payment_record.supplier_invoice_id;

      IF total_paid >= invoice_total THEN
        UPDATE supplier_invoices
        SET status = 'paid',
            updated_at = NOW()
        WHERE id = payment_record.supplier_invoice_id;
      END IF;
    END;
  END IF;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_supplier_payment_to_ledger(UUID) IS
  'Posts supplier payment to ledger (AP reduction). Requires supplier invoice to be posted first. DEBIT: AP (control key). CREDIT: Cash/Bank/Clearing.';
