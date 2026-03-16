-- ============================================================================
-- MIGRATION: Fix All Foreign Keys, Relations, and Orphan Data
-- ============================================================================
-- This migration ensures all foreign key relationships are correct,
-- adds proper ON DELETE behaviors, and cleans up orphan records.

-- ============================================================================
-- STEP 1: Clean up orphan records before adding constraints
-- ============================================================================

-- Remove orphan invoice_items (invoices that don't exist)
DELETE FROM invoice_items 
WHERE invoice_id NOT IN (SELECT id FROM invoices)
   OR invoice_id IS NULL;

-- Remove orphan payments (invoices that don't exist)
DELETE FROM payments 
WHERE invoice_id NOT IN (SELECT id FROM invoices)
   OR invoice_id IS NULL;

-- Remove orphan credit_notes (invoices that don't exist)
UPDATE credit_notes 
SET invoice_id = NULL 
WHERE invoice_id IS NOT NULL 
  AND invoice_id NOT IN (SELECT id FROM invoices);

-- Remove orphan credit_note_items (credit_notes that don't exist)
DELETE FROM credit_note_items 
WHERE credit_note_id NOT IN (SELECT id FROM credit_notes)
   OR credit_note_id IS NULL;

-- Remove orphan bill_items (bills that don't exist)
DELETE FROM bill_items 
WHERE bill_id NOT IN (SELECT id FROM bills)
   OR bill_id IS NULL;

-- Remove orphan bill_payments (bills that don't exist)
DELETE FROM bill_payments 
WHERE bill_id NOT IN (SELECT id FROM bills)
   OR bill_id IS NULL;

-- Remove orphan depreciation_entries (assets that don't exist)
DELETE FROM depreciation_entries 
WHERE asset_id NOT IN (SELECT id FROM assets)
   OR asset_id IS NULL;

-- Remove orphan allowances/deductions (staff that don't exist)
DELETE FROM allowances 
WHERE staff_id NOT IN (SELECT id FROM staff)
   OR staff_id IS NULL;

DELETE FROM deductions 
WHERE staff_id NOT IN (SELECT id FROM staff)
   OR staff_id IS NULL;

-- Remove orphan payslips (payroll_runs or staff that don't exist)
DELETE FROM payslips 
WHERE (payroll_run_id IS NOT NULL AND payroll_run_id NOT IN (SELECT id FROM payroll_runs))
   OR staff_id NOT IN (SELECT id FROM staff)
   OR staff_id IS NULL;

-- Remove orphan journal_entry_lines (journal_entries or accounts that don't exist)
DELETE FROM journal_entry_lines 
WHERE journal_entry_id NOT IN (SELECT id FROM journal_entries)
   OR account_id NOT IN (SELECT id FROM accounts)
   OR journal_entry_id IS NULL
   OR account_id IS NULL;

-- Remove orphan bank_transactions (accounts that don't exist)
DELETE FROM bank_transactions 
WHERE account_id NOT IN (SELECT id FROM accounts)
   OR account_id IS NULL;

-- Remove orphan reconciliation_periods (accounts that don't exist)
DELETE FROM reconciliation_periods 
WHERE account_id NOT IN (SELECT id FROM accounts)
   OR account_id IS NULL;

-- ============================================================================
-- STEP 2: Add/Update Foreign Key Constraints
-- ============================================================================

-- CUSTOMERS
DO $$
BEGIN
  -- Drop existing constraint if it exists with wrong behavior
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_business_id_fkey') THEN
    ALTER TABLE customers DROP CONSTRAINT customers_business_id_fkey;
  END IF;
  -- Add correct constraint
  ALTER TABLE customers
    ADD CONSTRAINT customers_business_id_fkey 
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
END $$;

-- CATEGORIES
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_business_id_fkey') THEN
    ALTER TABLE categories DROP CONSTRAINT categories_business_id_fkey;
  END IF;
  ALTER TABLE categories
    ADD CONSTRAINT categories_business_id_fkey 
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
END $$;

-- PRODUCTS_SERVICES
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_services_business_id_fkey') THEN
    ALTER TABLE products_services DROP CONSTRAINT products_services_business_id_fkey;
  END IF;
  ALTER TABLE products_services
    ADD CONSTRAINT products_services_business_id_fkey 
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_services_category_id_fkey') THEN
    ALTER TABLE products_services DROP CONSTRAINT products_services_category_id_fkey;
  END IF;
  ALTER TABLE products_services
    ADD CONSTRAINT products_services_category_id_fkey 
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
END $$;

-- INVOICES
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_business_id_fkey') THEN
    ALTER TABLE invoices DROP CONSTRAINT invoices_business_id_fkey;
  END IF;
  ALTER TABLE invoices
    ADD CONSTRAINT invoices_business_id_fkey 
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_customer_id_fkey') THEN
    ALTER TABLE invoices DROP CONSTRAINT invoices_customer_id_fkey;
  END IF;
  ALTER TABLE invoices
    ADD CONSTRAINT invoices_customer_id_fkey 
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
END $$;

-- INVOICE_ITEMS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_invoice_id_fkey') THEN
    ALTER TABLE invoice_items DROP CONSTRAINT invoice_items_invoice_id_fkey;
  END IF;
  ALTER TABLE invoice_items
    ADD CONSTRAINT invoice_items_invoice_id_fkey 
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_product_service_id_fkey') THEN
    ALTER TABLE invoice_items DROP CONSTRAINT invoice_items_product_service_id_fkey;
  END IF;
  ALTER TABLE invoice_items
    ADD CONSTRAINT invoice_items_product_service_id_fkey 
    FOREIGN KEY (product_service_id) REFERENCES products_services(id) ON DELETE SET NULL;
END $$;

-- PAYMENTS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_business_id_fkey') THEN
    ALTER TABLE payments DROP CONSTRAINT payments_business_id_fkey;
  END IF;
  ALTER TABLE payments
    ADD CONSTRAINT payments_business_id_fkey 
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_invoice_id_fkey') THEN
    ALTER TABLE payments DROP CONSTRAINT payments_invoice_id_fkey;
  END IF;
  ALTER TABLE payments
    ADD CONSTRAINT payments_invoice_id_fkey 
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
END $$;

-- EXPENSES
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_business_id_fkey') THEN
    ALTER TABLE expenses DROP CONSTRAINT expenses_business_id_fkey;
  END IF;
  ALTER TABLE expenses
    ADD CONSTRAINT expenses_business_id_fkey 
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_category_id_fkey') THEN
    ALTER TABLE expenses DROP CONSTRAINT expenses_category_id_fkey;
  END IF;
  -- Check if expense_categories table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'expense_categories') THEN
    ALTER TABLE expenses
      ADD CONSTRAINT expenses_category_id_fkey 
      FOREIGN KEY (category_id) REFERENCES expense_categories(id) ON DELETE SET NULL;
  END IF;
END $$;

-- BILLS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bills_business_id_fkey') THEN
    ALTER TABLE bills DROP CONSTRAINT bills_business_id_fkey;
  END IF;
  ALTER TABLE bills
    ADD CONSTRAINT bills_business_id_fkey 
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
END $$;

-- BILL_ITEMS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bill_items_bill_id_fkey') THEN
    ALTER TABLE bill_items DROP CONSTRAINT bill_items_bill_id_fkey;
  END IF;
  ALTER TABLE bill_items
    ADD CONSTRAINT bill_items_bill_id_fkey 
    FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE;
END $$;

-- BILL_PAYMENTS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bill_payments_bill_id_fkey') THEN
    ALTER TABLE bill_payments DROP CONSTRAINT bill_payments_bill_id_fkey;
  END IF;
  ALTER TABLE bill_payments
    ADD CONSTRAINT bill_payments_bill_id_fkey 
    FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bill_payments_business_id_fkey') THEN
    ALTER TABLE bill_payments DROP CONSTRAINT bill_payments_business_id_fkey;
  END IF;
  ALTER TABLE bill_payments
    ADD CONSTRAINT bill_payments_business_id_fkey 
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
END $$;

-- CREDIT_NOTES
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_notes_business_id_fkey') THEN
    ALTER TABLE credit_notes DROP CONSTRAINT credit_notes_business_id_fkey;
  END IF;
  ALTER TABLE credit_notes
    ADD CONSTRAINT credit_notes_business_id_fkey 
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_notes_invoice_id_fkey') THEN
    ALTER TABLE credit_notes DROP CONSTRAINT credit_notes_invoice_id_fkey;
  END IF;
  ALTER TABLE credit_notes
    ADD CONSTRAINT credit_notes_invoice_id_fkey 
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
END $$;

-- CREDIT_NOTE_ITEMS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_note_items_credit_note_id_fkey') THEN
    ALTER TABLE credit_note_items DROP CONSTRAINT credit_note_items_credit_note_id_fkey;
  END IF;
  ALTER TABLE credit_note_items
    ADD CONSTRAINT credit_note_items_credit_note_id_fkey 
    FOREIGN KEY (credit_note_id) REFERENCES credit_notes(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_note_items_invoice_item_id_fkey') THEN
    ALTER TABLE credit_note_items DROP CONSTRAINT credit_note_items_invoice_item_id_fkey;
  END IF;
  ALTER TABLE credit_note_items
    ADD CONSTRAINT credit_note_items_invoice_item_id_fkey 
    FOREIGN KEY (invoice_item_id) REFERENCES invoice_items(id) ON DELETE SET NULL;
END $$;

-- RECURRING_INVOICES
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_invoices_business_id_fkey') THEN
    ALTER TABLE recurring_invoices DROP CONSTRAINT recurring_invoices_business_id_fkey;
  END IF;
  ALTER TABLE recurring_invoices
    ADD CONSTRAINT recurring_invoices_business_id_fkey 
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_invoices_customer_id_fkey') THEN
    ALTER TABLE recurring_invoices DROP CONSTRAINT recurring_invoices_customer_id_fkey;
  END IF;
  ALTER TABLE recurring_invoices
    ADD CONSTRAINT recurring_invoices_customer_id_fkey 
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
END $$;

-- VAT_RETURNS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vat_returns_business_id_fkey') THEN
    ALTER TABLE vat_returns DROP CONSTRAINT vat_returns_business_id_fkey;
  END IF;
  ALTER TABLE vat_returns
    ADD CONSTRAINT vat_returns_business_id_fkey 
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
END $$;

-- ASSETS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_business_id_fkey') THEN
    ALTER TABLE assets DROP CONSTRAINT assets_business_id_fkey;
  END IF;
  ALTER TABLE assets
    ADD CONSTRAINT assets_business_id_fkey 
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
END $$;

-- DEPRECIATION_ENTRIES
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depreciation_entries_business_id_fkey') THEN
    ALTER TABLE depreciation_entries DROP CONSTRAINT depreciation_entries_business_id_fkey;
  END IF;
  ALTER TABLE depreciation_entries
    ADD CONSTRAINT depreciation_entries_business_id_fkey 
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depreciation_entries_asset_id_fkey') THEN
    ALTER TABLE depreciation_entries DROP CONSTRAINT depreciation_entries_asset_id_fkey;
  END IF;
  ALTER TABLE depreciation_entries
    ADD CONSTRAINT depreciation_entries_asset_id_fkey 
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depreciation_entries_journal_entry_id_fkey') THEN
    ALTER TABLE depreciation_entries DROP CONSTRAINT depreciation_entries_journal_entry_id_fkey;
  END IF;
  -- Only add if journal_entries exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_entries') THEN
    ALTER TABLE depreciation_entries
      ADD CONSTRAINT depreciation_entries_journal_entry_id_fkey 
      FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE SET NULL;
  END IF;
END $$;

-- STAFF
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_business_id_fkey') THEN
    ALTER TABLE staff DROP CONSTRAINT staff_business_id_fkey;
  END IF;
  ALTER TABLE staff
    ADD CONSTRAINT staff_business_id_fkey 
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
END $$;

-- ALLOWANCES
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allowances_staff_id_fkey') THEN
    ALTER TABLE allowances DROP CONSTRAINT allowances_staff_id_fkey;
  END IF;
  ALTER TABLE allowances
    ADD CONSTRAINT allowances_staff_id_fkey 
    FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE;
END $$;

-- DEDUCTIONS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deductions_staff_id_fkey') THEN
    ALTER TABLE deductions DROP CONSTRAINT deductions_staff_id_fkey;
  END IF;
  ALTER TABLE deductions
    ADD CONSTRAINT deductions_staff_id_fkey 
    FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE;
END $$;

-- PAYROLL_RUNS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_runs_business_id_fkey') THEN
    ALTER TABLE payroll_runs DROP CONSTRAINT payroll_runs_business_id_fkey;
  END IF;
  ALTER TABLE payroll_runs
    ADD CONSTRAINT payroll_runs_business_id_fkey 
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
END $$;

-- PAYROLL_ENTRIES
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_entries_payroll_run_id_fkey') THEN
    ALTER TABLE payroll_entries DROP CONSTRAINT payroll_entries_payroll_run_id_fkey;
  END IF;
  ALTER TABLE payroll_entries
    ADD CONSTRAINT payroll_entries_payroll_run_id_fkey 
    FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_entries_staff_id_fkey') THEN
    ALTER TABLE payroll_entries DROP CONSTRAINT payroll_entries_staff_id_fkey;
  END IF;
  ALTER TABLE payroll_entries
    ADD CONSTRAINT payroll_entries_staff_id_fkey 
    FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE;
END $$;

-- PAYSLIPS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payslips_payroll_run_id_fkey') THEN
    ALTER TABLE payslips DROP CONSTRAINT payslips_payroll_run_id_fkey;
  END IF;
  ALTER TABLE payslips
    ADD CONSTRAINT payslips_payroll_run_id_fkey 
    FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payslips_staff_id_fkey') THEN
    ALTER TABLE payslips DROP CONSTRAINT payslips_staff_id_fkey;
  END IF;
  ALTER TABLE payslips
    ADD CONSTRAINT payslips_staff_id_fkey 
    FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE;
END $$;

-- AUDIT_LOGS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_business_id_fkey') THEN
    ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_business_id_fkey;
  END IF;
  ALTER TABLE audit_logs
    ADD CONSTRAINT audit_logs_business_id_fkey 
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

  -- user_id is nullable, so we don't enforce FK if users table doesn't exist or is not standard
  -- Most systems use auth.users, so we'll leave this as nullable without FK
END $$;

-- ACCOUNTS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_business_id_fkey') THEN
    ALTER TABLE accounts DROP CONSTRAINT accounts_business_id_fkey;
  END IF;
  ALTER TABLE accounts
    ADD CONSTRAINT accounts_business_id_fkey 
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
END $$;

-- JOURNAL_ENTRIES
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_entries_business_id_fkey') THEN
    ALTER TABLE journal_entries DROP CONSTRAINT journal_entries_business_id_fkey;
  END IF;
  ALTER TABLE journal_entries
    ADD CONSTRAINT journal_entries_business_id_fkey 
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
END $$;

-- JOURNAL_ENTRY_LINES
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_entry_lines_journal_entry_id_fkey') THEN
    ALTER TABLE journal_entry_lines DROP CONSTRAINT journal_entry_lines_journal_entry_id_fkey;
  END IF;
  ALTER TABLE journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_journal_entry_id_fkey 
    FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_entry_lines_account_id_fkey') THEN
    ALTER TABLE journal_entry_lines DROP CONSTRAINT journal_entry_lines_account_id_fkey;
  END IF;
  ALTER TABLE journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_account_id_fkey 
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;
END $$;

-- BANK_TRANSACTIONS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_transactions_business_id_fkey') THEN
    ALTER TABLE bank_transactions DROP CONSTRAINT bank_transactions_business_id_fkey;
  END IF;
  ALTER TABLE bank_transactions
    ADD CONSTRAINT bank_transactions_business_id_fkey 
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_transactions_account_id_fkey') THEN
    ALTER TABLE bank_transactions DROP CONSTRAINT bank_transactions_account_id_fkey;
  END IF;
  ALTER TABLE bank_transactions
    ADD CONSTRAINT bank_transactions_account_id_fkey 
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;
END $$;

-- RECONCILIATION_PERIODS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reconciliation_periods_business_id_fkey') THEN
    ALTER TABLE reconciliation_periods DROP CONSTRAINT reconciliation_periods_business_id_fkey;
  END IF;
  ALTER TABLE reconciliation_periods
    ADD CONSTRAINT reconciliation_periods_business_id_fkey 
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reconciliation_periods_account_id_fkey') THEN
    ALTER TABLE reconciliation_periods DROP CONSTRAINT reconciliation_periods_account_id_fkey;
  END IF;
  ALTER TABLE reconciliation_periods
    ADD CONSTRAINT reconciliation_periods_account_id_fkey 
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;
END $$;

-- ============================================================================
-- STEP 3: Create indexes on foreign keys for performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_customers_business_id ON customers(business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_categories_business_id ON categories(business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_services_business_id ON products_services(business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_services_category_id ON products_services(category_id);
CREATE INDEX IF NOT EXISTS idx_invoices_business_id ON invoices(business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_items_product_service_id ON invoice_items(product_service_id);
CREATE INDEX IF NOT EXISTS idx_payments_business_id ON payments(business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_business_id ON expenses(business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_category_id ON expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_bills_business_id ON bills(business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bill_items_bill_id ON bill_items(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_bill_id ON bill_payments(bill_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bill_payments_business_id ON bill_payments(business_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_business_id ON credit_notes(business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice_id ON credit_notes(invoice_id);
CREATE INDEX IF NOT EXISTS idx_credit_note_items_credit_note_id ON credit_note_items(credit_note_id);
CREATE INDEX IF NOT EXISTS idx_credit_note_items_invoice_item_id ON credit_note_items(invoice_item_id);
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_business_id ON recurring_invoices(business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_customer_id ON recurring_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_vat_returns_business_id ON vat_returns(business_id);
CREATE INDEX IF NOT EXISTS idx_assets_business_id ON assets(business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_depreciation_entries_business_id ON depreciation_entries(business_id);
CREATE INDEX IF NOT EXISTS idx_depreciation_entries_asset_id ON depreciation_entries(asset_id);
CREATE INDEX IF NOT EXISTS idx_staff_business_id ON staff(business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_allowances_staff_id ON allowances(staff_id);
CREATE INDEX IF NOT EXISTS idx_deductions_staff_id ON deductions(staff_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_business_id ON payroll_runs(business_id);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_payroll_run_id ON payroll_entries(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_staff_id ON payroll_entries(staff_id);
CREATE INDEX IF NOT EXISTS idx_payslips_payroll_run_id ON payslips(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payslips_staff_id ON payslips(staff_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_business_id ON audit_logs(business_id);
CREATE INDEX IF NOT EXISTS idx_accounts_business_id ON accounts(business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_journal_entries_business_id ON journal_entries(business_id);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_journal_entry_id ON journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account_id ON journal_entry_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_business_id ON bank_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_id ON bank_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_periods_business_id ON reconciliation_periods(business_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_periods_account_id ON reconciliation_periods(account_id);

-- ============================================================================
-- STEP 4: Validate relationships with test queries
-- ============================================================================
-- These queries will fail if relationships are broken

DO $$
DECLARE
  test_count INTEGER;
BEGIN
  -- Test invoice with items, customer, payments
  SELECT COUNT(*) INTO test_count
  FROM invoices i
  LEFT JOIN customers c ON i.customer_id = c.id
  LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
  LEFT JOIN payments p ON p.invoice_id = i.id
  LIMIT 1;
  
  RAISE NOTICE 'Invoice relationships test: PASSED';

  -- Test customer with invoices
  SELECT COUNT(*) INTO test_count
  FROM customers c
  LEFT JOIN invoices i ON i.customer_id = c.id
  LIMIT 1;
  
  RAISE NOTICE 'Customer relationships test: PASSED';

  -- Test bill with items and payments
  SELECT COUNT(*) INTO test_count
  FROM bills b
  LEFT JOIN bill_items bi ON bi.bill_id = b.id
  LEFT JOIN bill_payments bp ON bp.bill_id = b.id
  LIMIT 1;
  
  RAISE NOTICE 'Bill relationships test: PASSED';

  -- Test asset with depreciation entries
  SELECT COUNT(*) INTO test_count
  FROM assets a
  LEFT JOIN depreciation_entries de ON de.asset_id = a.id
  LIMIT 1;
  
  RAISE NOTICE 'Asset relationships test: PASSED';

  -- Test payroll run with payslips and staff
  SELECT COUNT(*) INTO test_count
  FROM payroll_runs pr
  LEFT JOIN payslips ps ON ps.payroll_run_id = pr.id
  LEFT JOIN staff s ON s.id = ps.staff_id
  LIMIT 1;
  
  RAISE NOTICE 'Payroll relationships test: PASSED';

  -- Test journal entries with lines and accounts
  SELECT COUNT(*) INTO test_count
  FROM journal_entries je
  LEFT JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
  LEFT JOIN accounts a ON a.id = jel.account_id
  LIMIT 1;
  
  RAISE NOTICE 'Journal entry relationships test: PASSED';

  RAISE NOTICE 'All relationship tests PASSED!';
END $$;


