-- ============================================================================
-- MIGRATION: Phase 12B - Backfill Completion + Safe Compatibility
-- ============================================================================
-- Completes Phase 12 backfill coverage (sales + invoices + expenses + payments)
-- Ensures backward compatibility for all DB function signatures
-- Improves legacy detection to match current accounting invariants
--
-- Constraints:
-- - NO UI changes
-- - NO POS/Service/General workspace changes
-- - NO tax engine changes
-- - NO silent data fixes
-- - Preserve backward compatibility for DB function signatures
-- ============================================================================

-- ============================================================================
-- STEP A: RESTORE COMPATIBILITY FOR post_journal_entry (10-PARAMETER WRAPPER)
-- ============================================================================
-- Create wrapper for old 10-parameter signature that calls new 13-parameter version
-- This ensures all existing callers continue to work unchanged
-- 
-- Note: Migration 171 already dropped the 10-parameter version and created the 13-parameter version.
-- We need to explicitly create an overload for the 10-parameter signature.
-- PostgreSQL function overloading will distinguish between 10 and 13 parameters.

-- Drop any existing 10-parameter version (should already be dropped by migration 171, but be safe)
-- Use CASCADE to drop any dependent objects
DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID) CASCADE;

-- Create the 10-parameter overload as a new function (not replace)
-- This creates a separate overload that will be matched when exactly 10 parameters are provided
CREATE FUNCTION post_journal_entry(
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
  -- Call the 13-parameter version with explicit parameter names to avoid ambiguity
  -- All parameters are required (no defaults), so this is a distinct overload
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
    p_backfill_actor => NULL::TEXT
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID) IS 
'PHASE 12B: Backward compatibility wrapper for 10-parameter post_journal_entry. Calls 13-parameter version with trailing NULLs.';

-- ============================================================================
-- STEP B1: EXTEND post_invoice_to_ledger FOR BACKFILL METADATA
-- ============================================================================
-- Add optional (p_entry_type, p_backfill_reason, p_backfill_actor) parameters
-- Validate: if entry_type='backfill' then backfill_reason and backfill_actor required
-- Pass through to post_journal_entry
-- Drop old 1-parameter version to avoid ambiguity
DROP FUNCTION IF EXISTS post_invoice_to_ledger(UUID);

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
  -- PHASE 12B: Validate backfill metadata if entry_type='backfill'
  IF p_entry_type = 'backfill' THEN
    IF p_backfill_reason IS NULL OR TRIM(p_backfill_reason) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_reason';
    END IF;
    IF p_backfill_actor IS NULL OR TRIM(p_backfill_actor) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_actor';
    END IF;
  END IF;

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

  -- GUARD: Assert accounting period is open
  PERFORM assert_accounting_period_is_open(business_id_val, invoice_record.issue_date);

  -- Parse tax_lines JSONB metadata
  tax_lines_jsonb := invoice_record.tax_lines;
  IF tax_lines_jsonb IS NOT NULL THEN
    IF jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'tax_lines' THEN
      tax_lines_jsonb := tax_lines_jsonb->'tax_lines';
    END IF;
    IF jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_jsonb)
      LOOP
        IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
          parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Get account IDs
  ar_account_code := get_control_account_code(business_id_val, 'AR');
  PERFORM assert_account_exists(business_id_val, ar_account_code);
  PERFORM assert_account_exists(business_id_val, '4000'); -- Revenue
  ar_account_id := get_account_by_control_key(business_id_val, 'AR');
  revenue_account_id := get_account_by_code(business_id_val, '4000');

  -- Build journal entry lines: start with base lines (AR and Revenue)
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', ar_account_id,
      'debit', invoice_record.total,
      'description', 'Accounts Receivable'
    ),
    jsonb_build_object(
      'account_id', revenue_account_id,
      'credit', subtotal,
      'description', 'Service Revenue'
    )
  );

  -- Add tax lines: iterate parsed_tax_lines and post each to its control account
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    line_meta := tax_line_item->'meta';
    
    IF line_meta IS NOT NULL THEN
      tax_ledger_account_code := line_meta->>'ledger_account_code';
      tax_ledger_side := line_meta->>'ledger_side';
    ELSE
      tax_ledger_account_code := NULL;
      tax_ledger_side := NULL;
    END IF;

    -- Only post tax lines with ledger_account_code (sales don't have absorbed taxes)
    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
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

  -- Post journal entry (PHASE 12B: pass through backfill params)
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
    p_backfill_actor
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_invoice_to_ledger IS 'PHASE 12B: Post invoice to ledger. Optional p_entry_type, p_backfill_reason, p_backfill_actor for Phase 12 backfill.';

-- ============================================================================
-- STEP B2: EXTEND post_expense_to_ledger FOR BACKFILL METADATA
-- ============================================================================
-- Add optional (p_entry_type, p_backfill_reason, p_backfill_actor) parameters
-- Validate: if entry_type='backfill' then backfill_reason and backfill_actor required
-- Pass through to post_journal_entry
-- Drop old 1-parameter version to avoid ambiguity
DROP FUNCTION IF EXISTS post_expense_to_ledger(UUID);

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
  line_meta JSONB;
  cash_account_code TEXT;
BEGIN
  -- PHASE 12B: Validate backfill metadata if entry_type='backfill'
  IF p_entry_type = 'backfill' THEN
    IF p_backfill_reason IS NULL OR TRIM(p_backfill_reason) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_reason';
    END IF;
    IF p_backfill_actor IS NULL OR TRIM(p_backfill_actor) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_actor';
    END IF;
  END IF;

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
    IF jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'tax_lines' THEN
      tax_lines_jsonb := tax_lines_jsonb->'tax_lines';
    END IF;
    IF jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_jsonb)
      LOOP
        IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
          parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Get account IDs using control keys
  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, '5100'); -- Operating Expenses
  cash_account_id := get_account_by_control_key(business_id_val, 'CASH');
  expense_account_id := get_account_by_code(business_id_val, '5100');

  -- Build journal entry lines: start with base lines (Expense and Cash)
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', expense_account_id,
      'debit', expense_record.subtotal,
      'description', COALESCE(expense_record.description, 'Expense')
    ),
    jsonb_build_object(
      'account_id', cash_account_id,
      'credit', expense_record.total,
      'description', 'Cash payment'
    )
  );

  -- Add tax lines (input taxes are typically debits - tax recoverable)
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    line_meta := tax_line_item->'meta';
    
    IF line_meta IS NOT NULL THEN
      tax_ledger_account_code := line_meta->>'ledger_account_code';
      tax_ledger_side := line_meta->>'ledger_side';
    ELSE
      tax_ledger_account_code := NULL;
      tax_ledger_side := NULL;
    END IF;

    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      
      IF tax_ledger_side = 'debit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'debit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' input tax'
          )
        );
      ELSIF tax_ledger_side = 'credit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'credit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax'
          )
        );
      END IF;
    END IF;
  END LOOP;

  -- Post journal entry (PHASE 12B: pass through backfill params)
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
    p_backfill_actor
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_expense_to_ledger IS 'PHASE 12B: Post expense to ledger. Optional p_entry_type, p_backfill_reason, p_backfill_actor for Phase 12 backfill.';

