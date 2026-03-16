-- SAFE FIX: Update business_users role check constraint to allow 'cashier'
-- This version checks existing data first and handles it safely

-- STEP 1: Check what roles currently exist in the table
-- Run this first to see what roles you have:
SELECT DISTINCT role, COUNT(*) as count
FROM business_users
GROUP BY role
ORDER BY role;

-- STEP 2: If you see any roles that are NOT: admin, manager, cashier, or employee
-- You need to update them first. For example:
-- UPDATE business_users SET role = 'employee' WHERE role = 'some_invalid_role';

-- STEP 3: Once all roles are valid, drop the existing constraint
ALTER TABLE business_users 
DROP CONSTRAINT IF EXISTS business_users_role_check;

-- STEP 4: Create new constraint that allows admin, manager, cashier, and employee
ALTER TABLE business_users
ADD CONSTRAINT business_users_role_check 
CHECK (role IN ('admin', 'manager', 'cashier', 'employee'));

-- STEP 5: Verify the constraint was created
SELECT 
  constraint_name,
  check_clause
FROM information_schema.check_constraints
WHERE constraint_schema = 'public' 
  AND constraint_name = 'business_users_role_check';

