-- ============================================================================
-- MIGRATION: Fix posting_source DEFAULT Bug (Critical)
-- ============================================================================
-- FIXES SQL default + trigger timing bug where DEFAULT 'accountant' causes
-- system postings to be validated as accountant postings before the intended
-- value is applied.
--
-- Problem: Column has DEFAULT 'accountant', which is applied BEFORE trigger
-- fires, causing system postings to fail authorization check.
--
-- Solution:
-- 1. Remove DEFAULT from posting_source column
-- 2. Ensure ALL inserts explicitly set posting_source
-- 3. Update all system posting functions to pass posting_source = 'system'
-- ============================================================================

-- ============================================================================
-- STEP 1: Ensure posting_source column exists and remove DEFAULT
-- ============================================================================
-- Handle case where migration 189 may have failed due to immutability trigger
-- When adding a column with DEFAULT, PostgreSQL automatically backfills existing rows
-- without triggering UPDATE, so we can use this to avoid the trigger issue
DO $$
BEGIN
  -- Check if column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'journal_entries'
      AND column_name = 'posting_source'
  ) THEN
    -- Column doesn't exist - add it with DEFAULT to let PostgreSQL backfill automatically
    -- This avoids the UPDATE trigger issue since PostgreSQL backfills atomically
    ALTER TABLE journal_entries
      ADD COLUMN posting_source TEXT 
        CHECK (posting_source IN ('system', 'accountant'))
        DEFAULT 'accountant' NOT NULL;
    
    -- Now immediately remove the DEFAULT to prevent the bug
    ALTER TABLE journal_entries
      ALTER COLUMN posting_source DROP DEFAULT;
    
    -- Create index
    CREATE INDEX IF NOT EXISTS idx_journal_entries_posting_source ON journal_entries(posting_source);
  ELSE
    -- Column exists - check if it has NULL values (migration 189 may have failed partway)
    IF EXISTS (
      SELECT 1 FROM journal_entries WHERE posting_source IS NULL
    ) THEN
      -- There are NULL values - we need to set them, but UPDATE is blocked
      -- Use a workaround: temporarily disable the trigger
      ALTER TABLE journal_entries DISABLE TRIGGER trigger_prevent_journal_entry_modification;
      
      UPDATE journal_entries
      SET posting_source = 'accountant'
      WHERE posting_source IS NULL;
      
      ALTER TABLE journal_entries ENABLE TRIGGER trigger_prevent_journal_entry_modification;
    END IF;
    
    -- Remove DEFAULT if it exists
    ALTER TABLE journal_entries
      ALTER COLUMN posting_source DROP DEFAULT;
    
    -- Ensure NOT NULL constraint
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'journal_entries'
        AND column_name = 'posting_source'
        AND is_nullable = 'YES'
    ) THEN
      ALTER TABLE journal_entries
        ALTER COLUMN posting_source SET NOT NULL;
    END IF;
  END IF;
END $$;

COMMENT ON COLUMN journal_entries.posting_source IS 
  'Posting source: ''system'' for automatic postings (retail sales, invoices, etc.), ''accountant'' for manual accountant postings. REQUIRED - must be explicitly set on insert. No default.';

-- ============================================================================
-- STEP 2: Update post_journal_entry() to require explicit posting_source
-- ============================================================================
-- Remove default from function parameter to force explicit setting
DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID) CASCADE;
DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID) CASCADE;
DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB) CASCADE;

-- ============================================================================
-- CANONICAL FUNCTION: post_journal_entry (15 parameters)
-- ============================================================================
-- This is the PRIMARY/CANONICAL implementation. All other overloads are wrappers.
-- Signature: (UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT)
-- Intended caller: Both system and accountant (via posting_source parameter)
-- posting_source: REQUIRED - must be 'system' or 'accountant' (validated inside)
CREATE OR REPLACE FUNCTION post_journal_entry(
  p_business_id UUID,
  p_date DATE,
  p_description TEXT,
  p_reference_type TEXT,
  p_reference_id UUID,
  p_lines JSONB,
  p_is_adjustment BOOLEAN DEFAULT FALSE,
  p_adjustment_reason TEXT DEFAULT NULL,
  p_adjustment_ref TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL,
  p_posted_by_accountant_id UUID DEFAULT NULL,
  p_posting_source TEXT DEFAULT NULL  -- Default NULL, but validated inside to ensure explicit setting
)
RETURNS UUID AS $$
DECLARE
  journal_id UUID;
  line JSONB;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  account_id UUID;
  system_accountant_id UUID;
