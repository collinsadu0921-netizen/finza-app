-- ============================================================================
-- Migration 389: Bill payment settlement FX rate (mirror invoice payments)
-- ============================================================================
-- 1) bill_payments.settlement_fx_rate — rate at payment time (1 doc unit = X home)
-- 2) post_bill_payment_to_ledger: Dr AP at bill.fx_rate, Cr cash at settlement_fx_rate,
--    FX gain/loss on difference (same pattern as post_invoice_payment_to_ledger)
-- 3) Allow posting when bill status is open, partially_paid, or overdue (follow-up payments)
-- ============================================================================

ALTER TABLE bill_payments
  ADD COLUMN IF NOT EXISTS settlement_fx_rate NUMERIC;

COMMENT ON COLUMN bill_payments.settlement_fx_rate IS
  'Exchange rate at time of payment (1 unit of bill document currency = settlement_fx_rate units of home currency). Required for FX bills when recording payment.';

CREATE INDEX IF NOT EXISTS idx_bill_payments_settlement_fx_rate
  ON bill_payments(settlement_fx_rate) WHERE settlement_fx_rate IS NOT NULL;

CREATE OR REPLACE FUNCTION post_bill_payment_to_ledger(p_bill_payment_id UUID)
RETURNS UUID AS $$
DECLARE
  payment_record       RECORD;
  bill_record          RECORD;
  business_id_val      UUID;
  ap_account_id        UUID;
  asset_account_id     UUID;
  fx_gain_account_id   UUID;
  fx_loss_account_id   UUID;
  cash_account_id      UUID;
  bank_account_id      UUID;
  momo_account_id      UUID;
  journal_id           UUID;
  payment_amount       NUMERIC;
  v_bill_fx_rate       NUMERIC;
  v_settlement_fx_rate NUMERIC;
  ap_debit_home        NUMERIC;
  cash_credit_home     NUMERIC;
  fx_diff              NUMERIC;
  journal_lines        JSONB;
  cash_account_code    TEXT;
  bank_account_code    TEXT;
  ap_account_code      TEXT;
  is_fx_bill           BOOLEAN;
