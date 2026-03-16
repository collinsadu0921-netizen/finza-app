DROP POLICY IF EXISTS "allow_all_select_audit_logs" ON audit_logs;
DROP POLICY IF EXISTS "allow_all_insert_audit_logs" ON audit_logs;
DROP POLICY IF EXISTS "allow_all_update_audit_logs" ON audit_logs;
DROP POLICY IF EXISTS "allow_all_delete_audit_logs" ON audit_logs;
DROP POLICY IF EXISTS "Enable read access for all users" ON audit_logs;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON audit_logs;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON audit_logs;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON audit_logs;
DROP POLICY IF EXISTS "Users can view audit logs for their business" ON audit_logs;
DROP POLICY IF EXISTS "Users can insert audit logs for their business" ON audit_logs;
DROP POLICY IF EXISTS "Users can update audit logs for their business" ON audit_logs;
DROP POLICY IF EXISTS "Users can delete audit logs for their business" ON audit_logs;
DROP POLICY IF EXISTS "tenant_update" ON audit_logs;
DROP POLICY IF EXISTS "tenant_delete" ON audit_logs;

DROP POLICY IF EXISTS "allow_all_select_automations" ON automations;
DROP POLICY IF EXISTS "allow_all_insert_automations" ON automations;
DROP POLICY IF EXISTS "allow_all_update_automations" ON automations;
DROP POLICY IF EXISTS "allow_all_delete_automations" ON automations;
DROP POLICY IF EXISTS "Enable read access for all users" ON automations;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON automations;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON automations;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON automations;
DROP POLICY IF EXISTS "Users can view automations for their business" ON automations;
DROP POLICY IF EXISTS "Users can insert automations for their business" ON automations;
DROP POLICY IF EXISTS "Users can update automations for their business" ON automations;
DROP POLICY IF EXISTS "Users can delete automations for their business" ON automations;

DROP POLICY IF EXISTS "allow_all_select_bank_transactions" ON bank_transactions;
DROP POLICY IF EXISTS "allow_all_insert_bank_transactions" ON bank_transactions;
DROP POLICY IF EXISTS "allow_all_update_bank_transactions" ON bank_transactions;
DROP POLICY IF EXISTS "allow_all_delete_bank_transactions" ON bank_transactions;
DROP POLICY IF EXISTS "Enable read access for all users" ON bank_transactions;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON bank_transactions;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON bank_transactions;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON bank_transactions;
DROP POLICY IF EXISTS "Users can view bank transactions for their business" ON bank_transactions;
DROP POLICY IF EXISTS "Users can insert bank transactions for their business" ON bank_transactions;
DROP POLICY IF EXISTS "Users can update bank transactions for their business" ON bank_transactions;
DROP POLICY IF EXISTS "Users can delete bank transactions for their business" ON bank_transactions;

DROP POLICY IF EXISTS "allow_all_select_bills" ON bills;
DROP POLICY IF EXISTS "allow_all_insert_bills" ON bills;
DROP POLICY IF EXISTS "allow_all_update_bills" ON bills;
DROP POLICY IF EXISTS "allow_all_delete_bills" ON bills;
DROP POLICY IF EXISTS "Enable read access for all users" ON bills;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON bills;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON bills;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON bills;
DROP POLICY IF EXISTS "Users can view bills for their business" ON bills;
DROP POLICY IF EXISTS "Users can insert bills for their business" ON bills;
DROP POLICY IF EXISTS "Users can update bills for their business" ON bills;
DROP POLICY IF EXISTS "Users can delete bills for their business" ON bills;

DROP POLICY IF EXISTS "allow_all_select_bill_items" ON bill_items;
DROP POLICY IF EXISTS "allow_all_insert_bill_items" ON bill_items;
DROP POLICY IF EXISTS "allow_all_update_bill_items" ON bill_items;
DROP POLICY IF EXISTS "allow_all_delete_bill_items" ON bill_items;
DROP POLICY IF EXISTS "Enable read access for all users" ON bill_items;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON bill_items;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON bill_items;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON bill_items;
DROP POLICY IF EXISTS "Users can view bill items for their business" ON bill_items;
DROP POLICY IF EXISTS "Users can insert bill items for their business" ON bill_items;
DROP POLICY IF EXISTS "Users can update bill items for their business" ON bill_items;
DROP POLICY IF EXISTS "Users can delete bill items for their business" ON bill_items;

DROP POLICY IF EXISTS "allow_all_select_bill_payments" ON bill_payments;
DROP POLICY IF EXISTS "allow_all_insert_bill_payments" ON bill_payments;
DROP POLICY IF EXISTS "allow_all_update_bill_payments" ON bill_payments;
DROP POLICY IF EXISTS "allow_all_delete_bill_payments" ON bill_payments;
DROP POLICY IF EXISTS "Enable read access for all users" ON bill_payments;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON bill_payments;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON bill_payments;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON bill_payments;
DROP POLICY IF EXISTS "Users can view bill payments for their business" ON bill_payments;
DROP POLICY IF EXISTS "Users can insert bill payments for their business" ON bill_payments;
DROP POLICY IF EXISTS "Users can update bill payments for their business" ON bill_payments;
DROP POLICY IF EXISTS "Users can delete bill payments for their business" ON bill_payments;

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'audit_logs',
    'automations',
    'bank_transactions',
    'bills',
    'bill_items',
    'bill_payments'
  )
ORDER BY tablename, cmd, policyname;
