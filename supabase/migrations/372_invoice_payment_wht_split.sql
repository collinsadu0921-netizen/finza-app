-- ============================================================================
-- Migration 372: post_invoice_payment_to_ledger — WHT suffered split
-- ============================================================================
-- When a customer deducts WHT from their payment (payments.wht_amount > 0):
--   Dr Bank            = (amount - wht_amount) × rate   (net cash received)
--   Dr WHT Receivable  = wht_amount × invoice_fx_rate   (tax credit asset 2155)
--   Cr AR              = amount × invoice_fx_rate        (full gross clears AR)
--
-- When wht_amount = 0 (default): behaviour is identical to migration 364.
-- FX gain/loss (Case 1): computed on cash_debit_home + wht_home vs ar_credit_home.
-- ============================================================================

CREATE OR REPLACE FUNCTION post_invoice_payment_to_ledger(p_payment_id UUID)
RETURNS UUID AS $$
DECLARE
  payment_record       RECORD;
  invoice_record       RECORD;
  business_id_val      UUID;
  ar_account_id        UUID;
  asset_account_id     UUID;
  fx_gain_account_id   UUID;
  fx_loss_account_id   UUID;
  wht_account_id       UUID;
  cash_account_id      UUID;
  bank_account_id      UUID;
  momo_account_id      UUID;
  journal_id           UUID;
  payment_amount       NUMERIC;   -- full invoice amount (gross, in invoice currency)
  v_wht_amount         NUMERIC;   -- WHT deducted by customer (in invoice currency)
  cash_debit_home      NUMERIC;   -- net cash received in home currency
  ar_credit_home       NUMERIC;   -- AR cleared in home currency (gross)
  wht_home             NUMERIC;   -- WHT receivable in home currency
  fx_diff              NUMERIC;   -- FX gain (positive) or loss (negative)
  v_invoice_fx_rate    NUMERIC;
  v_settlement_fx_rate NUMERIC;
  journal_lines        JSONB;
  cash_account_code    TEXT;
  bank_account_code    TEXT;