BEGIN
  -- Validate posting_source is provided
  IF p_posting_source IS NULL THEN
    RAISE EXCEPTION 'posting_source is required and must be explicitly set to ''system'' or ''accountant''';
  END IF;

  -- Validate posting_source value
  IF p_posting_source NOT IN ('system', 'accountant') THEN
    RAISE EXCEPTION 'posting_source must be ''system'' or ''accountant''. Found: %', p_posting_source;
  END IF;

  -- PHASE 6: Validate adjustment metadata
  IF p_is_adjustment = TRUE THEN
    IF p_adjustment_reason IS NULL OR TRIM(p_adjustment_reason) = '' THEN
      RAISE EXCEPTION 'Adjustment entries require a non-empty adjustment_reason';
    END IF;
    IF p_reference_type != 'adjustment' THEN
      RAISE EXCEPTION 'Adjustment entries must have reference_type = ''adjustment''. Found: %', p_reference_type;
    END IF;
    IF p_reference_id IS NOT NULL THEN
      RAISE EXCEPTION 'Adjustment entries must have reference_id = NULL. Adjustments are standalone entries.';
    END IF;
  ELSE
    IF p_adjustment_reason IS NOT NULL OR p_adjustment_ref IS NOT NULL THEN
      RAISE EXCEPTION 'Non-adjustment entries cannot have adjustment_reason or adjustment_ref';
    END IF;
  END IF;

  -- PHASE 12: Backfill entries must have reason and actor
  IF p_entry_type = 'backfill' THEN
    IF p_backfill_reason IS NULL OR TRIM(p_backfill_reason) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_reason';
    END IF;
    IF p_backfill_actor IS NULL OR TRIM(p_backfill_actor) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_actor';
    END IF;
  END IF;

  -- Validate that debits equal credits BEFORE inserting
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    total_debit := total_debit + COALESCE((line->>'debit')::NUMERIC, 0);
    total_credit := total_credit + COALESCE((line->>'credit')::NUMERIC, 0);
  END LOOP;

  IF ABS(total_debit - total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry must balance. Debit: %, Credit: %', total_debit, total_credit;
  END IF;

  -- Get system accountant (for system postings when posted_by_accountant_id not provided)
  IF p_posting_source = 'system' AND p_posted_by_accountant_id IS NULL THEN
    -- Default to business owner as system accountant for system postings
    SELECT owner_id INTO system_accountant_id
    FROM businesses
    WHERE id = p_business_id;
    
    IF system_accountant_id IS NULL THEN
      RAISE EXCEPTION 'Cannot post journal entry: Business owner not found for business %. System accountant required for automatic posting.', p_business_id;
    END IF;
  END IF;

  -- Create journal entry with posting_source (explicitly set, no default)
  INSERT INTO journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    created_by,
    is_adjustment,
    adjustment_reason,
    adjustment_ref,
    entry_type,
    backfill_reason,
    backfill_actor,
    posted_by_accountant_id,
    posting_source
  )
  VALUES (
    p_business_id,
    p_date,
    p_description,
    p_reference_type,
    p_reference_id,
    COALESCE(p_created_by, system_accountant_id, p_posted_by_accountant_id),
    p_is_adjustment,
    p_adjustment_reason,
    p_adjustment_ref,
    p_entry_type,
    p_backfill_reason,
    p_backfill_actor,
    COALESCE(p_posted_by_accountant_id, system_accountant_id),
    p_posting_source  -- Explicitly set, no default
  )
  RETURNING id INTO journal_id;

  -- Insert ALL lines in a SINGLE batch INSERT statement
  INSERT INTO journal_entry_lines (
    journal_entry_id,
    account_id,
    debit,
    credit,
    description
  )
  SELECT
    journal_id,
    (jl->>'account_id')::UUID,
    COALESCE((jl->>'debit')::NUMERIC, 0),
    COALESCE((jl->>'credit')::NUMERIC, 0),
    jl->>'description'
  FROM jsonb_array_elements(p_lines) AS jl;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT) IS 
  'FIX: Posts journal entry with REQUIRED posting_source parameter (no default). System postings do not require posted_by_accountant_id. Accountant postings require posted_by_accountant_id and accountant role verification. Uses batch INSERT for all lines.';

