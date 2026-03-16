-- ============================================================================
-- MIGRATION 180: PERMANENT FIX - Retail Ledger Posting NULL/Zero Credit Prevention
-- ============================================================================
-- Problem: net_total can remain NULL, get coerced to 0 at line 387, validation
-- fails open (NULL <= 0 is NULL, not TRUE), revenue credit becomes 0 → unbalanced journal.
--
-- Solution: Remove silent coercion to zero, compute totals deterministically,
-- add explicit NULL guards (fail closed), enforce accounting invariants.
-- ============================================================================

-- Drop existing function to recreate with fixes
DROP FUNCTION IF EXISTS post_sale_to_ledger(UUID, TEXT, TEXT, TEXT, UUID) CASCADE;

-- Recreate post_sale_to_ledger with NULL-safe total computation
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
  net_total NUMERIC;  -- Will be explicitly set, never allowed to remain NULL
  total_tax_amount NUMERIC;  -- Will be explicitly set, never allowed to remain NULL
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
  cash_account_code TEXT;
  total_cogs NUMERIC := 0;
  vat_payable_account_id UUID;
  effective_date DATE;
  system_accountant_id UUID;
  -- Deterministic extraction variables
  json_net NUMERIC;
  json_tax NUMERIC;
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

  -- ============================================================================
  -- STEP 1: AUTHORITATIVE GROSS TOTAL (from sale_record.amount)
  -- ============================================================================
  gross_total := ROUND(COALESCE(sale_record.amount, 0), 2);
  
  -- Validate gross_total is valid before proceeding
  IF gross_total IS NULL OR gross_total <= 0 THEN
    RAISE EXCEPTION
      'Retail posting error: gross_total invalid (%). Sale amount must be positive. Sale ID: %',
      gross_total, p_sale_id;
  END IF;

  -- ============================================================================
  -- STEP 2: DETERMINISTIC TOTAL COMPUTATION (from tax_lines_jsonb)
  -- ============================================================================
  tax_lines_jsonb := sale_record.tax_lines;
  
  -- Initialize totals to NULL (will be set deterministically)
  net_total := NULL;
  total_tax_amount := NULL;
  json_net := NULL;
  json_tax := NULL;
  
  -- Attempt to read structured totals from tax_lines_jsonb object
  IF tax_lines_jsonb IS NOT NULL AND jsonb_typeof(tax_lines_jsonb) = 'object' THEN
    -- Extract subtotal_excl_tax (net_total)
    IF tax_lines_jsonb ? 'subtotal_excl_tax' THEN
      BEGIN
        -- Try direct numeric extraction first (if value is stored as number)
        IF jsonb_typeof(tax_lines_jsonb->'subtotal_excl_tax') = 'number' THEN
          json_net := (tax_lines_jsonb->'subtotal_excl_tax')::numeric;
        ELSE
          -- Try string extraction and cast
          json_net := (tax_lines_jsonb->>'subtotal_excl_tax')::numeric;
        END IF;
        -- Only set if valid (not NULL and > 0 - revenue cannot be zero)
        IF json_net IS NOT NULL AND json_net > 0 THEN
          net_total := ROUND(json_net, 2);
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          -- Invalid value, leave as NULL (will derive below)
          NULL;
      END;
    END IF;
    
    -- Extract tax_total
    IF tax_lines_jsonb ? 'tax_total' THEN
      BEGIN
        -- Try direct numeric extraction first (if value is stored as number)
        IF jsonb_typeof(tax_lines_jsonb->'tax_total') = 'number' THEN
          json_tax := (tax_lines_jsonb->'tax_total')::numeric;
        ELSE
          -- Try string extraction and cast
          json_tax := (tax_lines_jsonb->>'tax_total')::numeric;
        END IF;
        -- Only set if valid (not NULL and >= 0 - tax can be zero)
        IF json_tax IS NOT NULL AND json_tax >= 0 THEN
          total_tax_amount := ROUND(json_tax, 2);
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          -- Invalid value, leave as NULL (will derive below)
          NULL;
      END;
    END IF;
  END IF;
  
  -- ============================================================================
  -- STEP 3: DERIVE MISSING TOTALS (if one exists, calculate the other)
  -- ============================================================================
  -- If one is missing but the other exists, derive the missing one
  IF net_total IS NULL AND total_tax_amount IS NOT NULL THEN
    net_total := ROUND(gross_total - total_tax_amount, 2);
  END IF;
  
  IF total_tax_amount IS NULL AND net_total IS NOT NULL THEN
    total_tax_amount := ROUND(gross_total - net_total, 2);
  END IF;
  
  -- ============================================================================
  -- STEP 4: FALLBACK - If both missing, try to derive from parsed_tax_lines
  -- ============================================================================
  IF net_total IS NULL AND total_tax_amount IS NULL THEN
    -- Extract tax_lines array for parsing
    IF tax_lines_jsonb IS NOT NULL AND jsonb_typeof(tax_lines_jsonb) = 'object' THEN
      IF tax_lines_jsonb ? 'tax_lines' THEN
        tax_lines_array := tax_lines_jsonb->'tax_lines';
      ELSIF tax_lines_jsonb ? 'lines' THEN
        tax_lines_array := tax_lines_jsonb->'lines';
      END IF;
    ELSIF tax_lines_jsonb IS NOT NULL AND jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      tax_lines_array := tax_lines_jsonb;
    END IF;
    
    -- Sum tax amounts from parsed lines
    IF tax_lines_array IS NOT NULL AND jsonb_typeof(tax_lines_array) = 'array' THEN
      json_tax := 0;  -- Initialize to 0 for summing
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_array)
      LOOP
        IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
          parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
          BEGIN
            json_tax := json_tax + COALESCE((tax_line_item->>'amount')::numeric, 0);
          EXCEPTION
            WHEN OTHERS THEN
              -- Skip invalid amounts
              NULL;
          END;
        END IF;
      END LOOP;
      
      IF json_tax > 0 THEN
        total_tax_amount := ROUND(json_tax, 2);
        net_total := ROUND(gross_total - total_tax_amount, 2);
      END IF;
    END IF;
  END IF;
  
  -- ============================================================================
  -- STEP 5: FINAL FALLBACK - No tax data available (must fail explicitly)
  -- ============================================================================
  -- If both are still NULL, we cannot post (fail closed)
  IF net_total IS NULL OR total_tax_amount IS NULL THEN
    RAISE EXCEPTION
      'Retail posting error: Cannot determine net_total or total_tax_amount from tax_lines. gross_total=%, tax_lines_jsonb=%, sale_id=%. Tax-inclusive sales must provide tax_lines with subtotal_excl_tax and tax_total, or parseable tax_lines array.',
      gross_total, tax_lines_jsonb, p_sale_id;
  END IF;
  
  -- ============================================================================
  -- STEP 6: EXPLICIT NULL GUARDS (fail closed)
  -- ============================================================================
  IF gross_total IS NULL OR gross_total <= 0 THEN
    RAISE EXCEPTION 'Retail posting error: gross_total invalid (%).', gross_total;
  END IF;

  IF net_total IS NULL THEN
    RAISE EXCEPTION 'Retail posting error: net_total is NULL (cannot post). sale_id=%', p_sale_id;
  END IF;

  IF total_tax_amount IS NULL THEN
    RAISE EXCEPTION 'Retail posting error: total_tax_amount is NULL (cannot post). sale_id=%', p_sale_id;
  END IF;

  -- Prevent zero-credit journal (at least one credit must be > 0)
  IF net_total <= 0 AND total_tax_amount <= 0 THEN
    RAISE EXCEPTION 'Retail posting error: net_total and tax_total both non-positive. net=% tax=% sale_id=%',
      net_total, total_tax_amount, p_sale_id;
  END IF;
  
  -- Revenue must be positive (cannot post zero or negative revenue)
  IF net_total <= 0 THEN
    RAISE EXCEPTION 'Retail posting error: net_total (%) is zero or negative. Revenue must be positive. gross_total=%, total_tax_amount=%, sale_id=%',
      net_total, gross_total, total_tax_amount, p_sale_id;
  END IF;

  -- ============================================================================
  -- STEP 7: ENFORCE ACCOUNTING IDENTITY (within tolerance)
  -- ============================================================================
  IF ABS(gross_total - (net_total + total_tax_amount)) > 0.01 THEN
    RAISE EXCEPTION
      'Retail posting error: totals mismatch. gross=% net=% tax=% diff=% sale_id=%',
      gross_total, net_total, total_tax_amount,
      (gross_total - (net_total + total_tax_amount)),
      p_sale_id;
  END IF;

  -- ============================================================================
  -- STEP 8: FINALIZE TOTALS (round to 2 decimal places)
  -- ============================================================================
  gross_total := ROUND(gross_total, 2);
  net_total := ROUND(net_total, 2);
  total_tax_amount := ROUND(total_tax_amount, 2);

  -- ============================================================================
  -- DIAGNOSTIC: Variable assignments after total computation (TEMPORARY)
  -- ============================================================================
  RAISE NOTICE 'EVIDENCE after_total_computation gross_total=%, net_total=%, total_tax_amount=%, tax_lines_jsonb_type=%', 
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

  -- RETAIL FIX: Parse tax_lines array for individual tax line posting
  -- (Re-parse if not already done in fallback step)
  IF array_length(parsed_tax_lines, 1) IS NULL THEN
    IF tax_lines_jsonb IS NOT NULL AND jsonb_typeof(tax_lines_jsonb) = 'object' THEN
      IF tax_lines_jsonb ? 'tax_lines' THEN
        tax_lines_array := tax_lines_jsonb->'tax_lines';
      ELSIF tax_lines_jsonb ? 'lines' THEN
        tax_lines_array := tax_lines_jsonb->'lines';
      ELSE
        tax_lines_array := NULL;
      END IF;
    ELSIF tax_lines_jsonb IS NOT NULL AND jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      tax_lines_array := tax_lines_jsonb;
    ELSE
      tax_lines_array := NULL;
    END IF;
    
    IF tax_lines_array IS NOT NULL AND jsonb_typeof(tax_lines_array) = 'array' THEN
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_array)
      LOOP
        IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
          parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
        END IF;
      END LOOP;
    END IF;
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
  IF array_length(parsed_tax_lines, 1) > 0 THEN
    FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
    LOOP
      tax_ledger_account_code := tax_line_item->>'ledger_account_code';
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
    PERFORM assert_account_exists(business_id_val, '2100');
  END IF;

  -- Get account IDs using control keys and codes
  cash_account_id := get_account_by_control_key(business_id_val, 'CASH');
  revenue_account_id := get_account_by_code(business_id_val, '4000');
  cogs_account_id := get_account_by_code(business_id_val, '5000');
  inventory_account_id := get_account_by_code(business_id_val, '1200');

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

  -- ============================================================================
  -- STEP 9: FINAL VALIDATION BEFORE BUILDING JOURNAL_LINES
  -- ============================================================================
  -- Double-check that totals are still valid (defensive)
  -- This should never trigger if the logic above is correct, but acts as a safety net
  IF net_total IS NULL THEN
    RAISE EXCEPTION 'Retail posting error: net_total is NULL before building journal_lines. This should have been caught earlier. gross_total=%, total_tax_amount=%, sale_id=%',
      gross_total, total_tax_amount, p_sale_id;
  END IF;
  
  IF net_total <= 0 THEN
    RAISE EXCEPTION 'Retail posting error: net_total (%) is zero or negative before building journal_lines. Revenue must be positive. gross_total=%, total_tax_amount=%, sale_id=%',
      net_total, gross_total, total_tax_amount, p_sale_id;
  END IF;
  
  IF total_tax_amount IS NULL THEN
    RAISE EXCEPTION 'Retail posting error: total_tax_amount is NULL before building journal_lines. This should have been caught earlier. net_total=%, gross_total=%, sale_id=%',
      net_total, gross_total, p_sale_id;
  END IF;
  
  IF total_tax_amount < 0 THEN
    RAISE EXCEPTION 'Retail posting error: total_tax_amount (%) is negative before building journal_lines. Tax cannot be negative. net_total=%, gross_total=%, sale_id=%',
      total_tax_amount, net_total, gross_total, p_sale_id;
  END IF;
  
  -- ============================================================================
  -- VALIDATION: Ensure revenue_account_id is not NULL before building journal_lines
  -- ============================================================================
  IF revenue_account_id IS NULL THEN
    RAISE EXCEPTION 'Retail posting error: revenue_account_id is NULL. Cannot create revenue credit line. sale_id=%', p_sale_id;
  END IF;
  
  -- ============================================================================
  -- STEP 10: BUILD BASE JOURNAL_LINES (UNCONDITIONAL - ALWAYS CREATED FIRST)
  -- ============================================================================
  -- INVARIANT: Revenue credit MUST be created unconditionally before any tax logic
  -- Tax logic may only APPEND additional lines, never suppress or replace revenue credit
  -- 
  -- Revenue credit is ALWAYS calculated as: gross_total - total_tax_amount
  -- This ensures revenue credit is NEVER zero when gross_total > 0 and total_tax_amount < gross_total
  -- 
  -- net_total and total_tax_amount are guaranteed non-NULL and valid at this point
  
  -- Calculate revenue credit directly (no intermediate variables to avoid scoping issues)
  -- Revenue credit = gross_total - total_tax_amount (authoritative, unconditional calculation)
  net_total := ROUND(gross_total - total_tax_amount, 2);
  
  -- Final validation: revenue credit must be positive
  IF net_total <= 0 THEN
    RAISE EXCEPTION 'Retail posting error: Revenue credit calculated as % (gross=% tax=%). Revenue must be positive. sale_id=%',
      net_total, gross_total, total_tax_amount, p_sale_id;
  END IF;
  
  -- Build base journal lines (UNCONDITIONAL - created before any tax logic)
  -- Revenue credit is calculated directly in JSONB: gross_total - total_tax_amount
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', cash_account_id,
      'debit', gross_total,  -- Already validated > 0
      'description', 'Sale receipt'
    ),
    jsonb_build_object(
      'account_id', revenue_account_id,
      'credit', ROUND(gross_total - total_tax_amount, 2),  -- DIRECT calculation: gross - tax (unconditional)
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

  -- ============================================================================
  -- DIAGNOSTIC: After base journal_lines build (TEMPORARY)
  -- ============================================================================
  RAISE NOTICE 'EVIDENCE after_base_build net_total=%, total_tax_amount=%, journal_lines=%', 
    net_total, total_tax_amount, journal_lines;
  
  -- TEMPORARY: Verify revenue credit line exists and has correct value
  DECLARE
    revenue_line jsonb;
    revenue_credit_value numeric;
  BEGIN
    SELECT line INTO revenue_line
    FROM jsonb_array_elements(journal_lines) AS line
    WHERE (line->>'account_id')::uuid = revenue_account_id;
    
    IF revenue_line IS NULL THEN
      RAISE EXCEPTION 'DIAGNOSTIC: Revenue credit line not found in journal_lines! revenue_account_id=%, journal_lines=%',
        revenue_account_id, journal_lines;
    END IF;
    
    revenue_credit_value := COALESCE((revenue_line->>'credit')::numeric, 0);
    IF revenue_credit_value = 0 OR revenue_credit_value IS NULL THEN
      RAISE EXCEPTION 'DIAGNOSTIC: Revenue credit value is 0 or NULL! revenue_line=%, net_total=%, journal_lines=%',
        revenue_line, net_total, journal_lines;
    END IF;
    
    RAISE NOTICE 'DIAGNOSTIC: Revenue credit line found - credit=%, account_id=%', 
      revenue_credit_value, revenue_account_id;
  END;
  -- ============================================================================

  -- ============================================================================
  -- STEP 11: APPEND TAX LINES (ONLY APPENDS - NEVER MODIFIES BASE LINES)
  -- ============================================================================
  -- INVARIANT: Tax logic ONLY appends additional journal lines
  -- Base journal_lines (cash, revenue, COGS, inventory) are NEVER modified
  -- Presence of tax_lines must NEVER suppress revenue credit (already created above)
  -- ============================================================================
  
  -- Simple structure: if tax_lines exist, parse and append; otherwise do nothing
  IF tax_lines_jsonb IS NOT NULL THEN
    -- Parse tax lines and append tax credit lines
    IF array_length(parsed_tax_lines, 1) > 0 THEN
      FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
      LOOP
        tax_code := tax_line_item->>'code';
        tax_amount := ROUND(COALESCE((tax_line_item->>'amount')::NUMERIC, 0), 2);
        tax_ledger_account_code := tax_line_item->>'ledger_account_code';
        tax_ledger_side := tax_line_item->>'ledger_side';

        -- Map tax code to account code if missing
        IF (tax_ledger_account_code IS NULL OR tax_ledger_account_code = '') AND tax_code IS NOT NULL THEN
          tax_ledger_account_code := map_tax_code_to_account_code(tax_code);
        END IF;

        -- Default ledger_side to 'credit' for sales
        IF tax_ledger_side IS NULL OR tax_ledger_side = '' THEN
          tax_ledger_side := 'credit';
        END IF;

        -- Post tax line if we have account code and amount > 0
        tax_amount := ROUND(COALESCE(tax_amount, 0), 2);
        
        IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
          tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
          
          IF tax_account_id IS NULL THEN
            RAISE EXCEPTION 'Tax account (%) not found for business: %', 
              tax_ledger_account_code, business_id_val;
          END IF;
          
          -- Build tax journal line (sales taxes are always credit)
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
    END IF;
  ELSE
    -- No tax: do nothing (revenue credit already created in base journal_lines)
    NULL;
  END IF;

  -- ============================================================================
  -- DIAGNOSTIC INSTRUMENTATION (TEMPORARY - REMOVE AFTER ROOT CAUSE ANALYSIS)
  -- ============================================================================
  diag_line_count := 0;
  diag_debit_count := 0;
  diag_credit_count := 0;
  diag_debit_sum := 0;
  diag_credit_sum := 0;
  diag_line_idx := 0;
  
  RAISE NOTICE 'EVIDENCE gross_total=%, net_total=%, tax_total=%, cogs=%', 
    gross_total, net_total, total_tax_amount, total_cogs;
  
  RAISE NOTICE 'EVIDENCE tax_lines_jsonb=%', tax_lines_jsonb;
  RAISE NOTICE 'EVIDENCE parsed_tax_lines_length=%', COALESCE(array_length(parsed_tax_lines, 1), 0);
  RAISE NOTICE 'EVIDENCE journal_lines=%', journal_lines;
  
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
    
    RAISE NOTICE 'EVIDENCE line[%] account_id=% debit=% credit=% desc=%', 
      diag_line_idx + 1,
      diag_line->>'account_id',
      COALESCE((diag_line->>'debit')::NUMERIC, 0),
      COALESCE((diag_line->>'credit')::NUMERIC, 0),
      diag_line->>'description';
  END LOOP;
  
  RAISE NOTICE 'EVIDENCE line_count=%, debit_count=%, credit_count=%, debit_sum=%, credit_sum=%', 
    diag_line_count, diag_debit_count, diag_credit_count, diag_debit_sum, diag_credit_sum;
  
  RAISE NOTICE 'EVIDENCE cash_account_id=%, revenue_account_id=%, cogs_account_id=%, inventory_account_id=%', 
    cash_account_id, revenue_account_id, cogs_account_id, inventory_account_id;
  -- ============================================================================
  -- END DIAGNOSTIC INSTRUMENTATION
  -- ============================================================================

  -- ============================================================================
  -- FINAL VALIDATION: Verify revenue credit exists and is positive before posting
  -- ============================================================================
  -- This MUST pass - if it doesn't, revenue credit is missing or zero
  DECLARE
    final_revenue_line jsonb;
    final_revenue_credit numeric;
    final_total_credits numeric := 0;
  BEGIN
    -- Find revenue credit line
    SELECT line INTO final_revenue_line
    FROM jsonb_array_elements(journal_lines) AS line
    WHERE (line->>'account_id')::uuid = revenue_account_id;
    
    IF final_revenue_line IS NULL THEN
      RAISE EXCEPTION 'CRITICAL: Revenue credit line MISSING from journal_lines! revenue_account_id=%, gross_total=%, total_tax_amount=%, net_total=%, journal_lines=%',
        revenue_account_id, gross_total, total_tax_amount, net_total, journal_lines;
    END IF;
    
    final_revenue_credit := COALESCE((final_revenue_line->>'credit')::numeric, 0);
    IF final_revenue_credit IS NULL OR final_revenue_credit <= 0 THEN
      RAISE EXCEPTION 'CRITICAL: Revenue credit value is % (must be > 0)! revenue_line=%, gross_total=%, total_tax_amount=%, net_total=%, journal_lines=%',
        final_revenue_credit, final_revenue_line, gross_total, total_tax_amount, net_total, journal_lines;
    END IF;
    
    -- Calculate total credits
    SELECT COALESCE(SUM(COALESCE((line->>'credit')::numeric, 0)), 0) INTO final_total_credits
    FROM jsonb_array_elements(journal_lines) AS line;
    
    IF final_total_credits IS NULL OR final_total_credits <= 0 THEN
      RAISE EXCEPTION 'CRITICAL: Total credits in journal_lines is % (must be > 0)! revenue_credit=%, gross_total=%, total_tax_amount=%, journal_lines=%',
        final_total_credits, final_revenue_credit, gross_total, total_tax_amount, journal_lines;
    END IF;
    
    RAISE NOTICE 'FINAL VALIDATION PASSED: revenue_credit=%, total_credits=%, gross_total=%, total_tax_amount=%',
      final_revenue_credit, final_total_credits, gross_total, total_tax_amount;
  END;
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
    p_posted_by_accountant_id
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_sale_to_ledger IS 
'RETAIL FIX: Posts sale to ledger with NULL-safe total computation. Guarantees net_total and total_tax_amount are never NULL, preventing credit=0 journal entries. Uses authoritative gross_total from sale_record.amount and deterministically computes net/tax from tax_lines_jsonb. Fails closed if totals cannot be determined.';
