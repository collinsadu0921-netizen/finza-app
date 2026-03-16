-- ============================================================================
-- Migration: Accrual AR posting at invoice finalisation
-- ============================================================================
-- Post Dr AR / Cr Revenue (and tax lines) on FIRST transition to sent/issued.
-- Idempotent: skip if an issuance JE already exists (see definition below).
-- Use invoice gross (total, or subtotal+total_tax when total=0). Respect period.
--
-- Issuance JE definition (ledger truth; do not rely on status or UI):
--   journal_entries.reference_type = 'invoice'
--   AND journal_entries.reference_id = invoice.id
--   AND the JE contains at least one line on the AR control account
--     (resolved via chart_of_accounts_control_map control_key = 'AR').
-- Payment JEs (reference_type = 'payment') and credit note JEs (reference_type
-- = 'credit_note') do NOT count as issuance; AR posting still runs once.
-- ============================================================================

CREATE OR REPLACE FUNCTION post_invoice_to_ledger(
  p_invoice_id UUID,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  invoice_record RECORD;
  business_id_val UUID;
  ar_account_id UUID;
  revenue_account_id UUID;
  journal_id UUID;
  subtotal NUMERIC;
  gross NUMERIC;
  posting_date DATE;
  tax_lines_jsonb JSONB;
  tax_line_item JSONB;
  parsed_tax_lines JSONB[] := ARRAY[]::JSONB[];
  journal_lines JSONB;
  tax_account_id UUID;
  tax_code TEXT;
  tax_amount NUMERIC;
  tax_ledger_side TEXT;
  tax_ledger_account_code TEXT;
  ar_account_code TEXT;
  tax_lines_posted INTEGER := 0;
  existing_je_id UUID;
BEGIN
  -- Get invoice details (include sent_at for posting date)
  SELECT 
    i.business_id,
    i.total,
    i.subtotal,
    i.total_tax,
    i.customer_id,
    i.invoice_number,
    i.issue_date,
    i.sent_at,
    i.tax_lines
  INTO invoice_record
  FROM invoices i
  WHERE i.id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found: %', p_invoice_id;
  END IF;

  business_id_val := invoice_record.business_id;
  subtotal := COALESCE(invoice_record.subtotal, 0);

  -- Gross: invoice.total; if 0, use subtotal + total_tax (same as credit note create)
  gross := COALESCE(invoice_record.total, 0);
  IF gross = 0 THEN
    gross := COALESCE(invoice_record.subtotal, 0) + COALESCE(invoice_record.total_tax, 0);
  END IF;

  -- Posting date: sent_at when issued, else issue_date. Block if both null.
  posting_date := COALESCE(
    (invoice_record.sent_at AT TIME ZONE 'UTC')::DATE,
    invoice_record.issue_date
  );
  IF posting_date IS NULL THEN
    RAISE EXCEPTION 'Invoice has no issue_date or sent_at. Cannot post to ledger. Invoice id: %', p_invoice_id;
  END IF;

  -- Resolve AR account (chart_of_accounts_control_map control_key ''AR'')
  ar_account_code := get_control_account_code(business_id_val, 'AR');
  PERFORM assert_account_exists(business_id_val, ar_account_code);
  ar_account_id := get_account_by_control_key(business_id_val, 'AR');
  IF ar_account_id IS NULL THEN
    RAISE EXCEPTION 'AR account not found for business: %', business_id_val;
  END IF;

  -- Serialize concurrent posting for the same invoice (exactly-once under concurrency)
  PERFORM pg_advisory_xact_lock(hashtext(business_id_val::text), hashtext(p_invoice_id::text));

  -- IDEMPOTENCY: Skip if issuance JE already exists (invoice + AR line; ledger truth)
  SELECT je.id INTO existing_je_id
  FROM journal_entries je
  JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
  WHERE je.business_id = business_id_val
    AND je.reference_type = 'invoice'
    AND je.reference_id = p_invoice_id
    AND jel.account_id = ar_account_id
  LIMIT 1;

  IF existing_je_id IS NOT NULL THEN
    RETURN existing_je_id;
  END IF;

  -- GUARD: Assert accounting period is open for posting date
  PERFORM assert_accounting_period_is_open(business_id_val, posting_date);

  -- Revenue: account_code 4000 (same pattern as existing invoice/revenue usage)
  PERFORM assert_account_exists(business_id_val, '4000');
  revenue_account_id := get_account_by_code(business_id_val, '4000');
  IF revenue_account_id IS NULL THEN
    RAISE EXCEPTION 'Revenue account (4000) not found for business: %', business_id_val;
  END IF;

  -- Parse tax_lines JSONB (support tax_lines / lines keys)
  tax_lines_jsonb := invoice_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    IF jsonb_typeof(tax_lines_jsonb) = 'object' THEN
      IF tax_lines_jsonb ? 'tax_lines' THEN
        tax_lines_jsonb := tax_lines_jsonb->'tax_lines';
      ELSIF tax_lines_jsonb ? 'lines' THEN
        tax_lines_jsonb := tax_lines_jsonb->'lines';
      END IF;
    END IF;
    IF jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_jsonb)
      LOOP
        IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
          parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Validate tax account codes
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  -- Build journal entry lines: Dr AR (gross), Cr Revenue (subtotal), tax lines
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', ar_account_id,
      'debit', gross,
      'description', 'Invoice receivable'
    ),
    jsonb_build_object(
      'account_id', revenue_account_id,
      'credit', subtotal,
      'description', 'Service revenue'
    )
  );

  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    tax_ledger_side := tax_line_item->>'ledger_side';

    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      IF tax_ledger_side = 'credit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'credit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax'
          )
        );
        tax_lines_posted := tax_lines_posted + 1;
      ELSIF tax_ledger_side = 'debit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'debit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax'
          )
        );
        tax_lines_posted := tax_lines_posted + 1;
      END IF;
    END IF;
  END LOOP;

  IF COALESCE(invoice_record.total_tax, 0) > 0 AND tax_lines_posted = 0 THEN
    RAISE EXCEPTION 'Invoice total_tax > 0 but no tax journal lines were posted. Aborting to prevent silent imbalance.';
  END IF;

  SELECT post_journal_entry(
    business_id_val,
    posting_date,
    'Invoice #' || COALESCE(invoice_record.invoice_number, p_invoice_id::TEXT),
    'invoice',
    p_invoice_id,
    journal_lines,
    FALSE,
    NULL,
    NULL,
    NULL,
    p_entry_type,
    p_backfill_reason,
    p_backfill_actor,
    NULL,
    'system'
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_invoice_to_ledger IS 
  'Accrual AR posting at invoice finalisation. Dr AR / Cr Revenue (gross). Idempotent: skip if issuance JE exists (reference_type=invoice, reference_id=invoice.id, and JE has AR line). Safe under retries and concurrency (advisory lock). Uses posting_date = sent_at or issue_date. Period guard via assert_accounting_period_is_open.';