-- ============================================================================
-- STEP 3: Recreate 14-parameter wrapper with explicit posting_source = 'accountant'
-- ============================================================================
-- WRAPPER FUNCTION: post_journal_entry (14 parameters)
-- This is a BACKWARD COMPATIBILITY WRAPPER, not the canonical implementation.
-- Signature: (UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID)
-- Intended caller: Manual accountant postings (accounting workspace)
-- Forwards to canonical function with posting_source = 'accountant'
CREATE OR REPLACE FUNCTION post_journal_entry(
  p_business_id UUID,
  p_date DATE,
  p_description TEXT,
  p_reference_type TEXT,
  p_reference_id UUID,
  p_lines JSONB,
  p_is_adjustment BOOLEAN DEFAULT FALSE,
  p_adjustment_reason TEXT DEFAULT NULL,
  p_adjustment_ref TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL,
  p_posted_by_accountant_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
BEGIN
  -- EXPLICIT: Pass posting_source = 'accountant' for manual postings
  RETURN post_journal_entry(
    p_business_id => p_business_id,
    p_date => p_date,
    p_description => p_description,
    p_reference_type => p_reference_type,
    p_reference_id => p_reference_id,
    p_lines => p_lines,
    p_is_adjustment => p_is_adjustment,
    p_adjustment_reason => p_adjustment_reason,
    p_adjustment_ref => p_adjustment_ref,
    p_created_by => p_created_by,
    p_entry_type => p_entry_type,
    p_backfill_reason => p_backfill_reason,
    p_backfill_actor => p_backfill_actor,
    p_posted_by_accountant_id => p_posted_by_accountant_id,
    p_posting_source => 'accountant'  -- EXPLICIT: Manual postings are accountant postings
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID) IS 
  'Backward compatibility wrapper for 14-parameter post_journal_entry. EXPLICITLY sets posting_source = ''accountant'' for manual postings.';

-- ============================================================================
-- STEP 4: Recreate 10-parameter wrapper with explicit posting_source = 'accountant'
-- ============================================================================
-- WRAPPER FUNCTION: post_journal_entry (10 parameters)
-- This is a BACKWARD COMPATIBILITY WRAPPER, not the canonical implementation.
-- Signature: (UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID)
-- Intended caller: Manual accountant postings (legacy accounting workspace calls)
-- Forwards to canonical function with posting_source = 'accountant'
CREATE OR REPLACE FUNCTION post_journal_entry(
  p_business_id UUID,
  p_date DATE,
  p_description TEXT,
  p_reference_type TEXT,
  p_reference_id UUID,
  p_lines JSONB,
  p_is_adjustment BOOLEAN,
  p_adjustment_reason TEXT,
  p_adjustment_ref TEXT,
  p_created_by UUID
)
RETURNS UUID AS $$
BEGIN
  -- EXPLICIT: Pass posting_source = 'accountant' for manual postings
  RETURN post_journal_entry(
    p_business_id => p_business_id,
    p_date => p_date,
    p_description => p_description,
    p_reference_type => p_reference_type,
    p_reference_id => p_reference_id,
    p_lines => p_lines,
    p_is_adjustment => p_is_adjustment,
    p_adjustment_reason => p_adjustment_reason,
    p_adjustment_ref => p_adjustment_ref,
    p_created_by => p_created_by,
    p_entry_type => NULL::TEXT,
    p_backfill_reason => NULL::TEXT,
    p_backfill_actor => NULL::TEXT,
    p_posted_by_accountant_id => NULL::UUID,
    p_posting_source => 'accountant'  -- EXPLICIT: Manual postings are accountant postings
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID) IS 
  'Backward compatibility wrapper for 10-parameter post_journal_entry. EXPLICITLY sets posting_source = ''accountant'' for manual postings.';

-- ============================================================================
-- STEP 5: Update system posting functions to explicitly pass posting_source = 'system'
-- ============================================================================

-- ============================================================================
-- CANONICAL FUNCTION: post_invoice_to_ledger
-- ============================================================================
-- This is the PRIMARY/CANONICAL implementation for invoice posting.
-- Signature: (UUID, TEXT DEFAULT NULL, TEXT DEFAULT NULL, TEXT DEFAULT NULL)
-- Intended caller: System (automatic invoice posting)
-- posting_source: Always 'system' (set internally)
-- Drop all existing overloads first to avoid ambiguity
DROP FUNCTION IF EXISTS post_invoice_to_ledger(UUID, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS post_invoice_to_ledger(UUID) CASCADE;

CREATE OR REPLACE FUNCTION post_invoice_to_ledger(
  p_invoice_id UUID,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL
)
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

  -- COA GUARD: Resolve and validate all account codes BEFORE any inserts
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
  revenue_account_id := get_account_by_code(business_id_val, '4000'); -- Service Revenue (not a control key)

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

  -- Post journal entry with EXPLICIT posting_source = 'system'
  SELECT post_journal_entry(
    business_id_val,
    invoice_record.issue_date,
    'Invoice #' || invoice_record.invoice_number,
    'invoice',
    p_invoice_id,
    journal_lines,
    FALSE,  -- p_is_adjustment
    NULL,   -- p_adjustment_reason
    NULL,   -- p_adjustment_ref
    NULL,   -- p_created_by
    p_entry_type,
    p_backfill_reason,
    p_backfill_actor,
    NULL,   -- p_posted_by_accountant_id (not required for system postings)
    'system'  -- EXPLICIT: Invoice postings are system-generated
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_invoice_to_ledger IS 
  'Posts invoice to ledger with EXPLICIT posting_source = ''system''. Invoice postings are system-generated and do not require posted_by_accountant_id.';

-- ============================================================================
-- CANONICAL FUNCTION: post_bill_to_ledger
-- ============================================================================
-- This is the PRIMARY/CANONICAL implementation for bill posting.
-- Signature: (UUID, TEXT DEFAULT NULL, TEXT DEFAULT NULL, TEXT DEFAULT NULL)
-- Intended caller: System (automatic bill posting)
-- posting_source: Always 'system' (set internally)
-- Drop all existing overloads first to avoid ambiguity
DROP FUNCTION IF EXISTS post_bill_to_ledger(UUID, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS post_bill_to_ledger(UUID) CASCADE;

CREATE OR REPLACE FUNCTION post_bill_to_ledger(
  p_bill_id UUID,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL
)
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

  -- COA GUARD: Resolve and validate all account codes BEFORE any inserts
  ap_account_code := get_control_account_code(business_id_val, 'AP');
  PERFORM assert_account_exists(business_id_val, ap_account_code);
  PERFORM assert_account_exists(business_id_val, '5200'); -- Supplier Bills (not a control key)
  
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

  -- Build journal entry lines: start with base lines (AP and Expense)
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', expense_account_id,
      'debit', bill_record.subtotal,
      'description', 'Supplier bill expense'
    ),
    jsonb_build_object(
      'account_id', ap_account_id,
      'credit', bill_record.total,
      'description', 'Bill payable'
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

  -- Post journal entry with EXPLICIT posting_source = 'system'
  SELECT post_journal_entry(
    business_id_val,
    bill_record.issue_date,
    'Bill #' || bill_record.bill_number,
    'bill',
    p_bill_id,
    journal_lines,
    FALSE,  -- p_is_adjustment
    NULL,   -- p_adjustment_reason
    NULL,   -- p_adjustment_ref
    NULL,   -- p_created_by
    p_entry_type,
    p_backfill_reason,
    p_backfill_actor,
    NULL,   -- p_posted_by_accountant_id (not required for system postings)
    'system'  -- EXPLICIT: Bill postings are system-generated
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_bill_to_ledger IS 
  'Posts bill to ledger with EXPLICIT posting_source = ''system''. Bill postings are system-generated and do not require posted_by_accountant_id.';

-- ============================================================================
-- CANONICAL FUNCTION: post_expense_to_ledger
-- ============================================================================
-- This is the PRIMARY/CANONICAL implementation for expense posting.
-- Signature: (UUID, TEXT DEFAULT NULL, TEXT DEFAULT NULL, TEXT DEFAULT NULL)
-- Intended caller: System (automatic expense posting)
-- posting_source: Always 'system' (set internally)
-- Drop all existing overloads first to avoid ambiguity
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

  -- COA GUARD: Resolve and validate all account codes BEFORE any inserts
  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, '5100'); -- Operating Expenses (not a control key)
  
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

  -- Post journal entry with EXPLICIT posting_source = 'system'
  SELECT post_journal_entry(
    business_id_val,
    expense_record.date,
    'Expense: ' || COALESCE(expense_record.description, 'General expense'),
    'expense',
    p_expense_id,
    journal_lines,
    FALSE,  -- p_is_adjustment
    NULL,   -- p_adjustment_reason
    NULL,   -- p_adjustment_ref
    NULL,   -- p_created_by
    p_entry_type,
    p_backfill_reason,
    p_backfill_actor,
    NULL,   -- p_posted_by_accountant_id (not required for system postings)
    'system'  -- EXPLICIT: Expense postings are system-generated
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_expense_to_ledger IS 
  'Posts expense to ledger with EXPLICIT posting_source = ''system''. Expense postings are system-generated and do not require posted_by_accountant_id.';

-- ============================================================================
-- CANONICAL FUNCTION: post_payment_to_ledger
-- ============================================================================
-- This is the PRIMARY/CANONICAL implementation for payment posting.
-- Signature: (UUID, TEXT DEFAULT NULL, TEXT DEFAULT NULL, TEXT DEFAULT NULL)
-- Intended caller: System (automatic payment posting)
-- posting_source: Always 'system' (set internally)
-- Drop all existing overloads first to avoid ambiguity
DROP FUNCTION IF EXISTS post_payment_to_ledger(UUID, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS post_payment_to_ledger(UUID) CASCADE;

CREATE OR REPLACE FUNCTION post_payment_to_ledger(
  p_payment_id UUID,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL
)
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
  ar_account_code TEXT;
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

  -- COA GUARD: Resolve and validate all account codes BEFORE any inserts
  ar_account_code := get_control_account_code(business_id_val, 'AR');
  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  bank_account_code := get_control_account_code(business_id_val, 'BANK');
  
  -- Validate all account codes that will be used
  PERFORM assert_account_exists(business_id_val, ar_account_code);
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, bank_account_code);
  PERFORM assert_account_exists(business_id_val, '1020'); -- MoMo (hardcoded, not a control key)

  -- Get account IDs using control keys
  ar_account_id := get_account_by_control_key(business_id_val, 'AR');
  cash_account_id := get_account_by_code(business_id_val, cash_account_code);
  bank_account_id := get_account_by_code(business_id_val, bank_account_code);
  momo_account_id := get_account_by_code(business_id_val, '1020'); -- MoMo not a control key

  -- Validate AR account exists
  IF ar_account_id IS NULL THEN
    RAISE EXCEPTION 'AR account not found for business: %. Payment ID: %', business_id_val, p_payment_id;
  END IF;

  -- Determine asset account based on payment method
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
    RAISE EXCEPTION 'Asset account not found for payment method: %. Payment ID: %', payment_record.method, p_payment_id;
  END IF;

  -- Post journal entry with EXPLICIT posting_source = 'system'
  SELECT post_journal_entry(
    business_id_val,
    payment_record.date,
    'Payment for Invoice #' || invoice_record.invoice_number,
    'payment',
    p_payment_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', ar_account_id,
        'credit', payment_amount,
        'description', 'Reduce receivable'
      ),
      jsonb_build_object(
        'account_id', asset_account_id,
        'debit', payment_amount,
        'description', 'Payment received'
      )
    ),
    FALSE,  -- p_is_adjustment
    NULL,   -- p_adjustment_reason
    NULL,   -- p_adjustment_ref
    NULL,   -- p_created_by
    p_entry_type,
    p_backfill_reason,
    p_backfill_actor,
    NULL,   -- p_posted_by_accountant_id (not required for system postings)
    'system'  -- EXPLICIT: Payment postings are system-generated
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_payment_to_ledger IS 
  'Posts payment to ledger with EXPLICIT posting_source = ''system''. Payment postings are system-generated and do not require posted_by_accountant_id.';

-- ============================================================================
-- STEP 6: Update post_invoice_payment_to_ledger to use posting_source = 'system'
-- ============================================================================
-- Drop all existing overloads first to avoid ambiguity
DROP FUNCTION IF EXISTS post_invoice_payment_to_ledger(UUID, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS post_invoice_payment_to_ledger(UUID) CASCADE;

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
  ar_account_code TEXT;
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

  -- COA GUARD: Resolve and validate all account codes BEFORE any inserts
  ar_account_code := get_control_account_code(business_id_val, 'AR');
  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  bank_account_code := get_control_account_code(business_id_val, 'BANK');
  
  -- Validate all account codes that will be used
  PERFORM assert_account_exists(business_id_val, ar_account_code);
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, bank_account_code);
  PERFORM assert_account_exists(business_id_val, '1020'); -- MoMo (hardcoded, not a control key)

  -- Get account IDs using control keys
  ar_account_id := get_account_by_control_key(business_id_val, 'AR');
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

  -- Post journal entry with EXPLICIT posting_source = 'system'
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
    ),
    FALSE,  -- p_is_adjustment
    NULL,   -- p_adjustment_reason
    NULL,   -- p_adjustment_ref
    NULL,   -- p_created_by
    NULL,   -- p_entry_type
    NULL,   -- p_backfill_reason
    NULL,   -- p_backfill_actor
    NULL,   -- p_posted_by_accountant_id (not required for system postings)
    'system'  -- EXPLICIT: Invoice payment postings are system-generated
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_invoice_payment_to_ledger IS 
  'Posts invoice payment to ledger with EXPLICIT posting_source = ''system''. Invoice payment postings are system-generated and do not require posted_by_accountant_id.';

-- ============================================================================
-- STEP 7: Update post_bill_payment_to_ledger to use posting_source = 'system'
-- ============================================================================
-- Drop all existing overloads first to avoid ambiguity
DROP FUNCTION IF EXISTS post_bill_payment_to_ledger(UUID, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS post_bill_payment_to_ledger(UUID) CASCADE;

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
  ap_account_code TEXT;
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

  -- COA GUARD: Resolve and validate all account codes BEFORE any inserts
  ap_account_code := get_control_account_code(business_id_val, 'AP');
  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  bank_account_code := get_control_account_code(business_id_val, 'BANK');
  
  -- Validate all account codes that will be used
  PERFORM assert_account_exists(business_id_val, ap_account_code);
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, bank_account_code);
  PERFORM assert_account_exists(business_id_val, '1020'); -- MoMo (hardcoded, not a control key)

  -- Get account IDs using control keys
  ap_account_id := get_account_by_control_key(business_id_val, 'AP');
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

  -- Post journal entry with EXPLICIT posting_source = 'system'
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
    ),
    FALSE,  -- p_is_adjustment
    NULL,   -- p_adjustment_reason
    NULL,   -- p_adjustment_ref
    NULL,   -- p_created_by
    NULL,   -- p_entry_type
    NULL,   -- p_backfill_reason
    NULL,   -- p_backfill_actor
    NULL,   -- p_posted_by_accountant_id (not required for system postings)
    'system'  -- EXPLICIT: Bill payment postings are system-generated
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_bill_payment_to_ledger IS 
  'Posts bill payment to ledger with EXPLICIT posting_source = ''system''. Bill payment postings are system-generated and do not require posted_by_accountant_id.';

-- ============================================================================
-- STEP 7: Update post_credit_note_to_ledger to use posting_source = 'system'
-- ============================================================================
-- Drop all existing overloads first to avoid ambiguity
DROP FUNCTION IF EXISTS post_credit_note_to_ledger(UUID, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS post_credit_note_to_ledger(UUID) CASCADE;

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
  tax_lines_array JSONB;
  tax_line_item JSONB;
  parsed_tax_lines JSONB[] := ARRAY[]::JSONB[];
  journal_lines JSONB;
  tax_account_id UUID;
  tax_code TEXT;
  tax_amount NUMERIC;
  tax_ledger_side TEXT;
  tax_ledger_account_code TEXT;
  ar_account_code TEXT;
  line_meta JSONB;
BEGIN
  -- Get credit note details (DO NOT SELECT legacy tax columns)
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

  -- Parse tax_lines JSONB: Read from canonical format (tax_lines->'lines')
  tax_lines_jsonb := cn_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    -- Canonical format: { "lines": [...], "meta": {...}, "pricing_mode": "..." }
    IF jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'lines' THEN
      tax_lines_array := tax_lines_jsonb->'lines';
      
      -- Validate it's an array and parse individual tax line items
      IF jsonb_typeof(tax_lines_array) = 'array' THEN
        FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_array)
        LOOP
          -- Defensive validation: ensure tax line has required fields
          IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
            parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
          END IF;
        END LOOP;
      END IF;
    END IF;
  END IF;

  -- COA GUARD: Validate control accounts using control keys
  ar_account_code := get_control_account_code(business_id_val, 'AR');
  PERFORM assert_account_exists(business_id_val, ar_account_code);
  PERFORM assert_account_exists(business_id_val, '4000'); -- Revenue (not a control key)
  
  -- Validate tax account codes from tax_lines (extract from line.meta or line directly)
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    -- Extract ledger_account_code from line.meta (canonical format) or directly from line (legacy compatibility)
    line_meta := tax_line_item->'meta';
    IF line_meta IS NOT NULL AND line_meta ? 'ledger_account_code' THEN
      tax_ledger_account_code := line_meta->>'ledger_account_code';
    ELSIF tax_line_item ? 'ledger_account_code' THEN
      -- Fallback: legacy format with ledger_account_code directly on line
      tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    ELSE
      tax_ledger_account_code := NULL;
    END IF;
    
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  -- Get account IDs using control keys
  ar_account_id := get_account_by_control_key(business_id_val, 'AR');
  revenue_account_id := get_account_by_code(business_id_val, '4000'); -- Service Revenue (not a control key)

  -- Build journal entry lines: start with base lines (AR and Revenue) - REVERSED for credit note
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', ar_account_id,
      'credit', cn_record.total,  -- REVERSED: Credit AR (reduce receivable)
      'description', 'Credit note receivable reduction'
    ),
    jsonb_build_object(
      'account_id', revenue_account_id,
      'debit', subtotal,  -- REVERSED: Debit Revenue (reduce revenue)
      'description', 'Service revenue reduction'
    )
  );

  -- Add tax lines: iterate parsed_tax_lines and post each to its control account
  -- Credit note tax lines are REVERSED (debit tax payable instead of credit)
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    
    -- Extract ledger_account_code from line.meta or line directly
    line_meta := tax_line_item->'meta';
    IF line_meta IS NOT NULL AND line_meta ? 'ledger_account_code' THEN
      tax_ledger_account_code := line_meta->>'ledger_account_code';
    ELSIF tax_line_item ? 'ledger_account_code' THEN
      tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    ELSE
      tax_ledger_account_code := NULL;
    END IF;
    
    -- Extract ledger_side from line.meta or line directly
    IF line_meta IS NOT NULL AND line_meta ? 'ledger_side' THEN
      tax_ledger_side := line_meta->>'ledger_side';
    ELSIF tax_line_item ? 'ledger_side' THEN
      tax_ledger_side := tax_line_item->>'ledger_side';
    ELSE
      tax_ledger_side := NULL;
    END IF;

    -- Only post tax lines with ledger_account_code
    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      
      -- REVERSED: Credit notes reverse tax, so flip the side
      IF tax_ledger_side = 'credit' THEN
        -- Original was credit, reversal is debit
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'debit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax reversal'
          )
        );
      ELSIF tax_ledger_side = 'debit' THEN
        -- Original was debit, reversal is credit
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

  -- Post journal entry with EXPLICIT posting_source = 'system'
  SELECT post_journal_entry(
    business_id_val,
    cn_record.date,
    'Credit Note #' || cn_record.credit_number || ' for Invoice #' || invoice_record.invoice_number,
    'credit_note',
    p_credit_note_id,
    journal_lines,
    FALSE,  -- p_is_adjustment
    NULL,   -- p_adjustment_reason
    NULL,   -- p_adjustment_ref
    NULL,   -- p_created_by
    NULL,   -- p_entry_type
    NULL,   -- p_backfill_reason
    NULL,   -- p_backfill_actor
    NULL,   -- p_posted_by_accountant_id (not required for system postings)
    'system'  -- EXPLICIT: Credit note postings are system-generated
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_credit_note_to_ledger IS 
  'Posts credit note to ledger with EXPLICIT posting_source = ''system''. Credit note postings are system-generated and do not require posted_by_accountant_id.';

-- ============================================================================
-- STEP 8: Add backward-compatible wrapper for post_sale_to_ledger
-- ============================================================================
-- WRAPPER FUNCTION: post_sale_to_ledger (2 parameters: UUID, UUID)
-- This is a BACKWARD COMPATIBILITY WRAPPER for app calls, not the canonical implementation.
-- Signature: (UUID, UUID) - matches app call: (p_sale_id, p_posted_by_accountant_id)
-- Intended caller: Retail app (app/api/sales/create/route.ts)
-- Forwards to canonical post_sale_to_ledger(UUID, TEXT, TEXT, TEXT) with posting_source = 'system'
-- Note: p_posted_by_accountant_id is ignored for system postings (set to NULL in canonical function)
-- 
-- IMPORTANT: We use explicit parameter types in the RETURN statement to ensure
-- PostgreSQL matches the canonical (UUID, TEXT, TEXT, TEXT) signature, not this wrapper.
CREATE OR REPLACE FUNCTION post_sale_to_ledger(
  p_sale_id UUID,
  p_posted_by_accountant_id UUID
)
RETURNS UUID AS $$
DECLARE
  result UUID;
BEGIN
  -- Forward to canonical function with posting_source = 'system'
  -- Using explicit NULL::TEXT to match canonical signature (UUID, TEXT, TEXT, TEXT)
  -- p_posted_by_accountant_id is ignored for system postings
  SELECT post_sale_to_ledger(
    p_sale_id => p_sale_id,
    p_entry_type => NULL::TEXT,
    p_backfill_reason => NULL::TEXT,
    p_backfill_actor => NULL::TEXT
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_sale_to_ledger(UUID, UUID) IS 
  'Backward-compatible wrapper for app calls. Accepts (p_sale_id, p_posted_by_accountant_id) and forwards to canonical post_sale_to_ledger(UUID, TEXT, TEXT, TEXT) with posting_source = ''system''. The p_posted_by_accountant_id parameter is ignored for system postings.';

-- ============================================================================
-- CANONICAL FUNCTION: post_sale_to_ledger (4 parameters)
-- ============================================================================
-- This is the PRIMARY/CANONICAL implementation for sale posting.
-- Defined in: Migration 189 (supabase/migrations/189_fix_ledger_posting_authorization.sql)
-- Signature: (UUID, TEXT DEFAULT NULL, TEXT DEFAULT NULL, TEXT DEFAULT NULL)
-- Intended caller: System (automatic retail sale posting) - called by wrapper above
-- posting_source: Always 'system' (set internally in migration 189)
-- Expected: post_sale_to_ledger() calls post_journal_entry(..., 'system')

-- ============================================================================
-- STEP 10: Fix live asset and payroll posting functions to set posting_source
-- ============================================================================
-- These functions are still called from the app and INSERT directly into journal_entries
-- They must explicitly set posting_source = 'system' since they are automated postings

-- Fix post_asset_purchase_to_ledger
CREATE OR REPLACE FUNCTION post_asset_purchase_to_ledger(
  p_asset_id UUID,
  p_payment_account_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_business_id UUID;
  v_purchase_amount NUMERIC;
  v_asset_account_id UUID;
  v_payment_account UUID;
  v_journal_entry_id UUID;
BEGIN
  -- Get asset details
  SELECT business_id, purchase_amount INTO v_business_id, v_purchase_amount
  FROM assets
  WHERE id = p_asset_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  -- Get or create Fixed Assets account (1500)
  SELECT id INTO v_asset_account_id
  FROM accounts
  WHERE business_id = v_business_id
    AND code = '1500'
    AND type = 'asset';

  IF v_asset_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Fixed Assets', '1500', 'asset', 'Fixed assets', TRUE)
    RETURNING id INTO v_asset_account_id;
  END IF;

  -- Determine payment account
  IF p_payment_account_id IS NOT NULL THEN
    v_payment_account := p_payment_account_id;
  ELSE
    -- Default to Cash account (1010)
    SELECT id INTO v_payment_account
    FROM accounts
    WHERE business_id = v_business_id
      AND code = '1010'
      AND type = 'asset';

    IF v_payment_account IS NULL THEN
      RAISE EXCEPTION 'Cash account (1010) not found';
    END IF;
  END IF;

  -- Create journal entry with EXPLICIT posting_source = 'system'
  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id, posting_source)
  VALUES (v_business_id, CURRENT_DATE, 'Asset Purchase: ' || (SELECT name FROM assets WHERE id = p_asset_id), 'asset', p_asset_id, 'system')
  RETURNING id INTO v_journal_entry_id;

  -- Debit Fixed Assets
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_asset_account_id, v_purchase_amount, 0, 'Asset Purchase');

  -- Credit Cash/Bank/Payment Account
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_payment_account, 0, v_purchase_amount, 'Payment for Asset');

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_asset_purchase_to_ledger IS 
  'Posts asset purchase to ledger with EXPLICIT posting_source = ''system''. Asset postings are system-generated and do not require posted_by_accountant_id.';

