-- ============================================================================
-- Sale / Refund / Void posting idempotency: advisory lock + re-check under lock.
-- One sale_id → one JE (reference_type='sale'); one refund → one JE ('refund');
-- one void → one JE ('void'). No schema or contract changes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) post_sale_to_ledger
-- ----------------------------------------------------------------------------
-- Step 1: business_id from sale row (already done: business_id_val := sale_record.business_id).
-- Step 2: Advisory lock (business_id, sale_id).
-- Step 3: Idempotency check under lock (reference_type='sale', reference_id=p_sale_id); return if exists.
-- Step 4: Proceed with existing posting logic.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION post_sale_to_ledger(
  p_sale_id UUID,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL,
  p_posted_by_accountant_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  sale_record RECORD;
  business_id_val UUID;
  cash_account_id UUID;
  revenue_account_id UUID;
  cogs_account_id UUID;
  inventory_account_id UUID;
  journal_id UUID;
  gross_total NUMERIC;
  net_total NUMERIC;
  total_tax_amount NUMERIC := 0;
  tax_lines_jsonb JSONB;
  tax_lines_array JSONB;
  tax_line_item JSONB;
  parsed_tax_lines JSONB[] := ARRAY[]::JSONB[];
  journal_lines JSONB;
  tax_account_id UUID;
  tax_code TEXT;
  tax_amount NUMERIC;
  tax_ledger_side TEXT;
  tax_ledger_account_code TEXT;
  cash_account_code TEXT;
  total_cogs NUMERIC := 0;
  vat_payable_account_id UUID;
  effective_date DATE;
  system_accountant_id UUID;
  revenue_credit_value NUMERIC;
BEGIN
  SELECT 
    s.business_id,
    s.amount,
    s.created_at,
    s.description,
    s.tax_lines,
    s.tax_engine_effective_from
  INTO sale_record
  FROM sales s
  WHERE s.id = p_sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found: %', p_sale_id;
  END IF;

  business_id_val := sale_record.business_id;
  effective_date := COALESCE(sale_record.tax_engine_effective_from::DATE, sale_record.created_at::DATE);

  IF business_id_val IS NULL THEN
    RAISE EXCEPTION 'Business ID is NULL for sale: %', p_sale_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(business_id_val::text), hashtext(p_sale_id::text));

  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'sale'
    AND reference_id = p_sale_id
  LIMIT 1;

  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  gross_total := COALESCE(sale_record.amount, 0);
  IF gross_total <= 0 THEN
    RAISE EXCEPTION
      'Retail posting error: gross_total invalid (%). Sale amount must be positive. Sale ID: %',
      gross_total, p_sale_id;
  END IF;

  gross_total := ROUND(gross_total, 2);
  tax_lines_jsonb := sale_record.tax_lines;

  IF tax_lines_jsonb IS NOT NULL AND jsonb_typeof(tax_lines_jsonb) = 'object' THEN
    IF tax_lines_jsonb ? 'subtotal_excl_tax' THEN
      BEGIN
        net_total := (tax_lines_jsonb->>'subtotal_excl_tax')::numeric;
        IF net_total IS NULL OR net_total < 0 THEN
          IF tax_lines_jsonb ? 'tax_total' THEN
            BEGIN
              total_tax_amount := (tax_lines_jsonb->>'tax_total')::numeric;
              IF total_tax_amount IS NULL OR total_tax_amount < 0 THEN total_tax_amount := 0; END IF;
            EXCEPTION WHEN OTHERS THEN total_tax_amount := 0; END;
            net_total := gross_total - total_tax_amount;
          ELSE
            net_total := gross_total;
            total_tax_amount := 0;
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        net_total := gross_total;
        total_tax_amount := 0;
      END;
    ELSE
      IF tax_lines_jsonb ? 'tax_total' THEN
        BEGIN
          total_tax_amount := (tax_lines_jsonb->>'tax_total')::numeric;
          IF total_tax_amount IS NULL OR total_tax_amount < 0 THEN total_tax_amount := 0; END IF;
        EXCEPTION WHEN OTHERS THEN total_tax_amount := 0; END;
        net_total := gross_total - total_tax_amount;
      ELSE
        net_total := NULL;
        total_tax_amount := NULL;
      END IF;
    END IF;

    IF total_tax_amount IS NULL OR total_tax_amount = 0 THEN
      IF tax_lines_jsonb ? 'tax_total' THEN
        BEGIN
          total_tax_amount := (tax_lines_jsonb->>'tax_total')::numeric;
          IF total_tax_amount IS NULL OR total_tax_amount < 0 THEN total_tax_amount := 0; END IF;
        EXCEPTION WHEN OTHERS THEN total_tax_amount := 0; END;
      END IF;
    END IF;
  ELSE
    net_total := gross_total;
    total_tax_amount := 0;
  END IF;

  IF tax_lines_jsonb IS NOT NULL AND jsonb_typeof(tax_lines_jsonb) = 'object' THEN
    IF tax_lines_jsonb ? 'tax_lines' THEN tax_lines_array := tax_lines_jsonb->'tax_lines';
    ELSIF tax_lines_jsonb ? 'lines' THEN tax_lines_array := tax_lines_jsonb->'lines';
    ELSE tax_lines_array := NULL; END IF;
  ELSIF tax_lines_jsonb IS NOT NULL AND jsonb_typeof(tax_lines_jsonb) = 'array' THEN
    tax_lines_array := tax_lines_jsonb;
  ELSE
    tax_lines_array := NULL;
  END IF;

  IF (total_tax_amount IS NULL OR total_tax_amount = 0) AND tax_lines_array IS NOT NULL AND jsonb_typeof(tax_lines_array) = 'array' THEN
    BEGIN
      SELECT COALESCE(SUM(COALESCE((line->>'amount')::numeric, 0)), 0) INTO total_tax_amount
      FROM jsonb_array_elements(tax_lines_array) AS line WHERE line ? 'amount';
      IF total_tax_amount IS NULL THEN total_tax_amount := 0; END IF;
    EXCEPTION WHEN OTHERS THEN total_tax_amount := 0; END;
  END IF;

  IF tax_lines_array IS NOT NULL AND jsonb_typeof(tax_lines_array) = 'array' THEN
    FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_array)
    LOOP
      IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
        parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
      END IF;
    END LOOP;
  END IF;

  IF net_total IS NULL THEN
    IF total_tax_amount IS NOT NULL AND total_tax_amount >= 0 THEN net_total := gross_total - total_tax_amount;
    ELSE net_total := gross_total; total_tax_amount := 0; END IF;
  END IF;

  gross_total := ROUND(gross_total, 2);
  net_total := ROUND(COALESCE(net_total, gross_total), 2);
  total_tax_amount := ROUND(COALESCE(total_tax_amount, 0), 2);
  IF total_tax_amount IS NULL THEN total_tax_amount := 0; END IF;

  revenue_credit_value := ROUND(gross_total - COALESCE(total_tax_amount, 0), 2);
  IF revenue_credit_value IS NULL THEN
    RAISE EXCEPTION 'Retail posting error: Revenue credit is NULL. gross_total=%, total_tax_amount=%, sale_id=%',
      gross_total, total_tax_amount, p_sale_id;
  END IF;
  IF revenue_credit_value <= 0 THEN
    RAISE EXCEPTION 'Retail posting error: Revenue credit (%) must be positive. sale_id=%', revenue_credit_value, p_sale_id;
  END IF;
  net_total := revenue_credit_value;

  IF p_posted_by_accountant_id IS NULL THEN
    SELECT owner_id INTO system_accountant_id FROM businesses WHERE id = business_id_val;
    IF system_accountant_id IS NULL THEN
      RAISE EXCEPTION 'Cannot post sale to ledger: Business owner not found for business %.', business_id_val;
    END IF;
    p_posted_by_accountant_id := system_accountant_id;
  END IF;

  PERFORM assert_accounting_period_is_open(business_id_val, sale_record.created_at::DATE);

  SELECT COALESCE(SUM(COALESCE(cogs, 0)), 0) INTO total_cogs FROM sale_items WHERE sale_id = p_sale_id;
  total_cogs := ROUND(COALESCE(total_cogs, 0), 2);

  IF revenue_credit_value <= 0 AND total_tax_amount <= 0 THEN
    RAISE EXCEPTION 'Retail posting error: Revenue and tax both zero or negative. Sale ID: %', p_sale_id;
  END IF;
  IF gross_total <= 0 THEN RAISE EXCEPTION 'Retail posting error: gross_total invalid. Sale ID: %', p_sale_id; END IF;
  IF revenue_credit_value <= 0 THEN RAISE EXCEPTION 'Retail posting error: Revenue credit invalid. Sale ID: %', p_sale_id; END IF;
  IF total_tax_amount < 0 THEN RAISE EXCEPTION 'Retail posting error: tax_total negative. Sale ID: %', p_sale_id; END IF;

  BEGIN
    PERFORM ensure_retail_control_account_mapping(business_id_val, 'CASH', '1000');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Cannot post sale to ledger: % (Business: %, Sale: %)', SQLERRM, business_id_val, p_sale_id;
  END;

  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, '4000');
  PERFORM assert_account_exists(business_id_val, '5000');
  PERFORM assert_account_exists(business_id_val, '1200');
  IF array_length(parsed_tax_lines, 1) > 0 THEN
    FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
    LOOP
      tax_ledger_account_code := tax_line_item->>'ledger_account_code';
      IF (tax_ledger_account_code IS NULL OR tax_ledger_account_code = '') AND tax_line_item->>'code' IS NOT NULL THEN
        tax_ledger_account_code := map_tax_code_to_account_code(tax_line_item->>'code');
      END IF;
      IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
        PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
      END IF;
    END LOOP;
  ELSIF total_tax_amount > 0 THEN
    PERFORM assert_account_exists(business_id_val, '2100');
  END IF;

  cash_account_id := get_account_by_control_key(business_id_val, 'CASH');
  revenue_account_id := get_account_by_code(business_id_val, '4000');
  cogs_account_id := get_account_by_code(business_id_val, '5000');
  inventory_account_id := get_account_by_code(business_id_val, '1200');

  IF cash_account_id IS NULL THEN RAISE EXCEPTION 'Cash account not found for business: %', business_id_val; END IF;
  IF revenue_account_id IS NULL THEN RAISE EXCEPTION 'Revenue account (4000) not found for business: %', business_id_val; END IF;
  IF cogs_account_id IS NULL THEN RAISE EXCEPTION 'COGS account (5000) not found for business: %', business_id_val; END IF;
  IF inventory_account_id IS NULL THEN RAISE EXCEPTION 'Inventory account (1200) not found for business: %', business_id_val; END IF;

  IF ABS(gross_total - (revenue_credit_value + total_tax_amount)) > 0.01 THEN
    RAISE EXCEPTION 'Retail posting error: Totals do not balance. Sale ID: %', p_sale_id;
  END IF;

  journal_lines := jsonb_build_array(
    jsonb_build_object('account_id', cash_account_id, 'debit', ROUND(COALESCE(gross_total, 0), 2), 'description', 'Sale receipt'),
    jsonb_build_object('account_id', revenue_account_id, 'credit', ROUND(COALESCE(gross_total, 0) - COALESCE(total_tax_amount, 0), 2), 'description', 'Sales revenue'),
    jsonb_build_object('account_id', cogs_account_id, 'debit', total_cogs, 'description', 'Cost of goods sold'),
    jsonb_build_object('account_id', inventory_account_id, 'credit', total_cogs, 'description', 'Inventory reduction')
  );

  IF array_length(parsed_tax_lines, 1) > 0 THEN
    FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
    LOOP
      tax_code := tax_line_item->>'code';
      tax_amount := ROUND(COALESCE((tax_line_item->>'amount')::NUMERIC, 0), 2);
      tax_ledger_account_code := tax_line_item->>'ledger_account_code';
      tax_ledger_side := tax_line_item->>'ledger_side';
      IF (tax_ledger_account_code IS NULL OR tax_ledger_account_code = '') AND tax_code IS NOT NULL THEN
        tax_ledger_account_code := map_tax_code_to_account_code(tax_code);
      END IF;
      IF tax_ledger_side IS NULL OR tax_ledger_side = '' THEN tax_ledger_side := 'credit'; END IF;
      IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
        tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
        IF tax_account_id IS NULL THEN RAISE EXCEPTION 'Tax account (%) not found for business: %', tax_ledger_account_code, business_id_val; END IF;
        IF tax_ledger_side = 'credit' THEN
          journal_lines := journal_lines || jsonb_build_array(jsonb_build_object('account_id', tax_account_id, 'credit', tax_amount, 'description', COALESCE(tax_code, 'Tax') || ' tax'));
        ELSIF tax_ledger_side = 'debit' THEN
          journal_lines := journal_lines || jsonb_build_array(jsonb_build_object('account_id', tax_account_id, 'debit', tax_amount, 'description', COALESCE(tax_code, 'Tax') || ' tax'));
        END IF;
      END IF;
    END LOOP;
  ELSIF total_tax_amount > 0 THEN
    total_tax_amount := ROUND(COALESCE(total_tax_amount, 0), 2);
    IF total_tax_amount > 0 THEN
      vat_payable_account_id := get_account_by_code(business_id_val, '2100');
      IF vat_payable_account_id IS NULL THEN
        RAISE EXCEPTION 'VAT Payable account (2100) not found for business: %.', business_id_val;
      END IF;
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object('account_id', vat_payable_account_id, 'credit', total_tax_amount, 'description', 'Tax payable (tax-inclusive sale)')
      );
    END IF;
  END IF;

  IF ABS(gross_total - (revenue_credit_value + total_tax_amount)) > 0.01 THEN
    RAISE EXCEPTION 'Tax-inclusive sale posting imbalance. Sale: %', p_sale_id;
  END IF;

  BEGIN
    INSERT INTO public.retail_posting_debug_log (sale_id, business_id, gross_total, net_total, total_tax_amount, total_cogs, tax_lines_jsonb, journal_lines, line_count, debit_sum, credit_sum, credit_count, tax_shape, note)
    SELECT p_sale_id, business_id_val, gross_total, revenue_credit_value, total_tax_amount, total_cogs, tax_lines_jsonb, journal_lines,
      COALESCE(jsonb_array_length(journal_lines), 0),
      COALESCE((SELECT SUM(COALESCE((line->>'debit')::numeric, 0)) FROM jsonb_array_elements(COALESCE(journal_lines, '[]'::jsonb)) AS line), 0),
      COALESCE((SELECT SUM(COALESCE((line->>'credit')::numeric, 0)) FROM jsonb_array_elements(COALESCE(journal_lines, '[]'::jsonb)) AS line), 0),
      COALESCE((SELECT COUNT(*) FROM jsonb_array_elements(COALESCE(journal_lines, '[]'::jsonb)) AS line WHERE COALESCE((line->>'credit')::numeric, 0) > 0), 0),
      CASE WHEN tax_lines_jsonb IS NULL THEN 'null' WHEN jsonb_typeof(tax_lines_jsonb) = 'object' THEN 'object' WHEN jsonb_typeof(tax_lines_jsonb) = 'array' THEN 'array' ELSE 'other' END,
      'Before post_journal_entry - idempotent';
  EXCEPTION WHEN undefined_table THEN NULL; WHEN OTHERS THEN RAISE NOTICE 'DEBUG LOG ERROR (non-fatal): %', SQLERRM;
  END;

  SELECT post_journal_entry(
    business_id_val, sale_record.created_at::DATE,
    'Sale' || COALESCE(': ' || sale_record.description, ''),
    'sale', p_sale_id, journal_lines,
    FALSE, NULL, NULL, NULL, p_entry_type, p_backfill_reason, p_backfill_actor, p_posted_by_accountant_id
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_sale_to_ledger(UUID, TEXT, TEXT, TEXT, UUID) IS
'Posts sale to ledger. Idempotent: advisory lock + re-check under lock (reference_type=sale, reference_id=sale_id). One sale_id → one JE.';

-- ----------------------------------------------------------------------------
-- 2) post_sale_refund_to_ledger
-- ----------------------------------------------------------------------------
-- Step 1: business_id from sale row (get sale_record first, then business_id_val := sale_record.business_id).
-- Step 2: Advisory lock (business_id, sale_id).
-- Step 3: Idempotency check under lock (reference_type='refund', reference_id=p_sale_id); return if exists.
-- Step 4: Proceed with existing posting logic (validate refunded, resolve payment account, build reversal, post).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION post_sale_refund_to_ledger(p_sale_id UUID)
RETURNS UUID AS $$
DECLARE
  sale_record RECORD;
  original_journal_entry RECORD;
  business_id_val UUID;
  payment_account_id UUID;
  payment_account_code TEXT;
  revenue_account_id UUID;
  cogs_account_id UUID;
  inventory_account_id UUID;
  journal_id UUID;
  subtotal NUMERIC;
  total_cogs NUMERIC := 0;
  tax_lines_jsonb JSONB;
  tax_line_item JSONB;
  parsed_tax_lines JSONB[] := ARRAY[]::JSONB[];
  journal_lines JSONB;
  tax_account_id UUID;
  tax_code TEXT;
  tax_amount NUMERIC;
  tax_ledger_side TEXT;
  tax_ledger_account_code TEXT;
  total_tax_amount NUMERIC := 0;
  has_payment_credit BOOLEAN := FALSE;
  has_vat_reversal BOOLEAN := FALSE;
  has_cash_credit BOOLEAN := FALSE;
  line JSONB;
  line_account_code TEXT;
