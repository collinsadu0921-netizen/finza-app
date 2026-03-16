-- ============================================================================
-- MIGRATION: Track A - Refund Ledger Posting & Sale Posting Idempotency
-- ============================================================================
-- PHASE A1: Implements refund ledger posting to restore completeness invariant
-- PHASE A2: Adds idempotency guard to sale posting to prevent orphaned sales
-- 
-- Scope: INVARIANT VIOLATIONS ONLY
-- Mode: CONTROLLED BATCH (no drift, no shortcuts)
-- ============================================================================

-- ============================================================================
-- PHASE A1: Refund Ledger Posting Function
-- ============================================================================
-- Creates reversal journal entry for refunded sales
-- Reverses: Revenue, Taxes, Cash, COGS, Inventory
-- Enforces: Period open check, double-entry balance, idempotency
-- ============================================================================

CREATE OR REPLACE FUNCTION post_sale_refund_to_ledger(p_sale_id UUID)
RETURNS UUID AS $$
DECLARE
  sale_record RECORD;
  original_journal_entry RECORD;
  business_id_val UUID;
  cash_account_id UUID;
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
  cash_account_code TEXT;
BEGIN
  -- IDEMPOTENCY GUARD: Check if refund journal entry already exists
  -- Reference type: 'sale_refund', reference_id: sale_id
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'sale_refund'
    AND reference_id = p_sale_id
  LIMIT 1;

  IF journal_id IS NOT NULL THEN
    -- Refund already posted - return existing journal entry ID (idempotent)
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
  -- Refunds must be posted in open periods (same as sales)
  PERFORM assert_accounting_period_is_open(business_id_val, sale_record.created_at::DATE);

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

  -- Calculate total COGS from sale_items (same as original sale)
  SELECT COALESCE(SUM(COALESCE(cogs, 0)), 0)
  INTO total_cogs
  FROM sale_items
  WHERE sale_id = p_sale_id;

  -- Parse tax_lines JSONB metadata (same format as original sale)
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

  -- Calculate subtotal: total - sum of all taxes (same as original sale)
  subtotal := COALESCE(sale_record.amount, 0) - total_tax_amount;

  -- COA GUARD: Validate all accounts exist before posting
  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, '4000'); -- Revenue
  IF total_cogs > 0 THEN
    PERFORM assert_account_exists(business_id_val, '5000'); -- COGS Expense
    PERFORM assert_account_exists(business_id_val, '1200'); -- Inventory Asset
  END IF;
  
  -- Validate tax account codes from tax_lines
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  -- Get account IDs using control keys and codes
  cash_account_id := get_account_by_control_key(business_id_val, 'CASH');
  revenue_account_id := get_account_by_code(business_id_val, '4000'); -- Service Revenue
  IF total_cogs > 0 THEN
    cogs_account_id := get_account_by_code(business_id_val, '5000'); -- Cost of Sales
    inventory_account_id := get_account_by_code(business_id_val, '1200'); -- Inventory Asset
  END IF;

  -- Validate all required accounts exist
  IF cash_account_id IS NULL THEN
    RAISE EXCEPTION 'Cash account not found for business: %', business_id_val;
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

  -- Build reversal journal entry lines (opposite of original sale)
  -- Original sale: Cash DEBIT, Revenue CREDIT, COGS DEBIT, Inventory CREDIT, Taxes CREDIT
  -- Refund: Cash CREDIT, Revenue DEBIT, COGS CREDIT, Inventory DEBIT, Taxes DEBIT
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', cash_account_id,
      'credit', sale_record.amount, -- CREDIT (opposite of original DEBIT)
      'description', 'Refund: Sale receipt reversed'
    ),
    jsonb_build_object(
      'account_id', revenue_account_id,
      'debit', subtotal, -- DEBIT (opposite of original CREDIT)
      'description', 'Refund: Sales revenue reversed'
    )
  );

  -- Add COGS and Inventory reversals (only if COGS > 0, same as original sale)
  IF total_cogs > 0 THEN
    journal_lines := journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', cogs_account_id,
        'credit', total_cogs, -- CREDIT (opposite of original DEBIT)
        'description', 'Refund: Cost of goods sold reversed'
      ),
      jsonb_build_object(
        'account_id', inventory_account_id,
        'debit', total_cogs, -- DEBIT (opposite of original CREDIT)
        'description', 'Refund: Inventory restored'
      )
    );
  END IF;

  -- Add tax reversals: iterate parsed_tax_lines and post each reversed
  -- Original sale taxes are CREDIT (output taxes) → Refund taxes are DEBIT (reverse output)
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    tax_ledger_side := tax_line_item->>'ledger_side';

    -- Only post tax lines with ledger_account_code
    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      
      -- Reverse tax journal line: original was CREDIT, refund is DEBIT
      -- For sales, taxes are always output taxes (credit), so refunds are always debit
      IF tax_ledger_side = 'credit' THEN
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'debit', tax_amount, -- DEBIT (opposite of original CREDIT)
            'description', 'Refund: ' || COALESCE(tax_code, 'Tax') || ' tax reversed'
          )
        );
      ELSIF tax_ledger_side = 'debit' THEN
        -- If original was debit (shouldn't happen for sales, but handle for completeness)
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'credit', tax_amount, -- CREDIT (opposite of original DEBIT)
            'description', 'Refund: ' || COALESCE(tax_code, 'Tax') || ' tax reversed'
          )
        );
      END IF;
    END IF;
  END LOOP;

  -- Post reversal journal entry (post_journal_entry validates debits = credits)
  -- EXPLICIT: Use canonical 15-parameter signature with posting_source = 'system'
  -- Refunds are system-generated operations (even if supervisor-approved)
  SELECT post_journal_entry(
    business_id_val,
    sale_record.created_at::DATE, -- Use same date as original sale
    'Refund: Sale' || COALESCE(': ' || sale_record.description, ''),
    'sale_refund', -- Reference type: sale_refund
    p_sale_id, -- Reference ID: sale_id
    journal_lines,
    FALSE,  -- p_is_adjustment
    NULL,   -- p_adjustment_reason
    NULL,   -- p_adjustment_ref
    NULL,   -- p_created_by
    NULL,   -- p_entry_type
    NULL,   -- p_backfill_reason
    NULL,   -- p_backfill_actor
    NULL,   -- p_posted_by_accountant_id (not required for system postings)
    'system'  -- EXPLICIT: Refund postings are system-generated
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_sale_refund_to_ledger IS 
'PHASE A1: Creates reversal journal entry for refunded sales. Reverses Revenue, Taxes, Cash, COGS, and Inventory. Enforces period open check, double-entry balance, and idempotency.';

-- ============================================================================
-- PHASE A2: Add Idempotency Guard to Sale Posting
-- ============================================================================
-- Prevents duplicate journal entries for the same sale
-- Returns existing journal entry ID if already posted (idempotent)
-- NOTE: Function signature matches migration 171 (4 parameters for backfill support)
-- ============================================================================

-- Drop all existing overloads to avoid ambiguity
-- NOTE: Do NOT drop (UUID, UUID) wrapper - it's created by migration 190 and required by app
-- DROP FUNCTION IF EXISTS post_sale_to_ledger(UUID, UUID) CASCADE; -- REMOVED: Preserves wrapper from migration 190
DROP FUNCTION IF EXISTS post_sale_to_ledger(UUID, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS post_sale_to_ledger(UUID) CASCADE;

CREATE OR REPLACE FUNCTION post_sale_to_ledger(
  p_sale_id UUID,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL
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
  cash_account_code TEXT;
  total_cogs NUMERIC := 0;
  total_tax_amount NUMERIC := 0;
BEGIN
  -- IDEMPOTENCY GUARD: Check if journal entry already exists
  -- Reference type: 'sale', reference_id: sale_id
  SELECT id INTO journal_id
  FROM journal_entries
  WHERE reference_type = 'sale'
    AND reference_id = p_sale_id
  LIMIT 1;

  IF journal_id IS NOT NULL THEN
    -- Sale already posted - return existing journal entry ID (idempotent)
    RETURN journal_id;
  END IF;

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

  -- Calculate total COGS from sale_items
  SELECT COALESCE(SUM(COALESCE(cogs, 0)), 0)
  INTO total_cogs
  FROM sale_items
  WHERE sale_id = p_sale_id;

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

  -- COA GUARD: Validate all accounts exist before posting
  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, '4000'); -- Revenue (not a control key)
  PERFORM assert_account_exists(business_id_val, '5000'); -- COGS Expense
  PERFORM assert_account_exists(business_id_val, '1200'); -- Inventory Asset
  
  -- Validate tax account codes from tax_lines
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_ledger_account_code := tax_line_item->>'ledger_account_code';
    IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
      PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
    END IF;
  END LOOP;

  -- Get account IDs using control keys and codes
  cash_account_id := get_account_by_control_key(business_id_val, 'CASH');
  revenue_account_id := get_account_by_code(business_id_val, '4000'); -- Service Revenue (not a control key)
  cogs_account_id := get_account_by_code(business_id_val, '5000'); -- Cost of Sales
  inventory_account_id := get_account_by_code(business_id_val, '1200'); -- Inventory Asset

  -- Validate all required accounts exist
  IF cash_account_id IS NULL THEN
    RAISE EXCEPTION 'Cash account not found for business: %', business_id_val;
  END IF;
  IF revenue_account_id IS NULL THEN
    RAISE EXCEPTION 'Revenue account (4000) not found for business: %', business_id_val;
  END IF;
  IF cogs_account_id IS NULL THEN
    RAISE EXCEPTION 'COGS account (5000) not found for business: %', business_id_val;
  END IF;
  IF inventory_account_id IS NULL THEN
    RAISE EXCEPTION 'Inventory account (1200) not found for business: %', business_id_val;
  END IF;

  -- Build journal entry lines: start with base lines (Cash, Revenue, COGS, Inventory)
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
    ),
    jsonb_build_object(
      'account_id', cogs_account_id,
      'debit', total_cogs,
      'description', 'Cost of goods sold'
    ),
    jsonb_build_object(
      'account_id', inventory_account_id,
      'credit', total_cogs,
      'description', 'Inventory reduction'
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

  -- Post journal entry (post_journal_entry validates debits = credits)
  -- EXPLICIT: Use canonical 15-parameter signature with posting_source = 'system'
  -- Sales are system-generated operations
  SELECT post_journal_entry(
    business_id_val,
    sale_record.created_at::DATE,
    'Sale' || COALESCE(': ' || sale_record.description, ''),
    'sale',
    p_sale_id,
    journal_lines,
    FALSE, -- p_is_adjustment
    NULL,  -- p_adjustment_reason
    NULL,  -- p_adjustment_ref
    NULL,  -- p_created_by
    p_entry_type,      -- p_entry_type (for backfill)
    p_backfill_reason, -- p_backfill_reason
    p_backfill_actor,  -- p_backfill_actor
    NULL,  -- p_posted_by_accountant_id (not required for system postings)
    'system'  -- EXPLICIT: Sale postings are system-generated
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_sale_to_ledger IS 
'PHASE A2: Updated with idempotency guard. Returns existing journal entry ID if sale already posted. Prevents duplicate journal entries and orphaned sales. Maintains 4-parameter signature from migration 171 for backfill support.';
