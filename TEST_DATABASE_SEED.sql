-- ============================================================================
-- TEST DATABASE SEED SCRIPT
-- Step 9.1 Batch F — Minimal Test Data
-- 
-- Purpose: Seed minimal test data required for opening balance import tests
-- 
-- WARNING: Only run in TEST database. Never run in production/dev.
-- ============================================================================

-- ============================================================================
-- STEP 1: CREATE TEST ACCOUNTING FIRM
-- ============================================================================

INSERT INTO accounting_firms (
  id,
  name,
  registration_number,
  tax_id,
  address,
  phone,
  email,
  onboarding_status,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Test Accounting Firm',
  'TEST-FIRM-001',
  'TEST-TAX-001',
  '123 Test Street, Test City',
  '+1234567890',
  'test-firm@example.com',
  'completed',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- STEP 2: CREATE TEST USERS
-- ============================================================================

-- IMPORTANT: Users must be created in Supabase Auth FIRST
-- 
-- Option A: Via Supabase Dashboard
-- 1. Go to Authentication → Users → Add User
-- 2. Create three users:
--    - test-partner@example.com (Password: TestPassword123!)
--    - test-senior@example.com (Password: TestPassword123!)
--    - test-junior@example.com (Password: TestPassword123!)
-- 3. After creating, run this script
--
-- Option B: Via Supabase API (for automation)
-- Use Supabase Admin API to create users programmatically
--
-- Option C: Use existing users
-- If you already have test users, update the emails below to match

-- Verify users exist before proceeding
DO $$
DECLARE
  v_partner_id UUID;
  v_senior_id UUID;
  v_junior_id UUID;
BEGIN
  -- Check for Partner user
  SELECT id INTO v_partner_id
  FROM auth.users
  WHERE email = 'test-partner@example.com'
  LIMIT 1;
  
  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Partner user not found. Create test-partner@example.com in Supabase Auth first.';
  END IF;
  
  -- Check for Senior user
  SELECT id INTO v_senior_id
  FROM auth.users
  WHERE email = 'test-senior@example.com'
  LIMIT 1;
  
  IF v_senior_id IS NULL THEN
    RAISE EXCEPTION 'Senior user not found. Create test-senior@example.com in Supabase Auth first.';
  END IF;
  
  -- Check for Junior user
  SELECT id INTO v_junior_id
  FROM auth.users
  WHERE email = 'test-junior@example.com'
  LIMIT 1;
  
  IF v_junior_id IS NULL THEN
    RAISE EXCEPTION 'Junior user not found. Create test-junior@example.com in Supabase Auth first.';
  END IF;
  
  RAISE NOTICE 'All test users found. Proceeding with seed...';
END $$;

-- ============================================================================
-- STEP 3: CREATE FIRM USERS
-- ============================================================================

-- Partner User
-- Replace 'USER_ID_PARTNER' with actual user ID from auth.users
INSERT INTO accounting_firm_users (
  id,
  firm_id,
  user_id,
  role,
  created_at,
  updated_at
) VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001'::uuid,
  (SELECT id FROM auth.users WHERE email = 'test-partner@example.com' LIMIT 1),
  'partner',
  NOW(),
  NOW()
)
ON CONFLICT (firm_id, user_id) DO UPDATE SET role = 'partner';

-- Senior User
INSERT INTO accounting_firm_users (
  id,
  firm_id,
  user_id,
  role,
  created_at,
  updated_at
) VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001'::uuid,
  (SELECT id FROM auth.users WHERE email = 'test-senior@example.com' LIMIT 1),
  'senior',
  NOW(),
  NOW()
)
ON CONFLICT (firm_id, user_id) DO UPDATE SET role = 'senior';

-- Junior User
INSERT INTO accounting_firm_users (
  id,
  firm_id,
  user_id,
  role,
  created_at,
  updated_at
) VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001'::uuid,
  (SELECT id FROM auth.users WHERE email = 'test-junior@example.com' LIMIT 1),
  'junior',
  NOW(),
  NOW()
)
ON CONFLICT (firm_id, user_id) DO UPDATE SET role = 'junior';

-- ============================================================================
-- STEP 4: CREATE TEST CLIENT BUSINESS
-- ============================================================================

INSERT INTO businesses (
  id,
  name,
  industry,
  owner_id,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000002'::uuid,
  'Test Client Business',
  'service',
  (SELECT id FROM auth.users WHERE email = 'test-partner@example.com' LIMIT 1),
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- STEP 5: CREATE MINIMAL CHART OF ACCOUNTS
-- ============================================================================

-- Asset Accounts
INSERT INTO accounts (id, business_id, code, name, type, is_system, created_at, updated_at)
SELECT 
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000002'::uuid,
  '1000',
  'Cash',
  'asset',
  false,
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE business_id = '00000000-0000-0000-0000-000000000002'::uuid AND code = '1000');

