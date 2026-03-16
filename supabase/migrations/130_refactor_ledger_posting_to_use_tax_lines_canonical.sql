-- ============================================================================
-- Migration 130: Refactor Ledger Posting to Use tax_lines JSONB (Canonical Format)
-- ============================================================================
-- 
-- This migration updates ledger posting functions to:
-- 1. Read tax amounts ONLY from tax_lines.lines[] (canonical format)
-- 2. Do NOT read from legacy columns (vat, nhil, getfund, covid)
-- 3. Extract ledger_account_code and ledger_side from line.meta
-- 4. Remove any Ghana-specific cutoff logic (2026-01-01)
-- 
-- Canonical tax_lines format:
-- {
--   "lines": [
--     {
--       "code": "VAT",
--       "amount": 15.90,
--       "rate": 0.15,
--       "name": "VAT",
--       "meta": {
--         "ledger_account_code": "2100",
--         "ledger_side": "credit"
--       }
--     }
--   ],
--   "meta": {
--     "jurisdiction": "GH",
--     "effective_date_used": "2025-12-31",
--     "engine_version": "GH-2025-A"
--   },
--   "pricing_mode": "inclusive"
-- }
-- ============================================================================

-- ============================================================================
-- Update: post_invoice_to_ledger
-- ============================================================================
CREATE OR REPLACE FUNCTION post_invoice_to_ledger(p_invoice_id UUID)
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
  -- Get invoice details (DO NOT SELECT legacy tax columns)
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

  -- Parse tax_lines JSONB: Read from canonical format (tax_lines->'lines')
  tax_lines_jsonb := invoice_record.tax_lines;
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
  revenue_account_id := get_account_by_code(business_id_val, '4000'); -- Revenue (not a control key)

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
  -- Extract ledger_account_code and ledger_side from line.meta (canonical format)
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    
    -- Extract ledger metadata from line.meta (canonical format) or directly from line (legacy compatibility)
    line_meta := tax_line_item->'meta';
    IF line_meta IS NOT NULL AND line_meta ? 'ledger_account_code' THEN
      tax_ledger_account_code := line_meta->>'ledger_account_code';
      tax_ledger_side := line_meta->>'ledger_side';
    ELSIF tax_line_item ? 'ledger_account_code' THEN
      -- Fallback: legacy format with ledger_account_code directly on line
      tax_ledger_account_code := tax_line_item->>'ledger_account_code';
      tax_ledger_side := tax_line_item->>'ledger_side';
    ELSE
      tax_ledger_account_code := NULL;
      tax_ledger_side := NULL;
    END IF;

    -- Only post tax lines with ledger_account_code (skip absorbed taxes)
    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      
      -- Build tax journal line based on ledger_side from meta
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

  -- Post journal entry
  SELECT post_journal_entry(
    business_id_val,
    invoice_record.issue_date,
    'Invoice #' || invoice_record.invoice_number,
    'invoice',
    p_invoice_id,
    journal_lines
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Update: post_credit_note_to_ledger
-- ============================================================================
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
  revenue_account_id := get_account_by_code(business_id_val, '4000');

  -- Validate accounts exist
  IF ar_account_id IS NULL THEN
    RAISE EXCEPTION 'AR account not found for business: %. Credit Note ID: %', business_id_val, p_credit_note_id;
  END IF;
  IF revenue_account_id IS NULL THEN
    RAISE EXCEPTION 'Revenue account (4000) not found for business: %. Credit Note ID: %', business_id_val, p_credit_note_id;
  END IF;

  -- Build journal entry lines: start with base lines (reverse recognition)
  -- Sales credit note: Debit Revenue (reverse), Credit AR (reduce receivable)
  journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', revenue_account_id,
      'debit', subtotal,
      'description', 'Reverse revenue'
    ),
    jsonb_build_object(
      'account_id', ar_account_id,
      'credit', cn_record.total,
      'description', 'Reduce receivable'
    )
  );

  -- Add tax reversal lines: iterate parsed_tax_lines and reverse each tax control account
  -- Extract ledger_account_code and ledger_side from line.meta (canonical format)
  -- STEP 6 RULE: Reverse the original side (credit → debit, debit → credit)
  FOR tax_line_item IN SELECT * FROM unnest(parsed_tax_lines)
  LOOP
    tax_code := tax_line_item->>'code';
    tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0);
    
    -- Extract ledger metadata from line.meta (canonical format) or directly from line (legacy compatibility)
    line_meta := tax_line_item->'meta';
    IF line_meta IS NOT NULL AND line_meta ? 'ledger_account_code' THEN
      tax_ledger_account_code := line_meta->>'ledger_account_code';
      tax_ledger_side := line_meta->>'ledger_side';
    ELSIF tax_line_item ? 'ledger_account_code' THEN
      -- Fallback: legacy format with ledger_account_code directly on line
      tax_ledger_account_code := tax_line_item->>'ledger_account_code';
      tax_ledger_side := tax_line_item->>'ledger_side';
    ELSE
      tax_ledger_account_code := NULL;
      tax_ledger_side := NULL;
    END IF;

    -- Only post tax lines with ledger_account_code (skip absorbed taxes)
    IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
      tax_account_id := get_account_by_code(business_id_val, tax_ledger_account_code);
      
      IF tax_account_id IS NULL THEN
        RAISE EXCEPTION 'Tax account (%) not found for business: %. Credit Note ID: %', 
          tax_ledger_account_code, business_id_val, p_credit_note_id;
      END IF;
      
      -- STEP 6 RULE: Reverse the original side
      -- Original 'credit' → post 'debit' (reverse credit)
      -- Original 'debit'  → post 'credit' (reverse debit)
      IF tax_ledger_side = 'credit' THEN
        -- Original was credit, reverse with debit
        journal_lines := journal_lines || jsonb_build_array(
          jsonb_build_object(
            'account_id', tax_account_id,
            'debit', tax_amount,
            'description', COALESCE(tax_code, 'Tax') || ' tax reversal'
          )
        );
      ELSIF tax_ledger_side = 'debit' THEN
        -- Original was debit, reverse with credit
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

  -- Post journal entry
  SELECT post_journal_entry(
    business_id_val,
    cn_record.date,
    'Credit Note #' || cn_record.credit_number || ' for Invoice #' || invoice_record.invoice_number,
    'credit_note',
    p_credit_note_id,
    journal_lines
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Verification: Ensure functions read from tax_lines.lines[] (canonical format)
-- ============================================================================
-- Note: post_payment_to_ledger does not read tax columns (it only posts AR/Cash),
-- so no changes needed for that function.
-- ============================================================================

-- ============================================================================
-- VERIFICATION FUNCTION: Test ledger posting with tax_lines canonical format
-- ============================================================================
-- This function verifies that ledger posting correctly reads from tax_lines.lines[]
-- and handles pre-2026 (with COVID) vs post-2026 (without COVID) scenarios.
-- 
-- Usage (manual test):
--   SELECT verify_ledger_posting_tax_lines();
-- ============================================================================
CREATE OR REPLACE FUNCTION verify_ledger_posting_tax_lines()
RETURNS TABLE (
  test_name TEXT,
  passed BOOLEAN,
  message TEXT
) AS $$
DECLARE
  test_business_id UUID;
  test_invoice_id UUID;
  test_credit_note_id UUID;
  test_journal_id UUID;
  covid_line_count INT;
  vat_line_count INT;
  nhil_line_count INT;
  getfund_line_count INT;
  total_tax_from_lines NUMERIC;
  total_tax_from_ledger NUMERIC;
BEGIN
  -- Test 1: Pre-2026 invoice includes COVID tax line in ledger
  test_name := 'Pre-2026 invoice includes COVID in ledger';
  
  -- Create a test business (if not exists, use existing)
  SELECT id INTO test_business_id FROM businesses LIMIT 1;
  
  IF test_business_id IS NULL THEN
    RETURN QUERY SELECT 
      test_name::TEXT,
      false::BOOLEAN,
      'No test business found. Cannot run verification tests.'::TEXT;
    RETURN;
  END IF;
  
  -- Create a pre-2026 invoice with canonical tax_lines (includes COVID)
  INSERT INTO invoices (
    business_id,
    customer_id,
    issue_date,
    subtotal,
    total_tax,
    total,
    apply_taxes,
    status,
    tax_lines
  ) VALUES (
    test_business_id,
    NULL,
    '2025-12-31', -- Pre-2026 date
    100.00,
    21.90, -- 2.50 (NHIL) + 2.50 (GETFUND) + 1.00 (COVID) + 15.90 (VAT)
    121.90,
    true,
    'draft',
    jsonb_build_object(
      'lines', jsonb_build_array(
        jsonb_build_object(
          'code', 'NHIL',
          'amount', 2.50,
          'rate', 0.025,
          'name', 'NHIL',
          'meta', jsonb_build_object(
            'ledger_account_code', '2110',
            'ledger_side', 'credit'
          )
        ),
        jsonb_build_object(
          'code', 'GETFUND',
          'amount', 2.50,
          'rate', 0.025,
          'name', 'GETFund',
          'meta', jsonb_build_object(
            'ledger_account_code', '2120',
            'ledger_side', 'credit'
          )
        ),
        jsonb_build_object(
          'code', 'COVID',
          'amount', 1.00,
          'rate', 0.01,
          'name', 'COVID Levy',
          'meta', jsonb_build_object(
            'ledger_account_code', '2130',
            'ledger_side', 'credit'
          )
        ),
        jsonb_build_object(
          'code', 'VAT',
          'amount', 15.90,
          'rate', 0.15,
          'name', 'VAT',
          'meta', jsonb_build_object(
            'ledger_account_code', '2100',
            'ledger_side', 'credit'
          )
        )
      ),
      'meta', jsonb_build_object(
        'jurisdiction', 'GH',
        'effective_date_used', '2025-12-31',
        'engine_version', 'GH-2025-A'
      ),
      'pricing_mode', 'inclusive'
    )
  ) RETURNING id INTO test_invoice_id;
  
  -- Post to ledger
  BEGIN
    SELECT post_invoice_to_ledger(test_invoice_id) INTO test_journal_id;
    
    -- Count COVID tax line in ledger
    SELECT COUNT(*) INTO covid_line_count
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE je.id = test_journal_id
      AND jel.description LIKE '%COVID%';
    
    IF covid_line_count > 0 THEN
      RETURN QUERY SELECT 
        test_name::TEXT,
        true::BOOLEAN,
        format('PASSED: Pre-2026 invoice ledger includes %s COVID tax line(s)', covid_line_count)::TEXT;
    ELSE
      RETURN QUERY SELECT 
        test_name::TEXT,
        false::BOOLEAN,
        'FAILED: Pre-2026 invoice ledger does not include COVID tax line'::TEXT;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
      test_name::TEXT,
      false::BOOLEAN,
      format('ERROR: %s', SQLERRM)::TEXT;
  END;
  
  -- Cleanup
  DELETE FROM invoices WHERE id = test_invoice_id;
  
  -- Test 2: Post-2026 invoice does NOT include COVID tax line in ledger
  test_name := 'Post-2026 invoice excludes COVID from ledger';
  
  -- Create a post-2026 invoice with canonical tax_lines (no COVID)
  INSERT INTO invoices (
    business_id,
    customer_id,
    issue_date,
    subtotal,
    total_tax,
    total,
    apply_taxes,
    status,
    tax_lines
  ) VALUES (
    test_business_id,
    NULL,
    '2026-01-01', -- Post-2026 date
    100.00,
    20.00, -- 2.50 (NHIL) + 2.50 (GETFUND) + 15.00 (VAT) - NO COVID
    120.00,
    true,
    'draft',
    jsonb_build_object(
      'lines', jsonb_build_array(
        jsonb_build_object(
          'code', 'NHIL',
          'amount', 2.50,
          'rate', 0.025,
          'name', 'NHIL',
          'meta', jsonb_build_object(
            'ledger_account_code', '2110',
            'ledger_side', 'credit'
          )
        ),
        jsonb_build_object(
          'code', 'GETFUND',
          'amount', 2.50,
          'rate', 0.025,
          'name', 'GETFund',
          'meta', jsonb_build_object(
            'ledger_account_code', '2120',
            'ledger_side', 'credit'
          )
        ),
        jsonb_build_object(
          'code', 'VAT',
          'amount', 15.00,
          'rate', 0.15,
          'name', 'VAT',
          'meta', jsonb_build_object(
            'ledger_account_code', '2100',
            'ledger_side', 'credit'
          )
        )
      ),
      'meta', jsonb_build_object(
        'jurisdiction', 'GH',
        'effective_date_used', '2026-01-01',
        'engine_version', 'GH-2026-B'
      ),
      'pricing_mode', 'inclusive'
    )
  ) RETURNING id INTO test_invoice_id;
  
  -- Post to ledger
  BEGIN
    SELECT post_invoice_to_ledger(test_invoice_id) INTO test_journal_id;
    
    -- Count COVID tax line in ledger (should be 0)
    SELECT COUNT(*) INTO covid_line_count
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE je.id = test_journal_id
      AND jel.description LIKE '%COVID%';
    
    IF covid_line_count = 0 THEN
      RETURN QUERY SELECT 
        test_name::TEXT,
        true::BOOLEAN,
        'PASSED: Post-2026 invoice ledger correctly excludes COVID tax line'::TEXT;
    ELSE
      RETURN QUERY SELECT 
        test_name::TEXT,
        false::BOOLEAN,
        format('FAILED: Post-2026 invoice ledger includes %s COVID tax line(s) (should be 0)', covid_line_count)::TEXT;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
      test_name::TEXT,
      false::BOOLEAN,
      format('ERROR: %s', SQLERRM)::TEXT;
  END;
  
  -- Cleanup
  DELETE FROM invoices WHERE id = test_invoice_id;
  
  -- Test 3: Ledger amounts exactly match tax_lines amounts
  test_name := 'Ledger tax amounts match tax_lines amounts';
  
  -- Create a test invoice with known tax amounts
  INSERT INTO invoices (
    business_id,
    customer_id,
    issue_date,
    subtotal,
    total_tax,
    total,
    apply_taxes,
    status,
    tax_lines
  ) VALUES (
    test_business_id,
    NULL,
    '2026-01-01',
    100.00,
    20.00,
    120.00,
    true,
    'draft',
    jsonb_build_object(
      'lines', jsonb_build_array(
        jsonb_build_object(
          'code', 'NHIL',
          'amount', 2.50,
          'meta', jsonb_build_object('ledger_account_code', '2110', 'ledger_side', 'credit')
        ),
        jsonb_build_object(
          'code', 'GETFUND',
          'amount', 2.50,
          'meta', jsonb_build_object('ledger_account_code', '2120', 'ledger_side', 'credit')
        ),
        jsonb_build_object(
          'code', 'VAT',
          'amount', 15.00,
          'meta', jsonb_build_object('ledger_account_code', '2100', 'ledger_side', 'credit')
        )
      ),
      'meta', jsonb_build_object('jurisdiction', 'GH', 'effective_date_used', '2026-01-01', 'engine_version', 'GH-2026-B'),
      'pricing_mode', 'inclusive'
    )
  ) RETURNING id INTO test_invoice_id;
  
  -- Post to ledger
  BEGIN
    SELECT post_invoice_to_ledger(test_invoice_id) INTO test_journal_id;
    
    -- Sum tax amounts from ledger (all credit lines except AR and Revenue)
    SELECT COALESCE(SUM(jel.credit), 0) INTO total_tax_from_ledger
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE je.id = test_journal_id
      AND jel.description LIKE '%tax%';
    
    -- Sum tax amounts from tax_lines JSONB
    SELECT 
      COALESCE(SUM((line->>'amount')::NUMERIC), 0) INTO total_tax_from_lines
    FROM invoices i,
         jsonb_array_elements(i.tax_lines->'lines') AS line
    WHERE i.id = test_invoice_id;
    
    -- Compare (allow for small rounding differences)
    IF ABS(total_tax_from_ledger - total_tax_from_lines) < 0.01 THEN
      RETURN QUERY SELECT 
        test_name::TEXT,
        true::BOOLEAN,
        format('PASSED: Ledger tax total (%.2f) matches tax_lines total (%.2f)', 
               total_tax_from_ledger, total_tax_from_lines)::TEXT;
    ELSE
      RETURN QUERY SELECT 
        test_name::TEXT,
        false::BOOLEAN,
        format('FAILED: Ledger tax total (%.2f) does not match tax_lines total (%.2f)', 
               total_tax_from_ledger, total_tax_from_lines)::TEXT;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 
      test_name::TEXT,
      false::BOOLEAN,
      format('ERROR: %s', SQLERRM)::TEXT;
  END;
  
  -- Cleanup
  DELETE FROM invoices WHERE id = test_invoice_id;
  
END;
$$ LANGUAGE plpgsql;
