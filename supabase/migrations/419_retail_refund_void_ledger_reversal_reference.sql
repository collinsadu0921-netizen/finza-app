-- ============================================================================
-- Migration 419: Post retail refund/void to ledger as reversal JEs
-- ============================================================================
-- post_sale_refund_to_ledger / post_sale_void_to_ledger used reference_type
-- 'refund' / 'void' with revenue (4000) lines. post_journal_entry (418) only
-- allows revenue for invoice, credit_note, reversal, sale (system), or
-- flagged adjustments — so refunds failed with the revenue guard exception.
--
-- FIX: Post both as reference_type = 'reversal', reference_id = the original
--      sale journal entry id, and p_reverses_entry_id = same id (explicit
--      link to the posted sale JE). Legacy rows (refund/void + sale_id) remain
--      idempotent return paths.
-- ============================================================================

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

  SELECT id, date, description INTO original_journal_entry
  FROM journal_entries
  WHERE reference_type = 'sale'
    AND reference_id = p_sale_id
    AND business_id = business_id_val
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original sale journal entry not found for sale %. Cannot post refund reversal without original entry.', p_sale_id;
  END IF;

  SELECT id INTO journal_id
  FROM journal_entries
  WHERE business_id = business_id_val
    AND (
      (reference_type = 'refund' AND reference_id = p_sale_id)
      OR (reference_type = 'reversal' AND reference_id = original_journal_entry.id)
      OR (reference_type = 'reversal' AND reverses_entry_id = original_journal_entry.id)
    )
  LIMIT 1;

  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  IF sale_record.payment_status != 'refunded' THEN
    RAISE EXCEPTION 'Sale % is not refunded (payment_status: %). Cannot post refund to ledger.',
      p_sale_id, sale_record.payment_status;
  END IF;

  PERFORM assert_accounting_period_is_open(business_id_val, CURRENT_DATE);

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
    business_id_val,
    CURRENT_DATE,
    'Refund: Sale' || COALESCE(': ' || sale_record.description, ''),
    'reversal',
    original_journal_entry.id,
    journal_lines,
    FALSE,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    p_posting_source => 'system',
    p_is_revenue_correction => FALSE,
    p_reverses_entry_id => original_journal_entry.id
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_sale_refund_to_ledger(UUID) IS
'Creates reversal JE for refunded retail sales. Idempotent: legacy (reference_type=refund, reference_id=sale_id) or reversal (reference_id/reverses_entry_id = original sale JE id). Satisfies post_journal_entry revenue guard via reference_type=reversal.';


CREATE OR REPLACE FUNCTION post_sale_void_to_ledger(p_sale_id UUID)
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

  SELECT id, date, description INTO original_journal_entry
  FROM journal_entries
  WHERE reference_type = 'sale'
    AND reference_id = p_sale_id
    AND business_id = business_id_val
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original sale journal entry not found for sale %. Cannot post void reversal without original entry.', p_sale_id;
  END IF;

  SELECT id INTO journal_id
  FROM journal_entries
  WHERE business_id = business_id_val
    AND (
      (reference_type = 'void' AND reference_id = p_sale_id)
      OR (reference_type = 'reversal' AND reference_id = original_journal_entry.id)
      OR (reference_type = 'reversal' AND reverses_entry_id = original_journal_entry.id)
    )
  LIMIT 1;

  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  PERFORM assert_accounting_period_is_open(business_id_val, CURRENT_DATE);

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
    business_id_val,
    CURRENT_DATE,
    'Void: Sale' || COALESCE(': ' || sale_record.description, ''),
    'reversal',
    original_journal_entry.id,
    journal_lines,
    FALSE,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    p_posting_source => 'system',
    p_is_revenue_correction => FALSE,
    p_reverses_entry_id => original_journal_entry.id
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_sale_void_to_ledger(UUID) IS
'Creates reversal JE for voided retail sales. Idempotent: legacy (reference_type=void, reference_id=sale_id) or reversal (reference_id/reverses_entry_id = original sale JE id). Satisfies post_journal_entry revenue guard via reference_type=reversal.';