-- Fix post_depreciation_to_ledger
CREATE OR REPLACE FUNCTION post_depreciation_to_ledger(
  p_depreciation_entry_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_business_id UUID;
  v_asset_id UUID;
  v_amount NUMERIC;
  v_date DATE;
  v_asset_name TEXT;
  v_depreciation_expense_account_id UUID;
  v_accumulated_depreciation_account_id UUID;
  v_journal_entry_id UUID;
BEGIN
  -- Get depreciation entry details
  SELECT de.business_id, de.asset_id, de.amount, de.date, a.name
  INTO v_business_id, v_asset_id, v_amount, v_date, v_asset_name
  FROM depreciation_entries de
  JOIN assets a ON a.id = de.asset_id
  WHERE de.id = p_depreciation_entry_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Depreciation entry not found';
  END IF;

  -- Get or create Depreciation Expense account (5700)
  SELECT id INTO v_depreciation_expense_account_id
  FROM accounts
  WHERE business_id = v_business_id
    AND code = '5700'
    AND type = 'expense';

  IF v_depreciation_expense_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Depreciation Expense', '5700', 'expense', 'Depreciation expense', TRUE)
    RETURNING id INTO v_depreciation_expense_account_id;
  END IF;

  -- Get or create Accumulated Depreciation account (1650)
  SELECT id INTO v_accumulated_depreciation_account_id
  FROM accounts
  WHERE business_id = v_business_id
    AND code = '1650'
    AND type = 'asset';

  IF v_accumulated_depreciation_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Accumulated Depreciation', '1650', 'asset', 'Accumulated depreciation on fixed assets', TRUE)
    RETURNING id INTO v_accumulated_depreciation_account_id;
  END IF;

  -- Create journal entry with EXPLICIT posting_source = 'system'
  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id, posting_source)
  VALUES (v_business_id, v_date, 'Depreciation: ' || v_asset_name, 'depreciation', p_depreciation_entry_id, 'system')
  RETURNING id INTO v_journal_entry_id;

  -- Debit Depreciation Expense
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_depreciation_expense_account_id, v_amount, 0, 'Depreciation Expense');

  -- Credit Accumulated Depreciation
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_accumulated_depreciation_account_id, 0, v_amount, 'Accumulated Depreciation');

  -- Update depreciation entry with journal_entry_id
  UPDATE depreciation_entries
  SET journal_entry_id = v_journal_entry_id
  WHERE id = p_depreciation_entry_id;

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_depreciation_to_ledger IS 
  'Posts depreciation to ledger with EXPLICIT posting_source = ''system''. Depreciation postings are system-generated and do not require posted_by_accountant_id.';

