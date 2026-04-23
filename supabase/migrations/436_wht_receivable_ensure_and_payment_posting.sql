-- ============================================================================
-- Migration 436: WHT receivable — system accounts, control map, payment posting
-- ============================================================================
-- Problems:
--   • create_system_accounts (366+) no longer inserted WHT Receivable (2155),
--     so new businesses never got the account even though invoice WHT expects it.
--   • post_invoice_payment_to_ledger required WHT_RECEIVABLE mapping but chart
--     sync was easy to miss for legacy tenants.
-- Fixes:
--   1) Re-add WHT Receivable 2155 (asset) to create_system_accounts.
--   2) resolve_wht_receivable_account_code: valid mapping, then 2155, then name match.
--   3) ensure_wht_receivable_account_id: create_system_accounts + chart + control map
--      + return accounts.id (never a code with no row for this business).
--   4) post_invoice_payment_to_ledger uses ensure_* and a clear Settings error.
--   5) initialize_business_chart_of_accounts calls ensure_* at end.
--   6) Backfill: Ghana businesses + any business with WHT payments or WHT invoices.
-- Journal (unchanged): Dr Bank/Cash/MoMo net, Dr WHT receivable, Cr AR full applied.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) create_system_accounts — restore WHT Receivable (2155) for all new businesses
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_system_accounts(p_business_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Assets
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Cash',                       '1000', 'asset',     'Cash on hand',                                                          TRUE),
    (p_business_id, 'Bank',                       '1010', 'asset',     'Bank account',                                                          TRUE),
    (p_business_id, 'Mobile Money',               '1020', 'asset',     'Mobile money accounts',                                                 TRUE),
    (p_business_id, 'Accounts Receivable',        '1100', 'asset',     'Amounts owed by customers',                                             TRUE),
    (p_business_id, 'Staff Advances',             '1110', 'asset',     'Salary advances issued to employees',                                   TRUE),
    (p_business_id, 'WHT Receivable',             '2155', 'asset',     'Withholding tax deducted from your payments by customers',               TRUE),
    (p_business_id, 'Fixed Assets',               '1600', 'asset',     'Fixed assets including equipment, vehicles, and property',              TRUE),
    (p_business_id, 'Accumulated Depreciation',   '1650', 'asset',     'Accumulated depreciation on fixed assets',                              TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Liabilities — Current
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Accounts Payable',                    '2000', 'liability', 'Amounts owed to suppliers',                        TRUE),
    (p_business_id, 'VAT Payable',                         '2100', 'liability', 'VAT output tax minus input tax',                   TRUE),
    (p_business_id, 'NHIL Payable',                        '2110', 'liability', 'NHIL output tax minus input tax',                  TRUE),
    (p_business_id, 'GETFund Payable',                     '2120', 'liability', 'GETFund output tax minus input tax',               TRUE),
    (p_business_id, 'COVID Levy Payable',                  '2130', 'liability', 'COVID-19 Health Recovery Levy payable',            TRUE),
    (p_business_id, 'Other Tax Liabilities',               '2200', 'liability', 'Other tax obligations',                           TRUE),
    (p_business_id, 'PAYE Liability',                      '2210', 'liability', 'PAYE tax payable to GRA',                         TRUE),
    (p_business_id, 'SSNIT Employee Contribution Payable', '2220', 'liability', 'SSNIT employee contributions payable',            TRUE),
    (p_business_id, 'SSNIT Employer Contribution Payable', '2230', 'liability', 'SSNIT employer contributions payable',            TRUE),
    (p_business_id, 'Net Salaries Payable',                '2240', 'liability', 'Net salaries payable to employees',               TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Liabilities — Loan
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Short-term Loan',      '2300', 'liability', 'Loans and overdrafts repayable within 12 months',   TRUE),
    (p_business_id, 'Long-term Bank Loan',  '2310', 'liability', 'Loans repayable after 12 months',                   TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Equity
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Owner''s Equity',  '3000', 'equity', 'Owner investment',       TRUE),
    (p_business_id, 'Retained Earnings','3100', 'equity', 'Accumulated profits',    TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Income
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Service Revenue',        '4000', 'income', 'Revenue from services',                    TRUE),
    (p_business_id, 'Gain on Asset Disposal', '4200', 'income', 'Gains from disposal of fixed assets',      TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Expenses
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Cost of Sales',               '5000', 'expense', 'Direct costs',                                  TRUE),
    (p_business_id, 'Operating Expenses',          '5100', 'expense', 'General operating expenses',                    TRUE),
    (p_business_id, 'Supplier Bills',              '5200', 'expense', 'Supplier invoices',                             TRUE),
    (p_business_id, 'Administrative Expenses',     '5300', 'expense', 'Admin and overhead',                            TRUE),
    (p_business_id, 'Depreciation Expense',        '5700', 'expense', 'Depreciation expense for fixed assets',         TRUE),
    (p_business_id, 'Loss on Asset Disposal',      '5800', 'expense', 'Losses from disposal of fixed assets',          TRUE),
    (p_business_id, 'Payroll Expense',             '6000', 'expense', 'Employee salaries and wages',                   TRUE),
    (p_business_id, 'Employer SSNIT Contribution', '6010', 'expense', 'Employer SSNIT contributions',                  TRUE),
    (p_business_id, 'Interest Expense',            '6300', 'expense', 'Interest on loans and borrowings',              TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_system_accounts(UUID) IS
  'Idempotent system accounts for a business. Includes WHT Receivable (2155, asset) for Ghana invoice WHT.';

-- ---------------------------------------------------------------------------
-- 2) resolve_wht_receivable_account_code — mapping, default 2155, or name match
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_wht_receivable_account_code(p_business_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_code TEXT;
BEGIN
  -- Prefer an existing control mapping only if it points to a real asset + chart row
  SELECT m.account_code INTO v_code
  FROM chart_of_accounts_control_map m
  INNER JOIN accounts a
    ON a.business_id = m.business_id
   AND a.code = m.account_code
   AND a.deleted_at IS NULL
   AND a.type = 'asset'
  INNER JOIN chart_of_accounts c
    ON c.business_id = m.business_id
   AND c.account_code = m.account_code
   AND c.is_active = TRUE
  WHERE m.business_id = p_business_id
    AND m.control_key = 'WHT_RECEIVABLE'
  LIMIT 1;

  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  IF EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.business_id = p_business_id
      AND a.code = '2155'
      AND a.deleted_at IS NULL
      AND a.type = 'asset'
  ) THEN
    RETURN '2155';
  END IF;

  SELECT a.code INTO v_code
  FROM accounts a
  WHERE a.business_id = p_business_id
    AND a.deleted_at IS NULL
    AND a.type = 'asset'
    AND (
      LOWER(TRIM(a.name)) = 'wht receivable'
      OR LOWER(TRIM(a.name)) LIKE 'wht receivable (%'
      OR (LOWER(a.name) LIKE '%withholding%' AND LOWER(a.name) LIKE '%receiv%')
    )
  ORDER BY
    CASE WHEN a.code = '2155' THEN 0 ELSE 1 END,
    CASE WHEN a.is_system THEN 0 ELSE 1 END,
    LENGTH(a.code),
    a.code
  LIMIT 1;

  RETURN v_code;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION resolve_wht_receivable_account_code(UUID) IS
  'Returns account code for WHT receivable: valid WHT_RECEIVABLE map, else 2155 if asset, else first matching asset by name.';

-- ---------------------------------------------------------------------------
-- 3) ensure_wht_receivable_account_id — sync chart + map, return accounts.id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ensure_wht_receivable_account_id(p_business_id UUID)
RETURNS UUID AS $$
DECLARE
  v_code TEXT;
  v_id   UUID;
BEGIN
  PERFORM create_system_accounts(p_business_id);

  v_code := resolve_wht_receivable_account_code(p_business_id);
  IF v_code IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO chart_of_accounts (business_id, account_code, account_name, account_type, is_active)
  SELECT
    a.business_id,
    a.code,
    a.name,
    CASE WHEN a.type = 'income' THEN 'revenue' ELSE a.type END,
    TRUE
  FROM accounts a
  WHERE a.business_id = p_business_id
    AND a.deleted_at IS NULL
    AND a.code = v_code
    AND a.type = 'asset'
  ON CONFLICT (business_id, account_code) DO UPDATE
  SET
    account_name = EXCLUDED.account_name,
    account_type = EXCLUDED.account_type,
    is_active    = TRUE;

  IF NOT EXISTS (
    SELECT 1 FROM chart_of_accounts
    WHERE business_id = p_business_id AND account_code = v_code AND is_active = TRUE
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
  VALUES (p_business_id, 'WHT_RECEIVABLE', v_code)
  ON CONFLICT (business_id, control_key) DO UPDATE
  SET account_code = EXCLUDED.account_code;

  SELECT a.id INTO v_id
  FROM accounts a
  WHERE a.business_id = p_business_id
    AND a.code = v_code
    AND a.deleted_at IS NULL
    AND a.type = 'asset'
  LIMIT 1;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ensure_wht_receivable_account_id(UUID) IS
  'Ensures WHT receivable exists in accounts/chart/control_map; returns accounts.id or NULL.';

-- ---------------------------------------------------------------------------
-- 4) initialize_business_chart_of_accounts — ensure WHT after full sync
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

  PERFORM ensure_wht_receivable_account_id(p_business_id);

  RAISE NOTICE 'Business COA initialized: business_id=%, accounts_synced=%',
    p_business_id, accounts_synced;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION initialize_business_chart_of_accounts IS
  'Syncs accounts to chart_of_accounts and control maps (AR, AP, CASH, BANK, WHT_RECEIVABLE). Idempotent.';

-- ---------------------------------------------------------------------------
-- 5) post_invoice_payment_to_ledger — WHT via ensure_wht_receivable_account_id
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
    wht_account_id := ensure_wht_receivable_account_id(business_id_val);
    IF wht_account_id IS NULL THEN
      RAISE EXCEPTION
        'WHT receivable account is not configured. Go to Settings > Accounting Setup and map a WHT receivable account. Payment id: %',
        p_payment_id
      USING ERRCODE = 'P0001';
    END IF;
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
'Posts invoice payment: Dr settlement asset net of WHT, Dr WHT_RECEIVABLE (resolved asset account), Cr AR for full applied amount. FX branches unchanged.';

-- ---------------------------------------------------------------------------
-- 6) Backfill: Ghana + businesses with WHT on payments or invoices
-- ---------------------------------------------------------------------------
INSERT INTO accounts (business_id, name, code, type, description, is_system)
SELECT b.id, 'WHT Receivable', '2155', 'asset',
       'Withholding tax deducted from your payments by customers', TRUE
FROM businesses b
WHERE (
    LOWER(TRIM(COALESCE(b.address_country, ''))) IN ('ghana', 'gh')
    OR LOWER(TRIM(COALESCE(b.address_country, ''))) LIKE '%ghana%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.business_id = b.id AND a.code = '2155' AND a.deleted_at IS NULL
  );

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT b.id AS bid
    FROM businesses b
    WHERE (
        LOWER(TRIM(COALESCE(b.address_country, ''))) IN ('ghana', 'gh')
        OR LOWER(TRIM(COALESCE(b.address_country, ''))) LIKE '%ghana%'
      )
      OR EXISTS (
        SELECT 1 FROM payments p
        WHERE p.business_id = b.id AND COALESCE(p.wht_amount, 0) > 0
      )
      OR EXISTS (
        SELECT 1 FROM invoices i
        WHERE i.business_id = b.id AND COALESCE(i.wht_receivable_applicable, FALSE) IS TRUE
      )
  LOOP
    PERFORM create_system_accounts(r.bid);
    PERFORM ensure_wht_receivable_account_id(r.bid);
  END LOOP;
END $$;

-- Chart rows and WHT_RECEIVABLE mappings for non-loop businesses are created on demand
-- by ensure_wht_receivable_account_id when a WHT payment is posted.
