-- ============================================================================
-- MIGRATION: Retail System Accountant Posting Authorization
-- ============================================================================
-- Allows Retail sales to post to ledger using business owner as system accountant.
-- Business owners are considered accountants per is_user_accountant() function.
--
-- Changes:
-- 1. Add p_posted_by_accountant_id parameter to post_journal_entry
-- 2. Include posted_by_accountant_id in journal_entries INSERT
-- 3. Add p_posted_by_accountant_id parameter to post_sale_to_ledger
-- 4. Pass business owner ID to post_journal_entry
-- ============================================================================

-- ============================================================================
-- STEP 1: Drop all existing post_journal_entry overloads
-- ============================================================================
-- Drop all existing overloads explicitly to avoid ambiguity
-- Use CASCADE to drop dependent functions (like the 10-parameter wrapper)
DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID) CASCADE;
DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID) CASCADE;
DROP FUNCTION IF EXISTS post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB) CASCADE;

-- ============================================================================
-- STEP 2: Create 14-parameter post_journal_entry (with posted_by_accountant_id)
-- ============================================================================

-- Create the 14-parameter version (use CREATE OR REPLACE for idempotency)
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
DECLARE
  journal_id UUID;
  line JSONB;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  account_id UUID;
  system_accountant_id UUID;
BEGIN
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

  -- RETAIL FIX: If posted_by_accountant_id not provided, use business owner as system accountant
  IF p_posted_by_accountant_id IS NULL THEN
    SELECT owner_id INTO system_accountant_id
    FROM businesses
    WHERE id = p_business_id;
    
    IF system_accountant_id IS NULL THEN
      RAISE EXCEPTION 'Cannot post journal entry: Business owner not found for business %. System accountant required for automatic posting.', p_business_id;
    END IF;
    
    p_posted_by_accountant_id := system_accountant_id;
  END IF;

  PERFORM assert_accounting_period_is_open(p_business_id, p_date, p_is_adjustment);

  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    total_debit := total_debit + COALESCE((line->>'debit')::NUMERIC, 0);
    total_credit := total_credit + COALESCE((line->>'credit')::NUMERIC, 0);
  END LOOP;

  IF ABS(total_debit - total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry must balance. Debit: %, Credit: %', total_debit, total_credit;
  END IF;

  -- Create journal entry (including posted_by_accountant_id for authorization)
  INSERT INTO journal_entries (
    business_id,
    date,
    description,
    reference_type,
    reference_id,
    is_adjustment,
    adjustment_reason,
    adjustment_ref,
    created_by,
    entry_type,
    backfill_reason,
    backfill_at,
    backfill_actor,
    posted_by_accountant_id
  )
  VALUES (
    p_business_id,
    p_date,
    p_description,
    p_reference_type,
    p_reference_id,
    p_is_adjustment,
    p_adjustment_reason,
    p_adjustment_ref,
    p_created_by,
    CASE WHEN p_entry_type = 'backfill' THEN 'backfill' ELSE NULL END,
    CASE WHEN p_entry_type = 'backfill' THEN p_backfill_reason ELSE NULL END,
    CASE WHEN p_entry_type = 'backfill' THEN NOW() ELSE NULL END,
    CASE WHEN p_entry_type = 'backfill' THEN p_backfill_actor ELSE NULL END,
    p_posted_by_accountant_id
  )
  RETURNING id INTO journal_id;

  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    account_id := (line->>'account_id')::UUID;
    IF account_id IS NULL THEN
      RAISE EXCEPTION 'Account ID is NULL in journal entry line. Description: %', line->>'description';
    END IF;
    
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

COMMENT ON FUNCTION post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID) IS 
'RETAIL FIX: Posts journal entry with accountant authorization. If p_posted_by_accountant_id is NULL, uses business owner as system accountant. Business owners are considered accountants per is_user_accountant() function.';