BEGIN
  SELECT s.business_id, s.amount, s.created_at, s.description, s.tax_lines, s.payment_status
  INTO sale_record FROM sales s WHERE s.id = p_sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found: %', p_sale_id;
  END IF;

  business_id_val := sale_record.business_id;
  IF business_id_val IS NULL THEN
    RAISE EXCEPTION 'Business ID is NULL for sale: %', p_sale_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(business_id_val::text), hashtext(p_sale_id::text));

  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'refund'
    AND reference_id = p_sale_id
  LIMIT 1;

  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  IF sale_record.payment_status != 'refunded' THEN
    RAISE EXCEPTION 'Sale % is not refunded (payment_status: %). Cannot post refund to ledger.',
      p_sale_id, sale_record.payment_status;
  END IF;

  PERFORM assert_accounting_period_is_open(business_id_val, CURRENT_DATE);

  SELECT id, date, description INTO original_journal_entry
  FROM journal_entries
  WHERE reference_type = 'sale' AND reference_id = p_sale_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original sale journal entry not found for sale %. Cannot post refund reversal without original entry.', p_sale_id;
  END IF;

  SELECT resolved.payment_account_id, resolved.payment_account_code
  INTO payment_account_id, payment_account_code
  FROM resolve_payment_account_from_sale(p_sale_id) AS resolved;

  IF payment_account_id IS NULL THEN
    RAISE EXCEPTION 'Original sale journal entry does not have payment account debit. Cannot determine refund payment account for sale %.', p_sale_id;
  END IF;

  SELECT COALESCE(SUM(COALESCE(cogs, 0)), 0) INTO total_cogs FROM sale_items WHERE sale_id = p_sale_id;

  tax_lines_jsonb := sale_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    IF jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'tax_lines' THEN tax_lines_jsonb := tax_lines_jsonb->'tax_lines'; END IF;
    IF jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_jsonb)
      LOOP
        IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
          parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
          total_tax_amount := total_tax_amount + COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
        END IF;
      END LOOP;
    END IF;
  END IF;

  subtotal := COALESCE(sale_record.amount, 0) - total_tax_amount;

  PERFORM assert_account_exists(business_id_val, payment_account_code);
  PERFORM assert_account_exists(business_id_val, '4000');
  IF total_cogs > 0 THEN
    PERFORM assert_account_exists(business_id_val, '5000');
    PERFORM assert_account_exists(business_id_val, '1200');
  END IF;
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  revenue_account_id := get_account_by_code(business_id_val, '4000');
  IF total_cogs > 0 THEN
    cogs_account_id := get_account_by_code(business_id_val, '5000');
    inventory_account_id := get_account_by_code(business_id_val, '1200');
  END IF;

  IF payment_account_id IS NULL THEN RAISE EXCEPTION 'Payment account not found for business: %', business_id_val; END IF;
  IF revenue_account_id IS NULL THEN RAISE EXCEPTION 'Revenue account (4000) not found for business: %', business_id_val; END IF;
  IF total_cogs > 0 THEN
    IF cogs_account_id IS NULL THEN RAISE EXCEPTION 'COGS account (5000) not found for business: %', business_id_val; END IF;
    IF inventory_account_id IS NULL THEN RAISE EXCEPTION 'Inventory account (1200) not found for business: %', business_id_val; END IF;
  END IF;

  journal_lines := jsonb_build_array(
    jsonb_build_object('account_id', payment_account_id, 'credit', sale_record.amount, 'description', 'Refund: ' || COALESCE(payment_account_code, 'Payment') || ' payment reversed'),
    jsonb_build_object('account_id', revenue_account_id, 'debit', subtotal, 'description', 'Refund: Sales revenue reversed')
  );
  IF total_cogs > 0 THEN
    journal_lines := journal_lines || jsonb_build_array(
      jsonb_build_object('account_id', cogs_account_id, 'credit', total_cogs, 'description', 'Refund: Cost of goods sold reversed'),
      jsonb_build_object('account_id', inventory_account_id, 'debit', total_cogs, 'description', 'Refund: Inventory restored')
    );
  END IF;
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    tax_ledger_side := tax_line_item->>'ledger_side';
    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      IF tax_ledger_side = 'credit' THEN
        journal_lines := journal_lines || jsonb_build_array(jsonb_build_object('account_id', tax_account_id, 'debit', tax_amount, 'description', 'Refund: ' || COALESCE(tax_code, 'Tax') || ' tax reversed'));
      ELSIF tax_ledger_side = 'debit' THEN
        journal_lines := journal_lines || jsonb_build_array(jsonb_build_object('account_id', tax_account_id, 'credit', tax_amount, 'description', 'Refund: ' || COALESCE(tax_code, 'Tax') || ' tax reversed'));
      END IF;
    END IF;
  END LOOP;

  FOR line IN SELECT * FROM jsonb_array_elements(journal_lines)
  LOOP
    IF (line->>'account_id')::UUID = payment_account_id AND COALESCE((line->>'credit')::NUMERIC, 0) > 0 THEN
      has_payment_credit := TRUE;
      IF payment_account_code = '1000' THEN has_cash_credit := TRUE; END IF;
    END IF;
    SELECT code INTO line_account_code FROM accounts WHERE id = (line->>'account_id')::UUID;
    IF line_account_code = '2100' AND COALESCE((line->>'debit')::NUMERIC, 0) > 0 THEN has_vat_reversal := TRUE; END IF;
  END LOOP;

  IF has_vat_reversal AND payment_account_code = '1000' AND NOT has_cash_credit THEN
    RAISE EXCEPTION 'CASH_REFUND_INCOMPLETE: Cash refund must credit Cash (1000) when VAT is reversed. Sale ID: %', p_sale_id;
  END IF;
  IF payment_account_code = '1000' AND NOT has_payment_credit THEN
    RAISE EXCEPTION 'CASH_REFUND_MUST_CREDIT_CASH: Cash refund must credit Cash account (1000). Sale ID: %', p_sale_id;
  END IF;
  IF payment_account_code != '1000' THEN
    FOR line IN SELECT * FROM jsonb_array_elements(journal_lines)
    LOOP
      SELECT code INTO line_account_code FROM accounts WHERE id = (line->>'account_id')::UUID;
      IF line_account_code = '1000' AND COALESCE((line->>'credit')::NUMERIC, 0) > 0 THEN
        RAISE EXCEPTION 'ENFORCEMENT FAILED: Non-cash refund (original: %) must not credit Cash (1000). Sale ID: %', payment_account_code, p_sale_id;
      END IF;
    END LOOP;
  END IF;

  SELECT post_journal_entry(
    business_id_val, CURRENT_DATE,
    'Refund: Sale' || COALESCE(': ' || sale_record.description, ''),
    'refund', p_sale_id, journal_lines,
    FALSE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'system'
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_sale_refund_to_ledger(UUID) IS
'Creates reversal JE for refunded sales. Idempotent: advisory lock + re-check under lock (reference_type=refund). One sale_id refund → one JE.';

-- ----------------------------------------------------------------------------
-- 3) post_sale_void_to_ledger
-- ----------------------------------------------------------------------------
-- Step 1: business_id from sale row (sale must exist; get sale_record then business_id_val := sale_record.business_id).
-- Step 2: Advisory lock (business_id, sale_id).
-- Step 3: Idempotency check under lock (reference_type='void', reference_id=p_sale_id); return if exists.
-- Step 4: Proceed with existing posting logic (resolve payment account, build reversal, post).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION post_sale_void_to_ledger(p_sale_id UUID)
RETURNS UUID AS $$
DECLARE
  sale_record RECORD;
  business_id_val UUID;
  payment_account_id UUID;
  payment_account_code TEXT;
  revenue_account_id UUID;
  cogs_account_id UUID;
  inventory_account_id UUID;
  journal_id UUID;
  subtotal NUMERIC;
  total_cogs NUMERIC := 0;
  tax_lines_jsonb JSONB;
  tax_line_item JSONB;
  parsed_tax_lines JSONB[] := ARRAY[]::JSONB[];
  journal_lines JSONB;
  tax_account_id UUID;
  tax_code TEXT;
  tax_amount NUMERIC;
  tax_ledger_side TEXT;
  tax_ledger_account_code TEXT;
  total_tax_amount NUMERIC := 0;
  has_payment_credit BOOLEAN := FALSE;
  has_vat_reversal BOOLEAN := FALSE;
  has_cash_credit BOOLEAN := FALSE;
  line JSONB;
  line_account_code TEXT;
