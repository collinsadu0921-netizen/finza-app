-- ============================================================================
-- Migration 386: Map invoice payments with method = paystack to BANK (not CASH)
-- ============================================================================
-- Paystack was added as a payment method (358) but post_invoice_payment_to_ledger
-- had no WHEN branch, so paystack fell through to ELSE → cash. Gateway/card-style
-- collections should debit the business BANK control account (same as card/cheque).
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
  payment_amount       NUMERIC;
  v_wht_amount         NUMERIC;
  cash_debit_home      NUMERIC;
  ar_credit_home       NUMERIC;
  wht_home             NUMERIC;
  fx_diff              NUMERIC;
  v_invoice_fx_rate    NUMERIC;
  v_settlement_fx_rate NUMERIC;
  journal_lines        JSONB;
  cash_account_code    TEXT;
  bank_account_code    TEXT;
BEGIN
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
    WHEN 'cash'    THEN asset_account_id := cash_account_id;
    WHEN 'bank'    THEN asset_account_id := bank_account_id;
    WHEN 'momo'    THEN asset_account_id := momo_account_id;
    WHEN 'card'    THEN asset_account_id := bank_account_id;
    WHEN 'cheque'  THEN asset_account_id := bank_account_id;
    WHEN 'paystack' THEN asset_account_id := bank_account_id;
    ELSE                asset_account_id := cash_account_id;
  END CASE;

  IF asset_account_id IS NULL THEN
    RAISE EXCEPTION 'Asset account for method "%" not found for business: %. Payment ID: %',
      payment_record.method, business_id_val, p_payment_id;
  END IF;

  IF v_invoice_fx_rate IS NOT NULL AND v_invoice_fx_rate > 0
     AND v_settlement_fx_rate IS NOT NULL AND v_settlement_fx_rate > 0 THEN

    ar_credit_home  := ROUND(payment_amount * v_invoice_fx_rate, 2);
    wht_home        := ROUND(v_wht_amount * v_invoice_fx_rate, 2);
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
    p_business_id          => business_id_val,
    p_date                 => payment_record.date,
    p_description          => 'Payment for Invoice #' || invoice_record.invoice_number,
    p_reference_type       => 'payment',
    p_reference_id         => p_payment_id,
    p_lines                => journal_lines,
    p_posting_source       => 'system'
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_invoice_payment_to_ledger(UUID) IS
'Posts an invoice payment to the ledger in home currency.

Case 1 — FX invoice + settlement_fx_rate:
  AR credited at invoice.fx_rate × amount (booking rate)
  Cash/Bank debited at settlement_fx_rate × (amount - wht_amount) (today''s rate)
  WHT Receivable (2155) debited at invoice.fx_rate × wht_amount
  FX Gain (4300) or FX Loss (5900) for difference

Case 2 — FX invoice, no settlement_fx_rate:
  Both AR and Cash at invoice.fx_rate; no gain/loss. WHT at invoice rate.

Case 3 — Home-currency invoice:
  Dr Bank = amount - wht_amount, Dr WHT Rec = wht_amount, Cr AR = amount.

Asset account by method: cash→CASH, bank/card/cheque/paystack→BANK, momo→1020, other→CASH.

When wht_amount = 0 (default), all cases behave identically to migration 364.
Called by post_payment_to_ledger after guard checks (migration 373).
Updated migration 386: paystack clears through BANK control account.';


-- ============================================================================
-- Same mapping for supplier bill payments (method paystack on bill_payments)
-- ============================================================================

CREATE OR REPLACE FUNCTION post_bill_payment_to_ledger(p_bill_payment_id UUID)
RETURNS UUID AS $$
DECLARE
  payment_record RECORD;
  bill_record RECORD;
  business_id_val UUID;
  ap_account_id UUID;
  cash_account_id UUID;
  bank_account_id UUID;
  momo_account_id UUID;
  journal_id UUID;
  asset_account_id UUID;
  payment_amount NUMERIC;
  cash_account_code TEXT;
  bank_account_code TEXT;
  ap_account_code TEXT;
BEGIN
  SELECT
    bp.business_id,
    bp.bill_id,
    bp.amount,
    bp.method,
    bp.date
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

  SELECT id, bill_number, status
  INTO bill_record
  FROM bills
  WHERE id = payment_record.bill_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found for payment: %. Bill ID: %', p_bill_payment_id, payment_record.bill_id;
  END IF;

  business_id_val := payment_record.business_id;

  IF bill_record.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'Cannot post payment for bill %, status=% (must be open).', bill_record.id, bill_record.status;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM journal_entries
    WHERE reference_type = 'bill'
      AND reference_id = payment_record.bill_id
  ) THEN
    PERFORM post_bill_to_ledger(payment_record.bill_id);
  END IF;

  ap_account_code := get_control_account_code(business_id_val, 'AP');
  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  bank_account_code := get_control_account_code(business_id_val, 'BANK');

  PERFORM assert_account_exists(business_id_val, ap_account_code);
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, bank_account_code);
  PERFORM assert_account_exists(business_id_val, '1020');

  ap_account_id := get_account_by_control_key(business_id_val, 'AP');
  cash_account_id := get_account_by_code(business_id_val, cash_account_code);
  bank_account_id := get_account_by_code(business_id_val, bank_account_code);
  momo_account_id := get_account_by_code(business_id_val, '1020');

  IF ap_account_id IS NULL THEN
    RAISE EXCEPTION 'AP account not found for business: %. Bill Payment ID: %', business_id_val, p_bill_payment_id;
  END IF;

  CASE payment_record.method
    WHEN 'cash' THEN asset_account_id := cash_account_id;
    WHEN 'bank' THEN asset_account_id := bank_account_id;
    WHEN 'momo' THEN asset_account_id := momo_account_id;
    WHEN 'card' THEN asset_account_id := bank_account_id;
    WHEN 'cheque' THEN asset_account_id := bank_account_id;
    WHEN 'paystack' THEN asset_account_id := bank_account_id;
    ELSE asset_account_id := cash_account_id;
  END CASE;

  IF asset_account_id IS NULL THEN
    RAISE EXCEPTION 'Asset account for method "%" not found for business: %. Bill Payment ID: %. Cash: %, Bank: %, MoMo: %',
      payment_record.method, business_id_val, p_bill_payment_id, cash_account_id, bank_account_id, momo_account_id;
  END IF;

  SELECT post_journal_entry(
    business_id_val,
    payment_record.date,
    'Payment for Bill #' || bill_record.bill_number,
    'bill_payment',
    p_bill_payment_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', ap_account_id,
        'debit', payment_amount,
        'description', 'Reduce payable'
      ),
      jsonb_build_object(
        'account_id', asset_account_id,
        'credit', payment_amount,
        'description', 'Payment made'
      )
    ),
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
  'Posts bill payment to ledger. Bill must be open and posted first. Ensures bill JE exists (calls post_bill_to_ledger if missing). posting_source = system. Paystack credits BANK control account (migration 386).';