-- ============================================================================
-- STEP 3: Recreate 10-parameter wrapper (for backward compatibility)
-- ============================================================================
-- Recreate the 10-parameter wrapper from migration 172, updated to pass NULL for posted_by_accountant_id

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
  -- Call the 14-parameter version with explicit parameter names to avoid ambiguity
  -- Pass NULL for posted_by_accountant_id (will default to business owner)
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
    p_posted_by_accountant_id => NULL::UUID
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_journal_entry(UUID, DATE, TEXT, TEXT, UUID, JSONB, BOOLEAN, TEXT, TEXT, UUID) IS 
'PHASE 12B: Backward compatibility wrapper for 10-parameter post_journal_entry. Calls 14-parameter version with trailing NULLs. RETAIL FIX: Updated to include posted_by_accountant_id parameter.';

-- ============================================================================
-- UPDATE: post_sale_to_ledger (Add posted_by_accountant_id parameter)
-- ============================================================================
-- Drop all existing overloads explicitly to avoid ambiguity
-- Note: With default parameters, PostgreSQL may have created multiple implicit overloads
DROP FUNCTION IF EXISTS post_sale_to_ledger(UUID, TEXT, TEXT, TEXT, UUID) CASCADE; -- 5-parameter (if exists)
DROP FUNCTION IF EXISTS post_sale_to_ledger(UUID, TEXT, TEXT, TEXT) CASCADE; -- 4-parameter
DROP FUNCTION IF EXISTS post_sale_to_ledger(UUID) CASCADE; -- 1-parameter

