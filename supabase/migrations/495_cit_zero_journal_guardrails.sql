-- Prevent zero-value CIT journal entries from direct RPC calls.
-- API/UI also block these paths; this is the defensive database guardrail.

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
    RAISE EXCEPTION 'CIT provision % is already posted or paid (status: %)',
      p_provision_id, v_prov.status;
  END IF;

  IF v_prov.cit_amount IS NULL OR v_prov.cit_amount <= 0 THEN
    RAISE EXCEPTION 'No CIT payable for this period; no journal entry is required.';
  END IF;

  SELECT id INTO v_tax_exp_id
  FROM accounts
  WHERE business_id = v_prov.business_id AND code = '9000' AND deleted_at IS NULL;

  SELECT id INTO v_cit_pay_id
  FROM accounts
  WHERE business_id = v_prov.business_id AND code = '2160' AND deleted_at IS NULL;

  IF v_tax_exp_id IS NULL THEN
    RAISE EXCEPTION 'Income Tax Expense account (9000) not found for business %',
      v_prov.business_id;
  END IF;
  IF v_cit_pay_id IS NULL THEN
    RAISE EXCEPTION 'CIT Payable account (2160) not found for business %',
      v_prov.business_id;
  END IF;

  SELECT post_journal_entry(
    p_business_id    => v_prov.business_id,
    p_date           => CURRENT_DATE,
    p_description    => 'CIT Provision – ' || v_prov.period_label,
    p_reference_type => 'cit_provision',
    p_reference_id   => p_provision_id,
    p_lines          => jsonb_build_array(
      jsonb_build_object(
        'account_id',  v_tax_exp_id,
        'debit',       v_prov.cit_amount,
        'description', 'Corporate income tax – ' || v_prov.period_label
      ),
      jsonb_build_object(
        'account_id',  v_cit_pay_id,
        'credit',      v_prov.cit_amount,
        'description', 'CIT liability – ' || v_prov.period_label
      )
    ),
    p_posting_source => 'system'
  ) INTO v_je_id;

  UPDATE cit_provisions
    SET status = 'posted', journal_entry_id = v_je_id
  WHERE id = p_provision_id;

  RETURN v_je_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION post_cit_provision_to_ledger(UUID) IS
'Posts positive CIT provisions to ledger: Dr Income Tax Expense (9000) / Cr CIT Payable (2160).
Rejects zero or null CIT amounts because no journal entry is required.';

CREATE OR REPLACE FUNCTION post_cit_payment_to_ledger(
  p_provision_id         UUID,
  p_payment_account_code TEXT DEFAULT '1010',
  p_payment_date         DATE DEFAULT CURRENT_DATE,
  p_payment_ref          TEXT DEFAULT NULL
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

  IF v_prov.cit_amount IS NULL OR v_prov.cit_amount <= 0 THEN
    RAISE EXCEPTION 'No CIT payable for this period; no journal entry is required.';
  END IF;

  SELECT id INTO v_cit_pay_id
  FROM accounts
  WHERE business_id = v_prov.business_id AND code = '2160' AND deleted_at IS NULL;

  SELECT id INTO v_cash_acc_id
  FROM accounts
  WHERE business_id = v_prov.business_id AND code = p_payment_account_code AND deleted_at IS NULL;

  IF v_cit_pay_id IS NULL THEN
    RAISE EXCEPTION 'CIT Payable account (2160) not found for business %',
      v_prov.business_id;
  END IF;
  IF v_cash_acc_id IS NULL THEN
    RAISE EXCEPTION 'Payment account (%) not found for business %',
      p_payment_account_code, v_prov.business_id;
  END IF;

  SELECT post_journal_entry(
    p_business_id    => v_prov.business_id,
    p_date           => p_payment_date,
    p_description    => 'CIT Payment to GRA – ' || v_prov.period_label
                        || COALESCE(' [' || p_payment_ref || ']', ''),
    p_reference_type => 'cit_payment',
    p_reference_id   => p_provision_id,
    p_lines          => jsonb_build_array(
      jsonb_build_object(
        'account_id',  v_cit_pay_id,
        'debit',       v_prov.cit_amount,
        'description', 'CIT paid to GRA – ' || v_prov.period_label
      ),
      jsonb_build_object(
        'account_id',  v_cash_acc_id,
        'credit',      v_prov.cit_amount,
        'description', 'Payment to GRA – CIT ' || v_prov.period_label
      )
    ),
    p_posting_source => 'system'
  ) INTO v_je_id;

  UPDATE cit_provisions
  SET
    status      = 'paid',
    paid_at     = NOW(),
    paid_amount = v_prov.cit_amount,
    payment_ref = p_payment_ref
  WHERE id = p_provision_id;

  RETURN v_je_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION post_cit_payment_to_ledger(UUID, TEXT, DATE, TEXT) IS
'Posts positive CIT payments to GRA: Dr CIT Payable (2160) / Cr Cash/Bank.
Rejects zero or null CIT amounts because no payment journal entry is required.';