BEGIN
  SELECT
    bp.business_id,
    bp.bill_id,
    bp.amount,
    bp.method,
    bp.date,
    bp.settlement_fx_rate
  INTO payment_record
  FROM bill_payments bp
  WHERE bp.id = p_bill_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill payment not found: %', p_bill_payment_id;
  END IF;

  payment_amount := COALESCE(payment_record.amount, 0);
  IF payment_amount <= 0 OR payment_amount IS NULL THEN
    RAISE EXCEPTION 'Invalid payment amount: %. Bill Payment ID: %', payment_amount, p_bill_payment_id;
  END IF;

  SELECT id, bill_number, status, currency_code, fx_rate
  INTO bill_record
  FROM bills
  WHERE id = payment_record.bill_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found for payment: %. Bill ID: %', p_bill_payment_id, payment_record.bill_id;
  END IF;

  business_id_val := payment_record.business_id;

  IF bill_record.status IS NULL
     OR bill_record.status NOT IN ('open', 'partially_paid', 'overdue') THEN
    RAISE EXCEPTION 'Cannot post payment for bill %, status=% (must be open, partially_paid, or overdue).',
      bill_record.id, bill_record.status;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM journal_entries
    WHERE reference_type = 'bill'
      AND reference_id = payment_record.bill_id
  ) THEN
    PERFORM post_bill_to_ledger(payment_record.bill_id);
  END IF;

  ap_account_code   := get_control_account_code(business_id_val, 'AP');
  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  bank_account_code := get_control_account_code(business_id_val, 'BANK');

  PERFORM assert_account_exists(business_id_val, ap_account_code);
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, bank_account_code);
  PERFORM assert_account_exists(business_id_val, '1020');

  ap_account_id      := get_account_by_control_key(business_id_val, 'AP');
  cash_account_id    := get_account_by_code(business_id_val, cash_account_code);
  bank_account_id    := get_account_by_code(business_id_val, bank_account_code);
  momo_account_id    := get_account_by_code(business_id_val, '1020');
  fx_gain_account_id := get_account_by_code(business_id_val, '4300');
  fx_loss_account_id := get_account_by_code(business_id_val, '5900');

  IF ap_account_id IS NULL THEN
    RAISE EXCEPTION 'AP account not found for business: %. Bill Payment ID: %', business_id_val, p_bill_payment_id;
  END IF;

  CASE payment_record.method
    WHEN 'cash'     THEN asset_account_id := cash_account_id;
    WHEN 'bank'     THEN asset_account_id := bank_account_id;
    WHEN 'momo'     THEN asset_account_id := momo_account_id;
    WHEN 'card'     THEN asset_account_id := bank_account_id;
    WHEN 'cheque'   THEN asset_account_id := bank_account_id;
    WHEN 'paystack' THEN asset_account_id := bank_account_id;
    ELSE               asset_account_id := cash_account_id;
  END CASE;

  IF asset_account_id IS NULL THEN
    RAISE EXCEPTION 'Asset account for method "%" not found for business: %. Bill Payment ID: %. Cash: %, Bank: %, MoMo: %',
      payment_record.method, business_id_val, p_bill_payment_id, cash_account_id, bank_account_id, momo_account_id;
  END IF;

  v_bill_fx_rate       := bill_record.fx_rate;
  v_settlement_fx_rate := payment_record.settlement_fx_rate;
  is_fx_bill           := COALESCE(v_bill_fx_rate, 0) > 0 AND bill_record.currency_code IS NOT NULL;

  IF is_fx_bill
     AND v_settlement_fx_rate IS NOT NULL AND v_settlement_fx_rate > 0 THEN

    PERFORM assert_account_exists(business_id_val, '4300');
    PERFORM assert_account_exists(business_id_val, '5900');

    ap_debit_home    := ROUND(payment_amount * v_bill_fx_rate, 2);
    cash_credit_home := ROUND(payment_amount * v_settlement_fx_rate, 2);
    fx_diff          := ROUND(ap_debit_home - cash_credit_home, 2);

    journal_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id',  ap_account_id,
        'debit',       ap_debit_home,
        'description', 'Reduce payable (FX at bill rate)'
      ),
      jsonb_build_object(
        'account_id',  asset_account_id,
        'credit',      cash_credit_home,
        'description', 'Payment made (FX at settlement rate)'
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

  ELSIF is_fx_bill THEN

    ap_debit_home    := ROUND(payment_amount * v_bill_fx_rate, 2);
    cash_credit_home := ap_debit_home;

    journal_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id',  ap_account_id,
        'debit',       ap_debit_home,
        'description', 'Reduce payable (FX at bill rate — no settlement rate provided)'
      ),
      jsonb_build_object(
        'account_id',  asset_account_id,
        'credit',      cash_credit_home,
        'description', 'Payment made (FX at bill rate — no settlement rate provided)'
      )
    );

  ELSE

    journal_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id',  ap_account_id,
        'debit',       payment_amount,
        'description', 'Reduce payable'
      ),
      jsonb_build_object(
        'account_id',  asset_account_id,
        'credit',      payment_amount,
        'description', 'Payment made'
      )
    );

  END IF;

  SELECT post_journal_entry(
    business_id_val,
    payment_record.date,
    'Payment for Bill #' || bill_record.bill_number,
    'bill_payment',
    p_bill_payment_id,
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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_bill_payment_to_ledger(UUID) IS
  'Posts bill payment: home-currency bills unchanged. FX bills: Dr AP at bill.fx_rate × amount, Cr cash at settlement_fx_rate × amount when set, else both at bill rate. '
  'Realized FX gain/loss (4300/5900) on AP vs cash difference. Bill must be open, partially_paid, or overdue. Ensures bill JE exists.';
