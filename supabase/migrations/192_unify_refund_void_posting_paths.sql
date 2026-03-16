-- ============================================================================
-- MIGRATION: Unify All Refund/Void Posting Paths
-- ============================================================================
-- This migration ensures ALL refund/void paths that reverse VAT/revenue
-- also credit Cash (1000) when the original payment method was cash.
--
-- Changes:
-- 1. Create shared helper: resolve_payment_account_from_sale() to get payment account from original sale
-- 2. Add hard assertion CASH_REFUND_INCOMPLETE: If VAT is reversed AND original payment was cash AND no Cash credit exists → throw error
-- 3. Create post_sale_void_to_ledger() function for void sales (currently missing)
-- 4. Update post_sale_refund_to_ledger() to use shared helper and add new assertion
--
-- Refund/Void Paths Audited:
-- - Full refund: POST /api/override/refund-sale → post_sale_refund_to_ledger() ✅
-- - Void: POST /api/override/void-sale → post_sale_void_to_ledger() ✅ (NEW)
-- - Partial refund: Not currently supported (future enhancement)
-- ============================================================================

-- ============================================================================
-- STEP 1: Create Shared Helper Function
-- ============================================================================
-- Resolves payment account (Cash 1000, Bank 1010, MoMo 1020, Card 1030) from original sale journal entry
-- This is the canonical source of truth for payment method (not sales.payment_method field)
-- ============================================================================

