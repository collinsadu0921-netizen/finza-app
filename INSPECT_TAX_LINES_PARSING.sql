-- ============================================================================
-- INSPECT TAX LINES PARSING LOGIC
-- ============================================================================
-- This simulates the tax_lines parsing logic to see why credits aren't being added

SET client_min_messages TO NOTICE;

DO $$
DECLARE
  test_sale_id UUID;
  tax_lines_jsonb JSONB;
  tax_lines_array JSONB;
  parsed_tax_lines JSONB[] := ARRAY[]::JSONB[];
  tax_line_item JSONB;
  tax_code TEXT;
  tax_amount NUMERIC;
  tax_ledger_account_code TEXT;
  tax_ledger_side TEXT;
  test_business_id UUID := '69278e9a-8694-4640-88d1-cbcfe7dd42f3';
  tax_account_id UUID;
BEGIN
  -- Get the test sale
  SELECT id, tax_lines INTO test_sale_id, tax_lines_jsonb
  FROM sales
  WHERE description LIKE '%ROOT CAUSE TEST%'
  ORDER BY created_at DESC
  LIMIT 1;
  
  IF test_sale_id IS NULL THEN
    RAISE EXCEPTION 'No test sale found';
  END IF;
  
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'INSPECTING TAX LINES PARSING';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Sale ID: %', test_sale_id;
  RAISE NOTICE 'tax_lines_jsonb: %', tax_lines_jsonb;
  RAISE NOTICE '';
  
  -- Simulate the parsing logic from post_sale_to_ledger
  IF tax_lines_jsonb IS NOT NULL AND jsonb_typeof(tax_lines_jsonb) = 'object' THEN
    RAISE NOTICE 'tax_lines_jsonb is an object';
    
    IF tax_lines_jsonb ? 'tax_lines' THEN
      tax_lines_array := tax_lines_jsonb->'tax_lines';
      RAISE NOTICE 'Found tax_lines key, array: %', tax_lines_array;
    ELSIF tax_lines_jsonb ? 'lines' THEN
      tax_lines_array := tax_lines_jsonb->'lines';
      RAISE NOTICE 'Found lines key, array: %', tax_lines_array;
    ELSE
      tax_lines_array := NULL;
      RAISE NOTICE 'No tax_lines or lines key found';
    END IF;
  ELSIF tax_lines_jsonb IS NOT NULL AND jsonb_typeof(tax_lines_jsonb) = 'array' THEN
    tax_lines_array := tax_lines_jsonb;
    RAISE NOTICE 'tax_lines_jsonb is a direct array: %', tax_lines_array;
  ELSE
    tax_lines_array := NULL;
    RAISE NOTICE 'tax_lines_jsonb is NULL or wrong type';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'tax_lines_array: %', tax_lines_array;
  RAISE NOTICE 'tax_lines_array type: %', 
    CASE WHEN tax_lines_array IS NULL THEN 'NULL' ELSE jsonb_typeof(tax_lines_array) END;
  
  -- Parse individual tax line items
  IF tax_lines_array IS NOT NULL AND jsonb_typeof(tax_lines_array) = 'array' THEN
    RAISE NOTICE '';
    RAISE NOTICE 'Parsing tax_lines_array...';
    
    FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_array)
    LOOP
      RAISE NOTICE '  Processing tax_line_item: %', tax_line_item;
      
      IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
        parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
        RAISE NOTICE '    Added to parsed_tax_lines';
      ELSE
        RAISE NOTICE '    SKIPPED: Missing code or amount';
        RAISE NOTICE '      Has code: %, Has amount: %', 
          tax_line_item ? 'code', tax_line_item ? 'amount';
      END IF;
    END LOOP;
  ELSE
    RAISE NOTICE 'tax_lines_array is NULL or not an array';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'parsed_tax_lines length: %', COALESCE(array_length(parsed_tax_lines, 1), 0);
  RAISE NOTICE 'parsed_tax_lines: %', parsed_tax_lines;
  RAISE NOTICE '';
  
  -- Simulate the tax line posting logic
  IF array_length(parsed_tax_lines, 1) > 0 THEN
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'SIMULATING TAX LINE POSTING';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE '';
    
    FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
    LOOP
      tax_code := tax_line_item->>'code';
      tax_amount := ROUND(COALESCE((tax_line_item->>'amount')::NUMERIC, 0), 2);
      tax_ledger_account_code := tax_line_item->>'ledger_account_code';
      tax_ledger_side := tax_line_item->>'ledger_side';
      
      RAISE NOTICE 'Tax line details:';
      RAISE NOTICE '  code: %', tax_code;
      RAISE NOTICE '  amount: %', tax_amount;
      RAISE NOTICE '  ledger_account_code: %', tax_ledger_account_code;
      RAISE NOTICE '  ledger_side: %', tax_ledger_side;
      
      -- Map tax code to account code if missing
      IF (tax_ledger_account_code IS NULL OR tax_ledger_account_code = '') AND tax_code IS NOT NULL THEN
        BEGIN
          SELECT map_tax_code_to_account_code(tax_code) INTO tax_ledger_account_code;
          RAISE NOTICE '  Mapped tax_code to account_code: %', tax_ledger_account_code;
        EXCEPTION
          WHEN OTHERS THEN
            RAISE NOTICE '  ERROR mapping tax code: %', SQLERRM;
        END;
      END IF;
      
      -- Default ledger_side to 'credit' for sales
      IF tax_ledger_side IS NULL OR tax_ledger_side = '' THEN
        tax_ledger_side := 'credit';
        RAISE NOTICE '  Defaulted ledger_side to: credit';
      END IF;
      
      -- Check if we can post this tax line
      tax_amount := ROUND(COALESCE(tax_amount, 0), 2);
      RAISE NOTICE '  Final tax_amount: %', tax_amount;
      
      IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
        RAISE NOTICE '  Conditions met - attempting to get account ID...';
        
        BEGIN
          SELECT get_account_by_code(test_business_id, tax_ledger_account_code) INTO tax_account_id;
          RAISE NOTICE '  tax_account_id: %', tax_account_id;
          
          IF tax_account_id IS NULL THEN
            RAISE NOTICE '  ERROR: tax_account_id is NULL!';
          ELSE
            RAISE NOTICE '  SUCCESS: Would add credit line with amount: %', tax_amount;
          END IF;
        EXCEPTION
          WHEN OTHERS THEN
            RAISE NOTICE '  ERROR getting account: %', SQLERRM;
        END;
      ELSE
        RAISE NOTICE '  SKIPPED: tax_ledger_account_code=% OR tax_amount=%', 
          tax_ledger_account_code, tax_amount;
      END IF;
      
      RAISE NOTICE '';
    END LOOP;
  ELSE
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'NO PARSED TAX LINES - This explains why credits are zero!';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'The tax_lines JSONB exists but parsed_tax_lines array is empty.';
    RAISE NOTICE 'This means the parsing logic failed to extract tax lines.';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'INSPECTION COMPLETE';
  RAISE NOTICE '============================================================================';
  
END $$;
