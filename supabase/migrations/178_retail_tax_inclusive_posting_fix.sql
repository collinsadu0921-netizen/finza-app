-- ============================================================================
-- MIGRATION: Track C2.1 - Retail Sale Tax Posting (Tax-Inclusive Pricing)
-- ============================================================================
-- Fixes journal entry imbalance for Retail sales with tax-inclusive pricing.
--
-- Problem: "Journal entry must balance. Debit: 10, Credit: 8.33"
-- Root Cause: VAT payable not being posted because tax_lines lack ledger_account_code
--
-- Fix:
-- 1. Map tax codes to account codes when ledger_account_code is missing
-- 2. Ensure all tax components are posted as credit lines
-- 3. Use consistent rounding: net_total = ROUND(gross - total_tax, 2)
-- 4. Fallback: If tax_lines missing but total_tax > 0, post to VAT Payable (2100)
--
-- Rules:
-- - For tax-inclusive pricing: gross = sale.amount, net = gross - total_tax
-- - All sales taxes are output taxes (credit side)
-- - Tax codes map to: VAT→2100, NHIL→2110, GETFUND→2120, COVID→2130
-- ============================================================================

-- ============================================================================
-- FUNCTION: Map Tax Code to Ledger Account Code (for Sales)
-- ============================================================================
-- Maps tax codes to their corresponding liability account codes for sales.
-- Sales taxes are always output taxes (credit side).
--
-- Mapping:
-- - VAT → 2100 (VAT Payable)
-- - NHIL → 2110 (NHIL Payable)
-- - GETFUND → 2120 (GETFund Payable)
-- - COVID → 2130 (COVID Payable)
--
CREATE OR REPLACE FUNCTION map_tax_code_to_account_code(p_tax_code TEXT)
RETURNS TEXT AS $$
BEGIN
  CASE UPPER(TRIM(p_tax_code))
    WHEN 'VAT' THEN
      RETURN '2100';
    WHEN 'NHIL' THEN
      RETURN '2110';
    WHEN 'GETFUND' THEN
      RETURN '2120';
    WHEN 'GET FUND' THEN
      RETURN '2120';
    WHEN 'COVID' THEN
      RETURN '2130';
    WHEN 'COVID-19' THEN
      RETURN '2130';
    ELSE
      -- Default to VAT Payable for unknown tax codes
      RETURN '2100';
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION map_tax_code_to_account_code IS 
  'TRACK C2.1: Maps tax codes to ledger account codes for sales. VAT→2100, NHIL→2110, GETFUND→2120, COVID→2130. Defaults to 2100 for unknown codes.';

-- ============================================================================
-- UPDATE: post_sale_to_ledger (Fix Tax-Inclusive Posting)
-- ============================================================================
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
  gross_total NUMERIC;
  net_total NUMERIC;
  total_tax_amount NUMERIC := 0;
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
  vat_payable_account_id UUID;
  effective_date DATE;
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
  gross_total := COALESCE(sale_record.amount, 0);
  effective_date := COALESCE(sale_record.tax_engine_effective_from::DATE, sale_record.created_at::DATE);

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
    -- Handle both formats: object with tax_lines/lines key, or direct array
    IF jsonb_typeof(tax_lines_jsonb) = 'object' THEN
      IF tax_lines_jsonb ? 'tax_lines' THEN
        tax_lines_jsonb := tax_lines_jsonb->'tax_lines';
      ELSIF tax_lines_jsonb ? 'lines' THEN
        tax_lines_jsonb := tax_lines_jsonb->'lines';
      END IF;
    END IF;
    -- Validate it's an array and parse individual tax line items
    IF jsonb_typeof(tax_lines_jsonb) = 'array' THEN
      FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_jsonb)
      LOOP
        -- Defensive validation: ensure tax line has required fields
        IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
          parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
          -- Sum tax amounts to calculate total tax
          total_tax_amount := total_tax_amount + COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- TRACK C2.1 FIX: Calculate net_total with consistent rounding
  -- For tax-inclusive pricing: net = gross - total_tax
  -- Round to 2 decimals to ensure net + tax == gross (within tolerance)
  total_tax_amount := ROUND(total_tax_amount, 2);
  net_total := ROUND(gross_total - total_tax_amount, 2);

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

  -- TRACK C2.1 FIX: Build journal entry lines for tax-inclusive pricing
  -- Debit: CASH = gross_total (tax-inclusive)
  -- Credit: REVENUE = net_total (tax-exclusive)
  -- Credit: TAX PAYABLE = total_tax_amount (if > 0)
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', cash_account_id,
      'debit', gross_total,
      'description', 'Sale receipt'
    ),
    jsonb_build_object(
      'account_id', revenue_account_id,
      'credit', net_total,
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

  -- TRACK C2.1 FIX: Post tax lines (with mapping if ledger_account_code missing)
  -- Sales tax lines are always output taxes (credit side)
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
      IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
        tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
        
        IF tax_account_id IS NULL THEN
          RAISE EXCEPTION 'Tax account (%%) not found for business: %', 
            tax_ledger_account_code, tax_code, business_id_val;
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
          -- Should not happen for sales, but handle for completeness
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
  ELSIF total_tax_amount > 0 THEN
    -- TRACK C2.1 FIX: Fallback - if tax_lines missing but total_tax > 0, post to VAT Payable
    -- This handles cases where tax_lines are not provided but tax was calculated
    vat_payable_account_id := get_account_by_code(business_id_val, '2100');
    
    IF vat_payable_account_id IS NULL THEN
      RAISE EXCEPTION 'VAT Payable account (2100) not found for business: %. Tax-inclusive sale missing tax_lines but has total_tax > 0. Please ensure tax_lines are provided or VAT Payable account exists.', 
        business_id_val;
    END IF;
    
    journal_lines := journal_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', vat_payable_account_id,
        'credit', total_tax_amount,
        'description', 'Tax payable (tax-inclusive sale)'
      )
    );
  END IF;

  -- TRACK C2.1 FIX: Validation - ensure entry balances
  -- For tax-inclusive: gross_total (debit) must equal net_total + total_tax_amount (credits)
  -- Allow small rounding tolerance (0.01)
  IF ABS(gross_total - (net_total + total_tax_amount)) > 0.01 THEN
    RAISE EXCEPTION 'Tax-inclusive sale posting imbalance: gross (%), net (%), tax (%), difference (%). Sale: %', 
      gross_total, net_total, total_tax_amount, ABS(gross_total - (net_total + total_tax_amount)), p_sale_id;
  END IF;

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
    p_backfill_actor
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_sale_to_ledger IS 
  'TRACK C2.1: Posts sale to ledger with correct tax-inclusive pricing. Maps tax codes to account codes when ledger_account_code missing. For tax-inclusive: Cash debit = gross, Revenue credit = net, Tax Payable credit = total_tax. Ensures entry balances. Optional p_entry_type, p_backfill_reason, p_backfill_actor for Phase 12 backfill.';
