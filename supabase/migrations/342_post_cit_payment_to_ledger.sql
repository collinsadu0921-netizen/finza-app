-- Migration 342: post_cit_payment_to_ledger
-- ============================================================================
-- When a business pays CIT to GRA, this function posts the payment journal:
--   Dr CIT Payable (2160)   ← reduces liability
--   Cr Cash/Bank (1000|1010 or specified)
--
-- Requires the provision to already be in 'posted' status.
-- Updates cit_provisions.status → 'paid', sets paid_at and paid_amount.
-- ============================================================================

CREATE OR REPLACE FUNCTION post_cit_payment_to_ledger(
  p_provision_id        UUID,
  p_payment_account_code TEXT DEFAULT '1010',   -- Bank by default
  p_payment_date        DATE DEFAULT CURRENT_DATE,
  p_payment_ref         TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_prov        cit_provisions%ROWTYPE;
  v_je_id       UUID;
  v_cit_pay_id  UUID;
  v_cash_acc_id UUID;
BEGIN
  SELECT * INTO v_prov FROM cit_provisions WHERE id = p_provision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CIT provision % not found', p_provision_id;
  END IF;

  IF v_prov.status != 'posted' THEN
    RAISE EXCEPTION 'CIT provision % must be in posted status before marking paid (current: %)',
      p_provision_id, v_prov.status;
  END IF;

  -- Resolve accounts
  SELECT id INTO v_cit_pay_id
  FROM accounts
  WHERE business_id = v_prov.business_id AND code = '2160' AND deleted_at IS NULL;

  SELECT id INTO v_cash_acc_id
  FROM accounts
  WHERE business_id = v_prov.business_id AND code = p_payment_account_code AND deleted_at IS NULL;

  IF v_cit_pay_id IS NULL THEN
    RAISE EXCEPTION 'CIT Payable account (2160) not found for business %', v_prov.business_id;
  END IF;
  IF v_cash_acc_id IS NULL THEN
    RAISE EXCEPTION 'Payment account (%) not found for business %', p_payment_account_code, v_prov.business_id;
  END IF;

  -- Create payment journal entry
  INSERT INTO journal_entries (
    business_id, date, description, reference_type, reference_id
  )
  VALUES (
    v_prov.business_id,
    p_payment_date,
    'CIT Payment to GRA – ' || v_prov.period_label
      || COALESCE(' [' || p_payment_ref || ']', ''),
    'cit_payment',
    p_provision_id
  )
  RETURNING id INTO v_je_id;

  -- Dr CIT Payable (reduces the 2160 liability)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (
    v_je_id, v_cit_pay_id,
    v_prov.cit_amount, 0,
    'CIT paid to GRA – ' || v_prov.period_label
  );

  -- Cr Cash/Bank
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (
    v_je_id, v_cash_acc_id,
    0, v_prov.cit_amount,
    'Payment to GRA – CIT ' || v_prov.period_label
  );

  -- Mark provision as paid
  UPDATE cit_provisions
  SET
    status       = 'paid',
    paid_at      = NOW(),
    paid_amount  = v_prov.cit_amount,
    payment_ref  = p_payment_ref
  WHERE id = p_provision_id;

  RETURN v_je_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION post_cit_payment_to_ledger(UUID, TEXT, DATE, TEXT) IS
  'Posts CIT payment to GRA: Dr CIT Payable (2160) / Cr Cash/Bank. Marks provision as paid.';
