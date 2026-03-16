-- Check user role for Testing@retail.com

-- Step 0: Check if user exists in auth.users (Supabase Auth)
-- Note: You may need to check Supabase Auth dashboard directly
-- This query checks the public.users table which mirrors auth.users

-- Step 0a: Search for user with case-insensitive email
SELECT 
  id, 
  email, 
  full_name,
  store_id,
  pin_code,
  created_at
FROM users 
WHERE LOWER(email) = LOWER('Testing@retail.com');

-- Step 0b: Search for any email containing "testing" or "retail"
SELECT 
  id, 
  email, 
  full_name,
  store_id,
  pin_code
FROM users 
WHERE LOWER(email) LIKE '%testing%' 
   OR LOWER(email) LIKE '%retail%'
ORDER BY email;

-- Step 0c: List ALL users to help find the right one
SELECT 
  id, 
  email, 
  full_name,
  store_id,
  pin_code,
  created_at
FROM users 
ORDER BY created_at DESC
LIMIT 20;

-- Step 1: Find your user ID first (use the ID from Step 0)
-- Replace 'YOUR_USER_ID_HERE' with the actual ID from Step 0 results

-- Step 2: Check if you're a business owner (using user ID)
-- Replace 'YOUR_USER_ID_HERE' with your actual user ID
SELECT 
  b.id as business_id,
  b.name as business_name,
  b.owner_id,
  u.email,
  u.full_name,
  CASE 
    WHEN b.owner_id = u.id THEN 'OWNER ✅'
    ELSE 'NOT OWNER'
  END as ownership_status
FROM businesses b
JOIN users u ON u.id = b.owner_id
WHERE LOWER(u.email) = LOWER('Testing@retail.com');
-- OR u.id = 'YOUR_USER_ID_HERE';  -- Uncomment and replace with your user ID if email search doesn't work

-- Step 3: Check your role in business_users table
SELECT 
  bu.user_id,
  bu.business_id,
  bu.role,
  b.name as business_name,
  u.email,
  u.full_name,
  CASE 
    WHEN bu.role = 'owner' THEN 'OWNER ✅'
    WHEN bu.role = 'admin' THEN 'ADMIN ✅'
    WHEN bu.role = 'manager' THEN 'MANAGER ✅'
    WHEN bu.role = 'cashier' THEN 'CASHIER ⚠️'
    WHEN bu.role = 'employee' THEN 'EMPLOYEE'
    ELSE 'UNKNOWN'
  END as role_status
FROM business_users bu
JOIN businesses b ON b.id = bu.business_id
JOIN users u ON u.id = bu.user_id
WHERE LOWER(u.email) = LOWER('Testing@retail.com');
-- OR bu.user_id = 'YOUR_USER_ID_HERE';  -- Uncomment and replace with your user ID if email search doesn't work

-- Step 4: Check all your roles across all businesses
SELECT 
  u.email,
  u.full_name,
  b.name as business_name,
  bu.role,
  CASE 
    WHEN b.owner_id = u.id THEN 'OWNER'
    ELSE bu.role
  END as effective_role
FROM users u
LEFT JOIN businesses b ON b.owner_id = u.id
LEFT JOIN business_users bu ON bu.user_id = u.id AND bu.business_id = b.id
WHERE LOWER(u.email) = LOWER('Testing@retail.com');
-- OR u.id = 'YOUR_USER_ID_HERE'  -- Uncomment and replace with your user ID if email search doesn't work
-- ORDER BY b.name;

-- Step 4b: Alternative - Check by user ID directly
-- First get your user ID from Step 0, then run this:
/*
SELECT 
  u.id as user_id,
  u.email,
  u.full_name,
  b.id as business_id,
  b.name as business_name,
  CASE 
    WHEN b.owner_id = u.id THEN 'OWNER'
    ELSE COALESCE(bu.role, 'NO ROLE ASSIGNED')
  END as effective_role,
  bu.role as business_users_role
FROM users u
LEFT JOIN businesses b ON b.owner_id = u.id OR EXISTS (
  SELECT 1 FROM business_users bu2 
  WHERE bu2.user_id = u.id AND bu2.business_id = b.id
)
LEFT JOIN business_users bu ON bu.user_id = u.id AND bu.business_id = b.id
WHERE u.id = 'YOUR_USER_ID_HERE'  -- Replace with your user ID from Step 0
ORDER BY b.name;
*/

-- Step 5: Update your role to admin (since you're the owner)
-- Run this to update your business_users role from 'employee' to 'admin'
-- Replace the placeholders with your actual IDs from Step 3 results

-- Option A: Update by email (easier)
UPDATE business_users 
SET role = 'admin' 
WHERE user_id = (
  SELECT id FROM users WHERE LOWER(email) = LOWER('Testing@retail.com')
)
AND role = 'employee';

-- Option B: Update by user_id and business_id (more specific)
-- Uncomment and replace with your actual IDs:
/*
UPDATE business_users 
SET role = 'admin' 
WHERE user_id = 'YOUR_USER_ID_HERE'  -- Replace with your user ID from Step 0
  AND business_id = 'YOUR_BUSINESS_ID_HERE'  -- Replace with your business_id from Step 3
  AND role = 'employee';
*/

-- Verify the update
SELECT 
  bu.role,
  b.name as business_name,
  u.email,
  u.full_name,
  CASE 
    WHEN b.owner_id = u.id THEN 'OWNER (Effective)'
    ELSE bu.role
  END as effective_role
FROM business_users bu
JOIN businesses b ON b.id = bu.business_id
JOIN users u ON u.id = bu.user_id
WHERE LOWER(u.email) = LOWER('Testing@retail.com');

