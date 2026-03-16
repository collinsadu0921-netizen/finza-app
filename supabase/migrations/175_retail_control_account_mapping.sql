-- ============================================================================
-- MIGRATION: Retail Payment → Control Account Mapping Fix
-- ============================================================================
-- Ensures Retail businesses have CASH control account mapping required for
-- post_sale_to_ledger function.
--
-- Rules:
-- - ONLY creates mapping configuration (no account creation)
-- - Requires account code '1000' to exist in chart_of_accounts
-- - Throws clear error if account doesn't exist (does not auto-create)
-- ============================================================================

-- ============================================================================
-- Helper: Ensure Retail Control Account Mapping
-- ============================================================================
-- Creates control account mapping IF account exists in chart_of_accounts
-- If account exists in accounts table but not chart_of_accounts, syncs it (minimal fix)
-- Does NOT create new accounts - only syncs existing accounts and creates mapping
CREATE OR REPLACE FUNCTION ensure_retail_control_account_mapping(
  p_business_id UUID,
  p_control_key TEXT,
  p_account_code TEXT
)
RETURNS VOID AS $$
DECLARE
  account_in_chart BOOLEAN;
  account_in_legacy RECORD;
  mapping_exists BOOLEAN;
BEGIN
  -- Check if account exists in chart_of_accounts
  SELECT EXISTS (
    SELECT 1
    FROM chart_of_accounts
    WHERE business_id = p_business_id
      AND account_code = p_account_code
      AND is_active = TRUE
  ) INTO account_in_chart;

  -- If not in chart_of_accounts, check if it exists in accounts table (legacy)
  IF NOT account_in_chart THEN
    SELECT name, type INTO account_in_legacy
    FROM accounts
    WHERE business_id = p_business_id
      AND code = p_account_code
      AND deleted_at IS NULL
    LIMIT 1;

    -- If account exists in legacy accounts table, sync to chart_of_accounts
    IF FOUND THEN
      INSERT INTO chart_of_accounts (
        business_id,
        account_code,
        account_name,
        account_type,
        is_active
      ) VALUES (
        p_business_id,
        p_account_code,
        account_in_legacy.name,
        CASE 
          WHEN account_in_legacy.type = 'income' THEN 'revenue'
          ELSE account_in_legacy.type
        END,
        TRUE
      )
      ON CONFLICT (business_id, account_code) DO UPDATE
      SET is_active = TRUE;
      
      account_in_chart := TRUE;
    ELSE
      -- Account doesn't exist in either table - throw clear error
      RAISE EXCEPTION 'Cannot create control account mapping: Account code % does not exist in accounts or chart_of_accounts for business %. Please ensure default accounts are created first.', 
        p_account_code, p_business_id;
    END IF;
  END IF;

  -- Ensure mapping exists
  SELECT EXISTS (
    SELECT 1
    FROM chart_of_accounts_control_map
    WHERE business_id = p_business_id
      AND control_key = p_control_key
  ) INTO mapping_exists;

  -- Create mapping if it doesn't exist
  IF NOT mapping_exists THEN
    INSERT INTO chart_of_accounts_control_map (
      business_id,
      control_key,
      account_code
    ) VALUES (
      p_business_id,
      p_control_key,
      p_account_code
    )
    ON CONFLICT (business_id, control_key) DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ensure_retail_control_account_mapping IS 
  'RETAIL FIX: Ensures control account mapping exists. If account exists in accounts table but not chart_of_accounts, syncs it. Does NOT create new accounts - only syncs existing accounts and creates mapping configuration.';

-- ============================================================================
-- Update: post_sale_to_ledger - Ensure CASH mapping exists before use
-- ============================================================================
-- Add call to ensure_retail_control_account_mapping before get_control_account_code
-- This ensures the mapping exists without modifying posting logic
-- NOTE: Function signature matches migration 171 (4 parameters for backfill support)
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
  total_tax_amount NUMERIC := 0;
  cash_account_code TEXT;
  total_cogs NUMERIC := 0;
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

  -- RETAIL FIX: Ensure CASH control account mapping exists before use
  -- This ensures the mapping is created IF account '1000' exists in chart_of_accounts
  -- Throws clear error if account doesn't exist (does not auto-create account)
  BEGIN
    PERFORM ensure_retail_control_account_mapping(business_id_val, 'CASH', '1000');
  EXCEPTION
    WHEN OTHERS THEN
      -- Re-raise with context about Retail sales requirement
      RAISE EXCEPTION 'Cannot post sale to ledger: % (Business: %, Sale: %)', 
        SQLERRM, business_id_val, p_sale_id;
  END;

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
  -- PHASE 12B: Pass through backfill params if provided
  SELECT post_journal_entry(
    business_id_val,
    sale_record.created_at::DATE,
    'Sale' || COALESCE(': ' || sale_record.description, ''),
    'sale',
    p_sale_id,
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

COMMENT ON FUNCTION post_sale_to_ledger IS 'RETAIL FIX: Posts sale to ledger. Automatically ensures CASH control account mapping exists before posting. Optional p_entry_type, p_backfill_reason, p_backfill_actor for Phase 12 backfill.';
