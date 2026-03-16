-- Migration: Accounting Core for Ghana Service Businesses
-- Creates Chart of Accounts, General Ledger, and automatic journal posting

-- ============================================================================
-- ACCOUNTS TABLE (Chart of Accounts)
-- ============================================================================
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  description TEXT,
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(business_id, code)
);

-- Indexes for accounts
CREATE INDEX IF NOT EXISTS idx_accounts_business_id ON accounts(business_id);
CREATE INDEX IF NOT EXISTS idx_accounts_code ON accounts(code);
CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(type);
CREATE INDEX IF NOT EXISTS idx_accounts_deleted_at ON accounts(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- JOURNAL ENTRIES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT NOT NULL,
  reference_type TEXT, -- 'invoice', 'payment', 'credit_note', 'bill', 'bill_payment', 'expense', 'manual'
  reference_id UUID, -- ID of the related record
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Indexes for journal_entries
CREATE INDEX IF NOT EXISTS idx_journal_entries_business_id ON journal_entries(business_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_reference ON journal_entries(reference_type, reference_id);

-- ============================================================================
-- JOURNAL ENTRY LINES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  debit NUMERIC DEFAULT 0,
  credit NUMERIC DEFAULT 0,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for journal_entry_lines
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_journal_entry_id ON journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account_id ON journal_entry_lines(account_id);

-- ============================================================================
-- FUNCTION: Create system accounts for a business
-- ============================================================================
CREATE OR REPLACE FUNCTION create_system_accounts(p_business_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Assets
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Cash', '1000', 'asset', 'Cash on hand', TRUE),
    (p_business_id, 'Bank', '1010', 'asset', 'Bank account', TRUE),
    (p_business_id, 'Mobile Money', '1020', 'asset', 'Mobile money accounts', TRUE),
    (p_business_id, 'Accounts Receivable', '1100', 'asset', 'Amounts owed by customers', TRUE),
    (p_business_id, 'Fixed Assets', '1600', 'asset', 'Fixed assets including equipment, vehicles, and property', TRUE),
    (p_business_id, 'Accumulated Depreciation', '1650', 'asset', 'Accumulated depreciation on fixed assets', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Liabilities
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Accounts Payable', '2000', 'liability', 'Amounts owed to suppliers', TRUE),
    (p_business_id, 'VAT Payable', '2100', 'liability', 'VAT output tax minus input tax', TRUE),
    (p_business_id, 'NHIL Payable', '2110', 'liability', 'NHIL output tax minus input tax', TRUE),
    (p_business_id, 'GETFund Payable', '2120', 'liability', 'GETFund output tax minus input tax', TRUE),
    (p_business_id, 'COVID Levy Payable', '2130', 'liability', 'COVID-19 Health Recovery Levy output tax minus input tax', TRUE),
    (p_business_id, 'Other Tax Liabilities', '2200', 'liability', 'Other tax obligations', TRUE),
    (p_business_id, 'PAYE Liability', '2210', 'liability', 'PAYE tax payable to GRA', TRUE),
    (p_business_id, 'SSNIT Employee Contribution Payable', '2220', 'liability', 'SSNIT employee contributions payable', TRUE),
    (p_business_id, 'SSNIT Employer Contribution Payable', '2230', 'liability', 'SSNIT employer contributions payable', TRUE),
    (p_business_id, 'Net Salaries Payable', '2240', 'liability', 'Net salaries payable to employees', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Equity
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Owner''s Equity', '3000', 'equity', 'Owner investment', TRUE),
    (p_business_id, 'Retained Earnings', '3100', 'equity', 'Accumulated profits', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Income
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Service Revenue', '4000', 'income', 'Revenue from services', TRUE),
    (p_business_id, 'Gain on Asset Disposal', '4200', 'income', 'Gains from disposal of fixed assets', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Expenses
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Cost of Sales', '5000', 'expense', 'Direct costs', TRUE),
    (p_business_id, 'Operating Expenses', '5100', 'expense', 'General operating expenses', TRUE),
    (p_business_id, 'Supplier Bills', '5200', 'expense', 'Supplier invoices', TRUE),
    (p_business_id, 'Administrative Expenses', '5300', 'expense', 'Admin and overhead', TRUE),
    (p_business_id, 'Depreciation Expense', '5700', 'expense', 'Depreciation expense for fixed assets', TRUE),
    (p_business_id, 'Loss on Asset Disposal', '5800', 'expense', 'Losses from disposal of fixed assets', TRUE),
    (p_business_id, 'Payroll Expense', '6000', 'expense', 'Employee salaries and wages', TRUE),
    (p_business_id, 'Employer SSNIT Contribution', '6010', 'expense', 'Employer SSNIT contributions', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Get or create account by code
-- ============================================================================
CREATE OR REPLACE FUNCTION get_account_by_code(p_business_id UUID, p_code TEXT)
RETURNS UUID AS $$
DECLARE
  account_id UUID;
BEGIN
  SELECT id INTO account_id
  FROM accounts
  WHERE business_id = p_business_id
    AND code = p_code
    AND deleted_at IS NULL
  LIMIT 1;

  RETURN account_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Post journal entry (with validation)
-- ============================================================================
CREATE OR REPLACE FUNCTION post_journal_entry(
  p_business_id UUID,
  p_date DATE,
  p_description TEXT,
  p_reference_type TEXT,
  p_reference_id UUID,
  p_lines JSONB
)
RETURNS UUID AS $$
DECLARE
  journal_id UUID;
  line JSONB;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  account_id UUID;
BEGIN
  -- Validate that debits equal credits
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    total_debit := total_debit + COALESCE((line->>'debit')::NUMERIC, 0);
    total_credit := total_credit + COALESCE((line->>'credit')::NUMERIC, 0);
  END LOOP;

  IF ABS(total_debit - total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry must balance. Debit: %, Credit: %', total_debit, total_credit;
  END IF;

  -- Create journal entry
  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id)
  VALUES (p_business_id, p_date, p_description, p_reference_type, p_reference_id)
  RETURNING id INTO journal_id;

  -- Create journal entry lines
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    account_id := (line->>'account_id')::UUID;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (
      journal_id,
      account_id,
      COALESCE((line->>'debit')::NUMERIC, 0),
      COALESCE((line->>'credit')::NUMERIC, 0),
      line->>'description'
    );
  END LOOP;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Post invoice to ledger
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

-- ============================================================================
-- FUNCTION: Post payment to ledger
-- ============================================================================
CREATE OR REPLACE FUNCTION post_payment_to_ledger(p_payment_id UUID)
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

  -- Get invoice details
  SELECT invoice_number INTO invoice_record
  FROM invoices
  WHERE id = payment_record.invoice_id;

  business_id_val := payment_record.business_id;

  -- Get account IDs
  ar_account_id := get_account_by_code(business_id_val, '1100');
  cash_account_id := get_account_by_code(business_id_val, '1000');
  bank_account_id := get_account_by_code(business_id_val, '1010');
  momo_account_id := get_account_by_code(business_id_val, '1020');

  -- Determine asset account based on payment method
  CASE payment_record.method
    WHEN 'cash' THEN asset_account_id := cash_account_id;
    WHEN 'bank' THEN asset_account_id := bank_account_id;
    WHEN 'momo' THEN asset_account_id := momo_account_id;
    ELSE asset_account_id := cash_account_id; -- Default to cash
  END CASE;

  -- Post journal entry
  SELECT post_journal_entry(
    business_id_val,
    payment_record.date,
    'Payment for Invoice #' || invoice_record.invoice_number,
    'payment',
    p_payment_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', asset_account_id,
        'debit', payment_record.amount,
        'description', 'Payment received'
      ),
      jsonb_build_object(
        'account_id', ar_account_id,
        'credit', payment_record.amount,
        'description', 'Reduce receivable'
      )
    )
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Post credit note to ledger
-- ============================================================================
CREATE OR REPLACE FUNCTION post_credit_note_to_ledger(p_credit_note_id UUID)
RETURNS UUID AS $$
DECLARE
  cn_record RECORD;
  invoice_record RECORD;
  business_id_val UUID;
  ar_account_id UUID;
  revenue_account_id UUID;
  vat_account_id UUID;
  journal_id UUID;
BEGIN
  -- Get credit note details
  SELECT 
    cn.business_id,
    cn.invoice_id,
    cn.total,
    cn.subtotal,
    cn.total_tax,
    cn.credit_number,
    cn.date
  INTO cn_record
  FROM credit_notes cn
  WHERE cn.id = p_credit_note_id
    AND cn.status = 'applied';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Applied credit note not found: %', p_credit_note_id;
  END IF;

  -- Get invoice details
  SELECT invoice_number INTO invoice_record
  FROM invoices
  WHERE id = cn_record.invoice_id;

  business_id_val := cn_record.business_id;

  -- Get account IDs
  ar_account_id := get_account_by_code(business_id_val, '1100');
  revenue_account_id := get_account_by_code(business_id_val, '4000');
  vat_account_id := get_account_by_code(business_id_val, '2100');

  -- Post journal entry (reverse of invoice)
  SELECT post_journal_entry(
    business_id_val,
    cn_record.date,
    'Credit Note #' || cn_record.credit_number || ' for Invoice #' || invoice_record.invoice_number,
    'credit_note',
    p_credit_note_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', ar_account_id,
        'credit', cn_record.total,
        'description', 'Reduce receivable'
      ),
      jsonb_build_object(
        'account_id', revenue_account_id,
        'debit', cn_record.subtotal,
        'description', 'Reverse revenue'
      ),
      jsonb_build_object(
        'account_id', vat_account_id,
        'debit', cn_record.total_tax,
        'description', 'Reverse VAT'
      )
    )
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Post bill to ledger
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

-- ============================================================================
-- FUNCTION: Post bill payment to ledger
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

  -- Get bill details
  SELECT bill_number INTO bill_record
  FROM bills
  WHERE id = payment_record.bill_id;

  business_id_val := payment_record.business_id;

  -- Get account IDs
  ap_account_id := get_account_by_code(business_id_val, '2000');
  cash_account_id := get_account_by_code(business_id_val, '1000');
  bank_account_id := get_account_by_code(business_id_val, '1010');
  momo_account_id := get_account_by_code(business_id_val, '1020');

  -- Determine asset account based on payment method
  CASE payment_record.method
    WHEN 'cash' THEN asset_account_id := cash_account_id;
    WHEN 'bank' THEN asset_account_id := bank_account_id;
    WHEN 'momo' THEN asset_account_id := momo_account_id;
    ELSE asset_account_id := cash_account_id; -- Default to cash
  END CASE;

  -- Post journal entry
  SELECT post_journal_entry(
    business_id_val,
    payment_record.date,
    'Payment for Bill #' || bill_record.bill_number,
    'bill_payment',
    p_bill_payment_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', ap_account_id,
        'debit', payment_record.amount,
        'description', 'Reduce payable'
      ),
      jsonb_build_object(
        'account_id', asset_account_id,
        'credit', payment_record.amount,
        'description', 'Payment made'
      )
    )
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Post expense to ledger
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

-- ============================================================================
-- FUNCTION: Post sale to ledger
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

-- ============================================================================
-- TRIGGERS: Auto-post to ledger
-- ============================================================================

-- Trigger function to post invoice when status changes to 'sent' or 'paid'
CREATE OR REPLACE FUNCTION trigger_post_invoice()
RETURNS TRIGGER AS $$
BEGIN
  -- Only post if invoice is being sent/paid and wasn't already posted
  IF (NEW.status IN ('sent', 'paid', 'partially_paid') AND 
      (OLD.status IS NULL OR OLD.status = 'draft')) THEN
    -- Check if already posted
    IF NOT EXISTS (
      SELECT 1 FROM journal_entries 
      WHERE reference_type = 'invoice' 
        AND reference_id = NEW.id
    ) THEN
      PERFORM post_invoice_to_ledger(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_post_invoice ON invoices;
CREATE TRIGGER trigger_auto_post_invoice
  AFTER INSERT OR UPDATE OF status ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION trigger_post_invoice();

-- Trigger to post payment
CREATE OR REPLACE FUNCTION trigger_post_payment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deleted_at IS NULL THEN
    -- Check if already posted
    IF NOT EXISTS (
      SELECT 1 FROM journal_entries 
      WHERE reference_type = 'payment' 
        AND reference_id = NEW.id
    ) THEN
      PERFORM post_payment_to_ledger(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_post_payment ON payments;
CREATE TRIGGER trigger_auto_post_payment
  AFTER INSERT ON payments
  FOR EACH ROW
  EXECUTE FUNCTION trigger_post_payment();

-- Trigger to post credit note when applied
CREATE OR REPLACE FUNCTION trigger_post_credit_note()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'applied' AND (OLD.status IS NULL OR OLD.status != 'applied') THEN
    -- Check if already posted
    IF NOT EXISTS (
      SELECT 1 FROM journal_entries 
      WHERE reference_type = 'credit_note' 
        AND reference_id = NEW.id
    ) THEN
      PERFORM post_credit_note_to_ledger(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only create trigger if credit_notes table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = 'credit_notes'
  ) THEN
    DROP TRIGGER IF EXISTS trigger_auto_post_credit_note ON credit_notes;
    CREATE TRIGGER trigger_auto_post_credit_note
      AFTER INSERT OR UPDATE OF status ON credit_notes
      FOR EACH ROW
      EXECUTE FUNCTION trigger_post_credit_note();
  END IF;
END $$;

-- Trigger to post bill when status changes to 'open'
CREATE OR REPLACE FUNCTION trigger_post_bill()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.status = 'open' AND (OLD.status IS NULL OR OLD.status = 'draft')) THEN
    -- Check if already posted
    IF NOT EXISTS (
      SELECT 1 FROM journal_entries 
      WHERE reference_type = 'bill' 
        AND reference_id = NEW.id
    ) THEN
      PERFORM post_bill_to_ledger(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only create trigger if bills table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = 'bills'
  ) THEN
    DROP TRIGGER IF EXISTS trigger_auto_post_bill ON bills;
    CREATE TRIGGER trigger_auto_post_bill
      AFTER INSERT OR UPDATE OF status ON bills
      FOR EACH ROW
      EXECUTE FUNCTION trigger_post_bill();
  END IF;
END $$;

-- Trigger to post bill payment
CREATE OR REPLACE FUNCTION trigger_post_bill_payment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deleted_at IS NULL THEN
    -- Check if already posted
    IF NOT EXISTS (
      SELECT 1 FROM journal_entries 
      WHERE reference_type = 'bill_payment' 
        AND reference_id = NEW.id
    ) THEN
      PERFORM post_bill_payment_to_ledger(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only create trigger if bill_payments table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = 'bill_payments'
  ) THEN
    DROP TRIGGER IF EXISTS trigger_auto_post_bill_payment ON bill_payments;
    CREATE TRIGGER trigger_auto_post_bill_payment
      AFTER INSERT ON bill_payments
      FOR EACH ROW
      EXECUTE FUNCTION trigger_post_bill_payment();
  END IF;
END $$;

-- Trigger to post expense (only if expenses table exists)
CREATE OR REPLACE FUNCTION trigger_post_expense()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deleted_at IS NULL THEN
    -- Check if already posted
    IF NOT EXISTS (
      SELECT 1 FROM journal_entries 
      WHERE reference_type = 'expense' 
        AND reference_id = NEW.id
    ) THEN
      PERFORM post_expense_to_ledger(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only create trigger if expenses table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = 'expenses'
  ) THEN
    DROP TRIGGER IF EXISTS trigger_auto_post_expense ON expenses;
    CREATE TRIGGER trigger_auto_post_expense
      AFTER INSERT ON expenses
      FOR EACH ROW
      EXECUTE FUNCTION trigger_post_expense();
  END IF;
END $$;

-- ============================================================================
-- AUTO-UPDATE updated_at
-- ============================================================================
DROP TRIGGER IF EXISTS update_accounts_updated_at ON accounts;
CREATE TRIGGER update_accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on accounts
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view accounts for their business" ON accounts;
CREATE POLICY "Users can view accounts for their business"
  ON accounts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = accounts.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert accounts for their business" ON accounts;
CREATE POLICY "Users can insert accounts for their business"
  ON accounts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = accounts.business_id
        AND businesses.owner_id = auth.uid()
    )
    AND is_system = FALSE -- Cannot insert system accounts
  );

DROP POLICY IF EXISTS "Users can update non-system accounts for their business" ON accounts;
CREATE POLICY "Users can update non-system accounts for their business"
  ON accounts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = accounts.business_id
        AND businesses.owner_id = auth.uid()
    )
    AND is_system = FALSE -- Cannot update system accounts
  );

DROP POLICY IF EXISTS "Users can delete non-system accounts for their business" ON accounts;
CREATE POLICY "Users can delete non-system accounts for their business"
  ON accounts FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = accounts.business_id
        AND businesses.owner_id = auth.uid()
    )
    AND is_system = FALSE -- Cannot delete system accounts
  );

-- Enable RLS on journal_entries
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view journal entries for their business" ON journal_entries;
CREATE POLICY "Users can view journal entries for their business"
  ON journal_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = journal_entries.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert journal entries for their business" ON journal_entries;
CREATE POLICY "Users can insert journal entries for their business"
  ON journal_entries FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = journal_entries.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- Enable RLS on journal_entry_lines
ALTER TABLE journal_entry_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view journal entry lines for their business" ON journal_entry_lines;
CREATE POLICY "Users can view journal entry lines for their business"
  ON journal_entry_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM journal_entries
      JOIN businesses ON businesses.id = journal_entries.business_id
      WHERE journal_entries.id = journal_entry_lines.journal_entry_id
        AND businesses.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert journal entry lines for their business" ON journal_entry_lines;
CREATE POLICY "Users can insert journal entry lines for their business"
  ON journal_entry_lines FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM journal_entries
      JOIN businesses ON businesses.id = journal_entries.business_id
      WHERE journal_entries.id = journal_entry_lines.journal_entry_id
        AND businesses.owner_id = auth.uid()
    )
  );