-- ============================================================================
-- STEP B3: EXTEND post_invoice_payment_to_ledger FOR BACKFILL METADATA
-- ============================================================================
-- Add optional (p_entry_type, p_backfill_reason, p_backfill_actor) parameters
-- Validate: if entry_type='backfill' then backfill_reason and backfill_actor required
-- Pass through to post_journal_entry
-- Drop old 1-parameter version to avoid ambiguity
DROP FUNCTION IF EXISTS post_invoice_payment_to_ledger(UUID);

CREATE OR REPLACE FUNCTION post_invoice_payment_to_ledger(
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
  cash_account_code TEXT;
  bank_account_code TEXT;
BEGIN
  -- PHASE 12B: Validate backfill metadata if entry_type='backfill'
  IF p_entry_type = 'backfill' THEN
    IF p_backfill_reason IS NULL OR TRIM(p_backfill_reason) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_reason';
    END IF;
    IF p_backfill_actor IS NULL OR TRIM(p_backfill_actor) = '' THEN
      RAISE EXCEPTION 'Backfill entries require a non-empty backfill_actor';
    END IF;
  END IF;

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

  -- GUARD: Assert accounting period is open
  PERFORM assert_accounting_period_is_open(business_id_val, payment_record.date);

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

  -- Post journal entry (PHASE 12B: pass through backfill params)
  -- Debit Cash/Bank/Clearing, Credit AR
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
    p_entry_type,
    p_backfill_reason,
    p_backfill_actor
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_invoice_payment_to_ledger IS 'PHASE 12B: Post invoice payment to ledger. Optional p_entry_type, p_backfill_reason, p_backfill_actor for Phase 12 backfill.';

-- ============================================================================
-- STEP B4: CREATE ALIAS post_payment_to_ledger → post_invoice_payment_to_ledger
-- ============================================================================
-- Maintain backward compatibility for post_payment_to_ledger
-- Drop old 1-parameter version to avoid ambiguity
DROP FUNCTION IF EXISTS post_payment_to_ledger(UUID);

CREATE OR REPLACE FUNCTION post_payment_to_ledger(
  p_payment_id UUID,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL
)
RETURNS UUID AS $$
BEGIN
  RETURN post_invoice_payment_to_ledger(p_payment_id, p_entry_type, p_backfill_reason, p_backfill_actor);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_payment_to_ledger IS 'PHASE 12B: Alias for post_invoice_payment_to_ledger. Maintains backward compatibility. Supports backfill params.';

-- ============================================================================
-- STEP C1: IMPLEMENT backfill_missing_invoice_journals
-- ============================================================================
-- Controlled backfill loop for invoices (matches sales pattern exactly)
CREATE OR REPLACE FUNCTION backfill_missing_invoice_journals(
  p_business_id UUID,
  p_period_id UUID,
  p_invariant_enforcement_date DATE DEFAULT '2024-01-01',
  p_actor TEXT DEFAULT 'system'
)
RETURNS JSONB AS $$
DECLARE
  period_rec RECORD;
  invoice_rec RECORD;
  journal_id UUID;
  repaired INTEGER := 0;
  skipped_not_open INTEGER := 0;
  err_msg TEXT;
  after_js JSONB;
BEGIN
  SELECT * INTO period_rec 
  FROM accounting_periods 
  WHERE id = p_period_id AND business_id = p_business_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Period not found or does not belong to business: %', p_business_id;
  END IF;

  IF period_rec.status != 'open' THEN
    RETURN jsonb_build_object(
      'repaired', 0, 
      'skipped_reason', 'period status is not open', 
      'period_status', period_rec.status
    );
  END IF;

  FOR invoice_rec IN
    SELECT i.id, i.issue_date
    FROM invoices i
    WHERE i.business_id = p_business_id
      AND i.issue_date >= period_rec.period_start
      AND i.issue_date <= period_rec.period_end
      AND i.issue_date < p_invariant_enforcement_date
      AND i.status IN ('sent', 'paid', 'partially_paid')
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE je.reference_type = 'invoice' 
          AND je.reference_id = i.id 
          AND je.business_id = i.business_id
      )
  LOOP
    BEGIN
      SELECT post_invoice_to_ledger(
        invoice_rec.id,
        'backfill',
        'Phase 12B backfill: invoice missing journal entry',
        p_actor
      ) INTO journal_id;

      after_js := jsonb_build_object('journal_entry_id', journal_id, 'invoice_id', invoice_rec.id);
      INSERT INTO backfill_audit_log (
        period_id, entity_type, entity_id, action_taken, actor, before_summary, after_summary
      )
      VALUES (
        p_period_id, 
        'invoice', 
        invoice_rec.id, 
        'created_journal_entry', 
        p_actor, 
        jsonb_build_object('invoice_id', invoice_rec.id, 'had_journal_entry', FALSE), 
        after_js
      );
      repaired := repaired + 1;
    EXCEPTION WHEN OTHERS THEN
      err_msg := SQLERRM;
      INSERT INTO backfill_audit_log (
        period_id, entity_type, entity_id, action_taken, actor, before_summary, after_summary
      )
      VALUES (
        p_period_id, 
        'invoice', 
        invoice_rec.id, 
        'backfill_failed', 
        p_actor, 
        jsonb_build_object('invoice_id', invoice_rec.id), 
        jsonb_build_object('error', err_msg)
      );
      RAISE;
    END;
  END LOOP;

  RETURN jsonb_build_object('repaired', repaired, 'period_id', p_period_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION backfill_missing_invoice_journals IS 'PHASE 12B: Backfill missing journal entries for legacy invoices. Only when period is open. Logs every action to backfill_audit_log.';

-- ============================================================================
-- STEP C2: IMPLEMENT backfill_missing_expense_journals
-- ============================================================================
-- Controlled backfill loop for expenses (matches sales pattern exactly)
CREATE OR REPLACE FUNCTION backfill_missing_expense_journals(
  p_business_id UUID,
  p_period_id UUID,
  p_invariant_enforcement_date DATE DEFAULT '2024-01-01',
  p_actor TEXT DEFAULT 'system'
)
RETURNS JSONB AS $$
DECLARE
  period_rec RECORD;
  expense_rec RECORD;
  journal_id UUID;
  repaired INTEGER := 0;
  skipped_not_open INTEGER := 0;
  err_msg TEXT;
  after_js JSONB;
BEGIN
  SELECT * INTO period_rec 
  FROM accounting_periods 
  WHERE id = p_period_id AND business_id = p_business_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Period not found or does not belong to business: %', p_business_id;
  END IF;

  IF period_rec.status != 'open' THEN
    RETURN jsonb_build_object(
      'repaired', 0, 
      'skipped_reason', 'period status is not open', 
      'period_status', period_rec.status
    );
  END IF;

  FOR expense_rec IN
    SELECT e.id, e.date
    FROM expenses e
    WHERE e.business_id = p_business_id
      AND e.date >= period_rec.period_start
      AND e.date <= period_rec.period_end
      AND e.date < p_invariant_enforcement_date
      AND e.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE je.reference_type = 'expense' 
          AND je.reference_id = e.id 
          AND je.business_id = e.business_id
      )
  LOOP
    BEGIN
      SELECT post_expense_to_ledger(
        expense_rec.id,
        'backfill',
        'Phase 12B backfill: expense missing journal entry',
        p_actor
      ) INTO journal_id;

      after_js := jsonb_build_object('journal_entry_id', journal_id, 'expense_id', expense_rec.id);
      INSERT INTO backfill_audit_log (
        period_id, entity_type, entity_id, action_taken, actor, before_summary, after_summary
      )
      VALUES (
        p_period_id, 
        'expense', 
        expense_rec.id, 
        'created_journal_entry', 
        p_actor, 
        jsonb_build_object('expense_id', expense_rec.id, 'had_journal_entry', FALSE), 
        after_js
      );
      repaired := repaired + 1;
    EXCEPTION WHEN OTHERS THEN
      err_msg := SQLERRM;
      INSERT INTO backfill_audit_log (
        period_id, entity_type, entity_id, action_taken, actor, before_summary, after_summary
      )
      VALUES (
        p_period_id, 
        'expense', 
        expense_rec.id, 
        'backfill_failed', 
        p_actor, 
        jsonb_build_object('expense_id', expense_rec.id), 
        jsonb_build_object('error', err_msg)
      );
      RAISE;
    END;
  END LOOP;

  RETURN jsonb_build_object('repaired', repaired, 'period_id', p_period_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION backfill_missing_expense_journals IS 'PHASE 12B: Backfill missing journal entries for legacy expenses. Only when period is open. Logs every action to backfill_audit_log.';

-- ============================================================================
-- STEP C3: IMPLEMENT backfill_missing_payment_journals
-- ============================================================================
-- Controlled backfill loop for payments (matches sales pattern exactly)
CREATE OR REPLACE FUNCTION backfill_missing_payment_journals(
  p_business_id UUID,
  p_period_id UUID,
  p_invariant_enforcement_date DATE DEFAULT '2024-01-01',
  p_actor TEXT DEFAULT 'system'
)
RETURNS JSONB AS $$
DECLARE
  period_rec RECORD;
  payment_rec RECORD;
  journal_id UUID;
  repaired INTEGER := 0;
  skipped_not_open INTEGER := 0;
  err_msg TEXT;
  after_js JSONB;
BEGIN
  SELECT * INTO period_rec 
  FROM accounting_periods 
  WHERE id = p_period_id AND business_id = p_business_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Period not found or does not belong to business: %', p_business_id;
  END IF;

  IF period_rec.status != 'open' THEN
    RETURN jsonb_build_object(
      'repaired', 0, 
      'skipped_reason', 'period status is not open', 
      'period_status', period_rec.status
    );
  END IF;

  FOR payment_rec IN
    SELECT p.id, p.date
    FROM payments p
    WHERE p.business_id = p_business_id
      AND p.date >= period_rec.period_start
      AND p.date <= period_rec.period_end
      AND p.date < p_invariant_enforcement_date
      AND p.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries je
        WHERE je.reference_type = 'payment' 
          AND je.reference_id = p.id 
          AND je.business_id = p.business_id
      )
  LOOP
    BEGIN
      SELECT post_invoice_payment_to_ledger(
        payment_rec.id,
        'backfill',
        'Phase 12B backfill: payment missing journal entry',
        p_actor
      ) INTO journal_id;

      after_js := jsonb_build_object('journal_entry_id', journal_id, 'payment_id', payment_rec.id);
      INSERT INTO backfill_audit_log (
        period_id, entity_type, entity_id, action_taken, actor, before_summary, after_summary
      )
      VALUES (
        p_period_id, 
        'payment', 
        payment_rec.id, 
        'created_journal_entry', 
        p_actor, 
        jsonb_build_object('payment_id', payment_rec.id, 'had_journal_entry', FALSE), 
        after_js
      );
      repaired := repaired + 1;
    EXCEPTION WHEN OTHERS THEN
      err_msg := SQLERRM;
      INSERT INTO backfill_audit_log (
        period_id, entity_type, entity_id, action_taken, actor, before_summary, after_summary
      )
      VALUES (
        p_period_id, 
        'payment', 
        payment_rec.id, 
        'backfill_failed', 
        p_actor, 
        jsonb_build_object('payment_id', payment_rec.id), 
        jsonb_build_object('error', err_msg)
      );
      RAISE;
    END;
  END LOOP;

  RETURN jsonb_build_object('repaired', repaired, 'period_id', p_period_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION backfill_missing_payment_journals IS 'PHASE 12B: Backfill missing journal entries for legacy payments. Only when period is open. Logs every action to backfill_audit_log.';

-- ============================================================================
-- STEP D: STRENGTHEN detect_legacy_issues FOR SALES LEDGER COMPLETENESS
-- ============================================================================
-- Sales JEs must validate required lines based on sale type:
-- - Always: Cash/AR and Revenue
-- - If inventory sale: must include COGS + Inventory
-- - If tax applied: must include Tax Payable
-- Return counts for each missing category separately
CREATE OR REPLACE FUNCTION detect_legacy_issues(
  p_business_id UUID,
  p_invariant_enforcement_date DATE DEFAULT '2024-01-01'
)
RETURNS JSONB AS $$
DECLARE
  res JSONB;
  sales_without_je JSONB;
  invoices_without_je JSONB;
  expenses_without_je JSONB;
  payments_without_je JSONB;
  journal_entries_missing_lines JSONB;
  sale_jes_missing_cash_or_ar JSONB;
  sale_jes_missing_revenue JSONB;
  sale_jes_missing_cogs JSONB;
  sale_jes_missing_inventory JSONB;
  sale_jes_missing_tax JSONB;
  periods_without_opening_balances JSONB;
  periods_not_properly_closed JSONB;
  trial_balance_imbalance JSONB;
  sale_je RECORD;
  has_cash_or_ar BOOLEAN;
  has_revenue BOOLEAN;
  has_cogs BOOLEAN;
  has_inventory BOOLEAN;
  has_tax BOOLEAN;
  sale_has_inventory BOOLEAN;
  sale_has_tax BOOLEAN;
  line_count INTEGER;
BEGIN
  -- Sales without journal entries (legacy only)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('sale_id', s.id, 'created_at', s.created_at)), '[]'::jsonb) INTO sales_without_je
  FROM sales s
  WHERE s.business_id = p_business_id
    AND s.created_at::DATE < p_invariant_enforcement_date
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.reference_type = 'sale' AND je.reference_id = s.id AND je.business_id = s.business_id
    );

  -- PHASE 12B: Enhanced sales journal entry completeness check
  -- Check each sale journal entry for required ledger lines
  FOR sale_je IN
    SELECT je.id as journal_entry_id, je.reference_id as sale_id, je.date
    FROM journal_entries je
    WHERE je.business_id = p_business_id
      AND je.date < p_invariant_enforcement_date
      AND je.reference_type = 'sale'
  LOOP
    -- Check if sale has inventory (check sale_items)
    SELECT EXISTS (
      SELECT 1 FROM sale_items si
      WHERE si.sale_id = sale_je.sale_id
        AND si.product_id IS NOT NULL
    ) INTO sale_has_inventory;

    -- Check if sale has tax (check sales.tax_lines)
    SELECT EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_je.sale_id
        AND s.tax_lines IS NOT NULL
        AND s.tax_lines != '{}'::jsonb
        AND (
          jsonb_typeof(s.tax_lines) = 'array' AND jsonb_array_length(s.tax_lines) > 0
          OR (jsonb_typeof(s.tax_lines) = 'object' 
              AND s.tax_lines ? 'tax_lines' 
              AND jsonb_typeof(s.tax_lines->'tax_lines') = 'array' 
              AND jsonb_array_length(s.tax_lines->'tax_lines') > 0)
        )
    ) INTO sale_has_tax;

    -- Check for Cash/AR (asset accounts 1000-1099)
    SELECT EXISTS (
      SELECT 1 FROM journal_entry_lines jel
      JOIN accounts a ON a.id = jel.account_id
      WHERE jel.journal_entry_id = sale_je.journal_entry_id
        AND a.code >= '1000' AND a.code < '1100'
        AND a.type = 'asset'
        AND (jel.debit > 0 OR jel.credit > 0)
    ) INTO has_cash_or_ar;

    -- Check for Revenue (income account)
    SELECT EXISTS (
      SELECT 1 FROM journal_entry_lines jel
      JOIN accounts a ON a.id = jel.account_id
      WHERE jel.journal_entry_id = sale_je.journal_entry_id
        AND a.type = 'income'
        AND jel.credit > 0
    ) INTO has_revenue;

    -- Check for COGS (expense account 5000)
    SELECT EXISTS (
      SELECT 1 FROM journal_entry_lines jel
      JOIN accounts a ON a.id = jel.account_id
      WHERE jel.journal_entry_id = sale_je.journal_entry_id
        AND a.code = '5000'
        AND a.type = 'expense'
        AND jel.debit > 0
    ) INTO has_cogs;

    -- Check for Inventory (asset account 1200)
    SELECT EXISTS (
      SELECT 1 FROM journal_entry_lines jel
      JOIN accounts a ON a.id = jel.account_id
      WHERE jel.journal_entry_id = sale_je.journal_entry_id
        AND a.code = '1200'
        AND a.type = 'asset'
        AND jel.credit > 0
    ) INTO has_inventory;

    -- Check for Tax Payable (liability accounts 2100-2130, 2200+)
    SELECT EXISTS (
      SELECT 1 FROM journal_entry_lines jel
      JOIN accounts a ON a.id = jel.account_id
      WHERE jel.journal_entry_id = sale_je.journal_entry_id
        AND a.type = 'liability'
        AND (a.code >= '2100' AND a.code <= '2130' OR a.code >= '2200')
        AND jel.credit > 0
    ) INTO has_tax;

    -- Collect missing line violations
    IF NOT has_cash_or_ar THEN
      sale_jes_missing_cash_or_ar := COALESCE(sale_jes_missing_cash_or_ar, '[]'::jsonb) || 
        jsonb_build_array(jsonb_build_object('journal_entry_id', sale_je.journal_entry_id, 'sale_id', sale_je.sale_id, 'reason', 'missing_cash_or_ar'));
    END IF;

    IF NOT has_revenue THEN
      sale_jes_missing_revenue := COALESCE(sale_jes_missing_revenue, '[]'::jsonb) || 
        jsonb_build_array(jsonb_build_object('journal_entry_id', sale_je.journal_entry_id, 'sale_id', sale_je.sale_id, 'reason', 'missing_revenue'));
    END IF;

    IF sale_has_inventory AND NOT has_cogs THEN
      sale_jes_missing_cogs := COALESCE(sale_jes_missing_cogs, '[]'::jsonb) || 
        jsonb_build_array(jsonb_build_object('journal_entry_id', sale_je.journal_entry_id, 'sale_id', sale_je.sale_id, 'reason', 'missing_cogs_for_inventory_sale'));
    END IF;

    IF sale_has_inventory AND NOT has_inventory THEN
      sale_jes_missing_inventory := COALESCE(sale_jes_missing_inventory, '[]'::jsonb) || 
        jsonb_build_array(jsonb_build_object('journal_entry_id', sale_je.journal_entry_id, 'sale_id', sale_je.sale_id, 'reason', 'missing_inventory_for_inventory_sale'));
    END IF;

    IF sale_has_tax AND NOT has_tax THEN
      sale_jes_missing_tax := COALESCE(sale_jes_missing_tax, '[]'::jsonb) || 
        jsonb_build_array(jsonb_build_object('journal_entry_id', sale_je.journal_entry_id, 'sale_id', sale_je.sale_id, 'reason', 'missing_tax_for_taxed_sale'));
    END IF;
  END LOOP;

  -- Initialize arrays if null
  sale_jes_missing_cash_or_ar := COALESCE(sale_jes_missing_cash_or_ar, '[]'::jsonb);
  sale_jes_missing_revenue := COALESCE(sale_jes_missing_revenue, '[]'::jsonb);
  sale_jes_missing_cogs := COALESCE(sale_jes_missing_cogs, '[]'::jsonb);
  sale_jes_missing_inventory := COALESCE(sale_jes_missing_inventory, '[]'::jsonb);
  sale_jes_missing_tax := COALESCE(sale_jes_missing_tax, '[]'::jsonb);

  -- Combined missing lines (for backward compatibility)
  journal_entries_missing_lines := sale_jes_missing_cash_or_ar || sale_jes_missing_revenue || sale_jes_missing_cogs || sale_jes_missing_inventory || sale_jes_missing_tax;

  -- Invoices without journal entries (legacy, postable statuses)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('invoice_id', i.id, 'issue_date', i.issue_date)), '[]'::jsonb) INTO invoices_without_je
  FROM invoices i
  WHERE i.business_id = p_business_id
    AND i.issue_date < p_invariant_enforcement_date
    AND i.status IN ('sent', 'paid', 'partially_paid')
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.reference_type = 'invoice' AND je.reference_id = i.id AND je.business_id = i.business_id
    );

  -- Expenses without journal entries (legacy, not deleted)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('expense_id', e.id, 'date', e.date)), '[]'::jsonb) INTO expenses_without_je
  FROM expenses e
  WHERE e.business_id = p_business_id
    AND e.date < p_invariant_enforcement_date
    AND e.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.reference_type = 'expense' AND je.reference_id = e.id AND je.business_id = e.business_id
    );

  -- Payments (invoice) without journal entries (legacy, not deleted)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('payment_id', p.id, 'date', p.date)), '[]'::jsonb) INTO payments_without_je
  FROM payments p
  WHERE p.business_id = p_business_id
    AND p.date < p_invariant_enforcement_date
    AND p.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.reference_type = 'payment' AND je.reference_id = p.id AND je.business_id = p.business_id
    );

  -- Periods (legacy) without any opening balances
  SELECT COALESCE(jsonb_agg(jsonb_build_object('period_id', ap.id, 'period_start', ap.period_start)), '[]'::jsonb) INTO periods_without_opening_balances
  FROM accounting_periods ap
  WHERE ap.business_id = p_business_id
    AND ap.period_start < p_invariant_enforcement_date
    AND NOT EXISTS (SELECT 1 FROM period_opening_balances pob WHERE pob.period_id = ap.id);

  -- Periods not properly closed/locked (legacy: status should be soft_closed or locked for old periods)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('period_id', ap.id, 'period_start', ap.period_start, 'status', ap.status)), '[]'::jsonb) INTO periods_not_properly_closed
  FROM accounting_periods ap
  WHERE ap.business_id = p_business_id
    AND ap.period_start < p_invariant_enforcement_date
    AND ap.status NOT IN ('soft_closed', 'locked');

  -- Trial balance imbalance: periods where snapshot exists and is_balanced = false
  SELECT COALESCE(jsonb_agg(jsonb_build_object('period_id', tbs.period_id, 'difference', tbs.balance_difference, 'total_debits', tbs.total_debits, 'total_credits', tbs.total_credits)), '[]'::jsonb) INTO trial_balance_imbalance
  FROM trial_balance_snapshots tbs
  JOIN accounting_periods ap ON ap.id = tbs.period_id
  WHERE ap.business_id = p_business_id
    AND ap.period_start < p_invariant_enforcement_date
    AND (tbs.is_balanced = FALSE OR tbs.balance_difference <> 0);

  res := jsonb_build_object(
    'business_id', p_business_id,
    'invariant_enforcement_date', p_invariant_enforcement_date,
    'detected_at', NOW(),
    'sales_without_journal_entry', sales_without_je,
    'invoices_without_journal_entry', invoices_without_je,
    'expenses_without_journal_entry', expenses_without_je,
    'payments_without_journal_entry', payments_without_je,
    'journal_entries_missing_required_lines', journal_entries_missing_lines,
    'sale_jes_missing_cash_or_ar', sale_jes_missing_cash_or_ar,
    'sale_jes_missing_revenue', sale_jes_missing_revenue,
    'sale_jes_missing_cogs', sale_jes_missing_cogs,
    'sale_jes_missing_inventory', sale_jes_missing_inventory,
    'sale_jes_missing_tax', sale_jes_missing_tax,
    'periods_without_opening_balances', periods_without_opening_balances,
    'periods_not_properly_closed', periods_not_properly_closed,
    'trial_balance_imbalance', trial_balance_imbalance,
    'counts', jsonb_build_object(
      'sales_without_je', jsonb_array_length(sales_without_je),
      'invoices_without_je', jsonb_array_length(invoices_without_je),
      'expenses_without_je', jsonb_array_length(expenses_without_je),
      'payments_without_je', jsonb_array_length(payments_without_je),
      'journal_entries_missing_lines', jsonb_array_length(journal_entries_missing_lines),
      'sale_jes_missing_cash_or_ar', jsonb_array_length(sale_jes_missing_cash_or_ar),
      'sale_jes_missing_revenue', jsonb_array_length(sale_jes_missing_revenue),
      'sale_jes_missing_cogs', jsonb_array_length(sale_jes_missing_cogs),
      'sale_jes_missing_inventory', jsonb_array_length(sale_jes_missing_inventory),
      'sale_jes_missing_tax', jsonb_array_length(sale_jes_missing_tax),
      'periods_without_opening_balances', jsonb_array_length(periods_without_opening_balances),
      'periods_not_properly_closed', jsonb_array_length(periods_not_properly_closed),
      'trial_balance_imbalance', jsonb_array_length(trial_balance_imbalance)
    )
  );
  RETURN res;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION detect_legacy_issues IS 'PHASE 12B: READ-ONLY. Identifies legacy (pre-invariant) records that fail current invariants. Enhanced sales ledger completeness checks with separate counts per missing category. No side effects.';

