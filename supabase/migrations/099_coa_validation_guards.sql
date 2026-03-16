-- ============================================================================
-- MIGRATION: Accounting Mode A4.3 - COA Validation Guards
-- ============================================================================
-- This migration adds COA validation guards to all posting functions.
-- Ensures no Accounting Mode posting can write to an invalid account code.
--
-- Scope: Accounting Mode ONLY
-- No posting logic changes, no debit/credit behavior changes, no tax logic changes
-- ============================================================================

-- ============================================================================
-- Guard: post_invoice_to_ledger
-- ============================================================================
CREATE OR REPLACE FUNCTION post_invoice_to_ledger(p_invoice_id UUID)
RETURNS UUID AS $$
DECLARE
  invoice_record RECORD;
  business_id_val UUID;
  ar_account_id UUID;
  revenue_account_id UUID;
  journal_id UUID;
  subtotal NUMERIC;
  tax_lines_jsonb JSONB;
  tax_line_item JSONB;
  parsed_tax_lines JSONB[] := ARRAY[]::JSONB[];
  journal_lines JSONB;
  tax_account_id UUID;
  tax_code TEXT;
  tax_amount NUMERIC;
  tax_ledger_side TEXT;
  tax_ledger_account_code TEXT;
BEGIN
  -- Get invoice details
  SELECT 
    i.business_id,
    i.total,
    i.subtotal,
    i.total_tax,
    i.customer_id,
    i.invoice_number,
    i.issue_date,
    i.tax_lines
  INTO invoice_record
  FROM invoices i
  WHERE i.id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found: %', p_invoice_id;
  END IF;

  business_id_val := invoice_record.business_id;

  -- GUARD: Assert accounting period is open
  PERFORM assert_accounting_period_is_open(business_id_val, invoice_record.issue_date);

  subtotal := COALESCE(invoice_record.subtotal, 0);

  -- Parse tax_lines JSONB metadata
  tax_lines_jsonb := invoice_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    -- Handle both formats: object with tax_lines key, or direct array
    IF jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'tax_lines' THEN
      tax_lines_jsonb := tax_lines_jsonb->'tax_lines';
    END IF;
    -- Validate it's an array and parse individual tax line items
    IF jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_jsonb)
      LOOP
        -- Defensive validation: ensure tax line has required fields
        IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
          parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- COA GUARD: Validate all account codes before journal inserts
  PERFORM assert_account_exists(business_id_val, '1100'); -- AR
  PERFORM assert_account_exists(business_id_val, '4000'); -- Revenue
  
  -- Validate tax account codes from tax_lines
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  -- Get account IDs
  ar_account_id := get_account_by_code(business_id_val, '1100');
  revenue_account_id := get_account_by_code(business_id_val, '4000');

  -- Build journal entry lines: start with base lines (AR and Revenue)
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', ar_account_id,
      'debit', invoice_record.total,
      'description', 'Invoice receivable'
    ),
    jsonb_build_object(
      'account_id', revenue_account_id,
      'credit', subtotal,
      'description', 'Service revenue'
    )
  );

  -- Add tax lines: iterate parsed_tax_lines and post each to its control account
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    tax_ledger_side := tax_line_item->>'ledger_side';

    -- Only post tax lines with ledger_account_code (skip absorbed taxes)
    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      
      -- Build tax journal line based on ledger_side
      IF tax_ledger_side = 'credit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'credit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax'
          )
        );
      ELSIF tax_ledger_side = 'debit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'debit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax'
          )
        );
      END IF;
    END IF;
  END LOOP;

  -- Post journal entry
  SELECT post_journal_entry(
    business_id_val,
    invoice_record.issue_date,
    'Invoice #' || invoice_record.invoice_number,
    'invoice',
    p_invoice_id,
    journal_lines
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Guard: post_bill_to_ledger
-- ============================================================================
CREATE OR REPLACE FUNCTION post_bill_to_ledger(p_bill_id UUID)
RETURNS UUID AS $$
DECLARE
  bill_record RECORD;
  business_id_val UUID;
  ap_account_id UUID;
  expense_account_id UUID;
  journal_id UUID;
  tax_lines_jsonb JSONB;
  tax_line_item JSONB;
  parsed_tax_lines JSONB[] := ARRAY[]::JSONB[];
  journal_lines JSONB;
  tax_account_id UUID;
  tax_code TEXT;
  tax_amount NUMERIC;
  tax_ledger_side TEXT;
  tax_ledger_account_code TEXT;
BEGIN
  -- Get bill details
  SELECT 
    b.business_id,
    b.total,
    b.subtotal,
    b.total_tax,
    b.bill_number,
    b.issue_date,
    b.tax_lines
  INTO bill_record
  FROM bills b
  WHERE b.id = p_bill_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found: %', p_bill_id;
  END IF;

  business_id_val := bill_record.business_id;

  -- GUARD: Assert accounting period is open
  PERFORM assert_accounting_period_is_open(business_id_val, bill_record.issue_date);

  -- Parse tax_lines JSONB metadata
  tax_lines_jsonb := bill_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    -- Handle both formats: object with tax_lines key, or direct array
    IF jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'tax_lines' THEN
      tax_lines_jsonb := tax_lines_jsonb->'tax_lines';
    END IF;
    -- Validate it's an array and parse individual tax line items
    IF jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_jsonb)
      LOOP
        -- Defensive validation: ensure tax line has required fields
        IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
          parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- COA GUARD: Validate all account codes before journal inserts
  PERFORM assert_account_exists(business_id_val, '2000'); -- AP
  PERFORM assert_account_exists(business_id_val, '5200'); -- Expense
  
  -- Validate tax account codes from tax_lines
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  -- Get account IDs
  ap_account_id := get_account_by_code(business_id_val, '2000');
  expense_account_id := get_account_by_code(business_id_val, '5200'); -- Supplier Bills

  -- Build journal entry lines: start with base lines (Expense and AP)
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', expense_account_id,
      'debit', bill_record.subtotal,
      'description', 'Supplier expense'
    ),
    jsonb_build_object(
      'account_id', ap_account_id,
      'credit', bill_record.total,
      'description', 'Accounts payable'
    )
  );

  -- Add tax lines: iterate parsed_tax_lines and post each to its control account
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    tax_ledger_side := tax_line_item->>'ledger_side';

    -- Only post tax lines with ledger_account_code (skip absorbed taxes)
    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      
      -- Build tax journal line based on ledger_side
      IF tax_ledger_side = 'credit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'credit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax'
          )
        );
      ELSIF tax_ledger_side = 'debit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'debit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax'
          )
        );
      END IF;
    END IF;
  END LOOP;

  -- Post journal entry
  SELECT post_journal_entry(
    business_id_val,
    bill_record.issue_date,
    'Supplier Bill #' || bill_record.bill_number,
    'bill',
    p_bill_id,
    journal_lines
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Guard: post_expense_to_ledger
-- ============================================================================
CREATE OR REPLACE FUNCTION post_expense_to_ledger(p_expense_id UUID)
RETURNS UUID AS $$
DECLARE
  expense_record RECORD;
  business_id_val UUID;
  expense_account_id UUID;
  cash_account_id UUID;
  journal_id UUID;
  tax_lines_jsonb JSONB;
  tax_line_item JSONB;
  parsed_tax_lines JSONB[] := ARRAY[]::JSONB[];
  journal_lines JSONB;
  tax_account_id UUID;
  tax_code TEXT;
  tax_amount NUMERIC;
  tax_ledger_side TEXT;
  tax_ledger_account_code TEXT;
BEGIN
  -- Get expense details
  SELECT 
    e.business_id,
    e.total,
    e.subtotal,
    e.total_tax,
    e.date,
    e.description,
    e.tax_lines
  INTO expense_record
  FROM expenses e
  WHERE e.id = p_expense_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found: %', p_expense_id;
  END IF;

  business_id_val := expense_record.business_id;

  -- GUARD: Assert accounting period is open
  PERFORM assert_accounting_period_is_open(business_id_val, expense_record.date);

  -- Parse tax_lines JSONB metadata
  tax_lines_jsonb := expense_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    -- Handle both formats: object with tax_lines key, or direct array
    IF jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'tax_lines' THEN
      tax_lines_jsonb := tax_lines_jsonb->'tax_lines';
    END IF;
    -- Validate it's an array and parse individual tax line items
    IF jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_jsonb)
      LOOP
        -- Defensive validation: ensure tax line has required fields
        IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
          parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- COA GUARD: Validate all account codes before journal inserts
  PERFORM assert_account_exists(business_id_val, '5100'); -- Expense
  PERFORM assert_account_exists(business_id_val, '1000'); -- Cash
  
  -- Validate tax account codes from tax_lines
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  -- Get account IDs
  expense_account_id := get_account_by_code(business_id_val, '5100'); -- Operating Expenses
  cash_account_id := get_account_by_code(business_id_val, '1000'); -- Assume paid from cash

  -- Build journal entry lines: start with base lines (Expense and Cash)
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', expense_account_id,
      'debit', expense_record.subtotal,
      'description', 'Operating expense'
    ),
    jsonb_build_object(
      'account_id', cash_account_id,
      'credit', expense_record.total,
      'description', 'Cash payment'
    )
  );

  -- Add tax lines: iterate parsed_tax_lines and post each to its control account
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    tax_ledger_side := tax_line_item->>'ledger_side';

    -- Only post tax lines with ledger_account_code (skip absorbed taxes)
    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      
      -- Build tax journal line based on ledger_side
      IF tax_ledger_side = 'credit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'credit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax'
          )
        );
      ELSIF tax_ledger_side = 'debit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'debit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax'
          )
        );
      END IF;
    END IF;
  END LOOP;

  -- Post journal entry
  SELECT post_journal_entry(
    business_id_val,
    expense_record.date,
    'Expense: ' || COALESCE(expense_record.description, 'General expense'),
    'expense',
    p_expense_id,
    journal_lines
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Guard: post_sale_to_ledger (POS sale)
-- ============================================================================
CREATE OR REPLACE FUNCTION post_sale_to_ledger(p_sale_id UUID)
RETURNS UUID AS $$
DECLARE
  sale_record RECORD;
  business_id_val UUID;
  cash_account_id UUID;
  revenue_account_id UUID;
  journal_id UUID;
  subtotal NUMERIC;
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
BEGIN
  -- Get sale details
  SELECT 
    s.business_id,
    s.amount,
    s.created_at,
    s.description,
    s.tax_lines
  INTO sale_record
  FROM sales s
  WHERE s.id = p_sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found: %', p_sale_id;
  END IF;

  business_id_val := sale_record.business_id;

  -- GUARD: Assert accounting period is open
  PERFORM assert_accounting_period_is_open(business_id_val, sale_record.created_at::DATE);

  -- Parse tax_lines JSONB metadata
  tax_lines_jsonb := sale_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    -- Handle both formats: object with tax_lines key, or direct array
    IF jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'tax_lines' THEN
      tax_lines_jsonb := tax_lines_jsonb->'tax_lines';
    END IF;
    -- Validate it's an array and parse individual tax line items
    IF jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_jsonb)
      LOOP
        -- Defensive validation: ensure tax line has required fields
        IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
          parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
          -- Sum tax amounts to calculate subtotal
          total_tax_amount := total_tax_amount + COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Calculate subtotal: total - sum of all taxes
  subtotal := COALESCE(sale_record.amount, 0) - total_tax_amount;

  -- COA GUARD: Validate all account codes before journal inserts
  PERFORM assert_account_exists(business_id_val, '1000'); -- Cash
  PERFORM assert_account_exists(business_id_val, '4000'); -- Revenue
  
  -- Validate tax account codes from tax_lines
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  -- Get account IDs
  cash_account_id := get_account_by_code(business_id_val, '1000'); -- Cash
  revenue_account_id := get_account_by_code(business_id_val, '4000'); -- Service Revenue

  -- Build journal entry lines: start with base lines (Cash and Revenue)
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', cash_account_id,
      'debit', sale_record.amount,
      'description', 'Sale receipt'
    ),
    jsonb_build_object(
      'account_id', revenue_account_id,
      'credit', subtotal,
      'description', 'Sales revenue'
    )
  );

  -- Add tax lines: iterate parsed_tax_lines and post each to its control account
  -- Sales tax lines are always output taxes (credit side)
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    tax_ledger_side := tax_line_item->>'ledger_side';

    -- Only post tax lines with ledger_account_code (sales don't have absorbed taxes)
    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      
      -- Build tax journal line based on ledger_side (should be 'credit' for sales output taxes)
      IF tax_ledger_side = 'credit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'credit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax'
          )
        );
      ELSIF tax_ledger_side = 'debit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'debit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax'
          )
        );
      END IF;
    END IF;
  END LOOP;

  -- Post journal entry
  SELECT post_journal_entry(
    business_id_val,
    sale_record.created_at::DATE,
    'Sale' || COALESCE(': ' || sale_record.description, ''),
    'sale',
    p_sale_id,
    journal_lines
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Guard: post_credit_note_to_ledger
-- ============================================================================
CREATE OR REPLACE FUNCTION post_credit_note_to_ledger(p_credit_note_id UUID)
RETURNS UUID AS $$
DECLARE
  cn_record RECORD;
  invoice_record RECORD;
  business_id_val UUID;
  ar_account_id UUID;
  revenue_account_id UUID;
  journal_id UUID;
  subtotal NUMERIC;
  tax_lines_jsonb JSONB;
  tax_line_item JSONB;
  parsed_tax_lines JSONB[] := ARRAY[]::JSONB[];
  journal_lines JSONB;
  tax_account_id UUID;
  tax_code TEXT;
  tax_amount NUMERIC;
  tax_ledger_side TEXT;
  tax_ledger_account_code TEXT;
BEGIN
  -- Get credit note details
  SELECT 
    cn.business_id,
    cn.invoice_id,
    cn.total,
    cn.subtotal,
    cn.total_tax,
    cn.credit_number,
    cn.date,
    cn.tax_lines
  INTO cn_record
  FROM credit_notes cn
  WHERE cn.id = p_credit_note_id
    AND cn.status = 'applied';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Applied credit note not found: %', p_credit_note_id;
  END IF;

  -- Get invoice details (for invoice_number only)
  SELECT invoice_number INTO invoice_record
  FROM invoices
  WHERE id = cn_record.invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found for credit note: %. Invoice ID: %', p_credit_note_id, cn_record.invoice_id;
  END IF;

  business_id_val := cn_record.business_id;

  -- GUARD: Assert accounting period is open
  PERFORM assert_accounting_period_is_open(business_id_val, cn_record.date);

  subtotal := COALESCE(cn_record.subtotal, 0);

  -- Parse tax_lines JSONB metadata
  tax_lines_jsonb := cn_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    -- Handle both formats: object with tax_lines key, or direct array
    IF jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'tax_lines' THEN
      tax_lines_jsonb := tax_lines_jsonb->'tax_lines';
    END IF;
    -- Validate it's an array and parse individual tax line items
    IF jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_jsonb)
      LOOP
        -- Defensive validation: ensure tax line has required fields
        IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
          parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- COA GUARD: Validate all account codes before journal inserts
  PERFORM assert_account_exists(business_id_val, '1100'); -- AR
  PERFORM assert_account_exists(business_id_val, '4000'); -- Revenue
  
  -- Validate tax account codes from tax_lines
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  -- Get account IDs
  ar_account_id := get_account_by_code(business_id_val, '1100');
  revenue_account_id := get_account_by_code(business_id_val, '4000');

  -- Validate accounts exist
  IF ar_account_id IS NULL THEN
    RAISE EXCEPTION 'AR account (1100) not found for business: %. Credit Note ID: %', business_id_val, p_credit_note_id;
  END IF;
  IF revenue_account_id IS NULL THEN
    RAISE EXCEPTION 'Revenue account (4000) not found for business: %. Credit Note ID: %', business_id_val, p_credit_note_id;
  END IF;

  -- Build journal entry lines: start with base lines (reverse recognition)
  -- Sales credit note: Debit Revenue (reverse), Credit AR (reduce receivable)
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', revenue_account_id,
      'debit', subtotal,
      'description', 'Reverse revenue'
    ),
    jsonb_build_object(
      'account_id', ar_account_id,
      'credit', cn_record.total,
      'description', 'Reduce receivable'
    )
  );

  -- Add tax reversal lines: iterate parsed_tax_lines and reverse each tax control account
  -- STEP 6 RULE: Reverse the original side (credit → debit, debit → credit)
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    tax_ledger_side := tax_line_item->>'ledger_side';

    -- Only post tax lines with ledger_account_code (skip absorbed taxes)
    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      
      IF tax_account_id IS NULL THEN
        RAISE EXCEPTION 'Tax account (%) not found for business: %. Credit Note ID: %', 
          tax_ledger_account_code, business_id_val, p_credit_note_id;
      END IF;
      
      -- STEP 6 RULE: Reverse the original side
      -- Original 'credit' → post 'debit' (reverse credit)
      -- Original 'debit'  → post 'credit' (reverse debit)
      IF tax_ledger_side = 'credit' THEN
        -- Original was credit, reverse with debit
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'debit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax reversal'
          )
        );
      ELSIF tax_ledger_side = 'debit' THEN
        -- Original was debit, reverse with credit
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'credit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax reversal'
          )
        );
      END IF;
    END IF;
  END LOOP;

  -- Post journal entry
  -- STEP 6 RULE: NO cash/bank movements (settlement handled separately)
  SELECT post_journal_entry(
    business_id_val,
    cn_record.date,
    'Credit Note #' || cn_record.credit_number || ' for Invoice #' || invoice_record.invoice_number,
    'credit_note',
    p_credit_note_id,
    journal_lines
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Guard: post_adjustment_to_ledger
-- ============================================================================
CREATE OR REPLACE FUNCTION post_adjustment_to_ledger(
  p_business_id UUID,
  p_adjustment_date DATE,
  p_lines JSONB,
  p_reason TEXT,
  p_reference_journal_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  journal_id UUID;
  adjustment_id UUID;
  line JSONB;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  account_id UUID;
  account_code TEXT;
  period_start_date DATE;
BEGIN
  -- Validate reason is not empty
  IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
    RAISE EXCEPTION 'Adjustment reason is mandatory and cannot be empty';
  END IF;

  -- Validate period using assert_accounting_period_is_open
  -- Adjustments CANNOT be posted into locked periods
  PERFORM assert_accounting_period_is_open(p_business_id, p_adjustment_date);

  -- Resolve period_start from adjustment_date
  period_start_date := DATE_TRUNC('month', p_adjustment_date)::DATE;

  -- COA GUARD: Validate all account codes from p_lines before journal inserts
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    account_code := line->>'account_code';
    IF account_code IS NULL THEN
      RAISE EXCEPTION 'Account code is required for each adjustment line';
    END IF;
    PERFORM assert_account_exists(p_business_id, account_code);
  END LOOP;

  -- Validate that adjustments MUST balance (total debit = total credit)
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    total_debit := total_debit + COALESCE((line->>'debit_amount')::NUMERIC, 0);
    total_credit := total_credit + COALESCE((line->>'credit_amount')::NUMERIC, 0);
  END LOOP;

  IF ABS(total_debit - total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Adjustment journal entry must balance. Debit: %, Credit: %', total_debit, total_credit;
  END IF;

  -- Create journal entry with reference_type = 'adjustment'
  INSERT INTO journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    created_by
  )
  VALUES (
    p_business_id,
    p_adjustment_date,
    'Adjustment: ' || p_reason,
    'adjustment',
    NULL, -- reference_id is NULL for adjustments (metadata stored in accounting_adjustments)
    auth.uid() -- Use current user from auth context
  )
  RETURNING id INTO journal_id;

  -- Create journal entry lines
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    account_code := line->>'account_code';
    
    IF account_code IS NULL THEN
      RAISE EXCEPTION 'Account code is required for each adjustment line';
    END IF;

    -- Get account ID by code
    account_id := get_account_by_code(p_business_id, account_code);

    IF account_id IS NULL THEN
      RAISE EXCEPTION 'Account with code % not found for business: %', account_code, p_business_id;
    END IF;

    INSERT INTO journal_entry_lines (
      journal_entry_id,
      account_id,
      debit,
      credit,
      description
    )
    VALUES (
      journal_id,
      account_id,
      COALESCE((line->>'debit_amount')::NUMERIC, 0),
      COALESCE((line->>'credit_amount')::NUMERIC, 0),
      line->>'description'
    );
  END LOOP;

  -- Store metadata row in accounting_adjustments
  INSERT INTO accounting_adjustments (
    business_id,
    adjustment_date,
    period_start,
    reason,
    reference_journal_id,
    created_by
  )
  VALUES (
    p_business_id,
    p_adjustment_date,
    period_start_date,
    p_reason,
    p_reference_journal_id,
    auth.uid()
  )
  RETURNING id INTO adjustment_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Guard: post_opening_balance_to_ledger
-- ============================================================================
CREATE OR REPLACE FUNCTION post_opening_balance_to_ledger(
  p_business_id UUID,
  p_as_of_date DATE,
  p_lines JSONB,
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  journal_id UUID;
  opening_balance_id UUID;
  line JSONB;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  account_id UUID;
  account_code TEXT;
  period_start_date DATE;
  period_end_date DATE;
  period_record accounting_periods;
  existing_opening_balance UUID;
BEGIN
  -- Rule 1: Enforce period policy
  -- Must pass assert_accounting_period_is_open - NOT allowed in locked period
  PERFORM assert_accounting_period_is_open(p_business_id, p_as_of_date);

  -- Resolve period_start from p_as_of_date
  period_start_date := DATE_TRUNC('month', p_as_of_date)::DATE;
  period_end_date := (DATE_TRUNC('month', p_as_of_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  -- Validate as_of_date <= period_end
  IF p_as_of_date > period_end_date THEN
    RAISE EXCEPTION 'as_of_date (%) must be <= period_end (%)', p_as_of_date, period_end_date;
  END IF;

  -- Rule 2: One-time rule
  -- If accounting_opening_balances already exists for business → RAISE EXCEPTION
  SELECT id INTO existing_opening_balance
  FROM accounting_opening_balances
  WHERE business_id = p_business_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Opening balance already exists for this business.';
  END IF;

  -- COA GUARD: Validate all account codes from p_lines before journal inserts
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    account_code := line->>'account_code';
    IF account_code IS NULL THEN
      RAISE EXCEPTION 'Account code is required for each opening balance line';
    END IF;
    PERFORM assert_account_exists(p_business_id, account_code);
  END LOOP;

  -- Rule 3: Balancing rule
  -- Sum(debits) must equal Sum(credits)
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    total_debit := total_debit + COALESCE((line->>'debit_amount')::NUMERIC, 0);
    total_credit := total_credit + COALESCE((line->>'credit_amount')::NUMERIC, 0);
  END LOOP;

  IF ABS(total_debit - total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Opening balance journal must balance.';
  END IF;

  -- Rule 4: Journal creation
  -- Insert a NEW journal entry with reference_type = 'opening_balance'
  INSERT INTO journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    created_by
  )
  VALUES (
    p_business_id,
    p_as_of_date,
    'Opening Balance (as of ' || TO_CHAR(p_as_of_date, 'YYYY-MM-DD') || ')',
    'opening_balance',
    NULL,
    p_created_by
  )
  RETURNING id INTO journal_id;

  -- Insert journal lines per p_lines
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    account_code := line->>'account_code';
    
    IF account_code IS NULL THEN
      RAISE EXCEPTION 'Account code is required for each opening balance line';
    END IF;

    -- Get account ID by code
    account_id := get_account_by_code(p_business_id, account_code);

    IF account_id IS NULL THEN
      RAISE EXCEPTION 'Account with code % not found for business: %', account_code, p_business_id;
    END IF;

    INSERT INTO journal_entry_lines (
      journal_entry_id,
      account_id,
      debit,
      credit,
      description
    )
    VALUES (
      journal_id,
      account_id,
      COALESCE((line->>'debit_amount')::NUMERIC, 0),
      COALESCE((line->>'credit_amount')::NUMERIC, 0),
      COALESCE(line->>'description', 'Opening balance')
    );
  END LOOP;

  -- Rule 5: Metadata row
  -- Insert into accounting_opening_balances
  INSERT INTO accounting_opening_balances (
    business_id,
    as_of_date,
    period_start,
    source,
    notes,
    created_by
  )
  VALUES (
    p_business_id,
    p_as_of_date,
    period_start_date,
    'manual',
    p_notes,
    p_created_by
  )
  RETURNING id INTO opening_balance_id;

  -- STEP 3: Optional immediate soft-close
  -- After posting opening balance, immediately soft-close the period
  -- Get the period record
  SELECT * INTO period_record
  FROM accounting_periods
  WHERE business_id = p_business_id
    AND period_start = period_start_date
  LIMIT 1;

  -- If period exists and is open, soft-close it
  IF FOUND AND period_record.status = 'open' THEN
    UPDATE accounting_periods
    SET 
      status = 'soft_closed',
      closed_at = NOW(),
      closed_by = p_created_by
    WHERE id = period_record.id;
  END IF;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- VERIFICATION: Guards applied successfully
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Accounting Mode A4.3: COA validation guards applied';
  RAISE NOTICE '  - post_invoice_to_ledger: Validates AR, Revenue, and tax accounts';
  RAISE NOTICE '  - post_bill_to_ledger: Validates AP, Expense, and tax accounts';
  RAISE NOTICE '  - post_expense_to_ledger: Validates Expense, Cash, and tax accounts';
  RAISE NOTICE '  - post_sale_to_ledger: Validates Cash, Revenue, and tax accounts';
  RAISE NOTICE '  - post_credit_note_to_ledger: Validates AR, Revenue, and tax accounts';
  RAISE NOTICE '  - post_adjustment_to_ledger: Validates all account codes from p_lines';
  RAISE NOTICE '  - post_opening_balance_to_ledger: Validates all account codes from p_lines';
  RAISE NOTICE '  - NO posting logic changes';
  RAISE NOTICE '  - NO debit/credit behavior changes';
  RAISE NOTICE '  - NO tax logic changes';
END;
$$;

