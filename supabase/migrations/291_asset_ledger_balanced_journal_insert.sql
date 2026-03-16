-- Fix: Asset/depreciation/disposal posting used multiple INSERTs into journal_entry_lines.
-- Statement-level balance trigger runs after each INSERT, so only the first line was visible → "Journal entry is not balanced".
-- Insert all lines in a single INSERT so the trigger sees DR = CR.
-- (If 290 was already applied with the old definitions, this migration updates the functions.)

-- post_asset_purchase_to_ledger: single INSERT for both lines
CREATE OR REPLACE FUNCTION post_asset_purchase_to_ledger(
  p_asset_id UUID,
  p_payment_account_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_business_id UUID;
  v_purchase_amount NUMERIC;
  v_purchase_date DATE;
  v_asset_account_id UUID;
  v_payment_account UUID;
  v_journal_entry_id UUID;
BEGIN
  SELECT business_id, purchase_amount, purchase_date
  INTO v_business_id, v_purchase_amount, v_purchase_date
  FROM assets
  WHERE id = p_asset_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  PERFORM assert_accounting_period_is_open(v_business_id, v_purchase_date);

  SELECT id INTO v_asset_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '1600' AND type = 'asset';

  IF v_asset_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Fixed Assets', '1600', 'asset', 'Fixed assets including equipment, vehicles, and property', TRUE)
    RETURNING id INTO v_asset_account_id;
  END IF;

  IF p_payment_account_id IS NOT NULL THEN
    v_payment_account := p_payment_account_id;
  ELSE
    SELECT id INTO v_payment_account
    FROM accounts
    WHERE business_id = v_business_id AND code = '1010' AND type = 'asset';
    IF v_payment_account IS NULL THEN
      RAISE EXCEPTION 'Cash account (1010) not found';
    END IF;
  END IF;

  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id, posting_source)
  VALUES (v_business_id, v_purchase_date, 'Asset Purchase: ' || (SELECT name FROM assets WHERE id = p_asset_id), 'asset', p_asset_id, 'system')
  RETURNING id INTO v_journal_entry_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_journal_entry_id, v_asset_account_id, v_purchase_amount, 0, 'Asset Purchase'),
    (v_journal_entry_id, v_payment_account, 0, v_purchase_amount, 'Payment for Asset');

  UPDATE assets SET acquisition_journal_entry_id = v_journal_entry_id WHERE id = p_asset_id;

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql;

-- post_depreciation_to_ledger: single INSERT for both lines (DR Depreciation Expense, CR Accumulated Depreciation)
CREATE OR REPLACE FUNCTION post_depreciation_to_ledger(p_depreciation_entry_id UUID)
RETURNS UUID AS $$
DECLARE
  v_business_id UUID;
  v_asset_id UUID;
  v_amount NUMERIC;
  v_date DATE;
  v_asset_name TEXT;
  v_existing_je_id UUID;
  v_depreciation_expense_account_id UUID;
  v_accumulated_depreciation_account_id UUID;
  v_journal_entry_id UUID;
BEGIN
  SELECT de.business_id, de.asset_id, de.amount, de.date, a.name, de.journal_entry_id
  INTO v_business_id, v_asset_id, v_amount, v_date, v_asset_name, v_existing_je_id
  FROM depreciation_entries de
  JOIN assets a ON a.id = de.asset_id
  WHERE de.id = p_depreciation_entry_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Depreciation entry not found';
  END IF;

  IF v_existing_je_id IS NOT NULL THEN
    RAISE EXCEPTION 'Depreciation entry already posted (journal_entry_id: %)', v_existing_je_id;
  END IF;

  PERFORM assert_accounting_period_is_open(v_business_id, v_date);

  SELECT id INTO v_depreciation_expense_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '5700' AND type = 'expense';

  IF v_depreciation_expense_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Depreciation Expense', '5700', 'expense', 'Depreciation expense for fixed assets', TRUE)
    RETURNING id INTO v_depreciation_expense_account_id;
  END IF;

  SELECT id INTO v_accumulated_depreciation_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '1650' AND type = 'asset';

  IF v_accumulated_depreciation_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Accumulated Depreciation', '1650', 'asset', 'Accumulated depreciation on fixed assets', TRUE)
    RETURNING id INTO v_accumulated_depreciation_account_id;
  END IF;

  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id, posting_source)
  VALUES (v_business_id, v_date, 'Depreciation: ' || v_asset_name, 'depreciation', p_depreciation_entry_id, 'system')
  RETURNING id INTO v_journal_entry_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_journal_entry_id, v_depreciation_expense_account_id, v_amount, 0, 'Depreciation Expense'),
    (v_journal_entry_id, v_accumulated_depreciation_account_id, 0, v_amount, 'Accumulated Depreciation');

  UPDATE depreciation_entries SET journal_entry_id = v_journal_entry_id WHERE id = p_depreciation_entry_id;

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql;

