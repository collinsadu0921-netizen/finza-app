-- ============================================================================
-- MIGRATION: Track C1.4 - Business COA Bootstrap
-- ============================================================================
-- Provides explicit, idempotent initialization for businesses to enable
-- transaction posting via chart_of_accounts and control account mappings.
--
-- This is a ONE-TIME initialization capability, NOT runtime logic.
-- Function must be called explicitly - does NOT auto-run during posting.
--
-- Rules:
-- - Syncs accounts from existing `accounts` table to `chart_of_accounts`
-- - Creates required control account mappings (AR, AP, CASH, BANK)
-- - Idempotent: safe to call multiple times
-- - Does NOT create new accounts - only syncs existing ones
-- ============================================================================

-- ============================================================================
-- FUNCTION: Initialize Business Chart of Accounts
-- ============================================================================
-- One-time bootstrap function to initialize chart_of_accounts and control mappings
-- for a business. Idempotent - safe to call multiple times.
--
-- Behavior:
-- 1. Syncs all accounts from `accounts` table to `chart_of_accounts` (if not exists)
-- 2. Creates control account mappings for AR, AP, CASH, BANK
-- 3. Does NOT create new accounts - only syncs existing accounts
-- 4. Does NOT modify ledger schema or posting logic
--
-- Usage:
--   SELECT initialize_business_chart_of_accounts(business_id);
--
CREATE OR REPLACE FUNCTION initialize_business_chart_of_accounts(p_business_id UUID)
RETURNS VOID AS $$
DECLARE
  account_record RECORD;
  accounts_synced INTEGER := 0;
BEGIN
  -- Guard: Business must exist
  IF NOT EXISTS (SELECT 1 FROM businesses WHERE id = p_business_id) THEN
    RAISE EXCEPTION 'Business not found: %', p_business_id;
  END IF;

  -- STEP 1: Sync accounts from `accounts` table to `chart_of_accounts`
  -- Only sync accounts that exist in `accounts` table (do NOT create new accounts)
  -- Map type 'income' -> 'revenue' (chart_of_accounts uses 'revenue')
  FOR account_record IN
    SELECT 
      code,
      name,
      type,
      description
    FROM accounts
    WHERE business_id = p_business_id
      AND deleted_at IS NULL
  LOOP
    -- Insert into chart_of_accounts if not exists (idempotent)
    INSERT INTO chart_of_accounts (
      business_id,
      account_code,
      account_name,
      account_type,
      is_active
    ) VALUES (
      p_business_id,
      account_record.code,
      account_record.name,
      CASE 
        WHEN account_record.type = 'income' THEN 'revenue'
        ELSE account_record.type
      END,
      TRUE
    )
    ON CONFLICT (business_id, account_code) DO UPDATE
    SET 
      account_name = EXCLUDED.account_name,
      account_type = EXCLUDED.account_type,
      is_active = TRUE;
    
    accounts_synced := accounts_synced + 1;
  END LOOP;

  -- STEP 2: Create control account mappings (idempotent)
  -- Only create mappings if the corresponding account exists in chart_of_accounts
  
  -- AR (Accounts Receivable) -> 1100
  IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = p_business_id AND account_code = '1100') THEN
    INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
    VALUES (p_business_id, 'AR', '1100')
    ON CONFLICT (business_id, control_key) DO NOTHING;
  END IF;

  -- AP (Accounts Payable) -> 2000
  IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = p_business_id AND account_code = '2000') THEN
    INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
    VALUES (p_business_id, 'AP', '2000')
    ON CONFLICT (business_id, control_key) DO NOTHING;
  END IF;

  -- CASH -> 1000
  IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = p_business_id AND account_code = '1000') THEN
    INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
    VALUES (p_business_id, 'CASH', '1000')
    ON CONFLICT (business_id, control_key) DO NOTHING;
  END IF;

  -- BANK -> 1010
  IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE business_id = p_business_id AND account_code = '1010') THEN
    INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
    VALUES (p_business_id, 'BANK', '1010')
    ON CONFLICT (business_id, control_key) DO NOTHING;
  END IF;

  -- Log completion (informational only)
  RAISE NOTICE 'Business COA initialized: business_id=%, accounts_synced=%', 
    p_business_id, accounts_synced;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION initialize_business_chart_of_accounts IS 
  'TRACK C1.4: One-time bootstrap function to initialize chart_of_accounts and control mappings for a business. Syncs existing accounts from accounts table to chart_of_accounts. Creates control mappings for AR (1100), AP (2000), CASH (1000), BANK (1010). Idempotent - safe to call multiple times. Does NOT create new accounts or auto-run during posting.';
