-- ============================================================================
-- MIGRATION: Accounting Mode A4.4 - Control Account Resolution
-- ============================================================================
-- This migration replaces hardcoded control account codes with business mappings.
-- Uses get_control_account_code to resolve control keys to account codes.
--
-- Scope: Accounting Mode ONLY
-- Minimal replacement: Only replaces hardcoded control accounts
-- ============================================================================

-- ============================================================================
-- Helper: Get account ID by control key
-- ============================================================================
-- This helper function resolves control key to account code, then to account ID
CREATE OR REPLACE FUNCTION get_account_by_control_key(
  p_business_id UUID,
  p_control_key TEXT
)
RETURNS UUID AS $$
DECLARE
  account_code TEXT;
  account_id UUID;
BEGIN
  -- Resolve control key to account code
  account_code := get_control_account_code(p_business_id, p_control_key);
  
  -- Get account ID by code
  account_id := get_account_by_code(p_business_id, account_code);
  
  RETURN account_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Update: post_invoice_to_ledger
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
  ar_account_code TEXT;
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

  -- COA GUARD: Validate control accounts using control keys
  ar_account_code := get_control_account_code(business_id_val, 'AR');
  PERFORM assert_account_exists(business_id_val, ar_account_code);
  PERFORM assert_account_exists(business_id_val, '4000'); -- Revenue (not a control key)
  
  -- Validate tax account codes from tax_lines
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  -- Get account IDs using control keys
  ar_account_id := get_account_by_control_key(business_id_val, 'AR');
  revenue_account_id := get_account_by_code(business_id_val, '4000'); -- Revenue (not a control key)

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
-- Update: post_bill_to_ledger
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
  ap_account_code TEXT;
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

  -- COA GUARD: Validate control accounts using control keys
  ap_account_code := get_control_account_code(business_id_val, 'AP');
  PERFORM assert_account_exists(business_id_val, ap_account_code);
  PERFORM assert_account_exists(business_id_val, '5200'); -- Expense (not a control key)
  
  -- Validate tax account codes from tax_lines
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  -- Get account IDs using control keys
  ap_account_id := get_account_by_control_key(business_id_val, 'AP');
  expense_account_id := get_account_by_code(business_id_val, '5200'); -- Supplier Bills (not a control key)

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
-- Update: post_expense_to_ledger
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
  cash_account_code TEXT;
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

  -- COA GUARD: Validate control accounts using control keys
  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, '5100'); -- Expense (not a control key)
  
  -- Validate tax account codes from tax_lines
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  -- Get account IDs using control keys
  cash_account_id := get_account_by_control_key(business_id_val, 'CASH');
  expense_account_id := get_account_by_code(business_id_val, '5100'); -- Operating Expenses (not a control key)

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
-- Update: post_sale_to_ledger (POS sale)
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
  cash_account_code TEXT;
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

  -- COA GUARD: Validate control accounts using control keys
  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, '4000'); -- Revenue (not a control key)
  
  -- Validate tax account codes from tax_lines
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  -- Get account IDs using control keys
  cash_account_id := get_account_by_control_key(business_id_val, 'CASH');
  revenue_account_id := get_account_by_code(business_id_val, '4000'); -- Service Revenue (not a control key)

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
-- Update: post_credit_note_to_ledger
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
  ar_account_code TEXT;
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

  -- COA GUARD: Validate control accounts using control keys
  ar_account_code := get_control_account_code(business_id_val, 'AR');
  PERFORM assert_account_exists(business_id_val, ar_account_code);
  PERFORM assert_account_exists(business_id_val, '4000'); -- Revenue (not a control key)
  
  -- Validate tax account codes from tax_lines
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  -- Get account IDs using control keys
  ar_account_id := get_account_by_control_key(business_id_val, 'AR');
  revenue_account_id := get_account_by_code(business_id_val, '4000');

  -- Validate accounts exist
  IF ar_account_id IS NULL THEN
    RAISE EXCEPTION 'AR account not found for business: %. Credit Note ID: %', business_id_val, p_credit_note_id;
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
-- Update: post_invoice_payment_to_ledger (Payment settlement)
-- ============================================================================
CREATE OR REPLACE FUNCTION post_invoice_payment_to_ledger(p_payment_id UUID)
RETURNS UUID AS $$
DECLARE
  payment_record RECORD;
  invoice_record RECORD;
  business_id_val UUID;
  ar_account_id UUID;
  cash_account_id UUID;
  bank_account_id UUID;
  momo_account_id UUID;
  journal_id UUID;
  asset_account_id UUID;
  payment_amount NUMERIC;
  cash_account_code TEXT;
  bank_account_code TEXT;
