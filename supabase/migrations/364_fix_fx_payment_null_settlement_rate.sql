-- Fix: FX invoice payments with no settlement_fx_rate posted raw foreign amount as home currency
--
-- BEFORE this fix, post_invoice_payment_to_ledger had two branches:
--   1. invoice.fx_rate IS NOT NULL AND settlement_fx_rate IS NOT NULL → correct FX conversion
--   2. else → post payment.amount directly in home currency (BUG: USD amount posted as GHS)
--
-- If settlement_fx_rate was NULL (not supplied by the UI), USD 20,000 was booked as GHS 20,000.
--
-- FIX: Add a third branch: FX invoice but settlement_fx_rate missing →
--   use invoice.fx_rate as fallback so the amount is still converted correctly.
--   No gain/loss line is posted (rates treated as identical). A note is added to the description.

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
  cash_account_id      UUID;
  bank_account_id      UUID;
  momo_account_id      UUID;
  journal_id           UUID;
  payment_amount       NUMERIC;  -- in invoice currency (FX or home)
  cash_debit_home      NUMERIC;  -- cash received in home currency
  ar_credit_home       NUMERIC;  -- AR portion cleared in home currency
  fx_diff              NUMERIC;  -- gain (positive) or loss (negative)
  v_invoice_fx_rate    NUMERIC;  -- rate when invoice was issued
  v_settlement_fx_rate NUMERIC;  -- rate when payment was received (may be NULL)
  journal_lines        JSONB;
  cash_account_code    TEXT;
  bank_account_code    TEXT;
BEGIN
  -- Fetch payment (including settlement_fx_rate)
  SELECT
    p.business_id,
    p.invoice_id,
    p.amount,
    p.method,
    p.date,
    p.settlement_fx_rate
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
  -- -------------------------------------------------------------------------
  IF v_invoice_fx_rate IS NOT NULL AND v_invoice_fx_rate > 0
     AND v_settlement_fx_rate IS NOT NULL AND v_settlement_fx_rate > 0 THEN

    -- CASE 1: Both rates provided — full FX gain/loss calculation
    ar_credit_home := ROUND(payment_amount * v_invoice_fx_rate, 2);
    cash_debit_home := ROUND(payment_amount * v_settlement_fx_rate, 2);
    fx_diff := ROUND(cash_debit_home - ar_credit_home, 2);

    journal_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id',  asset_account_id,
        'debit',       cash_debit_home,
        'description', 'Payment received (FX converted)'
      ),
      jsonb_build_object(
        'account_id',  ar_account_id,
        'credit',      ar_credit_home,
        'description', 'Reduce receivable (FX converted)'
      )
    );

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
    --   Fall back to the invoice booking rate so the amount is still converted
    --   correctly. No gain/loss line (treated as same-rate settlement).
    --   This prevents the foreign-currency amount from being posted as home currency.
    ar_credit_home := ROUND(payment_amount * v_invoice_fx_rate, 2);

    journal_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id',  asset_account_id,
        'debit',       ar_credit_home,
        'description', 'Payment received (FX at invoice rate — no settlement rate provided)'
      ),
      jsonb_build_object(
        'account_id',  ar_account_id,
        'credit',      ar_credit_home,
        'description', 'Reduce receivable (FX at invoice rate)'
      )
    );

  ELSE

    -- CASE 3: True home-currency invoice — post as-is, no conversion needed.
    journal_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id',  asset_account_id,
        'debit',       payment_amount,
        'description', 'Payment received'
      ),
      jsonb_build_object(
        'account_id',  ar_account_id,
        'credit',      payment_amount,
        'description', 'Reduce receivable'
      )
    );

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
  Cash/Bank debited at settlement_fx_rate × amount (today''s rate)
  Difference posted as Realized FX Gain (4300) or FX Loss (5900)

Case 2 — FX invoice but settlement_fx_rate is NULL:
  Both AR and Cash converted using invoice.fx_rate (no gain/loss).
  This is a safe fallback: prevents foreign-currency amount from being
  posted directly as home currency.

Case 3 — Home-currency invoice:
  Amount posted as-is, no conversion.';