-- post_asset_disposal_to_ledger: single INSERT for all four lines
CREATE OR REPLACE FUNCTION post_asset_disposal_to_ledger(
  p_asset_id UUID,
  p_disposal_amount NUMERIC,
  p_payment_account_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_business_id UUID;
  v_purchase_amount NUMERIC;
  v_accumulated_depreciation NUMERIC;
  v_asset_name TEXT;
  v_asset_account_id UUID;
  v_accumulated_depreciation_account_id UUID;
  v_payment_account UUID;
  v_gain_loss_account_id UUID;
  v_journal_entry_id UUID;
  v_is_gain BOOLEAN;
  v_gain_loss_amount NUMERIC;
  v_disposal_date DATE := CURRENT_DATE;
BEGIN
  SELECT business_id, purchase_amount, name INTO v_business_id, v_purchase_amount, v_asset_name
  FROM assets WHERE id = p_asset_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  PERFORM assert_accounting_period_is_open(v_business_id, v_disposal_date);

  SELECT COALESCE(SUM(amount), 0) INTO v_accumulated_depreciation
  FROM depreciation_entries WHERE asset_id = p_asset_id AND deleted_at IS NULL;

  SELECT id INTO v_asset_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '1600' AND type = 'asset';

  SELECT id INTO v_accumulated_depreciation_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '1650' AND type = 'asset';

  IF p_payment_account_id IS NOT NULL THEN
    v_payment_account := p_payment_account_id;
  ELSE
    SELECT id INTO v_payment_account
    FROM accounts
    WHERE business_id = v_business_id AND code = '1010' AND type = 'asset';
  END IF;

  v_gain_loss_amount := p_disposal_amount - (v_purchase_amount - v_accumulated_depreciation);
  v_is_gain := v_gain_loss_amount > 0;

  IF v_is_gain THEN
    SELECT id INTO v_gain_loss_account_id FROM accounts WHERE business_id = v_business_id AND code = '4100' AND type = 'income' LIMIT 1;
  ELSE
    SELECT id INTO v_gain_loss_account_id FROM accounts WHERE business_id = v_business_id AND code = '5800' AND type = 'expense' LIMIT 1;
  END IF;

  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id, posting_source)
  VALUES (v_business_id, v_disposal_date, 'Asset Disposal: ' || v_asset_name, 'asset', p_asset_id, 'system')
  RETURNING id INTO v_journal_entry_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_journal_entry_id, v_payment_account, p_disposal_amount, 0, 'Proceeds from Asset Disposal'),
    (v_journal_entry_id, v_accumulated_depreciation_account_id, 0, v_accumulated_depreciation, 'Remove Accumulated Depreciation'),
    (v_journal_entry_id, v_asset_account_id, 0, v_purchase_amount, 'Remove Asset from Books'),
    (v_journal_entry_id, v_gain_loss_account_id, CASE WHEN v_is_gain THEN 0 ELSE ABS(v_gain_loss_amount) END, CASE WHEN v_is_gain THEN v_gain_loss_amount ELSE 0 END, CASE WHEN v_is_gain THEN 'Gain on Asset Disposal' ELSE 'Loss on Asset Disposal' END);

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql;
