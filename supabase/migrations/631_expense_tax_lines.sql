-- Expense tax-line metadata and pre-2026 levy absorption.
--
-- Pre-2026 purchase NHIL/GETFund/COVID are not creditable input tax. The
-- expense row still records the components for display/audit, while
-- tax_lines tells the posting function where each component goes:
--   pre-2026  NHIL/GETFund/COVID -> 5100 (cost), VAT -> 2100
--   post-2026 NHIL -> 2110, GETFund -> 2120, VAT -> 2100
-- Legacy rows without tax_lines keep the previous column-derived behavior.
-- No existing expense or journal is rewritten.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS tax_lines jsonb;

CREATE OR REPLACE FUNCTION public.post_expense_to_ledger_pkgb_body(
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
  v_payment_credit NUMERIC;
  v_tax_lines JSONB;
  v_tax_lines_array JSONB;
  v_tax_line JSONB;
  v_tax_amount NUMERIC;
  v_tax_account_code TEXT;
  v_tax_side TEXT;
  v_tax_added_from_jsonb NUMERIC := 0;
  v_tax_account_id UUID;
BEGIN
  SELECT je.id INTO journal_id
  FROM journal_entries je
  WHERE je.reference_type = 'expense' AND je.reference_id = p_expense_id
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = je.id
    )
  LIMIT 1;
  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

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
    ex.notes,
    ex.currency_code,
    ex.fx_rate,
    ex.home_currency_total,
    ex.tax_lines
  INTO expense_row
  FROM expenses ex
  WHERE ex.id = p_expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found: %', p_expense_id;
  END IF;

  business_id_val := expense_row.business_id;

  PERFORM pg_advisory_xact_lock(hashtext(business_id_val::text), hashtext(p_expense_id::text));

  SELECT je.id INTO journal_id
  FROM journal_entries je
  WHERE je.reference_type = 'expense' AND je.reference_id = p_expense_id
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = je.id
    )
  LIMIT 1;
  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  IF p_entry_type = 'backfill' THEN
    IF p_backfill_reason IS NULL OR TRIM(p_backfill_reason) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_reason';
    END IF;
    IF p_backfill_actor IS NULL OR TRIM(p_backfill_actor) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_actor';
    END IF;
  END IF;

  v_nhil   := expense_row.nhil;
  v_getfund := expense_row.getfund;
  v_vat    := expense_row.vat;
  v_covid  := CASE WHEN expense_row.covid > 0 THEN expense_row.covid ELSE 0 END;
  v_total_tax := v_nhil + v_getfund + v_vat + v_covid;

  IF v_total_tax > 0 AND expense_row.total IS NOT NULL THEN
    v_subtotal := expense_row.total - v_total_tax;
    IF v_subtotal < 0 THEN
      RAISE EXCEPTION 'Expense total (%) is less than sum of taxes (%). Fix amount/total/tax fields for expense %', expense_row.total, v_total_tax, p_expense_id;
    END IF;
  ELSE
    v_subtotal := COALESCE(expense_row.amount, expense_row.total, 0);
  END IF;

  IF COALESCE(expense_row.fx_rate, 0) > 0 AND expense_row.currency_code IS NOT NULL THEN
    v_subtotal := ROUND(v_subtotal * expense_row.fx_rate, 2);
    v_nhil   := ROUND(v_nhil * expense_row.fx_rate, 2);
    v_getfund := ROUND(v_getfund * expense_row.fx_rate, 2);
    v_vat    := ROUND(v_vat * expense_row.fx_rate, 2);
    v_covid  := ROUND(v_covid * expense_row.fx_rate, 2);
    v_payment_credit := ROUND(COALESCE(expense_row.total, 0) * expense_row.fx_rate, 2);
  ELSE
    v_payment_credit := COALESCE(expense_row.total, 0);
  END IF;

  v_description := 'Expense: ' || COALESCE(NULLIF(TRIM(expense_row.supplier), ''), NULLIF(TRIM(expense_row.notes), ''), 'General expense');

  PERFORM assert_accounting_period_is_open(business_id_val, expense_row.date);

  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, '5100');

  IF v_nhil > 0 THEN PERFORM assert_account_exists(business_id_val, '2110'); END IF;
  IF v_getfund > 0 THEN PERFORM assert_account_exists(business_id_val, '2120'); END IF;
  IF v_vat > 0 THEN PERFORM assert_account_exists(business_id_val, '2100'); END IF;
  IF v_covid > 0 THEN PERFORM assert_account_exists(business_id_val, '2130'); END IF;

  cash_account_id := get_account_by_control_key(business_id_val, 'CASH');
  expense_account_id := get_account_by_code(business_id_val, '5100');

  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', expense_account_id,
      'debit', v_subtotal,
      'description', 'Operating expense'
    ),
    jsonb_build_object(
      'account_id', cash_account_id,
      'credit', v_payment_credit,
      'description', 'Cash payment'
    )
  );

  -- Parse persisted tax metadata (if any). This is the authoritative mapping
  -- for new expenses; legacy rows fall back to the column-derived lines below.
  v_tax_lines := expense_row.tax_lines;
  IF v_tax_lines IS NOT NULL THEN
    IF jsonb_typeof(v_tax_lines) = 'object' AND v_tax_lines ? 'lines' THEN
      v_tax_lines_array := v_tax_lines->'lines';
    ELSIF jsonb_typeof(v_tax_lines) = 'object' AND v_tax_lines ? 'tax_lines' THEN
      v_tax_lines_array := v_tax_lines->'tax_lines';
    ELSIF jsonb_typeof(v_tax_lines) = 'array' THEN
      v_tax_lines_array := v_tax_lines;
    END IF;
  END IF;

  IF v_tax_lines_array IS NOT NULL AND jsonb_typeof(v_tax_lines_array) = 'array' THEN
    FOR v_tax_line IN SELECT * FROM jsonb_array_elements(v_tax_lines_array)
    LOOP
      v_tax_amount := COALESCE((v_tax_line->>'amount')::NUMERIC, 0);
      IF COALESCE(expense_row.fx_rate, 0) > 0 AND expense_row.currency_code IS NOT NULL THEN
        v_tax_amount := ROUND(v_tax_amount * expense_row.fx_rate, 2);
      END IF;
      v_tax_account_code := v_tax_line->>'ledger_account_code';
      v_tax_side := v_tax_line->>'ledger_side';

      IF v_tax_account_code IS NOT NULL AND v_tax_amount > 0 THEN
        PERFORM assert_account_exists(business_id_val, v_tax_account_code);
        v_tax_account_id := get_account_by_code(business_id_val, v_tax_account_code);

        IF v_tax_side = 'credit' THEN
          journal_lines := journal_lines || jsonb_build_array(
            jsonb_build_object(
              'account_id', v_tax_account_id,
              'credit', v_tax_amount,
              'description', COALESCE(v_tax_line->>'code', 'Tax') || ' tax'
            )
          );
        ELSE
          journal_lines := journal_lines || jsonb_build_array(
            jsonb_build_object(
              'account_id', v_tax_account_id,
              'debit', v_tax_amount,
              'description', COALESCE(v_tax_line->>'code', 'Tax') || ' tax'
            )
          );
          v_tax_added_from_jsonb := v_tax_added_from_jsonb + v_tax_amount;
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF v_tax_added_from_jsonb <= 0 THEN
    -- Legacy fallback: post from persisted columns (pre-2026 absorbed rows
    -- created before tax_lines existed keep their original behavior).
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
  END IF;

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
    'system',
    FALSE,
    NULL::UUID
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.post_expense_to_ledger_pkgb_body(UUID, TEXT, TEXT, TEXT) IS
  'Posts expenses in home currency. Uses persisted tax_lines for account direction (pre-2026 non-creditable levies absorbed to cost); legacy rows without tax_lines fall back to column-derived input-tax lines.';