BEGIN
  -- Get payment details
  SELECT 
    p.business_id,
    p.invoice_id,
    p.amount,
    p.method,
    p.date
  INTO payment_record
  FROM payments p
  WHERE p.id = p_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found: %', p_payment_id;
  END IF;

  -- Validate and use payment amount (NOT invoice total!)
  payment_amount := COALESCE(payment_record.amount, 0);
  IF payment_amount <= 0 OR payment_amount IS NULL THEN
    RAISE EXCEPTION 'Invalid payment amount: %. Payment ID: %', payment_amount, p_payment_id;
  END IF;

  -- Get invoice details (only for invoice_number, NOT for amount)
  SELECT invoice_number INTO invoice_record
  FROM invoices
  WHERE id = payment_record.invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found for payment: %. Invoice ID: %', p_payment_id, payment_record.invoice_id;
  END IF;

  business_id_val := payment_record.business_id;

  -- Validate business_id
  IF business_id_val IS NULL THEN
    RAISE EXCEPTION 'Business ID is NULL for payment: %', p_payment_id;
  END IF;

  -- Get account IDs using control keys
  ar_account_id := get_account_by_control_key(business_id_val, 'AR');
  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  bank_account_code := get_control_account_code(business_id_val, 'BANK');
  cash_account_id := get_account_by_code(business_id_val, cash_account_code);
  bank_account_id := get_account_by_code(business_id_val, bank_account_code);
  momo_account_id := get_account_by_code(business_id_val, '1020'); -- MoMo not a control key

  -- Validate AR account exists
  IF ar_account_id IS NULL THEN
    RAISE EXCEPTION 'AR account not found for business: %. Payment ID: %', business_id_val, p_payment_id;
  END IF;

  -- Determine asset account based on payment method
  -- Card and cheque payments use bank account (clearing)
  CASE payment_record.method
    WHEN 'cash' THEN asset_account_id := cash_account_id;
    WHEN 'bank' THEN asset_account_id := bank_account_id;
    WHEN 'momo' THEN asset_account_id := momo_account_id;
    WHEN 'card' THEN asset_account_id := bank_account_id; -- Card payments clear through bank
    WHEN 'cheque' THEN asset_account_id := bank_account_id; -- Cheque payments clear through bank
    ELSE asset_account_id := cash_account_id; -- Default to cash for 'other'
  END CASE;

  -- Validate asset account exists
  IF asset_account_id IS NULL THEN
    RAISE EXCEPTION 'Asset account for method "%" not found for business: %. Payment ID: %. Cash: %, Bank: %, MoMo: %', 
      payment_record.method, business_id_val, p_payment_id, cash_account_id, bank_account_id, momo_account_id;
  END IF;

  -- Post journal entry: Debit Cash/Bank/Clearing, Credit AR
  -- STEP 5 RULE: NO revenue lines, NO tax lines
  SELECT post_journal_entry(
    business_id_val,
    payment_record.date,
    'Payment for Invoice #' || invoice_record.invoice_number,
    'payment',
    p_payment_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', asset_account_id,
        'debit', payment_amount,
        'description', 'Payment received'
      ),
      jsonb_build_object(
        'account_id', ar_account_id,
        'credit', payment_amount,
        'description', 'Reduce receivable'
      )
    )
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Update: post_bill_payment_to_ledger (Bill payment settlement)
-- ============================================================================
CREATE OR REPLACE FUNCTION post_bill_payment_to_ledger(p_bill_payment_id UUID)
RETURNS UUID AS $$
DECLARE
  payment_record RECORD;
  bill_record RECORD;
  business_id_val UUID;
  ap_account_id UUID;
  cash_account_id UUID;
  bank_account_id UUID;
  momo_account_id UUID;
  journal_id UUID;
  asset_account_id UUID;
  payment_amount NUMERIC;
  cash_account_code TEXT;
  bank_account_code TEXT;
