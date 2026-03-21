-- ============================================================================
-- Migration 375: Fix CIT ledger posting — balance trigger failure
-- ============================================================================
-- ROOT CAUSE (same as migration 374 for WHT remittance):
--   post_cit_provision_to_ledger (migration 341) inserts journal_entry_lines
--   one at a time with two separate INSERTs:
--     INSERT line 1 (Dr Income Tax Expense 9000)  → balance trigger fires → Dr=X, Cr=0 → EXCEPTION
--     INSERT line 2 (Cr CIT Payable 2160)          → never reached
--
--   post_cit_payment_to_ledger (migration 342) has the same bug:
--     INSERT line 1 (Dr CIT Payable 2160)          → balance trigger fires → Dr=X, Cr=0 → EXCEPTION
--     INSERT line 2 (Cr Cash/Bank)                 → never reached
--
--   Both functions also omit posting_source, which the canonical post_journal_entry
--   requires to be explicitly 'system' or 'accountant'.
--
-- Fix: Rewrite both functions to use post_journal_entry() with all lines
--      supplied in a single JSONB array, with p_posting_source => 'system'.
--      post_journal_entry validates balance BEFORE inserting, then inserts
--      all lines in one batch — no intermediate-imbalance problem.
-- ============================================================================


-- ============================================================================
-- 1. post_cit_provision_to_ledger
--    Dr Income Tax Expense (9000) / Cr CIT Payable (2160)
-- ============================================================================
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

  -- Resolve account IDs
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

  -- Use post_journal_entry with BOTH lines in a single JSONB array.
  -- This passes the pre-insert balance check and avoids the sequential-insert
  -- imbalance that caused the balance trigger to reject the posting.
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

  -- Mark provision as posted and link journal entry
  UPDATE cit_provisions
    SET status = 'posted', journal_entry_id = v_je_id
  WHERE id = p_provision_id;

  RETURN v_je_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION post_cit_provision_to_ledger(UUID) IS
'Posts CIT provision to ledger: Dr Income Tax Expense (9000) / Cr CIT Payable (2160).
Uses post_journal_entry() with both lines in a single JSONB array to satisfy
the enforce_double_entry_balance trigger. Marks provision status → posted.';


-- ============================================================================
-- 2. post_cit_payment_to_ledger
--    Dr CIT Payable (2160) / Cr Cash/Bank (1010 or specified)
-- ============================================================================
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

  -- Resolve account IDs
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

  -- Use post_journal_entry with BOTH lines in a single JSONB array.
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

  -- Mark provision as paid
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
'Posts CIT payment to GRA: Dr CIT Payable (2160) / Cr Cash/Bank.
Uses post_journal_entry() with both lines in a single JSONB array to satisfy
the enforce_double_entry_balance trigger. Marks provision status → paid.';
