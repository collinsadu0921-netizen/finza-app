-- ============================================================================
-- TEST DATABASE VERIFICATION SCRIPT
-- Step 9.1 Batch F — Verify Test Database Setup
-- 
-- Run this after applying migrations and seeding test data
-- ============================================================================

-- ============================================================================
-- 1. CHECK MIGRATIONS APPLIED
-- ============================================================================

SELECT 
  'Migration Check' as check_type,
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'opening_balance_imports')
    THEN '✅ opening_balance_imports table exists'
    ELSE '❌ opening_balance_imports table missing'
  END as status;

SELECT 
  'Migration Check' as check_type,
  CASE 
    WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'post_opening_balance_import_to_ledger')
    THEN '✅ post_opening_balance_import_to_ledger function exists'
    ELSE '❌ post_opening_balance_import_to_ledger function missing'
  END as status;

SELECT 
  'Migration Check' as check_type,
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.table_constraints 
                 WHERE constraint_name = 'opening_balance_one_per_business')
    THEN '✅ UNIQUE constraint exists'
    ELSE '❌ UNIQUE constraint missing'
  END as status;

-- ============================================================================
-- 2. CHECK TEST FIRM
-- ============================================================================

SELECT 
  'Firm Check' as check_type,
  CASE 
    WHEN COUNT(*) = 1 THEN '✅ Test firm exists'
    ELSE '❌ Test firm missing or duplicate'
  END as status,
  COUNT(*) as count
FROM accounting_firms 
WHERE name = 'Test Accounting Firm';

-- ============================================================================
-- 3. CHECK FIRM USERS
-- ============================================================================

SELECT 
  'Firm Users Check' as check_type,
  afu.role,
  CASE 
    WHEN COUNT(*) = 1 THEN '✅ ' || afu.role || ' user exists'
    ELSE '❌ ' || afu.role || ' user missing'
  END as status,
  u.email
FROM accounting_firm_users afu
JOIN auth.users u ON afu.user_id = u.id
WHERE afu.firm_id = (SELECT id FROM accounting_firms WHERE name = 'Test Accounting Firm')
GROUP BY afu.role, u.email
ORDER BY 
  CASE afu.role 
    WHEN 'partner' THEN 1
    WHEN 'senior' THEN 2
    WHEN 'junior' THEN 3
    ELSE 4
  END;

-- ============================================================================
-- 4. CHECK TEST BUSINESS
-- ============================================================================

SELECT 
  'Business Check' as check_type,
  CASE 
    WHEN COUNT(*) = 1 THEN '✅ Test business exists'
    ELSE '❌ Test business missing or duplicate'
  END as status,
  COUNT(*) as count
FROM businesses 
WHERE name = 'Test Client Business';

-- ============================================================================
-- 5. CHECK CHART OF ACCOUNTS
-- ============================================================================

SELECT 
  'Accounts Check' as check_type,
  COUNT(*) as account_count,
  CASE 
    WHEN COUNT(*) >= 4 THEN '✅ Sufficient accounts (need 4+)'
    ELSE '❌ Insufficient accounts'
  END as status
FROM accounts 
WHERE business_id = (SELECT id FROM businesses WHERE name = 'Test Client Business')
  AND type IN ('asset', 'liability', 'equity')
  AND is_system = false;

-- List accounts
SELECT 
  'Account' as type,
  code,
  name,
  type
FROM accounts 
WHERE business_id = (SELECT id FROM businesses WHERE name = 'Test Client Business')
  AND type IN ('asset', 'liability', 'equity')
  AND is_system = false
ORDER BY code;

-- ============================================================================
-- 6. CHECK ACCOUNTING PERIODS
-- ============================================================================

SELECT 
  'Periods Check' as check_type,
  period_start,
  status,
  CASE 
    WHEN status = 'open' THEN '✅ Open period exists'
    WHEN status = 'locked' THEN '✅ Locked period exists'
    ELSE '⚠️ Unexpected status'
  END as status_check
FROM accounting_periods 
WHERE business_id = (SELECT id FROM businesses WHERE name = 'Test Client Business')
ORDER BY period_start;

-- Verify first open period
SELECT 
  'First Open Period Check' as check_type,
  CASE 
    WHEN COUNT(*) = 1 AND MIN(period_start) = (
      SELECT MIN(period_start) 
      FROM accounting_periods 
      WHERE business_id = (SELECT id FROM businesses WHERE name = 'Test Client Business')
        AND status = 'open'
    )
    THEN '✅ First open period identified'
    ELSE '❌ First open period check failed'
  END as status
FROM accounting_periods 
WHERE business_id = (SELECT id FROM businesses WHERE name = 'Test Client Business')
  AND status = 'open';

-- ============================================================================
-- 7. CHECK ENGAGEMENT
-- ============================================================================

SELECT 
  'Engagement Check' as check_type,
  status,
  access_level,
  effective_from,
  effective_to,
  CASE 
    WHEN status = 'active' 
      AND access_level = 'approve'
      AND effective_from <= CURRENT_DATE
      AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
    THEN '✅ Active engagement with approve access'
    ELSE '❌ Engagement not active or invalid'
  END as status_check
FROM firm_client_engagements 
WHERE id = '00000000-0000-0000-0000-000000000005'::uuid;

-- ============================================================================
-- 8. CHECK OPENING BALANCE IMPORT TABLE STRUCTURE
-- ============================================================================

SELECT 
  'Table Structure' as check_type,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'opening_balance_imports'
ORDER BY ordinal_position;

-- ============================================================================
-- 9. CHECK CONSTRAINTS
-- ============================================================================

SELECT 
  'Constraint Check' as check_type,
  constraint_name,
  constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'opening_balance_imports'
ORDER BY constraint_name;

-- ============================================================================
-- 10. SUMMARY
-- ============================================================================

SELECT 
  'SUMMARY' as check_type,
  'Run all checks above' as instruction,
  'All checks should show ✅' as expected_result;
