-- Fix business_users role check constraint to allow 'cashier' role
-- This migration updates the check constraint to allow: admin, manager, cashier

DO $$
DECLARE
  invalid_roles TEXT[];
  role_count INTEGER;
BEGIN
  -- First, check for any invalid roles and update them
  -- Get count of rows with invalid roles
  SELECT COUNT(*) INTO role_count
  FROM business_users
  WHERE role NOT IN ('admin', 'manager', 'cashier', 'employee');
  
  IF role_count > 0 THEN
    -- Update invalid roles to 'employee' as a safe default
    UPDATE business_users 
    SET role = 'employee'
    WHERE role NOT IN ('admin', 'manager', 'cashier', 'employee');
    
    RAISE NOTICE 'Updated % row(s) with invalid roles to ''employee''', role_count;
  END IF;

  -- Drop the existing constraint if it exists
  IF EXISTS (
    SELECT 1 
    FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' 
      AND table_name = 'business_users' 
      AND constraint_name = 'business_users_role_check'
  ) THEN
    ALTER TABLE business_users DROP CONSTRAINT business_users_role_check;
    RAISE NOTICE 'Dropped existing business_users_role_check constraint';
  END IF;

  -- Create new constraint that allows admin, manager, cashier, and employee
  ALTER TABLE business_users
    ADD CONSTRAINT business_users_role_check 
    CHECK (role IN ('admin', 'manager', 'cashier', 'employee'));
  
  RAISE NOTICE 'Created new business_users_role_check constraint allowing: admin, manager, cashier, employee';
END $$;

-- Verify the constraint
SELECT 
  constraint_name,
  check_clause
FROM information_schema.check_constraints
WHERE constraint_schema = 'public' 
  AND constraint_name = 'business_users_role_check';