CREATE OR REPLACE FUNCTION resolve_payment_account_from_sale(
  p_sale_id UUID
)
RETURNS TABLE (
  payment_account_id UUID,
  payment_account_code TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id AS payment_account_id,
    a.code AS payment_account_code
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a ON a.id = jel.account_id
  WHERE je.reference_type = 'sale'
    AND je.reference_id = p_sale_id
    AND a.code IN ('1000', '1010', '1020', '1030')  -- Cash, Bank, MoMo, Card
    AND jel.debit > 0  -- Original sale DEBITS the payment account
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION resolve_payment_account_from_sale IS 
'Shared helper to resolve payment account from original sale journal entry.
Returns the account that was debited in the original sale (Cash 1000, Bank 1010, MoMo 1020, Card 1030).
This is the canonical source of truth for payment method, not the sales.payment_method field.
Used by refund and void posting functions to ensure correct account is credited.';

-- ============================================================================
-- STEP 2: Update post_sale_refund_to_ledger() to use shared helper and add CASH_REFUND_INCOMPLETE assertion
-- ============================================================================

DROP FUNCTION IF EXISTS post_sale_refund_to_ledger(UUID) CASCADE;

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
  -- IDEMPOTENCY GUARD: Check if refund journal entry already exists
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'refund'
    AND reference_id = p_sale_id
    LIMIT 1;

  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  -- Get sale details
  SELECT 
    s.business_id,
    s.amount,
    s.created_at,
    s.description,
    s.tax_lines,
    s.payment_status
  INTO sale_record
  FROM sales s
  WHERE s.id = p_sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found: %', p_sale_id;
  END IF;

  -- Validate sale is refunded
  IF sale_record.payment_status != 'refunded' THEN
    RAISE EXCEPTION 'Sale % is not refunded (payment_status: %). Cannot post refund to ledger.', 
      p_sale_id, sale_record.payment_status;
  END IF;

  business_id_val := sale_record.business_id;

  -- GUARD: Assert accounting period is open
  PERFORM assert_accounting_period_is_open(business_id_val, CURRENT_DATE);

  -- Get original sale journal entry to ensure it exists
  SELECT id, date, description
  INTO original_journal_entry
  FROM journal_entries
  WHERE reference_type = 'sale'
    AND reference_id = p_sale_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original sale journal entry not found for sale %. Cannot post refund reversal without original entry.', 
      p_sale_id;
  END IF;

  -- USE SHARED HELPER: Resolve payment account from original sale journal entry
  SELECT 
    resolved.payment_account_id,
    resolved.payment_account_code
  INTO payment_account_id, payment_account_code
  FROM resolve_payment_account_from_sale(p_sale_id) AS resolved;

  IF payment_account_id IS NULL THEN
    RAISE EXCEPTION 'Original sale journal entry does not have payment account debit (Cash/Bank/MoMo/Card). Cannot determine refund payment account for sale %.', 
      p_sale_id;
  END IF;

  -- Calculate total COGS from sale_items
  SELECT COALESCE(SUM(COALESCE(cogs, 0)), 0)
  INTO total_cogs
  FROM sale_items
  WHERE sale_id = p_sale_id;

  -- Parse tax_lines JSONB metadata
  tax_lines_jsonb := sale_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    IF jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'tax_lines' THEN
      tax_lines_jsonb := tax_lines_jsonb->'tax_lines';
    END IF;
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

  -- Calculate subtotal
  subtotal := COALESCE(sale_record.amount, 0) - total_tax_amount;

  -- COA GUARD: Validate all accounts exist
  PERFORM assert_account_exists(business_id_val, payment_account_code);
  PERFORM assert_account_exists(business_id_val, '4000');
  IF total_cogs > 0 THEN
    PERFORM assert_account_exists(business_id_val, '5000');
    PERFORM assert_account_exists(business_id_val, '1200');
  END IF;
  
  -- Validate tax account codes
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  -- Get account IDs
  revenue_account_id := get_account_by_code(business_id_val, '4000');
  IF total_cogs > 0 THEN
    cogs_account_id := get_account_by_code(business_id_val, '5000');
    inventory_account_id := get_account_by_code(business_id_val, '1200');
  END IF;

  -- Validate all required accounts exist
  IF payment_account_id IS NULL THEN
    RAISE EXCEPTION 'Payment account not found for business: %', business_id_val;
  END IF;
  IF revenue_account_id IS NULL THEN
    RAISE EXCEPTION 'Revenue account (4000) not found for business: %', business_id_val;
  END IF;
  IF total_cogs > 0 THEN
    IF cogs_account_id IS NULL THEN
      RAISE EXCEPTION 'COGS account (5000) not found for business: %', business_id_val;
    END IF;
    IF inventory_account_id IS NULL THEN
      RAISE EXCEPTION 'Inventory account (1200) not found for business: %', business_id_val;
    END IF;
  END IF;

  -- Build reversal journal entry lines
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', payment_account_id,
      'credit', sale_record.amount,
      'description', 'Refund: ' || COALESCE(payment_account_code, 'Payment') || ' payment reversed'
    ),
    jsonb_build_object(
      'account_id', revenue_account_id,
      'debit', subtotal,
      'description', 'Refund: Sales revenue reversed'
    )
  );

  -- Add COGS and Inventory reversals
  IF total_cogs > 0 THEN
    journal_lines := journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', cogs_account_id,
        'credit', total_cogs,
        'description', 'Refund: Cost of goods sold reversed'
      ),
      jsonb_build_object(
        'account_id', inventory_account_id,
        'debit', total_cogs,
        'description', 'Refund: Inventory restored'
      )
    );
  END IF;

  -- Add tax reversals
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    tax_ledger_side := tax_line_item->>'ledger_side';

    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      
      IF tax_ledger_side = 'credit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'debit', tax_amount,
            'description', 'Refund: ' || COALESCE(tax_code, 'Tax') || ' tax reversed'
          )
        );
      ELSIF tax_ledger_side = 'debit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'credit', tax_amount,
            'description', 'Refund: ' || COALESCE(tax_code, 'Tax') || ' tax reversed'
          )
        );
      END IF;
    END IF;
  END LOOP;

  -- ENFORCEMENT: Validate journal_lines for cash refund completeness
  FOR line IN SELECT * FROM jsonb_array_elements(journal_lines)
  LOOP
    -- Check if payment account is credited
    IF (line->>'account_id')::UUID = payment_account_id 
       AND COALESCE((line->>'credit')::NUMERIC, 0) > 0 THEN
      has_payment_credit := TRUE;
      IF payment_account_code = '1000' THEN
        has_cash_credit := TRUE;
      END IF;
    END IF;
    
    -- Check if VAT (2100) is reversed (debited)
    SELECT code INTO line_account_code
    FROM accounts
    WHERE id = (line->>'account_id')::UUID;
    
    IF line_account_code = '2100' AND COALESCE((line->>'debit')::NUMERIC, 0) > 0 THEN
      has_vat_reversal := TRUE;
    END IF;
  END LOOP;

  -- HARD ASSERTION: CASH_REFUND_INCOMPLETE
  -- If VAT is reversed AND original payment was cash AND no Cash credit exists → throw error
  IF has_vat_reversal AND payment_account_code = '1000' AND NOT has_cash_credit THEN
    RAISE EXCEPTION 'CASH_REFUND_INCOMPLETE: Cash refund must credit Cash (1000) when VAT is reversed. Journal entry missing Cash CREDIT line. Sale ID: %', 
      p_sale_id;
  END IF;

  -- HARD GUARD: Cash refunds MUST credit Cash (1000)
  IF payment_account_code = '1000' AND NOT has_payment_credit THEN
    RAISE EXCEPTION 'CASH_REFUND_MUST_CREDIT_CASH: Cash refund must credit Cash account (1000). Journal entry missing Cash CREDIT line. Sale ID: %', 
      p_sale_id;
  END IF;

  -- ENFORCEMENT: Non-cash refunds MUST NOT credit Cash
  IF payment_account_code != '1000' THEN
    FOR line IN SELECT * FROM jsonb_array_elements(journal_lines)
    LOOP
      SELECT code INTO line_account_code
      FROM accounts
      WHERE id = (line->>'account_id')::UUID;
      
      IF line_account_code = '1000' AND COALESCE((line->>'credit')::NUMERIC, 0) > 0 THEN
        RAISE EXCEPTION 'ENFORCEMENT FAILED: Non-cash refund (original payment: %) must credit clearing account, not Cash (1000). Journal entry incorrectly credits Cash. Sale ID: %', 
          payment_account_code, p_sale_id;
      END IF;
    END LOOP;
  END IF;

  -- Post reversal journal entry
  SELECT post_journal_entry(
    business_id_val,
    CURRENT_DATE,
    'Refund: Sale' || COALESCE(': ' || sale_record.description, ''),
    'refund',
    p_sale_id,
    journal_lines,
    FALSE,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'system'
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_sale_refund_to_ledger IS 
'Creates reversal journal entry for refunded sales. Uses shared helper resolve_payment_account_from_sale() to get payment account from original sale journal entry. Enforces CASH_REFUND_INCOMPLETE: If VAT is reversed AND original payment was cash AND no Cash credit exists → throw error. Also enforces CASH_REFUND_MUST_CREDIT_CASH for all cash refunds.';

-- ============================================================================
-- STEP 3: Create post_sale_void_to_ledger() function for void sales
-- ============================================================================
-- Voids currently do NOT post to ledger, creating reconciliation gaps.
-- This function creates reversal journal entry for voided sales.
-- ============================================================================

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
  -- IDEMPOTENCY GUARD: Check if void journal entry already exists
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'void'
    AND reference_id = p_sale_id
    LIMIT 1;

  IF journal_id IS NOT NULL THEN
    RETURN journal_id;
  END IF;

  -- Get sale details (sale may have been deleted, so check journal entry first)
  -- If sale doesn't exist, we can still post void if original journal entry exists
  SELECT 
    s.business_id,
    s.amount,
    s.created_at,
    s.description,
    s.tax_lines
  INTO sale_record
  FROM sales s
  WHERE s.id = p_sale_id;

  -- If sale doesn't exist, try to get business_id from original journal entry
  IF NOT FOUND THEN
    SELECT business_id INTO business_id_val
    FROM journal_entries
    WHERE reference_type = 'sale'
      AND reference_id = p_sale_id
    LIMIT 1;
    
    IF business_id_val IS NULL THEN
      RAISE EXCEPTION 'Sale % not found and no original journal entry exists. Cannot post void to ledger.', 
        p_sale_id;
    END IF;
    
    -- Get amount and tax_lines from original journal entry metadata if available
    -- For now, we'll require the sale to exist (void should happen before deletion)
    RAISE EXCEPTION 'Sale % not found. Void posting requires sale to exist. Post void before deleting sale.', 
      p_sale_id;
  END IF;

  business_id_val := sale_record.business_id;

  -- GUARD: Assert accounting period is open
  PERFORM assert_accounting_period_is_open(business_id_val, CURRENT_DATE);

  -- Verify original sale journal entry exists
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'sale'
    AND reference_id = p_sale_id
  LIMIT 1;

  IF journal_id IS NULL THEN
    RAISE EXCEPTION 'Original sale journal entry not found for sale %. Cannot post void reversal without original entry.', 
      p_sale_id;
  END IF;

  -- USE SHARED HELPER: Resolve payment account from original sale journal entry
  SELECT 
    resolved.payment_account_id,
    resolved.payment_account_code
  INTO payment_account_id, payment_account_code
  FROM resolve_payment_account_from_sale(p_sale_id) AS resolved;

  IF payment_account_id IS NULL THEN
    RAISE EXCEPTION 'Original sale journal entry does not have payment account debit (Cash/Bank/MoMo/Card). Cannot determine void payment account for sale %.', 
      p_sale_id;
  END IF;

  -- Calculate total COGS from sale_items
  SELECT COALESCE(SUM(COALESCE(cogs, 0)), 0)
  INTO total_cogs
  FROM sale_items
  WHERE sale_id = p_sale_id;

  -- Parse tax_lines JSONB metadata
  tax_lines_jsonb := sale_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    IF jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'tax_lines' THEN
      tax_lines_jsonb := tax_lines_jsonb->'tax_lines';
    END IF;
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

  -- Calculate subtotal
  subtotal := COALESCE(sale_record.amount, 0) - total_tax_amount;

  -- COA GUARD: Validate all accounts exist
  PERFORM assert_account_exists(business_id_val, payment_account_code);
  PERFORM assert_account_exists(business_id_val, '4000');
  IF total_cogs > 0 THEN
    PERFORM assert_account_exists(business_id_val, '5000');
    PERFORM assert_account_exists(business_id_val, '1200');
  END IF;
  
  -- Validate tax account codes
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  -- Get account IDs
  revenue_account_id := get_account_by_code(business_id_val, '4000');
  IF total_cogs > 0 THEN
    cogs_account_id := get_account_by_code(business_id_val, '5000');
    inventory_account_id := get_account_by_code(business_id_val, '1200');
  END IF;

  -- Validate all required accounts exist
  IF payment_account_id IS NULL THEN
    RAISE EXCEPTION 'Payment account not found for business: %', business_id_val;
  END IF;
  IF revenue_account_id IS NULL THEN
    RAISE EXCEPTION 'Revenue account (4000) not found for business: %', business_id_val;
  END IF;
  IF total_cogs > 0 THEN
    IF cogs_account_id IS NULL THEN
      RAISE EXCEPTION 'COGS account (5000) not found for business: %', business_id_val;
    END IF;
    IF inventory_account_id IS NULL THEN
      RAISE EXCEPTION 'Inventory account (1200) not found for business: %', business_id_val;
    END IF;
  END IF;

  -- Build reversal journal entry lines
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', payment_account_id,
      'credit', sale_record.amount,
      'description', 'Void: ' || COALESCE(payment_account_code, 'Payment') || ' payment reversed'
    ),
    jsonb_build_object(
      'account_id', revenue_account_id,
      'debit', subtotal,
      'description', 'Void: Sales revenue reversed'
    )
  );

  -- Add COGS and Inventory reversals
  IF total_cogs > 0 THEN
    journal_lines := journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', cogs_account_id,
        'credit', total_cogs,
        'description', 'Void: Cost of goods sold reversed'
      ),
      jsonb_build_object(
        'account_id', inventory_account_id,
        'debit', total_cogs,
        'description', 'Void: Inventory restored'
      )
    );
  END IF;

  -- Add tax reversals
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    tax_ledger_side := tax_line_item->>'ledger_side';

    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      
      IF tax_ledger_side = 'credit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'debit', tax_amount,
            'description', 'Void: ' || COALESCE(tax_code, 'Tax') || ' tax reversed'
          )
        );
      ELSIF tax_ledger_side = 'debit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'credit', tax_amount,
            'description', 'Void: ' || COALESCE(tax_code, 'Tax') || ' tax reversed'
          )
        );
      END IF;
    END IF;
  END LOOP;

  -- ENFORCEMENT: Validate journal_lines for cash void completeness
  FOR line IN SELECT * FROM jsonb_array_elements(journal_lines)
  LOOP
    -- Check if payment account is credited
    IF (line->>'account_id')::UUID = payment_account_id 
       AND COALESCE((line->>'credit')::NUMERIC, 0) > 0 THEN
      has_payment_credit := TRUE;
      IF payment_account_code = '1000' THEN
        has_cash_credit := TRUE;
      END IF;
    END IF;
    
    -- Check if VAT (2100) is reversed (debited)
    SELECT code INTO line_account_code
    FROM accounts
    WHERE id = (line->>'account_id')::UUID;
    
    IF line_account_code = '2100' AND COALESCE((line->>'debit')::NUMERIC, 0) > 0 THEN
      has_vat_reversal := TRUE;
    END IF;
  END LOOP;

  -- HARD ASSERTION: CASH_REFUND_INCOMPLETE (applies to voids too)
  IF has_vat_reversal AND payment_account_code = '1000' AND NOT has_cash_credit THEN
    RAISE EXCEPTION 'CASH_REFUND_INCOMPLETE: Cash void must credit Cash (1000) when VAT is reversed. Journal entry missing Cash CREDIT line. Sale ID: %', 
      p_sale_id;
  END IF;

  -- HARD GUARD: Cash voids MUST credit Cash (1000)
  IF payment_account_code = '1000' AND NOT has_payment_credit THEN
    RAISE EXCEPTION 'CASH_REFUND_MUST_CREDIT_CASH: Cash void must credit Cash account (1000). Journal entry missing Cash CREDIT line. Sale ID: %', 
      p_sale_id;
  END IF;

  -- ENFORCEMENT: Non-cash voids MUST NOT credit Cash
  IF payment_account_code != '1000' THEN
    FOR line IN SELECT * FROM jsonb_array_elements(journal_lines)
    LOOP
      SELECT code INTO line_account_code
      FROM accounts
      WHERE id = (line->>'account_id')::UUID;
      
      IF line_account_code = '1000' AND COALESCE((line->>'credit')::NUMERIC, 0) > 0 THEN
        RAISE EXCEPTION 'ENFORCEMENT FAILED: Non-cash void (original payment: %) must credit clearing account, not Cash (1000). Journal entry incorrectly credits Cash. Sale ID: %', 
          payment_account_code, p_sale_id;
      END IF;
    END LOOP;
  END IF;

  -- Post reversal journal entry
  SELECT post_journal_entry(
    business_id_val,
    CURRENT_DATE,
    'Void: Sale' || COALESCE(': ' || sale_record.description, ''),
    'void',
    p_sale_id,
    journal_lines,
    FALSE,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'system'
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_sale_void_to_ledger IS 
'Creates reversal journal entry for voided sales. Uses shared helper resolve_payment_account_from_sale() to get payment account from original sale journal entry. Enforces CASH_REFUND_INCOMPLETE: If VAT is reversed AND original payment was cash AND no Cash credit exists → throw error. Also enforces CASH_REFUND_MUST_CREDIT_CASH for all cash voids. NOTE: Should be called BEFORE deleting the sale record.';
