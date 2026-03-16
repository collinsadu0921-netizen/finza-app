-- ============================================================================
-- DIAGNOSTIC: Function Resolution Investigation
-- ============================================================================
-- Objective: Confirm whether failing tests are calling a different 
-- post_sale_to_ledger() function than the one we manually inspected.
-- ============================================================================

-- Step 1: Enumerate ALL visible versions of post_sale_to_ledger
-- ============================================================================
SELECT
  n.nspname       AS schema,
  p.proname       AS function_name,
  p.oid           AS function_oid,
  pg_get_function_arguments(p.oid) AS function_arguments,
  pg_get_function_result(p.oid) AS return_type,
  p.oid::regprocedure AS function_signature
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'post_sale_to_ledger'
ORDER BY n.nspname, p.oid DESC;

-- Step 2: Check current search_path and user context
-- ============================================================================
SHOW search_path;
SELECT 
  current_user, 
  current_role,
  current_database(),
  current_schema();

-- Step 3: Get full function definition for each version
-- ============================================================================
SELECT
  n.nspname       AS schema,
  p.oid           AS function_oid,
  pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'post_sale_to_ledger'
ORDER BY n.nspname, p.oid DESC;

-- Step 4: Check for functions in non-public schemas
-- ============================================================================
SELECT
  n.nspname,
  p.proname,
  p.oid,
  pg_get_function_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'post_sale_to_ledger'
  AND n.nspname <> 'public'
ORDER BY n.nspname, p.oid DESC;

-- Step 5: Check which function would be resolved for a specific call
-- ============================================================================
-- This shows which function PostgreSQL would choose for a call with these parameters
SELECT
  p.oid,
  n.nspname AS schema,
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS arguments,
  p.oid::regprocedure AS signature
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'post_sale_to_ledger'
  AND n.nspname = 'public'
ORDER BY p.oid DESC;

-- Step 6: Check function dependencies and if any are dropped/recreated
-- ============================================================================
SELECT
  p.oid,
  p.proname,
  n.nspname AS schema,
  obj_description(p.oid, 'pg_proc') AS comment,
  p.prosrc IS NOT NULL AS has_source
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'post_sale_to_ledger'
ORDER BY p.oid DESC;

-- Step 7: Check for any function overloading conflicts
-- ============================================================================
SELECT
  p.oid,
  n.nspname AS schema,
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS arguments,
  p.prokind AS kind, -- 'f' = function, 'p' = procedure, etc.
  p.provolatile AS volatility -- 'i' = immutable, 's' = stable, 'v' = volatile
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'post_sale_to_ledger'
ORDER BY n.nspname, p.oid DESC;
