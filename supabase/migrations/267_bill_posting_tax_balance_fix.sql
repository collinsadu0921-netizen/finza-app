-- ============================================================================
-- Fix: post_bill_to_ledger creates balanced JE when bill has taxes
-- ============================================================================
-- Symptom: When bill has taxes, only Dr Expense (subtotal) and Cr AP (total)
-- were posted; input VAT/tax debit lines were missing → unbalanced.
--
-- Fix:
-- 1. Expense debit = subtotal (unchanged).
-- 2. When tax_lines JSONB has lines with ledger_account_code + ledger_side,
--    use them (unchanged).
-- 3. When tax_lines is empty or yields no tax debits but bill has total_tax
--    or nhil/getfund/vat/covid columns set, add input tax debit lines from
--    columns (VAT 2100, NHIL 2110, GETFund 2120, COVID 2130) so that
--    SUM(debits) = subtotal + total_tax = total = SUM(credits).
-- ============================================================================

DROP FUNCTION IF EXISTS post_bill_to_ledger(UUID, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS post_bill_to_ledger(UUID) CASCADE;

CREATE OR REPLACE FUNCTION post_bill_to_ledger(
  p_bill_id UUID,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  bill_record RECORD;
  business_id_val UUID;
  ap_account_id UUID;
  expense_account_id UUID;
  journal_id UUID;
  tax_lines_jsonb JSONB;
  tax_line_item JSONB;
  parsed_tax_lines JSONB[] := ARRAY[]::JSONB[];
  journal_lines JSONB;
  tax_account_id UUID;
  tax_code TEXT;
  tax_amount NUMERIC;
  tax_ledger_side TEXT;
  tax_ledger_account_code TEXT;
  ap_account_code TEXT;
  tax_added_from_jsonb NUMERIC := 0;
  v_nhil NUMERIC;
  v_getfund NUMERIC;
  v_vat NUMERIC;
  v_covid NUMERIC;
  v_total_tax NUMERIC;
BEGIN
  -- Get bill details (include tax columns for fallback when tax_lines empty)
  SELECT 
    b.business_id,
    b.total,
    b.subtotal,
    b.total_tax,
    b.nhil,
    b.getfund,
    b.vat,
    b.covid,
    b.bill_number,
    b.issue_date,
    b.tax_lines
  INTO bill_record
  FROM bills b
  WHERE b.id = p_bill_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found: %', p_bill_id;
  END IF;

  business_id_val := bill_record.business_id;

  -- GUARD: Assert accounting period is open
  PERFORM assert_accounting_period_is_open(business_id_val, bill_record.issue_date);

  -- Parse tax_lines JSONB metadata
  tax_lines_jsonb := bill_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    IF jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'tax_lines' THEN
      tax_lines_jsonb := tax_lines_jsonb->'tax_lines';
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

  -- Tax from columns (for fallback)
  v_nhil   := COALESCE(bill_record.nhil, 0);
  v_getfund := COALESCE(bill_record.getfund, 0);
  v_vat    := COALESCE(bill_record.vat, 0);
  v_covid  := COALESCE(bill_record.covid, 0);
  v_total_tax := COALESCE(bill_record.total_tax, v_nhil + v_getfund + v_vat + v_covid);

  -- COA GUARD: Resolve and validate all account codes BEFORE any inserts
  ap_account_code := get_control_account_code(business_id_val, 'AP');
  PERFORM assert_account_exists(business_id_val, ap_account_code);
  PERFORM assert_account_exists(business_id_val, '5200');

  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  -- Assert tax accounts exist when we will use column fallback
  IF v_total_tax > 0 THEN
    PERFORM assert_account_exists(business_id_val, '2100');
    IF v_nhil > 0 THEN PERFORM assert_account_exists(business_id_val, '2110'); END IF;
    IF v_getfund > 0 THEN PERFORM assert_account_exists(business_id_val, '2120'); END IF;
    IF v_covid > 0 THEN PERFORM assert_account_exists(business_id_val, '2130'); END IF;
  END IF;

  ap_account_id := get_account_by_control_key(business_id_val, 'AP');
  expense_account_id := get_account_by_code(business_id_val, '5200');

  -- 1) Expense debit = subtotal (before tax). 2) AP credit = bill total.
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', expense_account_id,
      'debit', bill_record.subtotal,
      'description', 'Supplier bill expense'
    ),
    jsonb_build_object(
      'account_id', ap_account_id,
      'credit', bill_record.total,
      'description', 'Bill payable'
    )
  );

  -- Add tax lines from tax_lines JSONB when present and valid
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
      ELSIF tax_ledger_side = 'debit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'debit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax'
          )
        );
        tax_added_from_jsonb := tax_added_from_jsonb + tax_amount;
      END IF;
    END IF;
  END LOOP;

  -- Fallback: when bill has tax but tax_lines didn't yield input tax debits, use columns
  -- so that SUM(debits) = subtotal + total_tax = total = SUM(credits)
  IF v_total_tax > 0 AND tax_added_from_jsonb <= 0 THEN
    IF v_vat > 0 THEN
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', get_account_by_code(business_id_val, '2100'),
          'debit', v_vat,
          'description', 'VAT input tax'
        )
      );
    END IF;
    IF v_nhil > 0 THEN
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', get_account_by_code(business_id_val, '2110'),
          'debit', v_nhil,
          'description', 'NHIL input tax'
        )
      );
    END IF;
    IF v_getfund > 0 THEN
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', get_account_by_code(business_id_val, '2120'),
          'debit', v_getfund,
          'description', 'GETFund input tax'
        )
      );
    END IF;
    IF v_covid > 0 THEN
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', get_account_by_code(business_id_val, '2130'),
          'debit', v_covid,
          'description', 'COVID levy (legacy) input tax'
        )
      );
    END IF;
    -- If total_tax set but no column breakdown, post single line to 2100
    IF (v_nhil + v_getfund + v_vat + v_covid) <= 0 AND v_total_tax > 0 THEN
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', get_account_by_code(business_id_val, '2100'),
          'debit', v_total_tax,
          'description', 'Input tax'
        )
      );
    END IF;
  END IF;

  SELECT post_journal_entry(
    business_id_val,
    bill_record.issue_date,
    'Bill #' || bill_record.bill_number,
    'bill',
    p_bill_id,
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

COMMENT ON FUNCTION post_bill_to_ledger(UUID, TEXT, TEXT, TEXT) IS
  'Posts bill to ledger: Dr Expense (subtotal), Dr input tax when applicable (from tax_lines or nhil/getfund/vat/covid), Cr AP (total). Balanced. posting_source=system.';
