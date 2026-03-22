-- ============================================================================
-- Migration 379: Fix invoice ledger rounding imbalance on FX invoices
-- ============================================================================
-- Root cause (migration 355):
--   gross    = invoice.home_currency_total              (stored rounded value)
--   subtotal = ROUND(invoice.subtotal * fx_rate, 2)     (independently rounded)
--   each tax = ROUND(usd_tax_amount  * fx_rate, 2)      (independently rounded)
--
-- Because each component is rounded separately,
--   subtotal + NHIL + GETFund + VAT  ≠  gross
-- by up to ±0.0N depending on how many tax lines there are.
-- This produces an "Unbalanced" journal entry (observed: off by 0.01).
--
-- Fix (two-pass approach):
--   Pass 1 — convert every tax line amount to home currency (ROUND each),
--             accumulate net_tax_credits and net_tax_debits.
--   Derive  — revenue_credit := gross + net_tax_debits - net_tax_credits
--             so that Dr AR = Cr Revenue + Cr tax lines − Dr tax lines exactly.
--   Pass 2 — re-iterate the same tax_lines array to emit journal line objects,
--             using the already-accumulated rounded amounts.
--
--   This guarantees the journal entry is always balanced regardless of how
--   the individual rounded tax components distribute.
--
-- Home-currency invoices (fx_rate IS NULL) are unaffected — the derivation
-- still produces the correct revenue credit (gross - sum(credit taxes)).
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
  gross NUMERIC;           -- AR debit: authoritative home-currency total
  revenue_credit NUMERIC;  -- derived so debits = credits exactly
  posting_date DATE;
  tax_lines_jsonb JSONB;
  tax_line_item JSONB;
  journal_lines JSONB;
  tax_account_id UUID;
  tax_code TEXT;
  tax_amount NUMERIC;
  tax_ledger_side TEXT;
  tax_ledger_account_code TEXT;
  tax_lines_posted INTEGER := 0;
  existing_je_id UUID;
  -- FX
  v_fx_rate NUMERIC;
  -- Pass-1 accumulators for balance derivation
  net_tax_credits NUMERIC := 0;
  net_tax_debits  NUMERIC := 0;
  -- Pass-1 stores resolved tax lines as JSONB for pass-2 emission
  -- Each element: {"account_id":..., "amount":..., "side":..., "description":...}
  resolved_tax_lines JSONB := '[]'::JSONB;
  r_tax JSONB;
