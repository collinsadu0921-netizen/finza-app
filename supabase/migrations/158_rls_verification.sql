-- A1: RLS flags (enabled/forced)

SELECT 
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'accounting_periods',
    'accounting_balances',
    'ledger_entries',
    'sales',
    'sale_items',
    'payments',
    'bills',
    'bill_items',
    'bill_payments',
    'bank_transactions',
    'products',
    'products_stock',
    'stock_movements',
    'stores',
    'registers',
    'business_reminder_settings',
    'automations',
    'audit_logs'
  )
ORDER BY c.relname;

-- A2: Existing policies (pg_policies)

SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'accounting_periods',
    'accounting_balances',
    'ledger_entries',
    'sales',
    'sale_items',
    'payments',
    'bills',
    'bill_items',
    'bill_payments',
    'bank_transactions',
    'products',
    'products_stock',
    'stock_movements',
    'stores',
    'registers',
    'business_reminder_settings',
    'automations',
    'audit_logs'
  )
ORDER BY tablename, policyname;

-- A3: Tables missing business_id (if any)

SELECT 
  t.table_name,
  CASE 
    WHEN c.column_name IS NULL THEN 'MISSING business_id'
    ELSE 'HAS business_id'
  END AS business_id_status
FROM information_schema.tables t
LEFT JOIN information_schema.columns c 
  ON t.table_schema = c.table_schema 
  AND t.table_name = c.table_name 
  AND c.column_name = 'business_id'
WHERE t.table_schema = 'public'
  AND t.table_name IN (
    'accounting_periods',
    'accounting_balances',
    'ledger_entries',
    'sales',
    'sale_items',
    'payments',
    'bills',
    'bill_items',
    'bill_payments',
    'bank_transactions',
    'products',
    'products_stock',
    'stock_movements',
    'stores',
    'registers',
    'business_reminder_settings',
    'automations',
    'audit_logs'
  )
ORDER BY t.table_name;

-- A4: Table privileges (information_schema.role_table_grants)

SELECT 
  grantee,
  table_schema,
  table_name,
  privilege_type,
  is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'accounting_periods',
    'accounting_balances',
    'ledger_entries',
    'sales',
    'sale_items',
    'payments',
    'bills',
    'bill_items',
    'bill_payments',
    'bank_transactions',
    'products',
    'products_stock',
    'stock_movements',
    'stores',
    'registers',
    'business_reminder_settings',
    'automations',
    'audit_logs'
  )
ORDER BY table_name, grantee, privilege_type;

-- A5: FK constraints (pg_constraint) for the join-based tables

SELECT
  tc.table_schema,
  tc.table_name AS child_table,
  kcu.column_name AS child_column,
  ccu.table_schema AS parent_table_schema,
  ccu.table_name AS parent_table,
  ccu.column_name AS parent_column,
  rc.update_rule,
  rc.delete_rule,
  con.conname AS constraint_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints AS rc
  ON rc.constraint_name = tc.constraint_name
  AND rc.constraint_schema = tc.table_schema
JOIN pg_constraint con ON con.conname = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND (
    (tc.table_name = 'sale_items' AND ccu.table_name = 'sales')
    OR (tc.table_name = 'bill_items' AND ccu.table_name = 'bills')
    OR (tc.table_name = 'products_stock' AND ccu.table_name = 'products')
  )
ORDER BY tc.table_name, kcu.column_name;
