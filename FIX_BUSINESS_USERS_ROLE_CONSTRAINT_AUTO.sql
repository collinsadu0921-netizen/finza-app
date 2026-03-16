-- AUTO FIX: Automatically handles existing invalid roles
-- This version drops the constraint FIRST, then updates roles, then recreates it

DO $$
DECLARE
  invalid_role_count INTEGER;
  role_list TEXT;
BEGIN
  -- Step 1: Drop the existing constraint FIRST (before any updates)
  -- This is critical - we must drop it before updating rows
  IF EXISTS (
    SELECT 1 
    FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' 
      AND table_name = 'business_users' 
      AND constraint_name = 'business_users_role_check'
  ) THEN
    ALTER TABLE business_users DROP CONSTRAINT business_users_role_check;
    RAISE NOTICE 'Dropped existing business_users_role_check constraint';
  ELSE
    RAISE NOTICE 'No existing constraint found';
  END IF;

  -- Step 2: Check for invalid roles (now that constraint is dropped)
  SELECT COUNT(*) INTO invalid_role_count
  FROM business_users
  WHERE role NOT IN ('admin', 'manager', 'cashier', 'employee');
  
  -- Step 3: If there are invalid roles, show what they are and update them
  IF invalid_role_count > 0 THEN
    SELECT string_agg(DISTINCT role, ', ') INTO role_list
    FROM business_users
    WHERE role NOT IN ('admin', 'manager', 'cashier', 'employee');
    
    RAISE NOTICE 'Found % row(s) with invalid roles: %', invalid_role_count, role_list;
    RAISE NOTICE 'Updating invalid roles to ''employee''...';
    
    -- Update invalid roles to 'employee' (constraint is now dropped, so this will work)
    UPDATE business_users 
    SET role = 'employee'
    WHERE role NOT IN ('admin', 'manager', 'cashier', 'employee');
    
    RAISE NOTICE 'Updated % row(s) to ''employee''', invalid_role_count;
  ELSE
    RAISE NOTICE 'No invalid roles found. All roles are valid.';
  END IF;

  -- Step 4: Create new constraint (after all updates are done)
  ALTER TABLE business_users
    ADD CONSTRAINT business_users_role_check 
    CHECK (role IN ('admin', 'manager', 'cashier', 'employee'));
  
  RAISE NOTICE 'Created new business_users_role_check constraint allowing: admin, manager, cashier, employee';
END $$;

-- Verify the constraint and show current roles
SELECT 
  constraint_name,
  check_clause
FROM information_schema.check_constraints
WHERE constraint_schema = 'public' 
  AND constraint_name = 'business_users_role_check';

-- Show all current roles in the table
SELECT DISTINCT role, COUNT(*) as count
FROM business_users
GROUP BY role
ORDER BY role;

