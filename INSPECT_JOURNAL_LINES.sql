-- ============================================================================
-- INSPECT JOURNAL_LINES JSONB CONSTRUCTION
-- ============================================================================
-- This manually reconstructs the journal_lines JSONB to see what should be passed to post_journal_entry

SET client_min_messages TO NOTICE;

DO $$
DECLARE
  test_sale_id UUID;
  sale_record RECORD;
  gross_total NUMERIC;
  net_total NUMERIC;
  total_tax_amount NUMERIC;
  total_cogs NUMERIC;
  tax_lines_jsonb JSONB;
  tax_lines_array JSONB;
  parsed_tax_lines JSONB[] := ARRAY[]::JSONB[];
  tax_line_item JSONB;
  test_business_id UUID := '69278e9a-8694-4640-88d1-cbcfe7dd42f3';
  cash_account_id UUID;
  revenue_account_id UUID;
  cogs_account_id UUID;
  inventory_account_id UUID;
  journal_lines JSONB;
  line JSONB;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  diag_line_idx INT;
  diag_line JSONB;
BEGIN
  -- Get the test sale
  SELECT * INTO sale_record
  FROM sales
  WHERE description LIKE '%ROOT CAUSE TEST%'
  ORDER BY created_at DESC
  LIMIT 1;
  
  IF sale_record.id IS NULL THEN
    RAISE EXCEPTION 'No test sale found';
  END IF;
  
  test_sale_id := sale_record.id;
  gross_total := sale_record.amount;
  tax_lines_jsonb := sale_record.tax_lines;
  
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'RECONSTRUCTING JOURNAL_LINES JSONB';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Sale ID: %', test_sale_id;
  RAISE NOTICE 'gross_total (sale.amount): %', gross_total;
  RAISE NOTICE 'tax_lines_jsonb: %', tax_lines_jsonb;
  RAISE NOTICE '';
  
  -- Extract net_total and total_tax_amount from tax_lines_jsonb (same logic as function)
  IF tax_lines_jsonb IS NOT NULL AND jsonb_typeof(tax_lines_jsonb) = 'object' THEN
    -- Extract subtotal_excl_tax (net_total)
    IF tax_lines_jsonb ? 'subtotal_excl_tax' THEN
      BEGIN
        net_total := (tax_lines_jsonb->>'subtotal_excl_tax')::numeric;
        IF net_total IS NULL OR net_total < 0 THEN
          net_total := 0;
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          net_total := 0;
      END;
    END IF;
    
    -- Extract tax_total
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
    
    -- Extract tax_lines array
    IF tax_lines_jsonb ? 'tax_lines' THEN
      tax_lines_array := tax_lines_jsonb->'tax_lines';
    ELSIF tax_lines_jsonb ? 'lines' THEN
      tax_lines_array := tax_lines_jsonb->'lines';
    END IF;
  END IF;
  
  -- Round and finalize
  gross_total := ROUND(COALESCE(gross_total, 0), 2);
  net_total := ROUND(COALESCE(net_total, gross_total), 2);
  total_tax_amount := ROUND(COALESCE(total_tax_amount, 0), 2);
  
  -- Recalculate net_total if needed to ensure balance
  IF ABS(gross_total - (net_total + total_tax_amount)) > 0.01 THEN
    net_total := gross_total - total_tax_amount;
    net_total := ROUND(net_total, 2);
  END IF;
  
  RAISE NOTICE 'After extraction:';
  RAISE NOTICE '  gross_total: %', gross_total;
  RAISE NOTICE '  net_total: %', net_total;
  RAISE NOTICE '  total_tax_amount: %', total_tax_amount;
  RAISE NOTICE '  Balance check: gross - (net + tax) = %', gross_total - (net_total + total_tax_amount);
  RAISE NOTICE '';
  
  -- Get COGS
  SELECT COALESCE(SUM(COALESCE(cogs, 0)), 0) INTO total_cogs
  FROM sale_items
  WHERE sale_id = test_sale_id;
  total_cogs := ROUND(COALESCE(total_cogs, 0), 2);
  
  RAISE NOTICE 'total_cogs: %', total_cogs;
  RAISE NOTICE '';
  
  -- Get account IDs
  cash_account_id := get_account_by_control_key(test_business_id, 'CASH');
  revenue_account_id := get_account_by_code(test_business_id, '4000');
  cogs_account_id := get_account_by_code(test_business_id, '5000');
  inventory_account_id := get_account_by_code(test_business_id, '1200');
  
  RAISE NOTICE 'Account IDs:';
  RAISE NOTICE '  cash_account_id: %', cash_account_id;
  RAISE NOTICE '  revenue_account_id: %', revenue_account_id;
  RAISE NOTICE '  cogs_account_id: %', cogs_account_id;
  RAISE NOTICE '  inventory_account_id: %', inventory_account_id;
  RAISE NOTICE '';
  
  -- Build initial journal_lines (same as function)
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
  
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'INITIAL JOURNAL_LINES (after build):';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '%', journal_lines;
  RAISE NOTICE '';
  
  -- Parse tax lines
  IF tax_lines_array IS NOT NULL AND jsonb_typeof(tax_lines_array) = 'array' THEN
    FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_array)
    LOOP
      IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
        parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
      END IF;
    END LOOP;
  END IF;
  
  RAISE NOTICE 'parsed_tax_lines length: %', COALESCE(array_length(parsed_tax_lines, 1), 0);
  
  -- Add tax credit lines (simplified - just show what should be added)
  IF array_length(parsed_tax_lines, 1) > 0 THEN
    RAISE NOTICE '';
    RAISE NOTICE 'Would add tax credit lines from parsed_tax_lines...';
    FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
    LOOP
      RAISE NOTICE '  Tax line: code=%, amount=%, ledger_account_code=%, ledger_side=%',
        tax_line_item->>'code',
        tax_line_item->>'amount',
        tax_line_item->>'ledger_account_code',
        tax_line_item->>'ledger_side';
    END LOOP;
  ELSIF total_tax_amount > 0 THEN
    RAISE NOTICE '';
    RAISE NOTICE 'Would add fallback tax credit line: amount=%', total_tax_amount;
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'CALCULATING TOTALS FROM JOURNAL_LINES:';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  
  -- Calculate totals (same as post_journal_entry does)
  FOR diag_line_idx IN 0..(jsonb_array_length(journal_lines) - 1)
  LOOP
    diag_line := journal_lines->diag_line_idx;
    total_debit := total_debit + COALESCE((diag_line->>'debit')::NUMERIC, 0);
    total_credit := total_credit + COALESCE((diag_line->>'credit')::NUMERIC, 0);
    
    RAISE NOTICE 'Line %: account_id=% debit=% credit=% desc=%',
      diag_line_idx + 1,
      diag_line->>'account_id',
      COALESCE((diag_line->>'debit')::NUMERIC, 0),
      COALESCE((diag_line->>'credit')::NUMERIC, 0),
      diag_line->>'description';
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE 'TOTALS:';
  RAISE NOTICE '  total_debit: %', total_debit;
  RAISE NOTICE '  total_credit: %', total_credit;
  RAISE NOTICE '  difference: %', total_debit - total_credit;
  RAISE NOTICE '';
  
  IF ABS(total_debit - total_credit) > 0.01 THEN
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'ERROR: JOURNAL_LINES IS NOT BALANCED!';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'This explains why post_journal_entry is failing.';
    RAISE NOTICE 'The initial journal_lines build is missing tax credit lines.';
  ELSE
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'JOURNAL_LINES IS BALANCED (but this is BEFORE adding tax credits)';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'If tax credits are not being added, that would cause the imbalance.';
  END IF;
  
END $$;