BEGIN
  SELECT s.business_id, s.amount, s.created_at, s.description, s.tax_lines
  INTO sale_record FROM sales s WHERE s.id = p_sale_id;

  IF NOT FOUND THEN
    SELECT business_id INTO business_id_val FROM journal_entries WHERE reference_type = 'sale' AND reference_id = p_sale_id LIMIT 1;
    IF business_id_val IS NULL THEN
      RAISE EXCEPTION 'Sale % not found and no original journal entry exists. Cannot post void to ledger.', p_sale_id;
    END IF;
    RAISE EXCEPTION 'Sale % not found. Void posting requires sale to exist. Post void before deleting sale.', p_sale_id;
  END IF;

  business_id_val := sale_record.business_id;
  IF business_id_val IS NULL THEN
    RAISE EXCEPTION 'Business ID is NULL for sale: %', p_sale_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(business_id_val::text), hashtext(p_sale_id::text));

  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'void'
    AND reference_id = p_sale_id
  LIMIT 1;

  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  PERFORM assert_accounting_period_is_open(business_id_val, CURRENT_DATE);

  SELECT id INTO journal_id FROM journal_entries WHERE reference_type = 'sale' AND reference_id = p_sale_id LIMIT 1;
  IF journal_id IS NULL THEN
    RAISE EXCEPTION 'Original sale journal entry not found for sale %. Cannot post void reversal without original entry.', p_sale_id;
  END IF;

  SELECT resolved.payment_account_id, resolved.payment_account_code
  INTO payment_account_id, payment_account_code
  FROM resolve_payment_account_from_sale(p_sale_id) AS resolved;

  IF payment_account_id IS NULL THEN
    RAISE EXCEPTION 'Original sale journal entry does not have payment account debit. Cannot determine void payment account for sale %.', p_sale_id;
  END IF;

  SELECT COALESCE(SUM(COALESCE(cogs, 0)), 0) INTO total_cogs FROM sale_items WHERE sale_id = p_sale_id;

  tax_lines_jsonb := sale_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    IF jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'tax_lines' THEN tax_lines_jsonb := tax_lines_jsonb->'tax_lines'; END IF;
    IF jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_jsonb)
      LOOP
        IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
          parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
          total_tax_amount := total_tax_amount + COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
        END IF;
      END LOOP;
    END IF;
  END IF;

  subtotal := COALESCE(sale_record.amount, 0) - total_tax_amount;

  PERFORM assert_account_exists(business_id_val, payment_account_code);
  PERFORM assert_account_exists(business_id_val, '4000');
  IF total_cogs > 0 THEN
    PERFORM assert_account_exists(business_id_val, '5000');
    PERFORM assert_account_exists(business_id_val, '1200');
  END IF;
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  revenue_account_id := get_account_by_code(business_id_val, '4000');
  IF total_cogs > 0 THEN
    cogs_account_id := get_account_by_code(business_id_val, '5000');
    inventory_account_id := get_account_by_code(business_id_val, '1200');
  END IF;

  IF payment_account_id IS NULL THEN RAISE EXCEPTION 'Payment account not found for business: %', business_id_val; END IF;
  IF revenue_account_id IS NULL THEN RAISE EXCEPTION 'Revenue account (4000) not found for business: %', business_id_val; END IF;
  IF total_cogs > 0 THEN
    IF cogs_account_id IS NULL THEN RAISE EXCEPTION 'COGS account (5000) not found for business: %', business_id_val; END IF;
    IF inventory_account_id IS NULL THEN RAISE EXCEPTION 'Inventory account (1200) not found for business: %', business_id_val; END IF;
  END IF;

  journal_lines := jsonb_build_array(
    jsonb_build_object('account_id', payment_account_id, 'credit', sale_record.amount, 'description', 'Void: ' || COALESCE(payment_account_code, 'Payment') || ' payment reversed'),
    jsonb_build_object('account_id', revenue_account_id, 'debit', subtotal, 'description', 'Void: Sales revenue reversed')
  );
  IF total_cogs > 0 THEN
    journal_lines := journal_lines || jsonb_build_array(
      jsonb_build_object('account_id', cogs_account_id, 'credit', total_cogs, 'description', 'Void: Cost of goods sold reversed'),
      jsonb_build_object('account_id', inventory_account_id, 'debit', total_cogs, 'description', 'Void: Inventory restored')
    );
  END IF;
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    tax_ledger_side := tax_line_item->>'ledger_side';
    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      IF tax_ledger_side = 'credit' THEN
        journal_lines := journal_lines || jsonb_build_array(jsonb_build_object('account_id', tax_account_id, 'debit', tax_amount, 'description', 'Void: ' || COALESCE(tax_code, 'Tax') || ' tax reversed'));
      ELSIF tax_ledger_side = 'debit' THEN
        journal_lines := journal_lines || jsonb_build_array(jsonb_build_object('account_id', tax_account_id, 'credit', tax_amount, 'description', 'Void: ' || COALESCE(tax_code, 'Tax') || ' tax reversed'));
      END IF;
    END IF;
  END LOOP;

  FOR line IN SELECT * FROM jsonb_array_elements(journal_lines)
  LOOP
    IF (line->>'account_id')::UUID = payment_account_id AND COALESCE((line->>'credit')::NUMERIC, 0) > 0 THEN
      has_payment_credit := TRUE;
      IF payment_account_code = '1000' THEN has_cash_credit := TRUE; END IF;
    END IF;
    SELECT code INTO line_account_code FROM accounts WHERE id = (line->>'account_id')::UUID;
    IF line_account_code = '2100' AND COALESCE((line->>'debit')::NUMERIC, 0) > 0 THEN has_vat_reversal := TRUE; END IF;
  END LOOP;

  IF has_vat_reversal AND payment_account_code = '1000' AND NOT has_cash_credit THEN
    RAISE EXCEPTION 'CASH_REFUND_INCOMPLETE: Cash void must credit Cash (1000) when VAT is reversed. Sale ID: %', p_sale_id;
  END IF;
  IF payment_account_code = '1000' AND NOT has_payment_credit THEN
    RAISE EXCEPTION 'CASH_REFUND_MUST_CREDIT_CASH: Cash void must credit Cash account (1000). Sale ID: %', p_sale_id;
  END IF;
  IF payment_account_code != '1000' THEN
    FOR line IN SELECT * FROM jsonb_array_elements(journal_lines)
    LOOP
      SELECT code INTO line_account_code FROM accounts WHERE id = (line->>'account_id')::UUID;
      IF line_account_code = '1000' AND COALESCE((line->>'credit')::NUMERIC, 0) > 0 THEN
        RAISE EXCEPTION 'ENFORCEMENT FAILED: Non-cash void (original: %) must not credit Cash (1000). Sale ID: %', payment_account_code, p_sale_id;
      END IF;
    END LOOP;
  END IF;

  SELECT post_journal_entry(
    business_id_val, CURRENT_DATE,
    'Void: Sale' || COALESCE(': ' || sale_record.description, ''),
    'void', p_sale_id, journal_lines,
    FALSE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'system'
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_sale_void_to_ledger(UUID) IS
'Creates reversal JE for voided sales. Idempotent: advisory lock + re-check under lock (reference_type=void). One sale_id void → one JE.';

-- ============================================================================
-- PLACEMENT NOTE: Lock + re-check (exact placement)
-- ============================================================================
--
-- post_sale_to_ledger:
--   After: business_id_val := sale_record.business_id; effective_date := ...
--   Then:  IF business_id_val IS NULL RAISE; PERFORM pg_advisory_xact_lock(hashtext(business_id_val::text), hashtext(p_sale_id::text));
--   Then:  SELECT id INTO journal_id FROM journal_entries WHERE reference_type = 'sale' AND reference_id = p_sale_id LIMIT 1;
--   Then:  IF journal_id IS NOT NULL THEN RETURN journal_id; END IF;
--   Then:  existing posting logic (gross_total, tax, journal_lines, post_journal_entry).
--
-- post_sale_refund_to_ledger:
--   After: SELECT ... INTO sale_record; business_id_val := sale_record.business_id;
--   Then:  IF business_id_val IS NULL RAISE; PERFORM pg_advisory_xact_lock(..., p_sale_id);
--   Then:  SELECT id INTO journal_id WHERE reference_type = 'refund' AND reference_id = p_sale_id; IF found RETURN journal_id;
--   Then:  validate payment_status, resolve payment account, build reversal, post_journal_entry.
--
-- post_sale_void_to_ledger:
--   After: SELECT ... INTO sale_record (or resolve business_id from JE if sale missing); business_id_val := sale_record.business_id;
--   Then:  IF business_id_val IS NULL RAISE; PERFORM pg_advisory_xact_lock(..., p_sale_id);
--   Then:  SELECT id INTO journal_id WHERE reference_type = 'void' AND reference_id = p_sale_id; IF found RETURN journal_id;
--   Then:  assert period open, resolve payment account, build reversal, post_journal_entry.
--
-- ============================================================================
-- PROOF: No duplicates (run after migration to verify)
-- ============================================================================
-- Sale duplicates (expect 0 rows):
--   SELECT reference_id AS sale_id, COUNT(*) AS cnt
--   FROM journal_entries WHERE reference_type = 'sale'
--   GROUP BY reference_id HAVING COUNT(*) > 1;
--
-- Refund duplicates (expect 0 rows):
--   SELECT reference_id AS sale_id, COUNT(*) AS cnt
--   FROM journal_entries WHERE reference_type = 'refund'
--   GROUP BY reference_id HAVING COUNT(*) > 1;
--
-- Void duplicates (expect 0 rows):
--   SELECT reference_id AS sale_id, COUNT(*) AS cnt
--   FROM journal_entries WHERE reference_type = 'void'
--   GROUP BY reference_id HAVING COUNT(*) > 1;
--
-- ============================================================================