-- Create the 5-parameter version (with posted_by_accountant_id)
CREATE OR REPLACE FUNCTION post_sale_to_ledger(
  p_sale_id UUID,
  p_entry_type TEXT DEFAULT NULL,
  p_backfill_reason TEXT DEFAULT NULL,
  p_backfill_actor TEXT DEFAULT NULL,
  p_posted_by_accountant_id UUID DEFAULT NULL
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
  gross_total NUMERIC;
  net_total NUMERIC;
  total_tax_amount NUMERIC := 0;
  tax_lines_jsonb JSONB;
  tax_lines_array JSONB;  -- Extracted array for parsing individual tax lines
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
  vat_payable_account_id UUID;
  effective_date DATE;
  system_accountant_id UUID;
  -- Diagnostic variables (TEMPORARY - REMOVE AFTER ROOT CAUSE ANALYSIS)
  diag_line_count INT;
  diag_debit_count INT;
  diag_credit_count INT;
  diag_debit_sum NUMERIC;
  diag_credit_sum NUMERIC;
  diag_line JSONB;
  diag_line_idx INT;
BEGIN
  -- Get sale details
  SELECT 
    s.business_id,
    s.amount,
    s.created_at,
    s.description,
    s.tax_lines,
    s.tax_engine_effective_from
  INTO sale_record
  FROM sales s
  WHERE s.id = p_sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found: %', p_sale_id;
  END IF;

  business_id_val := sale_record.business_id;
  effective_date := COALESCE(sale_record.tax_engine_effective_from::DATE, sale_record.created_at::DATE);

  -- RETAIL FIX: Use sale_record.amount as AUTHORITATIVE source for gross_total
  -- This is what the customer actually paid at checkout (e.g. 100.00 exactly)
  -- Frontend now uses integer cents to prevent floating-point errors
  gross_total := COALESCE(sale_record.amount, 0);
  
  -- Validate gross_total is valid before proceeding
  IF gross_total <= 0 THEN
    RAISE EXCEPTION
      'Retail posting error: gross_total invalid (%). Sale amount must be positive. Sale ID: %',
      gross_total, p_sale_id;
  END IF;

  -- Round to 2 decimal places (authoritative amount from frontend)
  gross_total := ROUND(gross_total, 2);

  -- RETAIL FIX: Extract tax-inclusive totals from canonical JSONB values
  -- For Retail, tax_lines JSONB is an object with pre-calculated totals:
  -- { tax_lines: [...], subtotal_excl_tax: 83.34, tax_total: 16.66, total_incl_tax: 100.00 }
  tax_lines_jsonb := sale_record.tax_lines;

  -- Extract net_total and total_tax_amount from JSONB (if available)
  -- But ALWAYS use gross_total from sale_record.amount as authoritative
  IF tax_lines_jsonb IS NOT NULL AND jsonb_typeof(tax_lines_jsonb) = 'object' THEN
    -- Extract subtotal_excl_tax (net_total)
    IF tax_lines_jsonb ? 'subtotal_excl_tax' THEN
      BEGIN
        net_total := (tax_lines_jsonb->>'subtotal_excl_tax')::numeric;
        IF net_total IS NULL OR net_total < 0 THEN
          -- If invalid, calculate from gross_total and tax_total
          IF tax_lines_jsonb ? 'tax_total' THEN
            BEGIN
              total_tax_amount := (tax_lines_jsonb->>'tax_total')::numeric;
              IF total_tax_amount IS NULL OR total_tax_amount < 0 THEN
                total_tax_amount := 0;
              END IF;
            EXCEPTION
              WHEN OTHERS THEN
                total_tax_amount := 0;
            END;
            net_total := gross_total - total_tax_amount;
          ELSE
            net_total := gross_total;
            total_tax_amount := 0;
          END IF;
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          net_total := gross_total;
          total_tax_amount := 0;
      END;
    ELSE
      -- No subtotal_excl_tax, try to extract tax_total and calculate net
      IF tax_lines_jsonb ? 'tax_total' THEN
        BEGIN
          total_tax_amount := (tax_lines_jsonb->>'tax_total')::numeric;
          IF total_tax_amount IS NULL OR total_tax_amount < 0 THEN
            total_tax_amount := 0;
          END IF;
        EXCEPTION
          WHEN OTHERS THEN
            total_tax_amount := 0;
        END;
        net_total := gross_total - total_tax_amount;
      ELSE
        -- No tax data, assume all revenue (no tax)
        net_total := gross_total;
        total_tax_amount := 0;
      END IF;
    END IF;

    -- Extract tax_total if not already set
    IF total_tax_amount IS NULL OR total_tax_amount = 0 THEN
      IF tax_lines_jsonb ? 'tax_total' THEN
        BEGIN
          total_tax_amount := (tax_lines_jsonb->>'tax_total')::numeric;
          IF total_tax_amount IS NULL OR total_tax_amount < 0 THEN
            total_tax_amount := 0;
          END IF;
        EXCEPTION
          WHEN OTHERS THEN
            total_tax_amount := 0;
        END;
      END IF;
    END IF;
  ELSE
    -- No tax_lines JSONB, assume all revenue (no tax)
    net_total := gross_total;
    total_tax_amount := 0;
  END IF;

  -- FINALIZE TOTALS (SINGLE SOURCE OF TRUTH)
  -- Round all values to 2 decimal places
  gross_total := ROUND(gross_total, 2);
  net_total := ROUND(COALESCE(net_total, gross_total), 2);
  total_tax_amount := ROUND(COALESCE(total_tax_amount, 0), 2);

  -- HARD VALIDATION: Ensure totals are consistent
  -- For tax-inclusive: gross_total = net_total + total_tax_amount (within rounding tolerance)
  -- Recalculate net_total if needed to ensure balance
  IF ABS(gross_total - (net_total + total_tax_amount)) > 0.01 THEN
    -- Recalculate net_total to ensure balance (gross_total is authoritative)
    net_total := gross_total - total_tax_amount;
    net_total := ROUND(net_total, 2);
  END IF;

  -- Final NULL guards (defensive)
  gross_total := COALESCE(gross_total, 0);
  net_total := COALESCE(net_total, 0);
  total_tax_amount := COALESCE(total_tax_amount, 0);

  -- ============================================================================
  -- DIAGNOSTIC: Variable assignments after tax extraction (TEMPORARY)
  -- ============================================================================
  RAISE NOTICE 'EVIDENCE after_tax_extraction gross_total=%, net_total=%, total_tax_amount=%, tax_lines_jsonb_type=%', 
    gross_total, net_total, total_tax_amount, 
    CASE WHEN tax_lines_jsonb IS NULL THEN 'NULL' ELSE jsonb_typeof(tax_lines_jsonb) END;
  -- ============================================================================

  -- RETAIL FIX: Resolve system accountant (business owner) if not provided
  IF p_posted_by_accountant_id IS NULL THEN
    SELECT owner_id INTO system_accountant_id
    FROM businesses
    WHERE id = business_id_val;
    
    IF system_accountant_id IS NULL THEN
      RAISE EXCEPTION 'Cannot post sale to ledger: Business owner not found for business %. System accountant required for automatic posting.', business_id_val;
    END IF;
    
    p_posted_by_accountant_id := system_accountant_id;
  END IF;

  -- GUARD: Assert accounting period is open
  PERFORM assert_accounting_period_is_open(business_id_val, sale_record.created_at::DATE);

  -- Calculate total COGS from sale_items
  SELECT COALESCE(SUM(COALESCE(cogs, 0)), 0)
  INTO total_cogs
  FROM sale_items
  WHERE sale_id = p_sale_id;

  -- HARD GUARD: ensure total_cogs is never NULL
  total_cogs := COALESCE(total_cogs, 0);
  total_cogs := ROUND(total_cogs, 2);

  -- VALIDATION: Ensure tax-inclusive totals are present and valid (after rounding)
  -- Credits must be > 0: either revenue (net_total) OR tax (total_tax_amount) must be non-zero
  -- Since gross_total is authoritative and > 0, at least one credit must be > 0
  IF net_total <= 0 AND total_tax_amount <= 0 THEN
    RAISE EXCEPTION
      'Retail posting error: net_total (%) and tax_total (%) both zero or negative after normalization. Tax-inclusive totals missing or malformed. Gross: %, Sale ID: %. This should never happen - gross_total is positive.',
      net_total, total_tax_amount, gross_total, p_sale_id;
  END IF;

  -- VALIDATION: Ensure gross_total is valid (already checked earlier, but double-check)
  IF gross_total <= 0 THEN
    RAISE EXCEPTION
      'Retail posting error: gross_total (%) is zero or negative. Sale amount invalid. Sale ID: %',
      gross_total, p_sale_id;
  END IF;

  -- VALIDATION: Ensure net_total is positive (revenue cannot be zero or negative)
  IF net_total <= 0 THEN
    RAISE EXCEPTION
      'Retail posting error: net_total (%) is zero or negative. Revenue must be positive. Gross: %, Tax: %, Sale ID: %',
      net_total, gross_total, total_tax_amount, p_sale_id;
  END IF;

  -- VALIDATION: Ensure total_tax_amount is non-negative (can be zero if no tax)
  IF total_tax_amount < 0 THEN
    RAISE EXCEPTION
      'Retail posting error: tax_total (%) is negative. Tax amount invalid. Gross: %, Net: %, Sale ID: %',
      total_tax_amount, gross_total, net_total, p_sale_id;
  END IF;

  -- RETAIL FIX: Parse tax_lines array for individual tax line posting
  -- Note: Totals are already extracted from canonical JSONB values above
  -- This parsing is only for building individual tax credit lines
  IF tax_lines_jsonb IS NOT NULL AND jsonb_typeof(tax_lines_jsonb) = 'object' THEN
    -- Extract tax_lines array from object (for individual line parsing)
    IF tax_lines_jsonb ? 'tax_lines' THEN
      tax_lines_array := tax_lines_jsonb->'tax_lines';
    ELSIF tax_lines_jsonb ? 'lines' THEN
      tax_lines_array := tax_lines_jsonb->'lines';
    ELSE
      tax_lines_array := NULL;
    END IF;
  ELSIF tax_lines_jsonb IS NOT NULL AND jsonb_typeof(tax_lines_jsonb) = 'array' THEN
    -- Handle legacy format: direct array (fallback)
    tax_lines_array := tax_lines_jsonb;
  ELSE
    tax_lines_array := NULL;
  END IF;

  -- Parse individual tax line items for posting (totals already normalized above)
  IF tax_lines_array IS NOT NULL AND jsonb_typeof(tax_lines_array) = 'array' THEN
    FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_array)
    LOOP
      -- Defensive validation: ensure tax line has required fields
      IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
        parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
        -- Note: total_tax_amount already extracted from canonical JSONB above
        -- We don't sum here - we use the authoritative value
      END IF;
    END LOOP;
  END IF;

  -- RETAIL FIX: Ensure CASH control account mapping exists before use
  BEGIN
    PERFORM ensure_retail_control_account_mapping(business_id_val, 'CASH', '1000');
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'Cannot post sale to ledger: % (Business: %, Sale: %)', 
        SQLERRM, business_id_val, p_sale_id;
  END;

  -- COA GUARD: Validate all accounts exist before posting
  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, '4000'); -- Revenue (not a control key)
  PERFORM assert_account_exists(business_id_val, '5000'); -- COGS Expense
  PERFORM assert_account_exists(business_id_val, '1200'); -- Inventory Asset
  
  -- Validate tax account codes (will be used for posting)
  -- Check if any tax lines exist - if yes, validate their account codes
  IF array_length(parsed_tax_lines, 1) > 0 THEN
    FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
    LOOP
      tax_ledger_account_code := tax_line_item->>'ledger_account_code';
      -- If ledger_account_code missing, map from tax code
      IF tax_ledger_account_code IS NULL OR tax_ledger_account_code = '' THEN
        tax_code := tax_line_item->>'code';
        IF tax_code IS NOT NULL THEN
          tax_ledger_account_code := map_tax_code_to_account_code(tax_code);
        END IF;
      END IF;
      
      IF tax_ledger_account_code IS NOT NULL AND COALESCE((tax_line_item->>'amount')::NUMERIC, 0) > 0 THEN
        PERFORM assert_account_exists(business_id_val, tax_ledger_account_code);
      END IF;
    END LOOP;
  ELSIF total_tax_amount > 0 THEN
    -- TRACK C2.1 FIX: If tax_lines missing but total_tax > 0, validate VAT Payable account
    PERFORM assert_account_exists(business_id_val, '2100');
  END IF;

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

  -- VALIDATION: Final check before building journal lines
  -- Ensure credit values are positive (at least one must be > 0)
  -- This is a redundant check but ensures we fail fast if something went wrong
  IF net_total <= 0 AND total_tax_amount <= 0 THEN
    RAISE EXCEPTION
      'Retail posting error: Cannot build journal lines. net_total (%) and tax_total (%) both zero or negative. Gross: %, Sale ID: %. Tax JSONB: %. This should have been caught earlier.',
      net_total, total_tax_amount, gross_total, p_sale_id, tax_lines_jsonb;
  END IF;

  -- VALIDATION: Ensure balance equation holds (gross = net + tax, within rounding tolerance)
  IF ABS(gross_total - (net_total + total_tax_amount)) > 0.01 THEN
    RAISE EXCEPTION
      'Retail posting error: Totals do not balance. Gross: %, Net: %, Tax: %, Difference: %. Sale ID: %. This indicates a calculation error.',
      gross_total, net_total, total_tax_amount, ABS(gross_total - (net_total + total_tax_amount)), p_sale_id;
  END IF;

  -- TRACK C2.1 FIX: Build journal entry lines for tax-inclusive pricing
  -- Debit: CASH = gross_total (tax-inclusive) - AUTHORITATIVE from sale_record.amount
  -- Credit: REVENUE = net_total (tax-exclusive) - MUST be > 0
  -- Credit: TAX PAYABLE = total_tax_amount (if > 0)
  -- NOTE: net_total and total_tax_amount are validated to ensure at least one is > 0
  -- FIX: Ensure all amounts are rounded and never NULL
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', cash_account_id,
      'debit', ROUND(COALESCE(gross_total, 0), 2),
      'description', 'Sale receipt'
    ),
    jsonb_build_object(
      'account_id', revenue_account_id,
      'credit', ROUND(COALESCE(net_total, 0), 2),  -- Validated to be > 0
      'description', 'Sales revenue'
    ),
    jsonb_build_object(
      'account_id', cogs_account_id,
      'debit', ROUND(COALESCE(total_cogs, 0), 2),
      'description', 'Cost of goods sold'
    ),
    jsonb_build_object(
      'account_id', inventory_account_id,
      'credit', ROUND(COALESCE(total_cogs, 0), 2),
      'description', 'Inventory reduction'
    )
  );

  -- ============================================================================
  -- DIAGNOSTIC: After initial journal_lines build (TEMPORARY)
  -- ============================================================================
  RAISE NOTICE 'EVIDENCE after_initial_build net_total=%, total_tax_amount=%, journal_lines=%', 
    net_total, total_tax_amount, journal_lines;
  -- ============================================================================

  -- TRACK C2.1 FIX: Post tax lines (with mapping if ledger_account_code missing)
  -- Sales tax lines are always output taxes (credit side)
  -- ============================================================================
  -- DIAGNOSTIC: Tax line posting branch decision (TEMPORARY)
  -- ============================================================================
  RAISE NOTICE 'EVIDENCE tax_posting_branch parsed_tax_lines_length=%, total_tax_amount=%', 
    COALESCE(array_length(parsed_tax_lines, 1), 0), total_tax_amount;
  -- ============================================================================
  
  IF array_length(parsed_tax_lines, 1) > 0 THEN
    FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
    LOOP
      tax_code := tax_line_item->>'code';
      tax_amount := ROUND(COALESCE((tax_line_item->>'amount')::NUMERIC, 0), 2);
      tax_ledger_account_code := tax_line_item->>'ledger_account_code';
      tax_ledger_side := tax_line_item->>'ledger_side';

      -- TRACK C2.1 FIX: Map tax code to account code if ledger_account_code missing
      IF (tax_ledger_account_code IS NULL OR tax_ledger_account_code = '') AND tax_code IS NOT NULL THEN
        tax_ledger_account_code := map_tax_code_to_account_code(tax_code);
      END IF;

      -- TRACK C2.1 FIX: For sales, all taxes are output taxes (credit side)
      -- If ledger_side is missing, default to 'credit' for sales
      IF tax_ledger_side IS NULL OR tax_ledger_side = '' THEN
        tax_ledger_side := 'credit';
      END IF;

      -- Post tax line if we have account code and amount > 0
      -- FIX: Ensure tax_amount is rounded and never NULL
      tax_amount := ROUND(COALESCE(tax_amount, 0), 2);
      
      IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
        tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
        
        IF tax_account_id IS NULL THEN
          RAISE EXCEPTION 'Tax account (%) not found for business: %', 
            tax_ledger_account_code, business_id_val;
        END IF;
        
        -- Build tax journal line (sales taxes are always credit)
        -- FIX: Ensure credit amount is never NULL or zero
        IF tax_ledger_side = 'credit' THEN
          journal_lines := journal_lines || jsonb_build_array(
            jsonb_build_object(
              'account_id', tax_account_id,
              'credit', tax_amount,  -- Already rounded and validated > 0
              'description', COALESCE(tax_code, 'Tax') || ' tax'
            )
          );
        ELSIF tax_ledger_side = 'debit' THEN
          -- Should not happen for sales, but handle for completeness
          journal_lines := journal_lines || jsonb_build_array(
            jsonb_build_object(
              'account_id', tax_account_id,
              'debit', tax_amount,  -- Already rounded
              'description', COALESCE(tax_code, 'Tax') || ' tax'
            )
          );
        END IF;
      END IF;
    END LOOP;
    -- ============================================================================
    -- DIAGNOSTIC: After parsed_tax_lines loop (TEMPORARY)
    -- ============================================================================
    RAISE NOTICE 'EVIDENCE after_parsed_tax_loop journal_lines=%', journal_lines;
    -- ============================================================================
  ELSIF total_tax_amount > 0 THEN
    -- TRACK C2.1 FIX: Fallback - if tax_lines missing but total_tax > 0, post to VAT Payable
    -- This handles cases where tax_lines are not provided but tax was calculated
    -- FIX: Ensure total_tax_amount is rounded and never NULL
    total_tax_amount := ROUND(COALESCE(total_tax_amount, 0), 2);
    
    IF total_tax_amount > 0 THEN
      vat_payable_account_id := get_account_by_code(business_id_val, '2100');
      
      IF vat_payable_account_id IS NULL THEN
        RAISE EXCEPTION 'VAT Payable account (2100) not found for business: %. Tax-inclusive sale missing tax_lines but has total_tax > 0. Please ensure tax_lines are provided or VAT Payable account exists.', 
          business_id_val;
      END IF;
      
      journal_lines := journal_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', vat_payable_account_id,
          'credit', total_tax_amount,  -- Already rounded and validated > 0
          'description', 'Tax payable (tax-inclusive sale)'
        )
      );
    END IF;
    -- ============================================================================
    -- DIAGNOSTIC: After fallback tax payable (TEMPORARY)
    -- ============================================================================
    RAISE NOTICE 'EVIDENCE after_fallback_tax journal_lines=%', journal_lines;
    -- ============================================================================
  END IF;

  -- TRACK C2.1 FIX: Final validation - ensure entry balances
  -- For tax-inclusive: gross_total (debit) must equal net_total + total_tax_amount (credits)
  -- Allow small rounding tolerance (0.01)
  -- This is a redundant check (already validated earlier) but ensures we catch any issues before posting
  IF ABS(gross_total - (net_total + total_tax_amount)) > 0.01 THEN
    RAISE EXCEPTION 'Tax-inclusive sale posting imbalance: gross (%), net (%), tax (%), difference (%). Sale: %. This should have been caught earlier.', 
      gross_total, net_total, total_tax_amount, ABS(gross_total - (net_total + total_tax_amount)), p_sale_id;
  END IF;

  -- ============================================================================
  -- DIAGNOSTIC INSTRUMENTATION (TEMPORARY - REMOVE AFTER ROOT CAUSE ANALYSIS)
  -- ============================================================================
  -- Capture evidence immediately before calling post_journal_entry
  
  -- Initialize diagnostic counters
  diag_line_count := 0;
  diag_debit_count := 0;
  diag_credit_count := 0;
  diag_debit_sum := 0;
  diag_credit_sum := 0;
  diag_line_idx := 0;
  
  -- Output totals
  RAISE NOTICE 'EVIDENCE gross_total=%, net_total=%, tax_total=%, cogs=%', 
    gross_total, net_total, total_tax_amount, total_cogs;
  
  -- Output tax_lines_jsonb
  RAISE NOTICE 'EVIDENCE tax_lines_jsonb=%', tax_lines_jsonb;
  
  -- Output parsed_tax_lines array length
  RAISE NOTICE 'EVIDENCE parsed_tax_lines_length=%', COALESCE(array_length(parsed_tax_lines, 1), 0);
  
  -- Output full journal_lines JSON
  RAISE NOTICE 'EVIDENCE journal_lines=%', journal_lines;
  
  -- Count lines and calculate sums
  diag_line_count := jsonb_array_length(journal_lines);
  FOR diag_line_idx IN 0..(diag_line_count - 1)
  LOOP
    diag_line := journal_lines->diag_line_idx;
    IF COALESCE((diag_line->>'debit')::NUMERIC, 0) > 0 THEN
      diag_debit_count := diag_debit_count + 1;
      diag_debit_sum := diag_debit_sum + COALESCE((diag_line->>'debit')::NUMERIC, 0);
    END IF;
    IF COALESCE((diag_line->>'credit')::NUMERIC, 0) > 0 THEN
      diag_credit_count := diag_credit_count + 1;
      diag_credit_sum := diag_credit_sum + COALESCE((diag_line->>'credit')::NUMERIC, 0);
    END IF;
    
    -- Output per-line evidence
    RAISE NOTICE 'EVIDENCE line[%] account_id=% debit=% credit=% desc=%', 
      diag_line_idx + 1,
      diag_line->>'account_id',
      COALESCE((diag_line->>'debit')::NUMERIC, 0),
      COALESCE((diag_line->>'credit')::NUMERIC, 0),
      diag_line->>'description';
  END LOOP;
  
  -- Output summary counts and sums
  RAISE NOTICE 'EVIDENCE line_count=%, debit_count=%, credit_count=%, debit_sum=%, credit_sum=%', 
    diag_line_count, diag_debit_count, diag_credit_count, diag_debit_sum, diag_credit_sum;
  
  -- Output account IDs for verification
  RAISE NOTICE 'EVIDENCE cash_account_id=%, revenue_account_id=%, cogs_account_id=%, inventory_account_id=%', 
    cash_account_id, revenue_account_id, cogs_account_id, inventory_account_id;
  
  -- TEMPORARY: Log to diagnostic table (queryable)
  BEGIN
    INSERT INTO diagnostic_journal_lines_log (
      sale_id, gross_total, net_total, total_tax_amount, journal_lines,
      cash_account_id, revenue_account_id, cogs_account_id, inventory_account_id
    ) VALUES (
      p_sale_id, gross_total, net_total, total_tax_amount, journal_lines,
      cash_account_id, revenue_account_id, cogs_account_id, inventory_account_id
    );
  EXCEPTION
    WHEN undefined_table THEN
      -- Table doesn't exist, skip logging
      NULL;
  END;
  -- ============================================================================
  -- END DIAGNOSTIC INSTRUMENTATION
  -- ============================================================================

  -- ============================================================================
  -- DEBUG LOG: Capture evidence before post_journal_entry() call
  -- ============================================================================
  -- This logging is REMOVABLE after root cause is proven
  -- Captures exact state of journal_lines before posting
  BEGIN
    INSERT INTO public.retail_posting_debug_log (
      sale_id,
      business_id,
      gross_total,
      net_total,
      total_tax_amount,
      total_cogs,
      tax_lines_jsonb,
      journal_lines,
      line_count,
      debit_sum,
      credit_sum,
      credit_count,
      tax_shape,
      note
    ) VALUES (
      p_sale_id,
      business_id_val,
      gross_total,
      net_total,
      total_tax_amount,
      total_cogs,
      tax_lines_jsonb,
      journal_lines,
      COALESCE(jsonb_array_length(journal_lines), 0),
      COALESCE((
        SELECT SUM(COALESCE((line->>'debit')::numeric, 0))
        FROM jsonb_array_elements(COALESCE(journal_lines, '[]'::jsonb)) AS line
      ), 0),
      COALESCE((
        SELECT SUM(COALESCE((line->>'credit')::numeric, 0))
        FROM jsonb_array_elements(COALESCE(journal_lines, '[]'::jsonb)) AS line
      ), 0),
      COALESCE((
        SELECT COUNT(*)
        FROM jsonb_array_elements(COALESCE(journal_lines, '[]'::jsonb)) AS line
        WHERE COALESCE((line->>'credit')::numeric, 0) > 0
      ), 0),
      CASE
        WHEN tax_lines_jsonb IS NULL THEN 'null'
        WHEN jsonb_typeof(tax_lines_jsonb) = 'object' THEN 'object'
        WHEN jsonb_typeof(tax_lines_jsonb) = 'array' THEN 'array'
        ELSE 'other'
      END,
      'Logged immediately before post_journal_entry() call'
    );
  EXCEPTION
    WHEN undefined_table THEN
      -- Debug table doesn't exist yet (migration 181 not applied), skip silently
      NULL;
    WHEN OTHERS THEN
      -- Any other error should not break posting, log and continue
      -- Use RAISE NOTICE instead of RAISE EXCEPTION to avoid breaking the function
      RAISE NOTICE 'DEBUG LOG ERROR (non-fatal): %', SQLERRM;
  END;
  -- ============================================================================
  -- END DEBUG LOG
  -- ============================================================================

  -- Post journal entry (post_journal_entry validates debits = credits)
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
    p_backfill_actor,
    p_posted_by_accountant_id  -- RETAIL FIX: Pass system accountant ID
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_sale_to_ledger IS 
'RETAIL FIX: Posts sale to ledger with system accountant authorization. Uses business owner as system accountant if p_posted_by_accountant_id not provided. Business owners are considered accountants per is_user_accountant() function. Optional p_entry_type, p_backfill_reason, p_backfill_actor for Phase 12 backfill.';