-- ============================================================================
-- STEP E: OPENING BALANCES REMEDIATION HOOK (READ-ONLY + SUGGESTED ORDER)
-- ============================================================================
-- Returns a recommended chronological plan for generating opening balances
-- DO NOT auto-generate unless explicitly invoked
CREATE OR REPLACE FUNCTION recommend_opening_balance_remediation_plan(
  p_business_id UUID
)
RETURNS JSONB AS $$
DECLARE
  period_record RECORD;
  prior_period_record RECORD;
  recommendations JSONB[] := ARRAY[]::JSONB[];
  recommendation JSONB;
  can_generate BOOLEAN;
BEGIN
  -- Get all periods ordered chronologically
  FOR period_record IN
    SELECT id, period_start, period_end, status
    FROM accounting_periods
    WHERE business_id = p_business_id
    ORDER BY period_start ASC
  LOOP
    -- Check if opening balances exist
    IF NOT EXISTS (
      SELECT 1 FROM period_opening_balances
      WHERE period_id = period_record.id
    ) THEN
      -- Find prior period
      SELECT * INTO prior_period_record
      FROM accounting_periods
      WHERE business_id = p_business_id
        AND period_end < period_record.period_start
      ORDER BY period_end DESC
      LIMIT 1;

      -- Determine if we can generate opening balances
      can_generate := FALSE;
      IF prior_period_record.id IS NULL THEN
        -- First period: can generate (bootstrap)
        can_generate := TRUE;
      ELSIF prior_period_record.status = 'locked' THEN
        -- Prior period is locked: can generate rollforward
        can_generate := TRUE;
      ELSE
        -- Prior period not locked: must lock first
        can_generate := FALSE;
      END IF;

      recommendation := jsonb_build_object(
        'period_id', period_record.id,
        'period_start', period_record.period_start,
        'period_end', period_record.period_end,
        'current_status', period_record.status,
        'prior_period_id', prior_period_record.id,
        'prior_period_start', prior_period_record.period_start,
        'prior_period_status', prior_period_record.status,
        'can_generate_opening_balances', can_generate,
        'recommended_action', CASE
          WHEN prior_period_record.id IS NULL THEN 'generate_opening_balances (bootstrap)'
          WHEN prior_period_record.status != 'locked' THEN format('lock prior period first (status: %s)', prior_period_record.status)
          WHEN period_record.status != 'open' THEN format('period must be open to generate opening balances (current: %s)', period_record.status)
          ELSE 'generate_opening_balances (rollforward)'
        END,
        'blocking_reason', CASE
          WHEN prior_period_record.id IS NULL THEN NULL
          WHEN prior_period_record.status != 'locked' THEN format('Prior period must be locked before generating opening balances. Prior period status: %s', prior_period_record.status)
          WHEN period_record.status != 'open' THEN format('Period must be open to generate opening balances. Current status: %s', period_record.status)
          ELSE NULL
        END
      );

      recommendations := array_append(recommendations, recommendation);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'business_id', p_business_id,
    'generated_at', NOW(),
    'periods_missing_opening_balances', jsonb_array_length(to_jsonb(recommendations)),
    'recommendations', recommendations,
    'execution_order', 'Process periods chronologically. For each period: 1) Lock prior period if not locked, 2) Generate opening balances if period is open'
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION recommend_opening_balance_remediation_plan IS 'PHASE 12B: Read-only helper function that returns a recommended chronological plan for generating opening balances. Does NOT auto-generate. Returns execution order and blocking reasons.';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- Backward compatibility restored: ✅ 10-parameter post_journal_entry wrapper
-- Backfill coverage complete: ✅ sales, invoices, expenses, payments
-- All backfilled entries traceable: ✅ entry_type/backfill_reason/backfill_actor + audit log
-- Enhanced legacy detection: ✅ Sales ledger completeness with separate counts per category
-- Opening balances remediation plan: ✅ Read-only helper with suggested order
-- ============================================================================
