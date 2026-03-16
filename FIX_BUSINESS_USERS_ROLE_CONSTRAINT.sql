-- QUICK FIX: Update business_users role check constraint to allow 'cashier'
-- Run this in Supabase SQL Editor to immediately fix the issue

-- Step 1: Check what roles currently exist in the table
SELECT DISTINCT role, COUNT(*) as count
FROM business_users
GROUP BY role
ORDER BY role;

-- Step 2: Update any invalid roles to 'employee' (or you can manually update them)
-- This handles any rows that might have roles not in our allowed list
-- Uncomment and modify the role values below if needed:
-- UPDATE business_users SET role = 'employee' WHERE role NOT IN ('admin', 'manager', 'cashier', 'employee');

-- Step 3: Drop the existing constraint
ALTER TABLE business_users 
DROP CONSTRAINT IF EXISTS business_users_role_check;

-- Step 4: Create new constraint that allows admin, manager, cashier, and employee
ALTER TABLE business_users
ADD CONSTRAINT business_users_role_check 
CHECK (role IN ('admin', 'manager', 'cashier', 'employee'));

-- Step 5: Verify the constraint was created
SELECT 
  constraint_name,
  check_clause
FROM information_schema.check_constraints
WHERE constraint_schema = 'public' 
  AND constraint_name = 'business_users_role_check';

-- Expected output should show:
-- constraint_name: business_users_role_check
-- check_clause: ((role = ANY (ARRAY['admin'::text, 'manager'::text, 'cashier'::text, 'employee'::text])))