-- Fix post_asset_disposal_to_ledger
CREATE OR REPLACE FUNCTION post_asset_disposal_to_ledger(
  p_asset_id UUID,
  p_disposal_amount NUMERIC,
  p_payment_account_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_business_id UUID;
  v_purchase_amount NUMERIC;
  v_accumulated_depreciation NUMERIC;
  v_asset_name TEXT;
  v_asset_account_id UUID;
  v_accumulated_depreciation_account_id UUID;
  v_payment_account UUID;
  v_journal_entry_id UUID;
  v_is_gain BOOLEAN;
  v_gain_loss_amount NUMERIC;
BEGIN
  -- Get asset details
  SELECT business_id, purchase_amount, name INTO v_business_id, v_purchase_amount, v_asset_name
  FROM assets
  WHERE id = p_asset_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  -- Calculate accumulated depreciation
  SELECT COALESCE(SUM(amount), 0) INTO v_accumulated_depreciation
  FROM depreciation_entries
  WHERE asset_id = p_asset_id;

  -- Get asset accounts
  SELECT id INTO v_asset_account_id
  FROM accounts
  WHERE business_id = v_business_id
    AND code = '1500'
    AND type = 'asset';

  SELECT id INTO v_accumulated_depreciation_account_id
  FROM accounts
  WHERE business_id = v_business_id
    AND code = '1650'
    AND type = 'asset';

  -- Determine payment account
  IF p_payment_account_id IS NOT NULL THEN
    v_payment_account := p_payment_account_id;
  ELSE
    SELECT id INTO v_payment_account
    FROM accounts
    WHERE business_id = v_business_id
      AND code = '1010'
      AND type = 'asset';
  END IF;

  -- Calculate gain/loss
  v_gain_loss_amount := p_disposal_amount - (v_purchase_amount - v_accumulated_depreciation);
  v_is_gain := v_gain_loss_amount > 0;

  -- Create journal entry with EXPLICIT posting_source = 'system'
  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id, posting_source)
  VALUES (v_business_id, CURRENT_DATE, 'Asset Disposal: ' || v_asset_name, 'asset', p_asset_id, 'system')
  RETURNING id INTO v_journal_entry_id;

  -- Debit Cash (disposal amount)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_payment_account, p_disposal_amount, 0, 'Proceeds from Asset Disposal');

  -- Credit Accumulated Depreciation (remove accumulated depreciation)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_accumulated_depreciation_account_id, 0, v_accumulated_depreciation, 'Remove Accumulated Depreciation');

  -- Credit Fixed Assets (remove asset at cost)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_asset_account_id, 0, v_purchase_amount, 'Remove Asset from Books');

  -- Handle gain/loss
  IF v_is_gain THEN
    -- Credit Gain on Disposal (income account)
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_journal_entry_id, (SELECT id FROM accounts WHERE business_id = v_business_id AND code = '4100' AND type = 'income' LIMIT 1), 0, v_gain_loss_amount, 'Gain on Asset Disposal');
  ELSE
    -- Debit Loss on Disposal (expense account)
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_journal_entry_id, (SELECT id FROM accounts WHERE business_id = v_business_id AND code = '5800' AND type = 'expense' LIMIT 1), ABS(v_gain_loss_amount), 0, 'Loss on Asset Disposal');
  END IF;

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_asset_disposal_to_ledger IS 
  'Posts asset disposal to ledger with EXPLICIT posting_source = ''system''. Asset disposal postings are system-generated and do not require posted_by_accountant_id.';