BEGIN
  -- Get payment details
  SELECT 
    bp.business_id,
    bp.bill_id,
    bp.amount,
    bp.method,
    bp.date
  INTO payment_record
  FROM bill_payments bp
  WHERE bp.id = p_bill_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill payment not found: %', p_bill_payment_id;
  END IF;

  -- Validate and use payment amount
  payment_amount := COALESCE(payment_record.amount, 0);
  IF payment_amount <= 0 OR payment_amount IS NULL THEN
    RAISE EXCEPTION 'Invalid payment amount: %. Bill Payment ID: %', payment_amount, p_bill_payment_id;
  END IF;

  -- Get bill details (only for bill_number, NOT for amount)
  SELECT bill_number INTO bill_record
  FROM bills
  WHERE id = payment_record.bill_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found for payment: %. Bill ID: %', p_bill_payment_id, payment_record.bill_id;
  END IF;

  business_id_val := payment_record.business_id;

  -- Validate business_id
  IF business_id_val IS NULL THEN
    RAISE EXCEPTION 'Business ID is NULL for bill payment: %', p_bill_payment_id;
  END IF;

  -- Get account IDs using control keys
  ap_account_id := get_account_by_control_key(business_id_val, 'AP');
  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  bank_account_code := get_control_account_code(business_id_val, 'BANK');
  cash_account_id := get_account_by_code(business_id_val, cash_account_code);
  bank_account_id := get_account_by_code(business_id_val, bank_account_code);
  momo_account_id := get_account_by_code(business_id_val, '1020'); -- MoMo not a control key

  -- Validate AP account exists
  IF ap_account_id IS NULL THEN
    RAISE EXCEPTION 'AP account not found for business: %. Bill Payment ID: %', business_id_val, p_bill_payment_id;
  END IF;

  -- Determine asset account based on payment method
  -- Card and cheque payments use bank account (clearing)
  CASE payment_record.method
    WHEN 'cash' THEN asset_account_id := cash_account_id;
    WHEN 'bank' THEN asset_account_id := bank_account_id;
    WHEN 'momo' THEN asset_account_id := momo_account_id;
    WHEN 'card' THEN asset_account_id := bank_account_id; -- Card payments clear through bank
    WHEN 'cheque' THEN asset_account_id := bank_account_id; -- Cheque payments clear through bank
    ELSE asset_account_id := cash_account_id; -- Default to cash for 'other'
  END CASE;

  -- Validate asset account exists
  IF asset_account_id IS NULL THEN
    RAISE EXCEPTION 'Asset account for method "%" not found for business: %. Bill Payment ID: %. Cash: %, Bank: %, MoMo: %', 
      payment_record.method, business_id_val, p_bill_payment_id, cash_account_id, bank_account_id, momo_account_id;
  END IF;

  -- Post journal entry: Debit AP, Credit Cash/Bank/Clearing
  -- STEP 5 RULE: NO expense lines, NO tax lines
  SELECT post_journal_entry(
    business_id_val,
    payment_record.date,
    'Payment for Bill #' || bill_record.bill_number,
    'bill_payment',
    p_bill_payment_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', ap_account_id,
        'debit', payment_amount,
        'description', 'Reduce payable'
      ),
      jsonb_build_object(
        'account_id', asset_account_id,
        'credit', payment_amount,
        'description', 'Payment made'
      )
    )
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VERIFICATION: Control account resolution applied
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Accounting Mode A4.4: Control account resolution applied';
  RAISE NOTICE '  - AR: Uses get_control_account_code(business_id, ''AR'')';
  RAISE NOTICE '  - AP: Uses get_control_account_code(business_id, ''AP'')';
  RAISE NOTICE '  - CASH: Uses get_control_account_code(business_id, ''CASH'')';
  RAISE NOTICE '  - BANK: Uses get_control_account_code(business_id, ''BANK'')';
  RAISE NOTICE '  - Revenue/Expense: Still hardcoded (not control keys)';
  RAISE NOTICE '  - MoMo: Still hardcoded (not a control key)';
  RAISE NOTICE '  - Helper function: get_account_by_control_key() created';
END;
$$;