BEGIN
  -- -------------------------------------------------------------------------
  -- 1. Fetch invoice
  -- -------------------------------------------------------------------------
  SELECT
    i.business_id,
    i.total,
    i.subtotal,
    i.total_tax,
    i.customer_id,
    i.invoice_number,
    i.issue_date,
    i.sent_at,
    i.tax_lines,
    i.fx_rate,
    i.home_currency_total
  INTO invoice_record
  FROM invoices i
  WHERE i.id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found: %', p_invoice_id;
  END IF;

  business_id_val := invoice_record.business_id;
  v_fx_rate       := invoice_record.fx_rate;

  -- -------------------------------------------------------------------------
  -- 2. Authoritative gross (AR debit) in home currency
  -- -------------------------------------------------------------------------
  IF v_fx_rate IS NOT NULL AND v_fx_rate > 0 THEN
    gross := COALESCE(
      invoice_record.home_currency_total,
      ROUND(COALESCE(invoice_record.total, 0) * v_fx_rate, 2)
    );
  ELSE
    gross := COALESCE(invoice_record.total, 0);
    IF gross = 0 THEN
      gross := COALESCE(invoice_record.subtotal, 0)
             + COALESCE(invoice_record.total_tax, 0);
    END IF;
  END IF;

  -- -------------------------------------------------------------------------
  -- 3. Posting date
  -- -------------------------------------------------------------------------
  posting_date := COALESCE(
    (invoice_record.sent_at AT TIME ZONE 'UTC')::DATE,
    invoice_record.issue_date
  );
  IF posting_date IS NULL THEN
    RAISE EXCEPTION
      'Invoice has no issue_date or sent_at. Cannot post to ledger. Invoice id: %',
      p_invoice_id;
  END IF;

  -- -------------------------------------------------------------------------
  -- 4. Resolve AR account
  -- -------------------------------------------------------------------------
  ar_account_id := get_account_by_control_key(business_id_val, 'AR');
  PERFORM assert_account_exists(
    business_id_val,
    get_control_account_code(business_id_val, 'AR')
  );
  IF ar_account_id IS NULL THEN
    RAISE EXCEPTION 'AR account not found for business: %', business_id_val;
  END IF;

  -- -------------------------------------------------------------------------
  -- 5. Advisory lock + idempotency guard
  -- -------------------------------------------------------------------------
  PERFORM pg_advisory_xact_lock(
    hashtext(business_id_val::text),
    hashtext(p_invoice_id::text)
  );

  SELECT je.id INTO existing_je_id
  FROM journal_entries je
  JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
  WHERE je.business_id    = business_id_val
    AND je.reference_type = 'invoice'
    AND je.reference_id   = p_invoice_id
    AND jel.account_id    = ar_account_id
  LIMIT 1;

  IF existing_je_id IS NOT NULL THEN
    RETURN existing_je_id;
  END IF;

  -- -------------------------------------------------------------------------
  -- 6. Period guard
  -- -------------------------------------------------------------------------
  PERFORM assert_accounting_period_is_open(business_id_val, posting_date);

  -- -------------------------------------------------------------------------
  -- 7. Revenue account
  -- -------------------------------------------------------------------------
  PERFORM assert_account_exists(business_id_val, '4000');
  revenue_account_id := get_account_by_code(business_id_val, '4000');
  IF revenue_account_id IS NULL THEN
    RAISE EXCEPTION 'Revenue account (4000) not found for business: %', business_id_val;
  END IF;

  -- -------------------------------------------------------------------------
  -- 8. PASS 1: parse tax_lines → convert to home currency → accumulate totals
  --            store resolved lines in JSONB array for pass 2
  -- -------------------------------------------------------------------------
  tax_lines_jsonb := invoice_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    -- Unwrap optional outer object wrapper
    IF jsonb_typeof(tax_lines_jsonb) = 'object' THEN
      IF    tax_lines_jsonb ? 'tax_lines' THEN tax_lines_jsonb := tax_lines_jsonb->'tax_lines';
      ELSIF tax_lines_jsonb ? 'lines'     THEN tax_lines_jsonb := tax_lines_jsonb->'lines';
      END IF;
    END IF;

    IF jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_jsonb)
      LOOP
        IF NOT (tax_line_item ? 'code' AND tax_line_item ? 'amount') THEN
          CONTINUE;
        END IF;

        tax_code                := tax_line_item->>'code';
        tax_amount              := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
        tax_ledger_account_code := tax_line_item->>'ledger_account_code';
        tax_ledger_side         := tax_line_item->>'ledger_side';

        -- Convert to home currency (round per line)
        IF v_fx_rate IS NOT NULL AND v_fx_rate > 0 THEN
          tax_amount := ROUND(tax_amount * v_fx_rate, 2);
        END IF;

        IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
          PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
          tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);

          -- Accumulate for revenue derivation
          IF tax_ledger_side = 'credit' THEN
            net_tax_credits  := net_tax_credits  + tax_amount;
            tax_lines_posted := tax_lines_posted + 1;
          ELSIF tax_ledger_side = 'debit' THEN
            net_tax_debits   := net_tax_debits   + tax_amount;
            tax_lines_posted := tax_lines_posted + 1;
          END IF;

          -- Store resolved line for pass 2
          resolved_tax_lines := resolved_tax_lines || jsonb_build_array(
            jsonb_build_object(
              'account_id',  tax_account_id,
              'amount',      tax_amount,
              'side',        tax_ledger_side,
              'description', COALESCE(tax_code, 'Tax') || ' tax'
            )
          );
        END IF;
      END LOOP;
    END IF;
  END IF;

  IF COALESCE(invoice_record.total_tax, 0) > 0 AND tax_lines_posted = 0 THEN
    RAISE EXCEPTION
      'Invoice total_tax > 0 but no tax journal lines were posted. '
      'Aborting to prevent silent imbalance.';
  END IF;

  -- -------------------------------------------------------------------------
  -- 9. Derive revenue credit so the entry balances exactly:
  --      Dr AR (gross)  +  Dr tax_debits  =  Cr Revenue  +  Cr tax_credits
  --   ∴  Cr Revenue = gross + net_tax_debits - net_tax_credits
  -- -------------------------------------------------------------------------
  revenue_credit := gross + net_tax_debits - net_tax_credits;

  -- -------------------------------------------------------------------------
  -- 10. PASS 2: build journal lines (AR debit + Revenue credit + tax lines)
  -- -------------------------------------------------------------------------
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id',  ar_account_id,
      'debit',       gross,
      'description', CASE WHEN v_fx_rate IS NOT NULL
                       THEN 'Invoice receivable (FX converted)'
                       ELSE 'Invoice receivable'
                     END
    ),
    jsonb_build_object(
      'account_id',  revenue_account_id,
      'credit',      revenue_credit,
      'description', 'Service revenue'
    )
  );

  FOR r_tax IN SELECT * FROM jsonb_array_elements(resolved_tax_lines)
  LOOP
    IF (r_tax->>'side') = 'credit' THEN
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id',  (r_tax->>'account_id')::UUID,
          'credit',      (r_tax->>'amount')::NUMERIC,
          'description', r_tax->>'description'
        )
      );
    ELSIF (r_tax->>'side') = 'debit' THEN
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id',  (r_tax->>'account_id')::UUID,
          'debit',       (r_tax->>'amount')::NUMERIC,
          'description', r_tax->>'description'
        )
      );
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 11. Post the balanced journal entry
  -- -------------------------------------------------------------------------
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
'Accrual AR posting at invoice finalisation. Dr AR / Cr Revenue + Cr Tax lines.
Idempotent (advisory lock + reference_id check).

FX invoices (fx_rate IS NOT NULL):
  gross         = invoice.home_currency_total (authoritative stored value).
  Each tax line = ROUND(usd_amount * fx_rate, 2) — rounded per line.
  Revenue credit is DERIVED as gross + net_tax_debits - net_tax_credits so that
  the journal entry is always balanced by construction, eliminating the ±0.01
  rounding imbalance that arose when subtotal was also independently rounded.

Home-currency invoices (fx_rate IS NULL):
  gross = invoice.total. Revenue credit derived the same way.
  Behaviour is identical to pre-379 for invoices with no tax lines.

Migration history: 355 (original FX support) → 379 (rounding fix).';
