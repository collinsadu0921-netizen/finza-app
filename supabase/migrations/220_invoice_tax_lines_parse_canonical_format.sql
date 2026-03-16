-- ============================================================================
-- Migration: post_invoice_to_ledger — parse both tax_lines and lines array keys
-- ============================================================================
-- Problem: Parser only accepted { tax_lines: [...] }; app stores canonical
--          { lines: [...], meta, pricing_mode }. Tax credits were skipped → JE imbalance.
-- Fix: Accept both keys (tax_lines legacy, lines canonical). No other logic changes.
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
BEGIN
  -- Get invoice details
  SELECT 
    i.business_id,
    i.total,
    i.subtotal,
    i.total_tax,
    i.customer_id,
    i.invoice_number,
    i.issue_date,
    i.tax_lines
  INTO invoice_record
  FROM invoices i
  WHERE i.id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found: %', p_invoice_id;
  END IF;

  business_id_val := invoice_record.business_id;

  -- GUARD: Assert accounting period is open
  PERFORM assert_accounting_period_is_open(business_id_val, invoice_record.issue_date);

  subtotal := COALESCE(invoice_record.subtotal, 0);

  -- Parse tax_lines JSONB metadata.
  -- Support both { tax_lines: [...] } (legacy) and { lines: [...] } (canonical from toTaxLinesJsonb).
  tax_lines_jsonb := invoice_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    IF jsonb_typeof(tax_lines_jsonb) = 'object' THEN
      IF tax_lines_jsonb ? 'tax_lines' THEN
        tax_lines_jsonb := tax_lines_jsonb->'tax_lines';
      ELSIF tax_lines_jsonb ? 'lines' THEN
        tax_lines_jsonb := tax_lines_jsonb->'lines';
      END IF;
    END IF;
    -- Validate it's an array and parse individual tax line items
    IF jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_jsonb)
      LOOP
        -- Defensive validation: ensure tax line has required fields
        IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
          parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- COA GUARD: Resolve and validate all account codes BEFORE any inserts
  ar_account_code := get_control_account_code(business_id_val, 'AR');
  PERFORM assert_account_exists(business_id_val, ar_account_code);
  PERFORM assert_account_exists(business_id_val, '4000'); -- Revenue (not a control key)
  
  -- Validate tax account codes from tax_lines
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  -- Get account IDs using control keys
  ar_account_id := get_account_by_control_key(business_id_val, 'AR');
  revenue_account_id := get_account_by_code(business_id_val, '4000'); -- Service Revenue (not a control key)

  -- Build journal entry lines: start with base lines (AR and Revenue)
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', ar_account_id,
      'debit', invoice_record.total,
      'description', 'Invoice receivable'
    ),
    jsonb_build_object(
      'account_id', revenue_account_id,
      'credit', subtotal,
      'description', 'Service revenue'
    )
  );

  -- Add tax lines: iterate parsed_tax_lines and post each to its control account
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    tax_ledger_side := tax_line_item->>'ledger_side';

    -- Only post tax lines with ledger_account_code (skip absorbed taxes)
    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      
      -- Build tax journal line based on ledger_side
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

  -- GUARD: Prevent silent imbalance when total_tax > 0 but no tax lines posted.
  -- INVARIANT: Invoices with total_tax = 0 may post with zero tax journal lines (AR + Revenue only).
  IF COALESCE(invoice_record.total_tax, 0) > 0 AND tax_lines_posted = 0 THEN
    RAISE EXCEPTION 'Invoice total_tax > 0 but no tax journal lines were posted. Aborting to prevent silent imbalance.';
  END IF;

  -- Post journal entry with EXPLICIT posting_source = 'system'
  SELECT post_journal_entry(
    business_id_val,
    invoice_record.issue_date,
    'Invoice #' || invoice_record.invoice_number,
    'invoice',
    p_invoice_id,
    journal_lines,
    FALSE,  -- p_is_adjustment
    NULL,   -- p_adjustment_reason
    NULL,   -- p_adjustment_ref
    NULL,   -- p_created_by
    p_entry_type,
    p_backfill_reason,
    p_backfill_actor,
    NULL,   -- p_posted_by_accountant_id (not required for system postings)
    'system'  -- EXPLICIT: Invoice postings are system-generated
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_invoice_to_ledger IS 
  'Posts invoice to ledger with EXPLICIT posting_source = ''system''. Invoice postings are system-generated and do not require posted_by_accountant_id.';