-- Fix post_payroll_to_ledger
CREATE OR REPLACE FUNCTION post_payroll_to_ledger(p_payroll_run_id UUID)
RETURNS UUID AS $$
DECLARE
  v_business_id UUID;
  v_payroll_month DATE;
  v_total_gross NUMERIC;
  v_total_allowances NUMERIC;
  v_total_ssnit_employer NUMERIC;
  v_total_paye NUMERIC;
  v_total_ssnit_employee NUMERIC;
  v_total_net NUMERIC;
  v_payroll_expense_account_id UUID;
  v_ssnit_employer_expense_account_id UUID;
  v_paye_liability_account_id UUID;
  v_ssnit_liability_account_id UUID;
  v_net_salaries_payable_account_id UUID;
  v_journal_entry_id UUID;
BEGIN
  -- Get payroll run details
  SELECT 
    business_id,
    payroll_month,
    total_gross,
    total_allowances,
    total_ssnit_employer,
    total_paye,
    total_ssnit_employee,
    total_net
  INTO 
    v_business_id,
    v_payroll_month,
    v_total_gross,
    v_total_allowances,
    v_total_ssnit_employer,
    v_total_paye,
    v_total_ssnit_employee,
    v_total_net
  FROM payroll_runs
  WHERE id = p_payroll_run_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Payroll run not found';
  END IF;

  -- Get or create required accounts
  SELECT id INTO v_payroll_expense_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '5600' AND type = 'expense';

  IF v_payroll_expense_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Payroll Expense', '5600', 'expense', 'Payroll expense', TRUE)
    RETURNING id INTO v_payroll_expense_account_id;
  END IF;

  SELECT id INTO v_ssnit_employer_expense_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '5610' AND type = 'expense';

  IF v_ssnit_employer_expense_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'SSNIT Employer Expense', '5610', 'expense', 'SSNIT employer contribution expense', TRUE)
    RETURNING id INTO v_ssnit_employer_expense_account_id;
  END IF;

  SELECT id INTO v_paye_liability_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '2230' AND type = 'liability';

  IF v_paye_liability_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'PAYE Tax Payable', '2230', 'liability', 'PAYE tax payable', TRUE)
    RETURNING id INTO v_paye_liability_account_id;
  END IF;

  SELECT id INTO v_ssnit_liability_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '2231' AND type = 'liability';

  IF v_ssnit_liability_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'SSNIT Payable', '2231', 'liability', 'SSNIT payable', TRUE)
    RETURNING id INTO v_ssnit_liability_account_id;
  END IF;

  SELECT id INTO v_net_salaries_payable_account_id
  FROM accounts
  WHERE business_id = v_business_id AND code = '2240' AND type = 'liability';

  IF v_net_salaries_payable_account_id IS NULL THEN
    INSERT INTO accounts (business_id, name, code, type, description, is_system)
    VALUES (v_business_id, 'Net Salaries Payable', '2240', 'liability', 'Net salaries payable to employees', TRUE)
    RETURNING id INTO v_net_salaries_payable_account_id;
  END IF;

  -- Create journal entry with EXPLICIT posting_source = 'system'
  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id, posting_source)
  VALUES (v_business_id, v_payroll_month, 'Payroll Run: ' || TO_CHAR(v_payroll_month, 'Month YYYY'), 'payroll', p_payroll_run_id, 'system')
  RETURNING id INTO v_journal_entry_id;

  -- Debit Payroll Expense (gross salary + allowances)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_payroll_expense_account_id, v_total_gross + v_total_allowances, 0, 'Gross Salaries and Allowances');

  -- Debit Employer SSNIT Expense
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_ssnit_employer_expense_account_id, v_total_ssnit_employer, 0, 'Employer SSNIT Contribution');

  -- Credit PAYE Liability
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_paye_liability_account_id, 0, v_total_paye, 'PAYE Tax Payable');

  -- Credit SSNIT Liability
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_ssnit_liability_account_id, 0, v_total_ssnit_employee + v_total_ssnit_employer, 'SSNIT Payable');

  -- Credit Net Salaries Payable
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_entry_id, v_net_salaries_payable_account_id, 0, v_total_net, 'Net Salaries Payable');

  RETURN v_journal_entry_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_payroll_to_ledger IS 
  'Posts payroll to ledger with EXPLICIT posting_source = ''system''. Payroll postings are system-generated and do not require posted_by_accountant_id.';

