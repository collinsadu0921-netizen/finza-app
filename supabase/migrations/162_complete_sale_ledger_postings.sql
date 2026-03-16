-- ============================================================================
-- MIGRATION: Phase 2 - Complete Sale Ledger Postings
-- ============================================================================
-- Extends post_sale_to_ledger to include COGS and Inventory movements
-- Ensures every sale journal entry contains exactly five mandatory lines:
-- 1. Cash/AR DEBIT
-- 2. Revenue CREDIT
-- 3. Tax Payable CREDIT (if applicable)
-- 4. COGS Expense DEBIT
-- 5. Inventory Asset CREDIT
-- ============================================================================

-- ============================================================================
-- Add Inventory Asset account to system accounts
-- ============================================================================
-- Add Inventory account (1200) to create_system_accounts function
-- This is required for retail sales with inventory
CREATE OR REPLACE FUNCTION create_system_accounts(p_business_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Assets
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Cash', '1000', 'asset', 'Cash on hand', TRUE),
    (p_business_id, 'Bank', '1010', 'asset', 'Bank account', TRUE),
    (p_business_id, 'Mobile Money', '1020', 'asset', 'Mobile money accounts', TRUE),
    (p_business_id, 'Accounts Receivable', '1100', 'asset', 'Amounts owed by customers', TRUE),
    (p_business_id, 'Inventory', '1200', 'asset', 'Inventory assets', TRUE),
    (p_business_id, 'Fixed Assets', '1600', 'asset', 'Fixed assets including equipment, vehicles, and property', TRUE),
    (p_business_id, 'Accumulated Depreciation', '1650', 'asset', 'Accumulated depreciation on fixed assets', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Liabilities
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Accounts Payable', '2000', 'liability', 'Amounts owed to suppliers', TRUE),
    (p_business_id, 'VAT Payable', '2100', 'liability', 'VAT output tax minus input tax', TRUE),
    (p_business_id, 'NHIL Payable', '2110', 'liability', 'NHIL output tax minus input tax', TRUE),
    (p_business_id, 'GETFund Payable', '2120', 'liability', 'GETFund output tax minus input tax', TRUE),
    (p_business_id, 'COVID Levy Payable', '2130', 'liability', 'COVID-19 Health Recovery Levy output tax minus input tax', TRUE),
    (p_business_id, 'Other Tax Liabilities', '2200', 'liability', 'Other tax obligations', TRUE),
    (p_business_id, 'PAYE Liability', '2210', 'liability', 'PAYE tax payable to GRA', TRUE),
    (p_business_id, 'SSNIT Employee Contribution Payable', '2220', 'liability', 'SSNIT employee contributions payable', TRUE),
    (p_business_id, 'SSNIT Employer Contribution Payable', '2230', 'liability', 'SSNIT employer contributions payable', TRUE),
    (p_business_id, 'Net Salaries Payable', '2240', 'liability', 'Net salaries payable to employees', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Equity
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Owner''s Equity', '3000', 'equity', 'Owner investment', TRUE),
    (p_business_id, 'Retained Earnings', '3100', 'equity', 'Accumulated profits', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Income
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Service Revenue', '4000', 'income', 'Revenue from services', TRUE),
    (p_business_id, 'Gain on Asset Disposal', '4200', 'income', 'Gains from disposal of fixed assets', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Expenses
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Cost of Sales', '5000', 'expense', 'Direct costs', TRUE),
    (p_business_id, 'Operating Expenses', '5100', 'expense', 'General operating expenses', TRUE),
    (p_business_id, 'Supplier Bills', '5200', 'expense', 'Supplier invoices', TRUE),
    (p_business_id, 'Administrative Expenses', '5300', 'expense', 'Admin and overhead', TRUE),
    (p_business_id, 'Depreciation Expense', '5700', 'expense', 'Depreciation expense for fixed assets', TRUE),
    (p_business_id, 'Loss on Asset Disposal', '5800', 'expense', 'Losses from disposal of fixed assets', TRUE),
    (p_business_id, 'Payroll Expense', '6000', 'expense', 'Employee salaries and wages', TRUE),
    (p_business_id, 'Employer SSNIT Contribution', '6010', 'expense', 'Employer SSNIT contributions', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Update: post_sale_to_ledger (Complete with COGS and Inventory)
-- ============================================================================
CREATE OR REPLACE FUNCTION post_sale_to_ledger(p_sale_id UUID)
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
  SELECT post_journal_entry(
    business_id_val,
    sale_record.created_at::DATE,
    'Sale' || COALESCE(': ' || sale_record.description, ''),
    'sale',
    p_sale_id,
    journal_lines
  ) INTO journal_id;

  RETURN journal_id;
END;
$$ LANGUAGE plpgsql;
