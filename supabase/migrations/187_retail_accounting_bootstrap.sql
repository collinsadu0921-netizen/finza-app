-- ============================================================================
-- MIGRATION: Retail Accounting Bootstrap (Global)
-- ============================================================================
-- Ensures ALL retail businesses have required default chart of accounts and
-- control accounts BEFORE any sale is posted.
--
-- Hard Restrictions (DO NOT VIOLATE):
-- - Does NOT create accounts during sale posting
-- - Does NOT add logic inside ledger posting functions
-- - Does NOT special-case a single retail store
-- - Does NOT touch tax logic, tax_lines, or retail UI
-- - Does NOT modify store-day events or accounting invariants
-- - Does NOT auto-fix missing accounts silently at runtime
--
-- Scope: Business-level accounting initialization for retail businesses
-- ============================================================================

-- ============================================================================
-- FUNCTION: Initialize Retail Accounting
-- ============================================================================
-- Creates required default accounts for retail posting:
-- - 1000: Cash (control account via 'CASH')
-- - 1010: Bank
-- - 1020: Mobile Money
-- - 1100: Accounts Receivable (control account via 'AR')
-- - 1200: Inventory Asset (required for retail COGS posting)
-- - 2000: Accounts Payable (control account via 'AP')
-- - 2100: VAT Payable
-- - 2110: NHIL Payable
-- - 2120: GETFund Payable
-- - 4000: Revenue (required for retail sales)
-- - 5000: COGS Expense (required for retail sales)
--
-- Behavior:
-- 1. Creates accounts in `accounts` table (idempotent)
-- 2. Syncs accounts to `chart_of_accounts` table (idempotent)
-- 3. Creates control account mappings (idempotent)
-- 4. Does NOT overwrite existing accounts
-- 5. Fails loudly if business doesn't exist
--
-- Usage:
--   SELECT initialize_retail_accounting(business_id);
--
CREATE OR REPLACE FUNCTION initialize_retail_accounting(p_business_id UUID)
RETURNS VOID AS $$
DECLARE
  mappings_created INTEGER := 0;
  temp_count INTEGER;
