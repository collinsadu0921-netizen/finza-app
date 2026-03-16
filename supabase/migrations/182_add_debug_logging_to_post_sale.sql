-- ============================================================================
-- Migration 182: Add Debug Logging to post_sale_to_ledger (Evidence Capture)
-- ============================================================================
-- This migration adds debug logging to the active post_sale_to_ledger function
-- to capture evidence of journal_lines before post_journal_entry() call.
-- 
-- REMOVABLE: This logging can be removed after root cause is proven
-- ============================================================================

-- Get the current function definition and add logging
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
  gross_total := COALESCE(sale_record.amount, 0);
  
  IF gross_total <= 0 THEN
    RAISE EXCEPTION
      'Retail posting error: gross_total invalid (%). Sale amount must be positive. Sale ID: %',
      gross_total, p_sale_id;
  END IF;

  gross_total := ROUND(gross_total, 2);

  -- RETAIL FIX: Extract tax-inclusive totals from canonical JSONB values
  tax_lines_jsonb := sale_record.tax_lines;

  -- Extract net_total and total_tax_amount from JSONB (if available)
  IF tax_lines_jsonb IS NOT NULL AND jsonb_typeof(tax_lines_jsonb) = 'object' THEN
    -- Extract subtotal_excl_tax (net_total)
    IF tax_lines_jsonb ? 'subtotal_excl_tax' THEN
      BEGIN
        net_total := (tax_lines_jsonb->>'subtotal_excl_tax')::numeric;
        IF net_total IS NULL OR net_total < 0 THEN
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

  -- FINALIZE TOTALS
  gross_total := ROUND(gross_total, 2);
  net_total := ROUND(COALESCE(net_total, gross_total), 2);
  total_tax_amount := ROUND(COALESCE(total_tax_amount, 0), 2);

  -- Recalculate net_total if imbalance
  IF ABS(gross_total - (net_total + total_tax_amount)) > 0.01 THEN
    net_total := gross_total - total_tax_amount;
    net_total := ROUND(net_total, 2);
  END IF;

  -- Final NULL guards (defensive)
  gross_total := COALESCE(gross_total, 0);
  net_total := COALESCE(net_total, 0);
  total_tax_amount := COALESCE(total_tax_amount, 0);

  -- RETAIL FIX: Resolve system accountant
  IF p_posted_by_accountant_id IS NULL THEN
    SELECT owner_id INTO system_accountant_id
    FROM businesses
    WHERE id = business_id_val;
    
    IF system_accountant_id IS NULL THEN
      RAISE EXCEPTION 'Cannot post sale to ledger: Business owner not found for business %. System accountant required for automatic posting.', business_id_val;
    END IF;
    
    p_posted_by_accountant_id := system_accountant_id;
  END IF;

  PERFORM assert_accounting_period_is_open(business_id_val, sale_record.created_at::DATE);

  -- Calculate total COGS
  SELECT COALESCE(SUM(COALESCE(cogs, 0)), 0)
  INTO total_cogs
  FROM sale_items
  WHERE sale_id = p_sale_id;

  total_cogs := COALESCE(total_cogs, 0);
  total_cogs := ROUND(total_cogs, 2);

  -- VALIDATION
  IF net_total <= 0 AND total_tax_amount <= 0 THEN
    RAISE EXCEPTION
      'Retail posting error: net_total (%) and tax_total (%) both zero or negative after normalization. Tax-inclusive totals missing or malformed. Gross: %, Sale ID: %. This should never happen - gross_total is positive.',
      net_total, total_tax_amount, gross_total, p_sale_id;
  END IF;

  IF gross_total <= 0 THEN
    RAISE EXCEPTION
      'Retail posting error: gross_total (%) is zero or negative. Sale amount invalid. Sale ID: %',
      gross_total, p_sale_id;
  END IF;

  IF net_total <= 0 THEN
    RAISE EXCEPTION
      'Retail posting error: net_total (%) is zero or negative. Revenue must be positive. Gross: %, Tax: %, Sale ID: %',
      net_total, gross_total, total_tax_amount, p_sale_id;
  END IF;

  IF total_tax_amount < 0 THEN
    RAISE EXCEPTION
      'Retail posting error: tax_total (%) is negative. Tax amount invalid. Gross: %, Net: %, Sale ID: %',
      total_tax_amount, gross_total, net_total, p_sale_id;
  END IF;

  -- Parse tax_lines array
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

  -- Ensure CASH control account mapping exists
  BEGIN
    PERFORM ensure_retail_control_account_mapping(business_id_val, 'CASH', '1000');
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'Cannot post sale to ledger: % (Business: %, Sale: %)', 
        SQLERRM, business_id_val, p_sale_id;
  END;

  -- Validate accounts exist
  cash_account_code := get_control_account_code(business_id_val, 'CASH');
  PERFORM assert_account_exists(business_id_val, cash_account_code);
  PERFORM assert_account_exists(business_id_val, '4000');
  PERFORM assert_account_exists(business_id_val, '5000');
  PERFORM assert_account_exists(business_id_val, '1200');
  
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

  -- Get account IDs
  cash_account_id := get_account_by_control_key(business_id_val, 'CASH');
  revenue_account_id := get_account_by_code(business_id_val, '4000');
  cogs_account_id := get_account_by_code(business_id_val, '5000');
  inventory_account_id := get_account_by_code(business_id_val, '1200');

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

  -- Final validation
  IF net_total <= 0 AND total_tax_amount <= 0 THEN
    RAISE EXCEPTION
      'Retail posting error: Cannot build journal lines. net_total (%) and tax_total (%) both zero or negative. Gross: %, Sale ID: %. Tax JSONB: %. This should have been caught earlier.',
      net_total, total_tax_amount, gross_total, p_sale_id, tax_lines_jsonb;
  END IF;

  IF ABS(gross_total - (net_total + total_tax_amount)) > 0.01 THEN
    RAISE EXCEPTION
      'Retail posting error: Totals do not balance. Gross: %, Net: %, Tax: %, Difference: %. Sale ID: %. This indicates a calculation error.',
      gross_total, net_total, total_tax_amount, ABS(gross_total - (net_total + total_tax_amount)), p_sale_id;
  END IF;

  -- Build journal lines
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', cash_account_id,
      'debit', ROUND(COALESCE(gross_total, 0), 2),
      'description', 'Sale receipt'
    ),
    jsonb_build_object(
      'account_id', revenue_account_id,
      'credit', ROUND(COALESCE(net_total, 0), 2),
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

  -- Post tax lines
  IF array_length(parsed_tax_lines, 1) > 0 THEN
    FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
    LOOP
      tax_code := tax_line_item->>'code';
      tax_amount := ROUND(COALESCE((tax_line_item->>'amount')::NUMERIC, 0), 2);
      tax_ledger_account_code := tax_line_item->>'ledger_account_code';
      tax_ledger_side := tax_line_item->>'ledger_side';

      IF (tax_ledger_account_code IS NULL OR tax_ledger_account_code = '') AND tax_code IS NOT NULL THEN
        tax_ledger_account_code := map_tax_code_to_account_code(tax_code);
      END IF;

      IF tax_ledger_side IS NULL OR tax_ledger_side = '' THEN
        tax_ledger_side := 'credit';
      END IF;

      tax_amount := ROUND(COALESCE(tax_amount, 0), 2);
      
      IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
        tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
        
        IF tax_account_id IS NULL THEN
          RAISE EXCEPTION 'Tax account (%) not found for business: %', 
            tax_ledger_account_code, business_id_val;
        END IF;
        
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
  ELSIF total_tax_amount > 0 THEN
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
          'credit', total_tax_amount,
          'description', 'Tax payable (tax-inclusive sale)'
        )
      );
    END IF;
  END IF;

  -- Final validation
  IF ABS(gross_total - (net_total + total_tax_amount)) > 0.01 THEN
    RAISE EXCEPTION 'Tax-inclusive sale posting imbalance: gross (%), net (%), tax (%), difference (%). Sale: %. This should have been caught earlier.', 
      gross_total, net_total, total_tax_amount, ABS(gross_total - (net_total + total_tax_amount)), p_sale_id;
  END IF;

  -- ============================================================================
  -- DEBUG LOG: Capture evidence before post_journal_entry() call
  -- ============================================================================
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
      NULL;
    WHEN OTHERS THEN
      RAISE NOTICE 'DEBUG LOG ERROR (non-fatal): %', SQLERRM;
  END;
  -- ============================================================================

  -- Post journal entry
  SELECT post_journal_entry(
    business_id_val,
    sale_record.created_at::DATE,
    'Sale' || COALESCE(': ' || sale_record.description, ''),
    'sale',
    p_sale_id,
    journal_lines,
    FALSE,
    NULL,
    NULL,
    NULL,
    p_entry_type,
    p_backfill_reason,
    p_backfill_actor,
    p_posted_by_accountant_id
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION post_sale_to_ledger IS 
'RETAIL FIX: Posts sale to ledger with system accountant authorization. Uses business owner as system accountant if p_posted_by_accountant_id not provided. Business owners are considered accountants per is_user_accountant() function. Optional p_entry_type, p_backfill_reason, p_backfill_actor for Phase 12 backfill.';
