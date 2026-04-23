-- ============================================================================
-- Migration 434: WHT receivable — chart sync, control map, payment posting
-- ============================================================================
-- Fixes:
-- 1) post_invoice_payment_to_ledger used assert_account_exists('2155') while
--    AR/cash/bank already use chart_of_accounts_control_map. Chart rows for
--    2155 could be missing even when accounts.code 2155 exists → cryptic error.
-- 2) Resolve WHT receivable via control key WHT_RECEIVABLE (default 2155),
--    same pattern as AR/CASH/BANK.
-- ============================================================================

-- Ensure chart_of_accounts has WHT Receivable wherever it exists in accounts
INSERT INTO chart_of_accounts (business_id, account_code, account_name, account_type, is_active)
SELECT
  a.business_id,
  a.code,
  a.name,
  CASE WHEN a.type = 'income' THEN 'revenue' ELSE a.type END,
  TRUE
FROM accounts a
WHERE a.deleted_at IS NULL
  AND a.code = '2155'
ON CONFLICT (business_id, account_code) DO UPDATE
SET
  account_name = EXCLUDED.account_name,
  account_type = EXCLUDED.account_type,
  is_active    = TRUE;

-- Default control mapping: WHT_RECEIVABLE → 2155 when that chart row exists
INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
SELECT c.business_id, 'WHT_RECEIVABLE', '2155'
FROM chart_of_accounts c
WHERE c.account_code = '2155'
  AND c.is_active = TRUE
ON CONFLICT (business_id, control_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- initialize_business_chart_of_accounts: add WHT_RECEIVABLE mapping
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION initialize_business_chart_of_accounts(p_business_id UUID)
RETURNS VOID AS $$
DECLARE
  account_record RECORD;
  accounts_synced INTEGER := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM businesses WHERE id = p_business_id) THEN
    RAISE EXCEPTION 'Business not found: %', p_business_id;
  END IF;

  FOR account_record IN
    SELECT
      code,
      name,
      type,
      description
    FROM accounts
    WHERE business_id = p_business_id
      AND deleted_at IS NULL
  LOOP
    INSERT INTO chart_of_accounts (
      business_id,
      account_code,
      account_name,
      account_type,
      is_active
    ) VALUES (
      p_business_id,
      account_record.code,
      account_record.name,
      CASE
        WHEN account_record.type = 'income' THEN 'revenue'
        ELSE account_record.type
      END,
      TRUE
    )
    ON CONFLICT (business_id, account_code) DO UPDATE
    SET
      account_name = EXCLUDED.account_name,
      account_type = EXCLUDED.account_type,
      is_active = TRUE;

    accounts_synced := accounts_synced + 1;
  END LOOP;

  IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = p_business_id AND account_code = '1100') THEN
    INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
    VALUES (p_business_id, 'AR', '1100')
    ON CONFLICT (business_id, control_key) DO NOTHING;
  END IF;

  IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = p_business_id AND account_code = '2000') THEN
    INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
    VALUES (p_business_id, 'AP', '2000')
    ON CONFLICT (business_id, control_key) DO NOTHING;
  END IF;

  IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = p_business_id AND account_code = '1000') THEN
    INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
    VALUES (p_business_id, 'CASH', '1000')
    ON CONFLICT (business_id, control_key) DO NOTHING;
  END IF;

  IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = p_business_id AND account_code = '1010') THEN
    INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
    VALUES (p_business_id, 'BANK', '1010')
    ON CONFLICT (business_id, control_key) DO NOTHING;
  END IF;

  IF EXISTS (
    SELECT 1 FROM chart_of_accounts
    WHERE business_id = p_business_id AND account_code = '2155' AND is_active = TRUE
  ) THEN
    INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
    VALUES (p_business_id, 'WHT_RECEIVABLE', '2155')
    ON CONFLICT (business_id, control_key) DO NOTHING;
  END IF;

  RAISE NOTICE 'Business COA initialized: business_id=%, accounts_synced=%',
    p_business_id, accounts_synced;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION initialize_business_chart_of_accounts IS
  'Syncs accounts → chart_of_accounts and creates control mappings: AR, AP, CASH, BANK, WHT_RECEIVABLE (→2155 when present). Idempotent.';

-- ---------------------------------------------------------------------------
-- post_invoice_payment_to_ledger: resolve WHT via control key
-- ---------------------------------------------------------------------------
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
    IF NOT EXISTS (
      SELECT 1 FROM chart_of_accounts_control_map
      WHERE business_id = business_id_val AND control_key = 'WHT_RECEIVABLE'
    ) THEN
      RAISE EXCEPTION
        'Cannot record this payment with withholding tax: no WHT receivable account is configured (missing control mapping WHT_RECEIVABLE). Open Settings and complete accounting setup, or ensure WHT Receivable exists in your chart. Payment id: %, WHT amount: %',
        p_payment_id, v_wht_amount
      USING ERRCODE = 'P0001';
    END IF;
    wht_account_id := get_account_by_control_key(business_id_val, 'WHT_RECEIVABLE');
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
'Posts invoice payment to ledger. WHT receivable uses control key WHT_RECEIVABLE (see chart_of_accounts_control_map). Paystack clears through BANK.';