-- ============================================================================
-- STEP 11: Verify manual accountant functions already set posting_source = 'accountant'
-- ============================================================================
-- apply_adjusting_journal(), post_adjustment_to_ledger(), and 
-- post_opening_balance_import_to_ledger() were already updated in migration 189,
-- so they should already be correct. This is just a verification comment.
-- Expected: All manual accountant functions set posting_source = 'accountant'

-- ============================================================================
-- STEP 12: Document legacy functions (quarantined - not callable)
-- ============================================================================
-- The following functions contain INSERT statements without posting_source but are
-- NOT callable (superseded by newer versions):
--
-- Migration 043: post_journal_entry() - Replaced by migrations 188, 189, 190
-- Migration 050: post_journal_entry() - Replaced by migrations 188, 189, 190
-- Migration 165: post_journal_entry() - Replaced by migrations 188, 189, 190
-- Migration 166: post_journal_entry() - Replaced by migrations 188, 189, 190
-- Migration 171: post_journal_entry() - Replaced by migrations 188, 189, 190
-- Migration 179: post_journal_entry() - Replaced by migrations 188, 189, 190
-- Migration 184: post_journal_entry() - Replaced by migrations 188, 189, 190
-- Migration 188: post_journal_entry() - Replaced by migrations 189, 190
-- Migration 095: post_adjustment_to_ledger() - Replaced by migration 189
-- Migration 096: post_opening_balance() - Replaced by migration 189
-- Migration 099: post_adjustment_to_ledger() - Replaced by migration 189
-- Migration 148: post_manual_journal_draft() - Replaced by migration 189
-- Migration 151: post_opening_balance_import_to_ledger() - Replaced by migration 189
--
-- These functions are kept for historical reference but are not reachable from
-- application code. They will fail if called directly due to missing posting_source.