BEGIN
  -- Fetch payment (including wht_amount and settlement_fx_rate)
  SELECT
    p.business_id,
    p.invoice_id,
    p.amount,
    p.method,
    p.date,
    p.settlement_fx_rate,
    COALESCE(p.wht_amount, 0) AS wht_amount
  INTO payment_record
  FROM payments p
  WHERE p.id = p_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found: %', p_payment_id;
  END IF;

  payment_amount := COALESCE(payment_record.amount, 0);
  IF payment_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid payment amount: %. Payment ID: %', payment_amount, p_payment_id;
  END IF;

  v_wht_amount := payment_record.wht_amount;

  -- Fetch invoice (including FX fields)
  SELECT invoice_number, fx_rate, home_currency_total, total
  INTO invoice_record
  FROM invoices
  WHERE id = payment_record.invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found for payment: %. Invoice ID: %', p_payment_id, payment_record.invoice_id;
  END IF;

  business_id_val      := payment_record.business_id;
  v_invoice_fx_rate    := invoice_record.fx_rate;
  v_settlement_fx_rate := payment_record.settlement_fx_rate;

  IF business_id_val IS NULL THEN
    RAISE EXCEPTION 'Business ID is NULL for payment: %', p_payment_id;
  END IF;

  -- Resolve accounts
  ar_account_id      := get_account_by_control_key(business_id_val, 'AR');
  cash_account_code  := get_control_account_code(business_id_val, 'CASH');
  bank_account_code  := get_control_account_code(business_id_val, 'BANK');
  cash_account_id    := get_account_by_code(business_id_val, cash_account_code);
  bank_account_id    := get_account_by_code(business_id_val, bank_account_code);
  momo_account_id    := get_account_by_code(business_id_val, '1020');
  fx_gain_account_id := get_account_by_code(business_id_val, '4300');
  fx_loss_account_id := get_account_by_code(business_id_val, '5900');

  IF ar_account_id IS NULL THEN
    RAISE EXCEPTION 'AR account not found for business: %. Payment ID: %', business_id_val, p_payment_id;
  END IF;

  IF v_wht_amount > 0 THEN
    PERFORM assert_account_exists(business_id_val, '2155');
    wht_account_id := get_account_by_code(business_id_val, '2155');
  END IF;

  CASE payment_record.method
    WHEN 'cash'   THEN asset_account_id := cash_account_id;
    WHEN 'bank'   THEN asset_account_id := bank_account_id;
    WHEN 'momo'   THEN asset_account_id := momo_account_id;
    WHEN 'card'   THEN asset_account_id := bank_account_id;
    WHEN 'cheque' THEN asset_account_id := bank_account_id;
    ELSE               asset_account_id := cash_account_id;
  END CASE;

  IF asset_account_id IS NULL THEN
    RAISE EXCEPTION 'Asset account for method "%" not found for business: %. Payment ID: %',
      payment_record.method, business_id_val, p_payment_id;
  END IF;

  -- -------------------------------------------------------------------------
  -- FX settlement logic (three cases)
  -- WHT split is applied inside each case when v_wht_amount > 0.
  -- -------------------------------------------------------------------------
  IF v_invoice_fx_rate IS NOT NULL AND v_invoice_fx_rate > 0
     AND v_settlement_fx_rate IS NOT NULL AND v_settlement_fx_rate > 0 THEN

    -- CASE 1: Both rates provided — full FX gain/loss calculation
    ar_credit_home  := ROUND(payment_amount * v_invoice_fx_rate, 2);
    wht_home        := ROUND(v_wht_amount * v_invoice_fx_rate, 2);
    -- Net cash received uses settlement rate; WHT uses booking rate (fixed liability)
    cash_debit_home := ROUND((payment_amount - v_wht_amount) * v_settlement_fx_rate, 2);
    fx_diff         := ROUND(cash_debit_home + wht_home - ar_credit_home, 2);

    journal_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id',  asset_account_id,
        'debit',       cash_debit_home,
        'description', CASE WHEN v_wht_amount > 0
                         THEN 'Payment received net of WHT (FX converted)'
                         ELSE 'Payment received (FX converted)'
                       END
      ),
      jsonb_build_object(
        'account_id',  ar_account_id,
        'credit',      ar_credit_home,
        'description', 'Reduce receivable (FX converted)'
      )
    );

    IF v_wht_amount > 0 THEN
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id',  wht_account_id,
          'debit',       wht_home,
          'description', 'WHT receivable — tax credit (FX converted)'
        )
      );
    END IF;

    IF fx_diff > 0 THEN
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id',  fx_gain_account_id,
          'credit',      fx_diff,
          'description', 'Realized FX gain on settlement'
        )
      );
    ELSIF fx_diff < 0 THEN
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id',  fx_loss_account_id,
          'debit',       ABS(fx_diff),
          'description', 'Realized FX loss on settlement'
        )
      );
    END IF;

  ELSIF v_invoice_fx_rate IS NOT NULL AND v_invoice_fx_rate > 0 THEN

    -- CASE 2: FX invoice but settlement_fx_rate was not supplied.
    --   Fall back to invoice booking rate. No gain/loss line.
    ar_credit_home  := ROUND(payment_amount * v_invoice_fx_rate, 2);
    wht_home        := ROUND(v_wht_amount * v_invoice_fx_rate, 2);
    cash_debit_home := ar_credit_home - wht_home;

    journal_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id',  asset_account_id,
        'debit',       cash_debit_home,
        'description', CASE WHEN v_wht_amount > 0
                         THEN 'Payment received net of WHT (FX at invoice rate)'
                         ELSE 'Payment received (FX at invoice rate — no settlement rate provided)'
                       END
      ),
      jsonb_build_object(
        'account_id',  ar_account_id,
        'credit',      ar_credit_home,
        'description', 'Reduce receivable (FX at invoice rate)'
      )
    );

    IF v_wht_amount > 0 THEN
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id',  wht_account_id,
          'debit',       wht_home,
          'description', 'WHT receivable — tax credit (FX at invoice rate)'
        )
      );
    END IF;

  ELSE

    -- CASE 3: True home-currency invoice — post as-is, no conversion needed.
    journal_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id',  asset_account_id,
        'debit',       payment_amount - v_wht_amount,
        'description', CASE WHEN v_wht_amount > 0
                         THEN 'Payment received net of WHT'
                         ELSE 'Payment received'
                       END
      ),
      jsonb_build_object(
        'account_id',  ar_account_id,
        'credit',      payment_amount,
        'description', 'Reduce receivable'
      )
    );

    IF v_wht_amount > 0 THEN
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id',  wht_account_id,
          'debit',       v_wht_amount,
          'description', 'WHT receivable — tax credit deducted by customer'
        )
      );
    END IF;

  END IF;

  SELECT post_journal_entry(
    business_id_val,
    payment_record.date,
    'Payment for Invoice #' || invoice_record.invoice_number,
    'payment',
    p_payment_id,
    journal_lines
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_invoice_payment_to_ledger(UUID) IS
'Posts an invoice payment to the ledger in home currency.

Case 1 — FX invoice + settlement_fx_rate provided:
  AR credited at invoice.fx_rate × amount (original booking rate)
  Cash/Bank debited at settlement_fx_rate × (amount - wht_amount) (today''s rate)
  WHT Receivable (2155) debited at invoice.fx_rate × wht_amount
  Difference posted as Realized FX Gain (4300) or FX Loss (5900)

Case 2 — FX invoice but settlement_fx_rate is NULL:
  Both AR and Cash converted using invoice.fx_rate (no gain/loss).
  WHT Receivable also at invoice.fx_rate.

Case 3 — Home-currency invoice:
  Dr Bank = amount - wht_amount, Dr WHT Rec = wht_amount, Cr AR = amount.

When wht_amount = 0 (default), all cases behave identically to migration 364.';
