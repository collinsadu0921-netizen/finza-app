-- ============================================================================
-- DEV SETUP: Accountant-First Mode (Quick Setup Script)
-- ============================================================================
-- Run this in Supabase SQL Editor to quickly set up firm + engagement
-- Replace YOUR_USER_EMAIL with your actual email
-- ============================================================================

-- Step 1: Get your user ID
DO $$
DECLARE
  v_user_id UUID;
  v_firm_id UUID;
  v_business_id UUID;
BEGIN
  -- Get user ID from email
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'YOUR_USER_EMAIL@example.com';  -- REPLACE THIS
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found. Replace YOUR_USER_EMAIL with your actual email.';
  END IF;
  
  RAISE NOTICE 'User ID: %', v_user_id;
  
  -- Step 2: Create firm
  INSERT INTO accounting_firms (name, created_by)
  VALUES ('Dev Test Accounting Firm', v_user_id)
  RETURNING id INTO v_firm_id;
  
  RAISE NOTICE 'Firm created: %', v_firm_id;
  
  -- Step 3: Add user as Partner
  INSERT INTO accounting_firm_users (firm_id, user_id, role)
  VALUES (v_firm_id, v_user_id, 'partner')
  ON CONFLICT (firm_id, user_id) DO NOTHING;
  
  RAISE NOTICE 'User added as Partner to firm';
  
  -- Step 4: Complete firm onboarding
  UPDATE accounting_firms
  SET onboarding_status = 'completed',
      onboarding_completed_at = NOW(),
      onboarding_completed_by = v_user_id,
      legal_name = 'Dev Test Accounting Firm Ltd',
      jurisdiction = 'Ghana',
      reporting_standard = 'IFRS',
      default_accounting_standard = 'IFRS'
  WHERE id = v_firm_id;
  
  RAISE NOTICE 'Firm onboarding completed';
  
  -- Step 5: Get or create a test business
  -- Option A: Use existing business (first business owned by user)
  SELECT id INTO v_business_id
  FROM businesses
  WHERE owner_id = v_user_id
  LIMIT 1;
  
  -- Option B: Create new business if none exists
  IF v_business_id IS NULL THEN
    INSERT INTO businesses (owner_id, name, industry, onboarding_step)
    VALUES (v_user_id, 'Test Client Business', 'service', 'complete')
    RETURNING id INTO v_business_id;
    
    -- Add user as admin
    INSERT INTO business_users (business_id, user_id, role)
    VALUES (v_business_id, v_user_id, 'admin')
    ON CONFLICT DO NOTHING;
    
    RAISE NOTICE 'Test business created: %', v_business_id;
  ELSE
    RAISE NOTICE 'Using existing business: %', v_business_id;
  END IF;
  
  -- Step 6: Create and accept engagement
  INSERT INTO firm_client_engagements (
    accounting_firm_id,
    client_business_id,
    status,
    access_level,
    effective_from,
    created_by,
    accepted_by,
    accepted_at
  )
  VALUES (
    v_firm_id,
    v_business_id,
    'active',  -- Skip pending, go straight to active
    'approve', -- Full access for testing
    CURRENT_DATE,
    v_user_id,
    v_user_id,  -- Self-accept
    NOW()
  )
  ON CONFLICT DO NOTHING;
  
  RAISE NOTICE 'Engagement created and accepted';
  
  -- Step 7: Output for browser console
  RAISE NOTICE '========================================';
  RAISE NOTICE 'SETUP COMPLETE!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Firm ID: %', v_firm_id;
  RAISE NOTICE 'Business ID: %', v_business_id;
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Open browser console on /accounting page';
  RAISE NOTICE '2. Run: sessionStorage.setItem(''finza_active_firm_id'', ''%'')', v_firm_id;
  RAISE NOTICE '3. Run: sessionStorage.setItem(''finza_active_client_business_id'', ''%'')', v_business_id;
  RAISE NOTICE '4. Refresh page';
  RAISE NOTICE '5. Navigate to /accounting/periods';
  RAISE NOTICE '========================================';
  
END $$;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Check firm was created
SELECT 
  af.id as firm_id,
  af.name as firm_name,
  af.onboarding_status,
  afu.role as your_role
FROM accounting_firms af
JOIN accounting_firm_users afu ON afu.firm_id = af.id
JOIN auth.users u ON u.id = afu.user_id
WHERE u.email = 'YOUR_USER_EMAIL@example.com';  -- REPLACE THIS

-- Check engagement was created
SELECT 
  fce.id as engagement_id,
  fce.status,
  fce.access_level,
  fce.effective_from,
  b.name as client_business_name,
  af.name as firm_name
FROM firm_client_engagements fce
JOIN accounting_firms af ON af.id = fce.accounting_firm_id
JOIN businesses b ON b.id = fce.client_business_id
JOIN accounting_firm_users afu ON afu.firm_id = af.id
JOIN auth.users u ON u.id = afu.user_id
WHERE u.email = 'YOUR_USER_EMAIL@example.com'  -- REPLACE THIS
  AND fce.status = 'active';
