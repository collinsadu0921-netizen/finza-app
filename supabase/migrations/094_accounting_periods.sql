-- ============================================================================
-- MIGRATION: Accounting Mode - Period Control v1
-- ============================================================================
-- This migration adds accounting period control for Accounting Mode.
-- Periods can be open / soft_closed / locked.
-- Ledger posting is BLOCKED into locked periods.
--
-- Scope: Accounting Mode ONLY
-- No UI changes, no report changes, no tax changes, no settlement changes
-- ============================================================================

-- ============================================================================
-- STEP 1: CREATE TABLE
-- ============================================================================
-- Handle existing table from migration 084 (which uses start_date/end_date)
-- Drop dependent tables first (from migrations 086, 087, 088), then drop the main table
-- Note: This migration replaces the old accounting_periods system
DROP TABLE IF EXISTS period_summary CASCADE;
DROP TABLE IF EXISTS period_opening_balances CASCADE;
DROP TABLE IF EXISTS period_closing_balances CASCADE;
DROP TABLE IF EXISTS period_account_snapshot CASCADE;
DROP TABLE IF EXISTS adjustment_journals CASCADE; -- From migration 087
DROP TABLE IF EXISTS accounting_periods CASCADE;

CREATE TABLE accounting_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','soft_closed','locked')),
  closed_at TIMESTAMP WITH TIME ZONE,
  closed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (business_id, period_start)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_accounting_periods_business_id ON accounting_periods(business_id);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_period_start ON accounting_periods(period_start);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_status ON accounting_periods(status);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_business_period ON accounting_periods(business_id, period_start);

-- Constraints: period_start must be first day of month, period_end must be last day of same month
ALTER TABLE accounting_periods
  ADD CONSTRAINT check_period_start_first_day 
  CHECK (period_start = DATE_TRUNC('month', period_start)::DATE);

ALTER TABLE accounting_periods
  ADD CONSTRAINT check_period_end_last_day 
  CHECK (period_end = (DATE_TRUNC('month', period_end) + INTERVAL '1 month' - INTERVAL '1 day')::DATE);

ALTER TABLE accounting_periods
  ADD CONSTRAINT check_period_same_month 
  CHECK (DATE_TRUNC('month', period_start) = DATE_TRUNC('month', period_end));

-- ============================================================================
-- STEP 2: PERIOD RESOLUTION
-- ============================================================================
CREATE OR REPLACE FUNCTION ensure_accounting_period(
  p_business_id UUID,
  p_date DATE
)
RETURNS accounting_periods AS $$
DECLARE
  period_start_date DATE;
  period_end_date DATE;
  period_record accounting_periods;
BEGIN
  -- Resolve month from p_date
  period_start_date := DATE_TRUNC('month', p_date)::DATE;
  period_end_date := (DATE_TRUNC('month', p_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  -- Check if period exists
  SELECT * INTO period_record
  FROM accounting_periods
  WHERE business_id = p_business_id
    AND period_start = period_start_date
  LIMIT 1;

  -- If period exists, return it
  IF FOUND THEN
    RETURN period_record;
  END IF;

  -- Else, create new period with status = 'open'
  INSERT INTO accounting_periods (business_id, period_start, period_end, status)
  VALUES (p_business_id, period_start_date, period_end_date, 'open')
  RETURNING * INTO period_record;

  RETURN period_record;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 3: LOCK ENFORCEMENT
-- ============================================================================
CREATE OR REPLACE FUNCTION assert_accounting_period_is_open(
  p_business_id UUID,
  p_date DATE
)
RETURNS VOID AS $$
DECLARE
  period_record accounting_periods;
BEGIN
  -- Resolve accounting period using ensure_accounting_period
  SELECT * INTO period_record
  FROM ensure_accounting_period(p_business_id, p_date);

  -- If status = 'locked' → RAISE EXCEPTION
  IF period_record.status = 'locked' THEN
    RAISE EXCEPTION 'Accounting period is locked. Post an adjustment in a later open period.';
  END IF;

  -- If status = 'soft_closed' → ALLOW
  -- If status = 'open' → ALLOW
  -- (No action needed, function just returns)
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 4: APPLY GUARD TO POSTING FUNCTIONS
-- ============================================================================

-- Guard: post_invoice_to_ledger
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

-- Guard: post_bill_to_ledger
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

-- Guard: post_expense_to_ledger
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

-- Guard: post_sale_to_ledger
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

-- Guard: post_credit_note_to_ledger
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

