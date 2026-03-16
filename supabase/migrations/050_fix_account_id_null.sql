-- ============================================================================
-- MIGRATION: Fix NULL account_id in journal_entry_lines
-- ============================================================================
-- This migration fixes the issue where get_account_by_code returns NULL
-- when accounts don't exist, causing journal entry creation to fail.

-- ============================================================================
-- FUNCTION: Get or create account by code (updated to ensure accounts exist)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_account_by_code(p_business_id UUID, p_code TEXT)
RETURNS UUID AS $$
DECLARE
  account_id UUID;
BEGIN
  -- First, ensure system accounts exist for this business
  PERFORM create_system_accounts(p_business_id);
  
  -- Now try to get the account
  SELECT id INTO account_id
  FROM accounts
  WHERE business_id = p_business_id
    AND code = p_code
    AND deleted_at IS NULL
  LIMIT 1;

  -- If still not found, raise an error with helpful message
  IF account_id IS NULL THEN
    RAISE EXCEPTION 'Account with code % not found for business %. Please ensure system accounts are created.', p_code, p_business_id;
  END IF;

  RETURN account_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Post journal entry (updated with account_id validation)
-- ============================================================================
CREATE OR REPLACE FUNCTION post_journal_entry(
  p_business_id UUID,
  p_date DATE,
  p_description TEXT,
  p_reference_type TEXT,
  p_reference_id UUID,
  p_lines JSONB
)
RETURNS UUID AS $$
DECLARE
  journal_id UUID;
  line JSONB;
  total_debit NUMERIC := 0;
  total_credit NUMERIC := 0;
  account_id UUID;
BEGIN
  -- Validate that debits equal credits
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    total_debit := total_debit + COALESCE((line->>'debit')::NUMERIC, 0);
    total_credit := total_credit + COALESCE((line->>'credit')::NUMERIC, 0);
  END LOOP;

  IF ABS(total_debit - total_credit) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry must balance. Debit: %, Credit: %', total_debit, total_credit;
  END IF;

  -- Create journal entry
  INSERT INTO journal_entries (business_id, date, description, reference_type, reference_id)
  VALUES (p_business_id, p_date, p_description, p_reference_type, p_reference_id)
  RETURNING id INTO journal_id;

  -- Create journal entry lines with validation
  FOR line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    account_id := (line->>'account_id')::UUID;
    
    -- Validate account_id is not NULL
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

-- ============================================================================
-- TRIGGER: Auto-create system accounts when business is created
-- ============================================================================
-- This ensures system accounts exist immediately when a business is created
CREATE OR REPLACE FUNCTION trigger_create_system_accounts()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create accounts for service businesses (where accounting is used)
  IF NEW.industry = 'service' THEN
    PERFORM create_system_accounts(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only create trigger if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_auto_create_system_accounts'
  ) THEN
    CREATE TRIGGER trigger_auto_create_system_accounts
      AFTER INSERT ON businesses
      FOR EACH ROW
      EXECUTE FUNCTION trigger_create_system_accounts();
  END IF;
END $$;

-- ============================================================================
-- Fix existing businesses: Create system accounts if missing
-- ============================================================================
-- This ensures all existing service businesses have system accounts
DO $$
DECLARE
  business_record RECORD;
BEGIN
  FOR business_record IN 
    SELECT id FROM businesses WHERE industry = 'service'
  LOOP
    -- Create system accounts if they don't exist
    PERFORM create_system_accounts(business_record.id);
  END LOOP;
END $$;


