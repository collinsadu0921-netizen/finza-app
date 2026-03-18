-- ============================================================================
-- Migration 341: WHT/CIT ledger posting — set posting_source on direct INSERT
-- ============================================================================
-- journal_entries.posting_source is NOT NULL (190). post_wht_remittance_to_ledger
-- and post_cit_provision_to_ledger insert directly and omitted posting_source,
-- causing runtime failure. Fix: add posting_source = 'system' to both INSERTs.
-- ============================================================================

-- post_wht_remittance_to_ledger: add posting_source
CREATE OR REPLACE FUNCTION post_wht_remittance_to_ledger(
  p_remittance_id UUID,
  p_payment_account_code TEXT DEFAULT '1010'
)
RETURNS UUID AS $$
DECLARE
  v_remittance    wht_remittances%ROWTYPE;
  v_business_id   UUID;
  v_je_id         UUID;
  v_wht_acc_id    UUID;
  v_cash_acc_id   UUID;
BEGIN
  SELECT * INTO v_remittance FROM wht_remittances WHERE id = p_remittance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WHT remittance % not found', p_remittance_id;
  END IF;

  v_business_id := v_remittance.business_id;

  SELECT id INTO v_wht_acc_id  FROM accounts WHERE business_id = v_business_id AND code = '2150' AND deleted_at IS NULL;
  SELECT id INTO v_cash_acc_id FROM accounts WHERE business_id = v_business_id AND code = p_payment_account_code AND deleted_at IS NULL;

  IF v_wht_acc_id IS NULL THEN
    RAISE EXCEPTION 'WHT Payable account (2150) not found for business %', v_business_id;
  END IF;
  IF v_cash_acc_id IS NULL THEN
    RAISE EXCEPTION 'Payment account (%) not found for business %', p_payment_account_code, v_business_id;
  END IF;

  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id, posting_source)
  VALUES (
    v_business_id,
    v_remittance.remittance_date,
    'WHT Remittance to GRA' || COALESCE(' – ' || v_remittance.reference, ''),
    'wht_remittance',
    p_remittance_id,
    'system'
  )
  RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_wht_acc_id, v_remittance.amount, 0, 'WHT remitted to GRA');

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_cash_acc_id, 0, v_remittance.amount, 'Payment to GRA for WHT');

  UPDATE wht_remittances SET journal_entry_id = v_je_id WHERE id = p_remittance_id;

  RETURN v_je_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- post_cit_provision_to_ledger: add posting_source
CREATE OR REPLACE FUNCTION post_cit_provision_to_ledger(p_provision_id UUID)
RETURNS UUID AS $$
DECLARE
  v_prov        cit_provisions%ROWTYPE;
  v_je_id       UUID;
  v_tax_exp_id  UUID;
  v_cit_pay_id  UUID;
BEGIN
  SELECT * INTO v_prov FROM cit_provisions WHERE id = p_provision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CIT provision % not found', p_provision_id;
  END IF;

  IF v_prov.status != 'draft' THEN
    RAISE EXCEPTION 'CIT provision % is already posted or paid', p_provision_id;
  END IF;

  SELECT id INTO v_tax_exp_id FROM accounts WHERE business_id = v_prov.business_id AND code = '9000' AND deleted_at IS NULL;
  SELECT id INTO v_cit_pay_id FROM accounts WHERE business_id = v_prov.business_id AND code = '2160' AND deleted_at IS NULL;

  IF v_tax_exp_id IS NULL THEN RAISE EXCEPTION 'Income Tax Expense account (9000) not found'; END IF;
  IF v_cit_pay_id IS NULL THEN RAISE EXCEPTION 'CIT Payable account (2160) not found'; END IF;

  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id, posting_source)
  VALUES (
    v_prov.business_id,
    CURRENT_DATE,
    'CIT Provision – ' || v_prov.period_label,
    'cit_provision',
    p_provision_id,
    'system'
  )
  RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_tax_exp_id, v_prov.cit_amount, 0, 'Corporate income tax – ' || v_prov.period_label);

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_cit_pay_id, 0, v_prov.cit_amount, 'CIT liability – ' || v_prov.period_label);

  UPDATE cit_provisions
    SET status = 'posted', journal_entry_id = v_je_id
  WHERE id = p_provision_id;

  RETURN v_je_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
