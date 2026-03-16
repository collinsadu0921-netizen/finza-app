-- Migration: Add 'accountant' role to business_users
-- Accountants have authority to move periods to closing, close, or lock periods
-- This extends the existing role constraint

DO $$
BEGIN
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

  -- Create new constraint that includes 'accountant' role
  ALTER TABLE business_users
    ADD CONSTRAINT business_users_role_check 
    CHECK (role IN ('admin', 'manager', 'cashier', 'employee', 'accountant'));
  
  RAISE NOTICE 'Created new business_users_role_check constraint allowing: admin, manager, cashier, employee, accountant';
END $$;

-- Verify the constraint
SELECT 
  constraint_name,
  check_clause
FROM information_schema.check_constraints
WHERE constraint_schema = 'public' 
  AND constraint_name = 'business_users_role_check';

