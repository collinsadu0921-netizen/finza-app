-- ============================================================================
-- Migration 626: FX-aware credit-note ledger posting
-- ============================================================================
-- Credit notes inherit their invoice currency. The ledger must post the
-- credit note in the business home currency, matching the invoice's recorded
-- fx_rate convention. Previously the posting used document-currency amounts,
-- so FX credit notes did not reconcile to the GHS ledger.
--
-- This is a targeted replacement of the existing credit-note posting body.
-- It does not change posted journals or historical rows.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.post_credit_note_to_ledger_pkgb_body(
  p_credit_note_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  cn_record RECORD;
  invoice_record RECORD;
  business_id_val UUID;
  ar_account_id UUID;
  revenue_account_id UUID;
  journal_id UUID;
  subtotal NUMERIC;
  v_fx_rate NUMERIC := 1;
  tax_lines_jsonb JSONB;
  tax_lines_array JSONB;
  tax_line_item JSONB;
  parsed_tax_lines JSONB[] := ARRAY[]::JSONB[];
  journal_lines JSONB;
  tax_account_id UUID;
  tax_code TEXT;
  tax_amount NUMERIC;
  tax_ledger_side TEXT;
  tax_ledger_account_code TEXT;
  ar_account_code TEXT;
  line_meta JSONB;
BEGIN
  SELECT
    cn.business_id,
    cn.invoice_id,
    cn.total,
    cn.subtotal,
    cn.total_tax,
    cn.credit_number,
    cn.date,
    cn.tax_lines
  INTO cn_record
  FROM public.credit_notes cn
  WHERE cn.id = p_credit_note_id
    AND cn.status = 'applied';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Applied credit note not found: %', p_credit_note_id;
  END IF;

  SELECT invoice_number, fx_rate, currency_code
  INTO invoice_record
  FROM public.invoices
  WHERE id = cn_record.invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found for credit note: %. Invoice ID: %',
      p_credit_note_id, cn_record.invoice_id;
  END IF;

  business_id_val := cn_record.business_id;

  IF invoice_record.currency_code IS NOT NULL
     AND COALESCE(invoice_record.fx_rate, 0) > 0 THEN
    v_fx_rate := invoice_record.fx_rate;
  ELSIF invoice_record.currency_code IS NOT NULL
        AND invoice_record.currency_code <> (
          SELECT COALESCE(default_currency, 'GHS')
          FROM public.businesses
          WHERE id = business_id_val
        ) THEN
    RAISE EXCEPTION
      'CREDIT_NOTE_FX_RATE_MISSING: credit note % references a % invoice without a valid exchange rate',
      p_credit_note_id, invoice_record.currency_code;
  END IF;

  PERFORM public.assert_accounting_period_is_open(business_id_val, cn_record.date);

  subtotal := ROUND(COALESCE(cn_record.subtotal, 0) * v_fx_rate, 2);

  tax_lines_jsonb := cn_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    IF jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'lines' THEN
      tax_lines_array := tax_lines_jsonb->'lines';
      IF jsonb_typeof(tax_lines_array) = 'array' THEN
        FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_array)
        LOOP
          IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
            parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
          END IF;
        END LOOP;
      END IF;
    ELSIF jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'tax_lines' THEN
      tax_lines_array := tax_lines_jsonb->'tax_lines';
      IF jsonb_typeof(tax_lines_array) = 'array' THEN
        FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_array)
        LOOP
          IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
            parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
          END IF;
        END LOOP;
      END IF;
    ELSIF jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_jsonb)
      LOOP
        IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
          parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
        END IF;
      END LOOP;
    END IF;
  END IF;

  ar_account_code := public.get_control_account_code(business_id_val, 'AR');
  PERFORM public.assert_account_exists(business_id_val, ar_account_code);
  PERFORM public.assert_account_exists(business_id_val, '4000');

  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    line_meta := tax_line_item->'meta';
    IF line_meta IS NOT NULL AND line_meta ? 'ledger_account_code' THEN
      tax_ledger_account_code := line_meta->>'ledger_account_code';
    ELSIF tax_line_item ? 'ledger_account_code' THEN
      tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    ELSE
      tax_ledger_account_code := NULL;
    END IF;

    IF tax_ledger_account_code IS NOT NULL
       AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM public.assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  ar_account_id := public.get_account_by_control_key(business_id_val, 'AR');
  revenue_account_id := public.get_account_by_code(business_id_val, '4000');

  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', ar_account_id,
      'credit', ROUND(COALESCE(cn_record.total, 0) * v_fx_rate, 2),
      'description', 'Credit note receivable reduction'
    ),
    jsonb_build_object(
      'account_id', revenue_account_id,
      'debit', subtotal,
      'description', 'Service revenue reduction'
    )
  );

  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := ROUND(
      COALESCE((tax_line_item->>'amount')::NUMERIC, 0) * v_fx_rate,
      2
    );

    line_meta := tax_line_item->'meta';
    IF line_meta IS NOT NULL AND line_meta ? 'ledger_account_code' THEN
      tax_ledger_account_code := line_meta->>'ledger_account_code';
    ELSIF tax_line_item ? 'ledger_account_code' THEN
      tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    ELSE
      tax_ledger_account_code := NULL;
    END IF;

    IF line_meta IS NOT NULL AND line_meta ? 'ledger_side' THEN
      tax_ledger_side := line_meta->>'ledger_side';
    ELSIF tax_line_item ? 'ledger_side' THEN
      tax_ledger_side := tax_line_item->>'ledger_side';
    ELSE
      tax_ledger_side := NULL;
    END IF;

    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := public.get_account_by_code(
        business_id_val,
        tax_ledger_account_code
      );

      IF tax_ledger_side = 'credit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'debit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax reversal'
          )
        );
      ELSIF tax_ledger_side = 'debit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'credit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax reversal'
          )
        );
      END IF;
    END IF;
  END LOOP;

  SELECT public.post_journal_entry(
    business_id_val,
    cn_record.date,
    'Credit Note #' || cn_record.credit_number
      || ' for Invoice #' || invoice_record.invoice_number,
    'credit_note',
    p_credit_note_id,
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

  RETURN journal_id;
END;
$$;

COMMENT ON FUNCTION public.post_credit_note_to_ledger_pkgb_body(UUID) IS
  'Posts an applied credit note in the business home currency. FX credit notes inherit the invoice fx_rate; missing FX evidence fails closed. Tax lines are reversed through the canonical posting function.';

REVOKE ALL ON FUNCTION public.post_credit_note_to_ledger_pkgb_body(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_credit_note_to_ledger_pkgb_body(UUID)
  TO authenticated, service_role, postgres;
