-- ============================================================================
-- Migration 374: Fix post_wht_remittance_to_ledger — balance trigger failure
-- ============================================================================
-- ROOT CAUSE:
--   The old implementation (migrations 339, 341) inserted journal_entry_lines
--   one at a time with two separate INSERT statements:
--     INSERT line 1 (Dr WHT Payable)  → balance trigger fires: Dr=X, Cr=0 → EXCEPTION
--     INSERT line 2 (Cr Bank)         → never reached
--
--   The enforce_double_entry_balance trigger fires AFTER EACH line insert.
--   After line 1 (debit only), SUM(debit) > SUM(credit) → imbalance > 0.01 → rejected.
--   The API caught this as a non-fatal error, so remittances were marked as
--   "remitted" in the bills table but no journal entry was ever created.
--
-- Fix: Use post_journal_entry() which:
--   1. Validates balance BEFORE inserting (pre-check of the full JSONB array)
--   2. Inserts all lines in one batch (single INSERT with multiple rows)
--   3. Passes posting_source => 'system' as required by canonical function
-- ============================================================================

CREATE OR REPLACE FUNCTION post_wht_remittance_to_ledger(
  p_remittance_id      UUID,
  p_payment_account_code TEXT DEFAULT '1010'   -- default: Bank
)
RETURNS UUID AS $$
DECLARE
  v_remittance  wht_remittances%ROWTYPE;
  v_business_id UUID;
  v_je_id       UUID;
  v_wht_acc_id  UUID;
  v_cash_acc_id UUID;
BEGIN
  SELECT * INTO v_remittance FROM wht_remittances WHERE id = p_remittance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WHT remittance % not found', p_remittance_id;
  END IF;

  v_business_id := v_remittance.business_id;

  -- Resolve account IDs
  SELECT id INTO v_wht_acc_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '2150' AND deleted_at IS NULL;

  SELECT id INTO v_cash_acc_id
  FROM accounts
  WHERE business_id = v_business_id AND code = p_payment_account_code AND deleted_at IS NULL;

  IF v_wht_acc_id IS NULL THEN
    RAISE EXCEPTION 'WHT Payable account (2150) not found for business %', v_business_id;
  END IF;
  IF v_cash_acc_id IS NULL THEN
    RAISE EXCEPTION 'Payment account (%) not found for business %',
      p_payment_account_code, v_business_id;
  END IF;

  -- Use post_journal_entry with BOTH lines in a single JSONB array.
  -- This passes the pre-insert balance check and avoids the sequential-insert
  -- imbalance that caused the balance trigger to reject the posting.
  SELECT post_journal_entry(
    p_business_id    => v_business_id,
    p_date           => v_remittance.remittance_date,
    p_description    => 'WHT Remittance to GRA'
                        || COALESCE(' – ' || v_remittance.reference, ''),
    p_reference_type => 'wht_remittance',
    p_reference_id   => p_remittance_id,
    p_lines          => jsonb_build_array(
      jsonb_build_object(
        'account_id',  v_wht_acc_id,
        'debit',       v_remittance.amount,
        'description', 'WHT remitted to GRA — clears WHT Payable (2150)'
      ),
      jsonb_build_object(
        'account_id',  v_cash_acc_id,
        'credit',      v_remittance.amount,
        'description', 'Payment to GRA for withholding tax'
      )
    ),
    p_posting_source => 'system'
  ) INTO v_je_id;

  -- Link journal entry back to remittance record
  UPDATE wht_remittances SET journal_entry_id = v_je_id WHERE id = p_remittance_id;

  RETURN v_je_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION post_wht_remittance_to_ledger(UUID, TEXT) IS
'Posts a WHT remittance to the ledger.
Dr WHT Payable (2150) — reduces liability
Cr Bank/Cash (default 1010) — records cash paid to GRA
Uses post_journal_entry() with both lines in a single JSONB array to satisfy
the enforce_double_entry_balance trigger (which fires after each line insert).';
