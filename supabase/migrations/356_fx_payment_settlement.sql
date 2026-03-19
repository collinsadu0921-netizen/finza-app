-- FX Payment Settlement: realized gain/loss on foreign-currency invoice payments
--
-- When a client pays a USD invoice but the GHS/USD rate has moved since the invoice
-- was issued, the difference between the original AR booking and the actual cash
-- received must be posted to a Realized FX Gain or FX Loss account.
--
-- Example (rate improved):
--   Invoice:  1,000 USD × 14.50 = GHS 14,500 → DR AR 14,500
--   Payment:  1,000 USD × 15.20 = GHS 15,200
--   Journal:  DR Cash 15,200 | CR AR 14,500 | CR FX Gain 700
--
-- Example (rate fell):
--   Payment:  1,000 USD × 14.00 = GHS 14,000
--   Journal:  DR Cash 14,000 | DR FX Loss 500 | CR AR 14,500
--
-- For partial payments:
--   ar_credit_ghs  = payment.amount × invoice.fx_rate      (portion of AR cleared)
--   cash_debit_ghs = payment.amount × settlement_fx_rate   (actual cash received)
--   fx_diff        = cash_debit_ghs - ar_credit_ghs
--
-- Home-currency invoices (fx_rate IS NULL) are completely unchanged.

-- ============================================================================
-- 1. Add settlement_fx_rate to payments
-- ============================================================================
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS settlement_fx_rate NUMERIC;

COMMENT ON COLUMN payments.settlement_fx_rate IS
'Exchange rate at time of payment (1 unit of invoice currency = settlement_fx_rate units of home currency).
Only relevant for FX invoices. NULL for home-currency invoices.';

