-- ============================================================================
-- TEST DATABASE RESET SCRIPT
-- Step 9.1 Batch F — Reset Test Data
-- 
-- WARNING: This deletes ALL test data. Only run in TEST database.
-- 
-- Purpose: Clean slate between test runs
-- ============================================================================

-- ============================================================================
-- STEP 1: DELETE TEST DATA (in dependency order)
-- ============================================================================

-- Opening balance imports (if any exist)
DELETE FROM opening_balance_imports 
WHERE client_business_id = (SELECT id FROM businesses WHERE name = 'Test Client Business');

-- Journal entries from opening balances (if any exist)
DELETE FROM journal_entries 
WHERE source_type = 'opening_balance'
  AND business_id = (SELECT id FROM businesses WHERE name = 'Test Client Business');

-- Engagements
DELETE FROM firm_client_engagements 
WHERE accounting_firm_id = (SELECT id FROM accounting_firms WHERE name = 'Test Accounting Firm')
  OR client_business_id = (SELECT id FROM businesses WHERE name = 'Test Client Business');

-- Accounting periods
DELETE FROM accounting_periods 
WHERE business_id = (SELECT id FROM businesses WHERE name = 'Test Client Business');

-- Accounts
DELETE FROM accounts 
WHERE business_id = (SELECT id FROM businesses WHERE name = 'Test Client Business');

-- Business
DELETE FROM businesses 
WHERE name = 'Test Client Business';

-- Firm users
DELETE FROM accounting_firm_users 
WHERE firm_id = (SELECT id FROM accounting_firms WHERE name = 'Test Accounting Firm');

-- Firm
DELETE FROM accounting_firms 
WHERE name = 'Test Accounting Firm';

-- ============================================================================
-- STEP 2: VERIFY DELETION
-- ============================================================================

SELECT 
  'Reset Verification' as check_type,
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ All test data deleted'
    ELSE '⚠️ Some test data remains: ' || COUNT(*)::text
  END as status
FROM (
  SELECT 1 FROM accounting_firms WHERE name = 'Test Accounting Firm'
  UNION ALL
  SELECT 1 FROM businesses WHERE name = 'Test Client Business'
  UNION ALL
  SELECT 1 FROM firm_client_engagements 
    WHERE accounting_firm_id = (SELECT id FROM accounting_firms WHERE name = 'Test Accounting Firm' LIMIT 1)
) t;

-- ============================================================================
-- NEXT STEP: Re-run TEST_DATABASE_SEED.sql to recreate test data
-- ============================================================================