BEGIN
  -- Guard: Business must exist
  IF NOT EXISTS (SELECT 1 FROM businesses WHERE id = p_business_id) THEN
    RAISE EXCEPTION 'Cannot initialize retail accounting: Business not found: %', p_business_id;
  END IF;

  -- STEP 1: Create required accounts in `accounts` table (idempotent)
  -- Assets
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Cash', '1000', 'asset', 'Cash on hand', TRUE),
    (p_business_id, 'Bank', '1010', 'asset', 'Bank account', TRUE),
    (p_business_id, 'Mobile Money', '1020', 'asset', 'Mobile money accounts', TRUE),
    (p_business_id, 'Accounts Receivable', '1100', 'asset', 'Amounts owed by customers', TRUE),
    (p_business_id, 'Inventory', '1200', 'asset', 'Inventory assets', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Liabilities
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Accounts Payable', '2000', 'liability', 'Amounts owed to suppliers', TRUE),
    (p_business_id, 'VAT Payable', '2100', 'liability', 'VAT output tax minus input tax', TRUE),
    (p_business_id, 'NHIL Payable', '2110', 'liability', 'NHIL output tax minus input tax', TRUE),
    (p_business_id, 'GETFund Payable', '2120', 'liability', 'GETFund output tax minus input tax', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Revenue
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Sales Revenue', '4000', 'income', 'Revenue from sales', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- Expenses
  INSERT INTO accounts (business_id, name, code, type, description, is_system) VALUES
    (p_business_id, 'Cost of Sales', '5000', 'expense', 'Direct costs', TRUE)
  ON CONFLICT (business_id, code) DO NOTHING;

  -- STEP 2: Sync accounts from `accounts` table to `chart_of_accounts` (idempotent)
  -- Map type 'income' -> 'revenue' (chart_of_accounts uses 'revenue')
  INSERT INTO chart_of_accounts (
    business_id,
    account_code,
    account_name,
    account_type,
    is_active
  )
  SELECT 
    a.business_id,
    a.code,
    a.name,
    CASE 
      WHEN a.type = 'income' THEN 'revenue'
      ELSE a.type
    END,
    TRUE
  FROM accounts a
  WHERE a.business_id = p_business_id
    AND a.deleted_at IS NULL
    AND a.code IN ('1000', '1010', '1020', '1100', '1200', '2000', '2100', '2110', '2120', '4000', '5000')
  ON CONFLICT (business_id, account_code) DO UPDATE
  SET 
    account_name = EXCLUDED.account_name,
    account_type = EXCLUDED.account_type,
    is_active = TRUE;

  -- STEP 3: Create control account mappings (idempotent)
  -- Only create mappings if the corresponding account exists in chart_of_accounts
  
  -- CASH -> 1000
  IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = p_business_id AND account_code = '1000') THEN
    INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
    VALUES (p_business_id, 'CASH', '1000')
    ON CONFLICT (business_id, control_key) DO NOTHING;
    
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    IF temp_count > 0 THEN
      mappings_created := mappings_created + 1;
    END IF;
  END IF;

  -- BANK -> 1010
  IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = p_business_id AND account_code = '1010') THEN
    INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
    VALUES (p_business_id, 'BANK', '1010')
    ON CONFLICT (business_id, control_key) DO NOTHING;
    
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    IF temp_count > 0 THEN
      mappings_created := mappings_created + 1;
    END IF;
  END IF;

  -- AR (Accounts Receivable) -> 1100
  IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = p_business_id AND account_code = '1100') THEN
    INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
    VALUES (p_business_id, 'AR', '1100')
    ON CONFLICT (business_id, control_key) DO NOTHING;
    
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    IF temp_count > 0 THEN
      mappings_created := mappings_created + 1;
    END IF;
  END IF;

  -- AP (Accounts Payable) -> 2000
  IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = p_business_id AND account_code = '2000') THEN
    INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
    VALUES (p_business_id, 'AP', '2000')
    ON CONFLICT (business_id, control_key) DO NOTHING;
    
    GET DIAGNOSTICS temp_count = ROW_COUNT;
    IF temp_count > 0 THEN
      mappings_created := mappings_created + 1;
    END IF;
  END IF;

  -- Log completion (informational only)
  RAISE NOTICE 'Retail accounting initialized: business_id=%, mappings_created=%', 
    p_business_id, mappings_created;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION initialize_retail_accounting IS 
  'RETAIL BOOTSTRAP: Creates required default accounts for retail posting (1000, 1010, 1020, 1100, 1200, 2000, 2100, 2110, 2120, 4000, 5000). Syncs to chart_of_accounts and creates control mappings (CASH, BANK, AR, AP). Idempotent - safe to call multiple times. Does NOT create accounts during sale posting.';

-- ============================================================================
-- TRIGGER: Auto-initialize retail accounting when business is created
-- ============================================================================
-- This ensures retail businesses have required accounts immediately when created
CREATE OR REPLACE FUNCTION trigger_initialize_retail_accounting()
RETURNS TRIGGER AS $$
BEGIN
  -- Only initialize for retail businesses
  IF NEW.industry = 'retail' THEN
    PERFORM initialize_retail_accounting(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists (to avoid duplicates)
DROP TRIGGER IF EXISTS trigger_auto_initialize_retail_accounting ON businesses;

-- Create trigger
CREATE TRIGGER trigger_auto_initialize_retail_accounting
  AFTER INSERT ON businesses
  FOR EACH ROW
  EXECUTE FUNCTION trigger_initialize_retail_accounting();

COMMENT ON TRIGGER trigger_auto_initialize_retail_accounting ON businesses IS 
  'RETAIL BOOTSTRAP: Automatically initializes retail accounting (accounts, chart_of_accounts, control mappings) when a retail business is created.';

-- ============================================================================
-- Backfill: Initialize retail accounting for existing retail businesses
-- ============================================================================
-- This ensures all existing retail businesses have required accounts
-- Safe to run multiple times (idempotent)
DO $$
DECLARE
  business_record RECORD;
  initialized_count INTEGER := 0;
BEGIN
  FOR business_record IN 
    SELECT id FROM businesses WHERE industry = 'retail'
  LOOP
    BEGIN
      PERFORM initialize_retail_accounting(business_record.id);
      initialized_count := initialized_count + 1;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'Failed to initialize retail accounting for business %: %', 
          business_record.id, SQLERRM;
    END;
  END LOOP;
  
  RAISE NOTICE 'Retail accounting backfill completed: % businesses initialized', initialized_count;
END $$;