-- ============================================================================
-- 2. Add FX Gain / FX Loss accounts to create_system_accounts
--    and backfill for all existing businesses
-- ============================================================================
CREATE OR REPLACE FUNCTION create_system_accounts(p_business_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO accounts (business_id, name, code, type, sub_type, description, is_system)
  VALUES
    -- Assets
    (p_business_id, 'Cash',                           '1000', 'asset',     'current',          'Cash on hand',                             TRUE),
    (p_business_id, 'Bank Account',                   '1010', 'asset',     'current',          'Business bank account',                    TRUE),
    (p_business_id, 'Mobile Money',                   '1020', 'asset',     'current',          'Mobile money account',                     TRUE),
    (p_business_id, 'Accounts Receivable',            '1100', 'asset',     'current',          'Money owed by customers',                  TRUE),
    (p_business_id, 'Inventory',                      '1200', 'asset',     'current',          'Goods held for sale',                      TRUE),
    (p_business_id, 'Prepaid Expenses',               '1300', 'asset',     'current',          'Expenses paid in advance',                 TRUE),
    (p_business_id, 'Fixed Assets',                   '1500', 'asset',     'non_current',      'Long-term physical assets',                TRUE),
    (p_business_id, 'Accumulated Depreciation',       '1600', 'asset',     'contra_asset',     'Accumulated depreciation on fixed assets', TRUE),
    -- Liabilities
    (p_business_id, 'Accounts Payable',               '2000', 'liability', 'current',          'Money owed to suppliers',                  TRUE),
    (p_business_id, 'VAT Payable',                    '2100', 'liability', 'current',          'VAT collected, owed to tax authority',     TRUE),
    (p_business_id, 'NHIL Payable',                   '2110', 'liability', 'current',          'NHIL collected, owed to tax authority',    TRUE),
    (p_business_id, 'GETFund Payable',                '2120', 'liability', 'current',          'GETFund collected, owed to tax authority', TRUE),
    (p_business_id, 'COVID Levy Payable',             '2130', 'liability', 'current',          'COVID levy collected',                     TRUE),
    (p_business_id, 'Accrued Liabilities',            '2200', 'liability', 'current',          'Accrued but unpaid expenses',              TRUE),
    (p_business_id, 'Short-term Loans',               '2300', 'liability', 'current',          'Short-term borrowings',                    TRUE),
    (p_business_id, 'Long-term Loans',                '2310', 'liability', 'non_current',      'Long-term borrowings',                     TRUE),
    -- Equity
    (p_business_id, 'Owner Equity',                   '3000', 'equity',    'equity',           'Owner capital contributions',              TRUE),
    (p_business_id, 'Retained Earnings',              '3100', 'equity',    'retained_earnings','Cumulative profits retained',              TRUE),
    (p_business_id, 'Owner Drawings',                 '3200', 'equity',    'drawings',         'Owner withdrawals',                        TRUE),
    -- Income
    (p_business_id, 'Service Revenue',                '4000', 'income',    'operating_revenue','Revenue from services',                    TRUE),
    (p_business_id, 'Sales Revenue',                  '4100', 'income',    'operating_revenue','Revenue from product sales',               TRUE),
    (p_business_id, 'Gain on Asset Disposal',         '4200', 'income',    'other_income',     'Gains from disposal of fixed assets',      TRUE),
    (p_business_id, 'FX Gain',                        '4300', 'income',    'other_income',     'Realized foreign exchange gain on settlement', TRUE),
    (p_business_id, 'Other Income',                   '4900', 'income',    'other_income',     'Miscellaneous income',                     TRUE),
    -- Expenses
    (p_business_id, 'Cost of Sales',                  '5000', 'expense',   'cost_of_sales',    'Direct costs of goods and services sold',  TRUE),
    (p_business_id, 'Operating Expenses',             '5100', 'expense',   'operating',        'General operating expenses',               TRUE),
    (p_business_id, 'Supplier Bills',                 '5200', 'expense',   'operating',        'Supplier invoices and purchases',          TRUE),
    (p_business_id, 'Administrative Expenses',        '5300', 'expense',   'operating',        'Admin and overhead',                       TRUE),
    (p_business_id, 'Depreciation Expense',           '5700', 'expense',   'depreciation',     'Depreciation on fixed assets',             TRUE),
    (p_business_id, 'Loss on Asset Disposal',         '5800', 'expense',   'other',            'Losses from disposal of fixed assets',     TRUE),
    (p_business_id, 'FX Loss',                        '5900', 'expense',   'other',            'Realized foreign exchange loss on settlement', TRUE),
    -- System / Rounding
    (p_business_id, 'Rounding Adjustment',            '7990', 'income',    'rounding',         'Cent-level rounding adjustments',          TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Backfill FX accounts for all existing businesses
DO $$
DECLARE
  biz_id UUID;
BEGIN
  FOR biz_id IN SELECT id FROM businesses LOOP
    INSERT INTO accounts (business_id, name, code, type, sub_type, description, is_system)
    VALUES
      (biz_id, 'FX Gain', '4300', 'income',  'other_income', 'Realized foreign exchange gain on settlement', TRUE),
      (biz_id, 'FX Loss', '5900', 'expense', 'other',        'Realized foreign exchange loss on settlement', TRUE)
    ON CONFLICT (business_id, code) DO NOTHING;
  END LOOP;
END;
$$;

-- ============================================================================
-- 3. Replace post_invoice_payment_to_ledger with FX gain/loss support
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
  cash_account_id      UUID;
  bank_account_id      UUID;
  momo_account_id      UUID;
  journal_id           UUID;
  payment_amount       NUMERIC;  -- in invoice currency (FX or home)
  cash_debit_home      NUMERIC;  -- cash received in home currency
  ar_credit_home       NUMERIC;  -- AR portion cleared in home currency
  fx_diff              NUMERIC;  -- gain (positive) or loss (negative)
  v_invoice_fx_rate    NUMERIC;  -- rate when invoice was issued
  v_settlement_fx_rate NUMERIC;  -- rate when payment was received
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
  -- FX settlement logic
  -- For FX invoices: amounts are translated to home currency using the
  -- respective rates so the ledger always holds home-currency values.
  -- -------------------------------------------------------------------------
  IF v_invoice_fx_rate IS NOT NULL AND v_invoice_fx_rate > 0
     AND v_settlement_fx_rate IS NOT NULL AND v_settlement_fx_rate > 0 THEN

    -- Portion of AR being cleared (at the original booking rate)
    ar_credit_home := ROUND(payment_amount * v_invoice_fx_rate, 2);
    -- Actual cash received in home currency (at today's rate)
    cash_debit_home := ROUND(payment_amount * v_settlement_fx_rate, 2);
    -- Difference: positive = gain, negative = loss
    fx_diff := ROUND(cash_debit_home - ar_credit_home, 2);

    -- Base lines: Cash debit + AR credit
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

    -- Add FX gain or loss line if there is a non-zero difference
    IF fx_diff > 0 THEN
      -- Rate improved since invoice: FX gain (credit income)
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id',  fx_gain_account_id,
          'credit',      fx_diff,
          'description', 'Realized FX gain on settlement'
        )
      );
    ELSIF fx_diff < 0 THEN
      -- Rate fell since invoice: FX loss (debit expense)
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id',  fx_loss_account_id,
          'debit',       ABS(fx_diff),
          'description', 'Realized FX loss on settlement'
        )
      );
    END IF;

  ELSE
    -- Home-currency invoice (or settlement_fx_rate not provided): unchanged behaviour
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
For FX invoices (invoice.fx_rate IS NOT NULL):
  - AR is credited at the original booking rate (invoice.fx_rate × payment.amount)
  - Cash/Bank is debited at the settlement rate (settlement_fx_rate × payment.amount)
  - The difference is posted as Realized FX Gain (4300) or FX Loss (5900)
For home-currency invoices: behaviour is unchanged.';

-- Index for settlement rate lookups
CREATE INDEX IF NOT EXISTS idx_payments_settlement_fx_rate
  ON payments(settlement_fx_rate) WHERE settlement_fx_rate IS NOT NULL;
