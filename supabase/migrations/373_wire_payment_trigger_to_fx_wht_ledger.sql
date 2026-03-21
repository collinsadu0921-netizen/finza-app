-- ============================================================================
-- Migration 373: Wire payment trigger → FX + WHT ledger function
-- ============================================================================
-- ROOT CAUSE (discovered):
--   trigger_post_payment → post_payment_to_ledger (migration 258, no FX, no WHT)
--   post_invoice_payment_to_ledger (migration 372, has FX + WHT) was NEVER called
--   from the trigger. FX conversion and WHT receivable split were silently skipped.
--
-- Additionally, migration 372's post_journal_entry call was missing
-- p_posting_source => 'system', which would raise at runtime.
--
-- Fix (two parts):
--   1. Replace post_invoice_payment_to_ledger with corrected version that passes
--      p_posting_source => 'system' to post_journal_entry.
--   2. Replace post_payment_to_ledger(UUID) with a guard wrapper that does
--      advisory lock + idempotency + period check + draft guard, then delegates
--      to post_invoice_payment_to_ledger for the actual FX+WHT journal posting.
--
-- The trigger (migration 218) continues to call post_payment_to_ledger(NEW.id)
-- unchanged — the delegation happens transparently inside.
-- ============================================================================

-- ============================================================================
-- PART 1: post_invoice_payment_to_ledger — same logic as migration 372 but
--         passes p_posting_source => 'system' to post_journal_entry.
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
  payment_amount       NUMERIC;   -- full invoice amount (gross, in invoice currency)
  v_wht_amount         NUMERIC;   -- WHT deducted by customer (in invoice currency)
  cash_debit_home      NUMERIC;   -- net cash received in home currency
  ar_credit_home       NUMERIC;   -- AR cleared in home currency (gross)
  wht_home             NUMERIC;   -- WHT receivable in home currency
  fx_diff              NUMERIC;   -- FX gain (positive) or loss (negative)
  v_invoice_fx_rate    NUMERIC;
  v_settlement_fx_rate NUMERIC;
  journal_lines        JSONB;
  cash_account_code    TEXT;
  bank_account_code    TEXT;
BEGIN
  -- Fetch payment (including wht_amount and settlement_fx_rate)
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

  IF v_wht_amount > 0 THEN
    PERFORM assert_account_exists(business_id_val, '2155');
    wht_account_id := get_account_by_code(business_id_val, '2155');
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
  -- FX settlement logic (three cases)
  -- WHT split is applied inside each case when v_wht_amount > 0.
  -- All home-currency amounts stored in ledger; foreign amounts only in payments.
  -- -------------------------------------------------------------------------
  IF v_invoice_fx_rate IS NOT NULL AND v_invoice_fx_rate > 0
     AND v_settlement_fx_rate IS NOT NULL AND v_settlement_fx_rate > 0 THEN

    -- CASE 1: Both rates — full FX gain/loss
    ar_credit_home  := ROUND(payment_amount * v_invoice_fx_rate, 2);
    wht_home        := ROUND(v_wht_amount * v_invoice_fx_rate, 2);   -- WHT at booking rate
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

    -- CASE 2: FX invoice, no settlement rate — use booking rate, no gain/loss
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

    -- CASE 3: Home-currency invoice — post as-is
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

  -- Use named parameter p_posting_source => 'system' (required by canonical function)
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

When wht_amount = 0 (default), all cases behave identically to migration 364.
Called by post_payment_to_ledger after guard checks (migration 373).';


-- ============================================================================
-- PART 2: post_payment_to_ledger(UUID) — guard wrapper → delegate to above
-- ============================================================================
-- The trigger trigger_post_payment (migration 218) calls this single-arg version.
-- We keep all guards here (advisory lock, idempotency, period, draft) and
-- delegate the actual FX+WHT journal posting to post_invoice_payment_to_ledger.
-- ============================================================================
CREATE OR REPLACE FUNCTION post_payment_to_ledger(p_payment_id UUID)
RETURNS UUID AS $$
DECLARE
  payment_record  RECORD;
  invoice_record  RECORD;
  business_id_val UUID;
  journal_id      UUID;
BEGIN
  -- Fetch payment for guard checks
  SELECT p.business_id, p.invoice_id, p.amount, p.date
  INTO payment_record
  FROM payments p
  WHERE p.id = p_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found: %', p_payment_id;
  END IF;

  IF COALESCE(payment_record.amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Invalid payment amount: %. Payment ID: %', payment_record.amount, p_payment_id;
  END IF;

  -- Fetch invoice for draft guard
  SELECT id, status
  INTO invoice_record
  FROM invoices
  WHERE id = payment_record.invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found for payment: %', p_payment_id;
  END IF;

  IF invoice_record.status = 'draft' THEN
    RAISE EXCEPTION 'Cannot post payment for draft invoice. Issue the invoice first.';
  END IF;

  business_id_val := payment_record.business_id;
  IF business_id_val IS NULL THEN
    RAISE EXCEPTION 'Business ID is NULL for payment: %', p_payment_id;
  END IF;

  -- Advisory lock: serialize concurrent posting for the same payment
  PERFORM pg_advisory_xact_lock(
    hashtext(business_id_val::text),
    hashtext(p_payment_id::text)
  );

  -- Idempotency: re-check after acquiring lock
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'payment'
    AND reference_id = p_payment_id
  LIMIT 1;

  IF journal_id IS NOT NULL THEN
    RETURN journal_id;  -- already posted
  END IF;

  -- Period guard: block posting to locked periods
  PERFORM assert_accounting_period_is_open(business_id_val, payment_record.date);

  -- Delegate to FX + WHT aware implementation
  RETURN post_invoice_payment_to_ledger(p_payment_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_payment_to_ledger(UUID) IS
'Guard wrapper for post_invoice_payment_to_ledger.
Performs: advisory lock, idempotency check, period guard, draft invoice guard.
Then delegates actual FX+WHT journal posting to post_invoice_payment_to_ledger.
Called by trigger_post_payment on payments INSERT.';


-- ============================================================================
-- Also update the 4-param overload (used by backfill) to delegate too.
-- The backfill path ignores p_entry_type/reason/actor since
-- post_invoice_payment_to_ledger does not support them — the standard journal
-- entry is sufficient; backfill metadata is not required for payments.
-- ============================================================================
CREATE OR REPLACE FUNCTION post_payment_to_ledger(
  p_payment_id UUID,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL
)
RETURNS UUID AS $$
BEGIN
  -- Delegate to the single-arg version which has all guards + FX+WHT logic
  RETURN post_payment_to_ledger(p_payment_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_payment_to_ledger(UUID, TEXT, TEXT, TEXT) IS
'Backward-compat 4-param overload. Delegates to post_payment_to_ledger(UUID)
which in turn calls post_invoice_payment_to_ledger for FX+WHT journal posting.';
