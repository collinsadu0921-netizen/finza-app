-- ============================================================================
-- Expense posting: align with actual expenses table schema (COVID-safe)
-- ============================================================================
-- Problem: post_expense_to_ledger (190, 172) SELECTs subtotal, total_tax,
-- description, tax_lines — none of which exist on expenses (033, 034, 051).
-- Expense INSERT triggers post_expense_to_ledger; SELECT fails → rollback → 500.
--
-- Fix:
-- 1. Read only real columns: business_id, category_id, supplier, amount,
--    nhil, getfund, vat, covid, total, date, notes.
-- 2. Derive subtotal = total - total_tax when taxes present; else amount (or total).
-- 3. total_tax = nhil + getfund + vat + (covid only if covid > 0) — COVID deprecated.
-- 4. Post tax lines from columns to 2100 (VAT), 2110 (NHIL), 2120 (GETFund),
--    2130 (COVID legacy only). Expense input tax = debit.
-- 5. Idempotency: if JE already exists for this expense, return existing id (no-op).
-- 6. Advisory lock for concurrency safety.
-- 7. Period guard and account validation unchanged; fail with clear message if missing.
-- ============================================================================

DROP FUNCTION IF EXISTS post_expense_to_ledger(UUID, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS post_expense_to_ledger(UUID) CASCADE;

CREATE OR REPLACE FUNCTION post_expense_to_ledger(
  p_expense_id UUID,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  expense_row RECORD;
  business_id_val UUID;
  expense_account_id UUID;
  cash_account_id UUID;
  journal_id UUID;
  cash_account_code TEXT;
  v_subtotal NUMERIC;
  v_total_tax NUMERIC;
  v_description TEXT;
  journal_lines JSONB;
  v_nhil NUMERIC;
  v_getfund NUMERIC;
  v_vat NUMERIC;
  v_covid NUMERIC;
BEGIN
  -- Idempotency: already posted → return existing JE id
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'expense' AND reference_id = p_expense_id
  LIMIT 1;
  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  -- Read only columns that exist on expenses (033, 034, 051)
  SELECT
    ex.business_id,
    ex.category_id,
    ex.supplier,
    ex.amount,
    COALESCE(ex.nhil, 0) AS nhil,
    COALESCE(ex.getfund, 0) AS getfund,
    COALESCE(ex.vat, 0) AS vat,
    COALESCE(ex.covid, 0) AS covid,
    ex.total,
    ex.date,
    ex.notes
  INTO expense_row
  FROM expenses ex
  WHERE ex.id = p_expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found: %', p_expense_id;
  END IF;

  business_id_val := expense_row.business_id;

  -- Concurrency: lock by (business_id, expense_id) for the transaction
  PERFORM pg_advisory_xact_lock(hashtext(business_id_val::text), hashtext(p_expense_id::text));

  -- Re-check idempotency after lock (another txn may have posted)
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'expense' AND reference_id = p_expense_id
  LIMIT 1;
  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  -- PHASE 12B: backfill metadata validation
  IF p_entry_type = 'backfill' THEN
    IF p_backfill_reason IS NULL OR TRIM(p_backfill_reason) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_reason';
    END IF;
    IF p_backfill_actor IS NULL OR TRIM(p_backfill_actor) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_actor';
    END IF;
  END IF;

  -- total_tax: nhil + getfund + vat + (covid ONLY if legacy > 0)
  v_nhil   := expense_row.nhil;
  v_getfund := expense_row.getfund;
  v_vat    := expense_row.vat;
  v_covid  := CASE WHEN expense_row.covid > 0 THEN expense_row.covid ELSE 0 END;
  v_total_tax := v_nhil + v_getfund + v_vat + v_covid;

  -- subtotal: total - total_tax when taxes present; else amount (or total)
  IF v_total_tax > 0 AND expense_row.total IS NOT NULL THEN
    v_subtotal := expense_row.total - v_total_tax;
    IF v_subtotal < 0 THEN
      RAISE EXCEPTION 'Expense total (%) is less than sum of taxes (%). Fix amount/total/tax fields for expense %', expense_row.total, v_total_tax, p_expense_id;
    END IF;
  ELSE
    v_subtotal := COALESCE(expense_row.amount, expense_row.total, 0);
  END IF;

  -- Description from supplier and/or notes (no description column)
  v_description := 'Expense: ' || COALESCE(NULLIF(TRIM(expense_row.supplier), ''), NULLIF(TRIM(expense_row.notes), ''), 'General expense');

  -- Period guard
  PERFORM assert_accounting_period_is_open(business_id_val, expense_row.date);

  -- Resolve and validate accounts: CASH (control), 5100 (Operating Expenses)
  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, '5100');

  -- Tax accounts only if used (COVID 2130 only when covid > 0)
  IF v_nhil > 0 THEN
    PERFORM assert_account_exists(business_id_val, '2110');
  END IF;
  IF v_getfund > 0 THEN
    PERFORM assert_account_exists(business_id_val, '2120');
  END IF;
  IF v_vat > 0 THEN
    PERFORM assert_account_exists(business_id_val, '2100');
  END IF;
  IF v_covid > 0 THEN
    PERFORM assert_account_exists(business_id_val, '2130');
  END IF;

  -- Get account IDs
  cash_account_id := get_account_by_control_key(business_id_val, 'CASH');
  expense_account_id := get_account_by_code(business_id_val, '5100');

  -- Base lines: Dr Expense (subtotal), Cr Cash (total)
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', expense_account_id,
      'debit', v_subtotal,
      'description', 'Operating expense'
    ),
    jsonb_build_object(
      'account_id', cash_account_id,
      'credit', expense_row.total,
      'description', 'Cash payment'
    )
  );

  -- Tax lines (input tax = debit). VAT 2100, NHIL 2110, GETFund 2120, COVID 2130 (legacy only)
  IF v_vat > 0 THEN
    journal_lines := journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', get_account_by_code(business_id_val, '2100'),
        'debit', v_vat,
        'description', 'VAT input tax'
      )
    );
  END IF;
  IF v_nhil > 0 THEN
    journal_lines := journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', get_account_by_code(business_id_val, '2110'),
        'debit', v_nhil,
        'description', 'NHIL input tax'
      )
    );
  END IF;
  IF v_getfund > 0 THEN
    journal_lines := journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', get_account_by_code(business_id_val, '2120'),
        'debit', v_getfund,
        'description', 'GETFund input tax'
      )
    );
  END IF;
  IF v_covid > 0 THEN
    journal_lines := journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', get_account_by_code(business_id_val, '2130'),
        'debit', v_covid,
        'description', 'COVID levy (legacy) input tax'
      )
    );
  END IF;

  -- Post journal entry (posting_source = 'system')
  SELECT post_journal_entry(
    business_id_val,
    expense_row.date,
    v_description,
    'expense',
    p_expense_id,
    journal_lines,
    FALSE,
    NULL,
    NULL,
    NULL,
    p_entry_type,
    p_backfill_reason,
    p_backfill_actor,
    NULL,
    'system'
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_expense_to_ledger(UUID, TEXT, TEXT, TEXT) IS
  'Posts expense to ledger using actual expenses table schema (amount, nhil, getfund, vat, covid, total, date, notes, supplier). Idempotent; period-guarded; COVID legacy-only (no new COVID). posting_source=system.';