INSERT INTO accounts (id, business_id, code, name, type, is_system, created_at, updated_at)
SELECT 
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000002'::uuid,
  '1200',
  'Accounts Receivable',
  'asset',
  false,
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE business_id = '00000000-0000-0000-0000-000000000002'::uuid AND code = '1200');

-- Liability Accounts
INSERT INTO accounts (id, business_id, code, name, type, is_system, created_at, updated_at)
SELECT 
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000002'::uuid,
  '2000',
  'Accounts Payable',
  'liability',
  false,
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE business_id = '00000000-0000-0000-0000-000000000002'::uuid AND code = '2000');

-- Equity Accounts
INSERT INTO accounts (id, business_id, code, name, type, is_system, created_at, updated_at)
SELECT 
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000002'::uuid,
  '3000',
  'Owner Equity',
  'equity',
  false,
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE business_id = '00000000-0000-0000-0000-000000000002'::uuid AND code = '3000');

-- ============================================================================
-- STEP 6: CREATE ACCOUNTING PERIODS
-- ============================================================================

-- First Open Period (for opening balances)
INSERT INTO accounting_periods (
  id,
  business_id,
  period_start,
  period_end,
  status,
  created_at
) VALUES (
  '00000000-0000-0000-0000-000000000003'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  DATE_TRUNC('month', CURRENT_DATE)::DATE,
  (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE,
  'open',
  NOW()
)
ON CONFLICT (business_id, period_start) DO UPDATE SET status = 'open';

-- Locked Period (for period lock tests)
INSERT INTO accounting_periods (
  id,
  business_id,
  period_start,
  period_end,
  status,
  created_at
) VALUES (
  '00000000-0000-0000-0000-000000000004'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month')::DATE,
  (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 day')::DATE,
  'locked',
  NOW()
)
ON CONFLICT (business_id, period_start) DO UPDATE SET status = 'locked';

-- ============================================================================
-- STEP 7: CREATE ACTIVE ENGAGEMENT
-- ============================================================================

INSERT INTO firm_client_engagements (
  id,
  accounting_firm_id,
  client_business_id,
  status,
  access_level,
  effective_from,
  effective_to,
  created_by,
  accepted_by,
  accepted_at,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000005'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  'active',
  'approve',
  CURRENT_DATE - INTERVAL '1 month',
  NULL,
  (SELECT id FROM auth.users WHERE email = 'test-partner@example.com' LIMIT 1),
  (SELECT id FROM auth.users WHERE email = 'test-partner@example.com' LIMIT 1),
  NOW(),
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET 
  status = 'active',
  access_level = 'approve',
  effective_from = CURRENT_DATE - INTERVAL '1 month',
  effective_to = NULL;

-- ============================================================================
-- STEP 8: VERIFICATION QUERIES
-- ============================================================================

-- Run these to verify setup:

-- SELECT 'Firm' as type, id, name FROM accounting_firms WHERE name = 'Test Accounting Firm';
-- SELECT 'Firm Users' as type, afu.role, u.email FROM accounting_firm_users afu
--   JOIN auth.users u ON afu.user_id = u.id
--   WHERE afu.firm_id = '00000000-0000-0000-0000-000000000001'::uuid;
-- SELECT 'Business' as type, id, name FROM businesses WHERE name = 'Test Client Business';
-- SELECT 'Accounts' as type, code, name, type FROM accounts 
--   WHERE business_id = '00000000-0000-0000-0000-000000000002'::uuid ORDER BY code;
-- SELECT 'Periods' as type, period_start, status FROM accounting_periods 
--   WHERE business_id = '00000000-0000-0000-0000-000000000002'::uuid ORDER BY period_start;
-- SELECT 'Engagement' as type, status, access_level, effective_from, effective_to 
--   FROM firm_client_engagements 
--   WHERE id = '00000000-0000-0000-0000-000000000005'::uuid;

-- ============================================================================
-- OUTPUT: Test Data IDs for .env.test
-- ============================================================================

-- Copy these values to .env.test after running:

-- TEST_FIRM_ID=00000000-0000-0000-0000-000000000001
-- TEST_BUSINESS_ID=00000000-0000-0000-0000-000000000002
-- TEST_OPEN_PERIOD_ID=00000000-0000-0000-0000-000000000003
-- TEST_LOCKED_PERIOD_ID=00000000-0000-0000-0000-000000000004
-- TEST_ENGAGEMENT_ID=00000000-0000-0000-0000-000000000005

-- User IDs (get from auth.users):
-- SELECT id, email FROM auth.users WHERE email IN (
--   'test-partner@example.com',
--   'test-senior@example.com',
--   'test-junior@example.com'
-- );
