-- ============================================================================
-- MIGRATION: Fix All Table Structures to Match Code Expectations
-- ============================================================================
-- This migration ensures all tables have the correct columns and structure
-- to match what the application code expects.

-- ============================================================================
-- CREATE EXPENSE_CATEGORIES TABLE FIRST (required for expenses foreign key)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'expense_categories') THEN
    CREATE TABLE expense_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(business_id, name)
    );

    CREATE INDEX IF NOT EXISTS idx_expense_categories_business_id ON expense_categories(business_id);
    
    ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "allow_all_select_expense_categories" ON expense_categories;
    CREATE POLICY "allow_all_select_expense_categories" ON expense_categories FOR SELECT USING (true);
    
    DROP POLICY IF EXISTS "allow_all_insert_expense_categories" ON expense_categories;
    CREATE POLICY "allow_all_insert_expense_categories" ON expense_categories FOR INSERT WITH CHECK (true);
    
    DROP POLICY IF EXISTS "allow_all_update_expense_categories" ON expense_categories;
    CREATE POLICY "allow_all_update_expense_categories" ON expense_categories FOR UPDATE USING (true);
    
    DROP POLICY IF EXISTS "allow_all_delete_expense_categories" ON expense_categories;
    CREATE POLICY "allow_all_delete_expense_categories" ON expense_categories FOR DELETE USING (true);
  END IF;
END $$;

-- ============================================================================
-- FIX EXPENSES TABLE
-- ============================================================================
-- The expenses table needs to match what the API expects:
-- supplier (not supplier_name), date (not expense_date), total (not total_amount),
-- receipt_path (not receipt_url), and Ghana tax fields

DO $$
BEGIN
  -- Check if expenses table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'expenses') THEN
    -- Add missing columns if they don't exist
    ALTER TABLE expenses
      ADD COLUMN IF NOT EXISTS supplier TEXT,
      ADD COLUMN IF NOT EXISTS date DATE,
      ADD COLUMN IF NOT EXISTS total NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS receipt_path TEXT,
      ADD COLUMN IF NOT EXISTS nhil NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS getfund NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS covid NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS vat NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

    -- Ensure NOT NULL columns have defaults (canonical columns only; no legacy names)
    UPDATE expenses SET supplier = COALESCE(supplier, 'Unknown Supplier') WHERE supplier IS NULL;
    UPDATE expenses SET date = COALESCE(date, CURRENT_DATE) WHERE date IS NULL;
    UPDATE expenses SET total = COALESCE(total, 0) WHERE total IS NULL;
    
    -- Now set NOT NULL constraints
    ALTER TABLE expenses
      ALTER COLUMN supplier SET NOT NULL,
      ALTER COLUMN date SET NOT NULL,
      ALTER COLUMN total SET NOT NULL;

    -- Drop old columns if they exist and new ones are populated
    ALTER TABLE expenses
      DROP COLUMN IF EXISTS supplier_name,
      DROP COLUMN IF EXISTS expense_date,
      DROP COLUMN IF EXISTS total_amount,
      DROP COLUMN IF EXISTS receipt_url,
      DROP COLUMN IF EXISTS tax_amount;
  ELSE
    -- Ensure expense_categories exists before creating expenses (double-check)
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'expense_categories') THEN
      CREATE TABLE expense_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(business_id, name)
      );
      CREATE INDEX IF NOT EXISTS idx_expense_categories_business_id ON expense_categories(business_id);
      ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
    END IF;

    -- Create expenses table with correct structure
    CREATE TABLE expenses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      supplier TEXT NOT NULL,
      category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
      amount NUMERIC NOT NULL DEFAULT 0,
      nhil NUMERIC DEFAULT 0,
      getfund NUMERIC DEFAULT 0,
      covid NUMERIC DEFAULT 0,
      vat NUMERIC DEFAULT 0,
      total NUMERIC NOT NULL DEFAULT 0,
      date DATE NOT NULL,
      notes TEXT,
      receipt_path TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      deleted_at TIMESTAMP WITH TIME ZONE
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_expenses_business_id ON expenses(business_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_category_id ON expenses(category_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
    CREATE INDEX IF NOT EXISTS idx_expenses_deleted_at ON expenses(deleted_at) WHERE deleted_at IS NULL;

    -- Enable RLS (scoped policies from 230_expenses_rls_canonical)
    ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ============================================================================
-- ENSURE ALL CORE TABLES EXIST
-- ============================================================================

-- Businesses table (should already exist, but ensure it has required columns)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'businesses') THEN
    CREATE TABLE businesses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id UUID NOT NULL,
      name TEXT NOT NULL,
      industry TEXT,
      legal_name TEXT,
      trading_name TEXT,
      address TEXT,
      phone TEXT,
      whatsapp_phone TEXT,
      email TEXT,
      website TEXT,
      tin TEXT,
      logo_url TEXT,
      default_currency TEXT DEFAULT 'GHS',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  END IF;

  -- Add missing columns to businesses if they don't exist
  ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS legal_name TEXT,
    ADD COLUMN IF NOT EXISTS trading_name TEXT,
    ADD COLUMN IF NOT EXISTS address TEXT,
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT,
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS website TEXT,
    ADD COLUMN IF NOT EXISTS tin TEXT,
    ADD COLUMN IF NOT EXISTS logo_url TEXT,
    ADD COLUMN IF NOT EXISTS default_currency TEXT DEFAULT 'GHS',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

  -- Ensure updated_at has a default value
  ALTER TABLE businesses
    ALTER COLUMN updated_at SET DEFAULT NOW();

  -- Update existing rows to have updated_at = created_at if created_at exists
  UPDATE businesses
  SET updated_at = COALESCE(created_at, NOW())
  WHERE updated_at IS NULL;
END $$;

-- Users table (should already exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
    CREATE TABLE users (
      id UUID PRIMARY KEY,
      email TEXT,
      full_name TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  END IF;
END $$;

-- Business users table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_users') THEN
    CREATE TABLE business_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      role TEXT NOT NULL DEFAULT 'employee',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(business_id, user_id)
    );
  END IF;
END $$;

-- ============================================================================
-- VERIFY INVOICE SYSTEM TABLES
-- ============================================================================
-- These should be created by migration 036, but verify they exist

DO $$
BEGIN
  -- Customers
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customers') THEN
    CREATE TABLE customers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      whatsapp_phone TEXT,
      address TEXT,
      tin TEXT,
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      deleted_at TIMESTAMP WITH TIME ZONE
    );
  END IF;

  -- Categories
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'categories') THEN
    CREATE TABLE categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      deleted_at TIMESTAMP WITH TIME ZONE,
      UNIQUE(business_id, name)
    );
  END IF;

  -- Products Services
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products_services') THEN
    CREATE TABLE products_services (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('service', 'product')),
      category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
      unit_price NUMERIC NOT NULL DEFAULT 0,
      description TEXT,
      tax_applicable BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      deleted_at TIMESTAMP WITH TIME ZONE
    );
  END IF;

  -- Invoices (verify structure)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'invoices') THEN
    ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS apply_taxes BOOLEAN DEFAULT true,
      ADD COLUMN IF NOT EXISTS public_token TEXT,
      ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS currency_code TEXT DEFAULT 'GHS',
      ADD COLUMN IF NOT EXISTS currency_symbol TEXT DEFAULT '₵',
      ADD COLUMN IF NOT EXISTS total_tax NUMERIC DEFAULT 0;
  END IF;

  -- Invoice Items
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'invoice_items') THEN
    CREATE TABLE invoice_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      product_service_id UUID REFERENCES products_services(id) ON DELETE SET NULL,
      description TEXT NOT NULL,
      qty NUMERIC NOT NULL DEFAULT 0,
      unit_price NUMERIC NOT NULL DEFAULT 0,
      discount_amount NUMERIC DEFAULT 0,
      line_subtotal NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      deleted_at TIMESTAMP WITH TIME ZONE
    );
  END IF;

  -- Payments
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payments') THEN
    CREATE TABLE payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      amount NUMERIC NOT NULL,
      date DATE NOT NULL,
      method TEXT NOT NULL CHECK (method IN ('cash', 'bank', 'momo', 'card', 'cheque', 'other')),
      reference TEXT,
      notes TEXT,
      e_levy_amount NUMERIC DEFAULT 0,
      public_token TEXT UNIQUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      deleted_at TIMESTAMP WITH TIME ZONE
    );
  END IF;
END $$;

-- ============================================================================
-- VERIFY BILLS TABLE STRUCTURE
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bills') THEN
    -- Ensure all required columns exist
    ALTER TABLE bills
      ADD COLUMN IF NOT EXISTS total_tax NUMERIC DEFAULT 0;
  END IF;
END $$;

-- ============================================================================
-- VERIFY CREDIT NOTES TABLE STRUCTURE
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'credit_notes') THEN
    ALTER TABLE credit_notes
      ADD COLUMN IF NOT EXISTS total_tax NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS public_token TEXT UNIQUE;
  END IF;
END $$;

-- ============================================================================
-- VERIFY RECURRING INVOICES TABLE
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'recurring_invoices') THEN
    CREATE TABLE recurring_invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
      frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
      next_run_date DATE NOT NULL,
      last_run_date DATE,
      auto_send BOOLEAN DEFAULT false,
      auto_whatsapp BOOLEAN DEFAULT false,
      invoice_template_data JSONB NOT NULL,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused')),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      deleted_at TIMESTAMP WITH TIME ZONE
    );
  END IF;
END $$;

-- ============================================================================
-- VERIFY VAT RETURNS TABLE
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vat_returns') THEN
    CREATE TABLE vat_returns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      period_start_date DATE NOT NULL,
      period_end_date DATE NOT NULL,
      status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'paid')),
      total_taxable_sales NUMERIC DEFAULT 0,
      total_output_nhil NUMERIC DEFAULT 0,
      total_output_getfund NUMERIC DEFAULT 0,
      total_output_covid NUMERIC DEFAULT 0,
      total_output_vat NUMERIC DEFAULT 0,
      total_output_tax NUMERIC DEFAULT 0,
      total_taxable_purchases NUMERIC DEFAULT 0,
      total_input_nhil NUMERIC DEFAULT 0,
      total_input_getfund NUMERIC DEFAULT 0,
      total_input_covid NUMERIC DEFAULT 0,
      total_input_vat NUMERIC DEFAULT 0,
      total_input_tax NUMERIC DEFAULT 0,
      net_vat_payable NUMERIC DEFAULT 0,
      net_vat_refund NUMERIC DEFAULT 0,
      adjustments JSONB,
      notes TEXT,
      submission_date DATE,
      payment_date DATE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(business_id, period_start_date)
    );
  END IF;
END $$;

-- ============================================================================
-- VERIFY ASSETS TABLE
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'assets') THEN
    CREATE TABLE assets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      asset_code TEXT,
      category TEXT,
      purchase_date DATE NOT NULL,
      purchase_amount NUMERIC NOT NULL,
      supplier_name TEXT,
      useful_life_years INTEGER,
      depreciation_method TEXT DEFAULT 'straight_line' CHECK (depreciation_method = 'straight_line'),
      salvage_value NUMERIC DEFAULT 0,
      current_value NUMERIC NOT NULL,
      accumulated_depreciation NUMERIC DEFAULT 0,
      notes TEXT,
      attachment_path TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      deleted_at TIMESTAMP WITH TIME ZONE
    );
  END IF;
END $$;

-- ============================================================================
-- VERIFY PAYROLL TABLES
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'staff') THEN
    CREATE TABLE staff (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position TEXT,
      phone TEXT,
      whatsapp_phone TEXT,
      email TEXT,
      basic_salary NUMERIC NOT NULL DEFAULT 0,
      start_date DATE,
      employment_type TEXT,
      bank_name TEXT,
      bank_account TEXT,
      ssnit_number TEXT,
      tin_number TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      deleted_at TIMESTAMP WITH TIME ZONE
    );
  END IF;
END $$;

-- ============================================================================
-- VERIFY AUDIT LOGS TABLE
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
    CREATE TABLE audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      user_id UUID,
      action_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id UUID,
      old_values JSONB,
      new_values JSONB,
      ip_address TEXT,
      user_agent TEXT,
      description TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  END IF;
END $$;

-- ============================================================================
-- VERIFY ACCOUNTING TABLES
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'accounts') THEN
    CREATE TABLE accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
      description TEXT,
      is_system BOOLEAN DEFAULT false,
      is_reconcilable BOOLEAN DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      deleted_at TIMESTAMP WITH TIME ZONE,
      UNIQUE(business_id, code)
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_entries') THEN
    CREATE TABLE journal_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      description TEXT NOT NULL,
      reference_type TEXT,
      reference_id UUID,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_entry_lines') THEN
    CREATE TABLE journal_entry_lines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      debit NUMERIC NOT NULL DEFAULT 0,
      credit NUMERIC NOT NULL DEFAULT 0,
      description TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  END IF;
END $$;

-- ============================================================================
-- VERIFY RECONCILIATION TABLES
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bank_transactions') THEN
    CREATE TABLE bank_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      date DATE NOT NULL,
      description TEXT,
      amount NUMERIC NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('debit', 'credit')),
      external_ref TEXT,
      status TEXT DEFAULT 'unreconciled' CHECK (status IN ('unreconciled', 'matched', 'ignored')),
      matches JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reconciliation_periods') THEN
    CREATE TABLE reconciliation_periods (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      reconciled_by UUID,
      reconciled_at TIMESTAMP WITH TIME ZONE,
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  END IF;
END $$;

-- ============================================================================
-- CREATE MISSING INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_expenses_business_id ON expenses(business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_bills_business_id ON bills(business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_credit_notes_business_id ON credit_notes(business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vat_returns_business_id ON vat_returns(business_id);
CREATE INDEX IF NOT EXISTS idx_assets_business_id ON assets(business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_staff_business_id ON staff(business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_business_id ON audit_logs(business_id);
CREATE INDEX IF NOT EXISTS idx_accounts_business_id ON accounts(business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_journal_entries_business_id ON journal_entries(business_id);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_journal_entry_id ON journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account_id ON journal_entry_lines(account_id);

-- ============================================================================
-- ENABLE RLS ON ALL TABLES (with permissive policies for development)
-- ============================================================================
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOR table_name IN 
    SELECT tablename FROM pg_tables 
    WHERE schemaname = 'public' 
      AND tablename IN (
        'bills', 'bill_items', 'bill_payments', 'credit_notes',
        'credit_note_items', 'recurring_invoices', 'vat_returns', 'assets',
        'depreciation_entries', 'staff', 'allowances', 'deductions',
        'payroll_runs', 'payroll_entries', 'payslips', 'audit_logs',
        'bank_transactions', 'reconciliation_periods', 'accounts'
      )
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    
    -- Create permissive policies (AUTH DISABLED FOR DEVELOPMENT)
    EXECUTE format('DROP POLICY IF EXISTS "allow_all_select_%s" ON %I', table_name, table_name);
    EXECUTE format('CREATE POLICY "allow_all_select_%s" ON %I FOR SELECT USING (true)', table_name, table_name);
    
    EXECUTE format('DROP POLICY IF EXISTS "allow_all_insert_%s" ON %I', table_name, table_name);
    EXECUTE format('CREATE POLICY "allow_all_insert_%s" ON %I FOR INSERT WITH CHECK (true)', table_name, table_name);
    
    EXECUTE format('DROP POLICY IF EXISTS "allow_all_update_%s" ON %I', table_name, table_name);
    EXECUTE format('CREATE POLICY "allow_all_update_%s" ON %I FOR UPDATE USING (true)', table_name, table_name);
    
    EXECUTE format('DROP POLICY IF EXISTS "allow_all_delete_%s" ON %I', table_name, table_name);
    EXECUTE format('CREATE POLICY "allow_all_delete_%s" ON %I FOR DELETE USING (true)', table_name, table_name);
  END LOOP;
END $$;

-- ============================================================================
-- DEFENSIVE: Drop permissive RLS on accounting tables (no USING(true)/allow_all_*)
-- ============================================================================
DROP POLICY IF EXISTS "Users can view expenses for their business" ON expenses;
DROP POLICY IF EXISTS "Users can insert expenses for their business" ON expenses;
DROP POLICY IF EXISTS "Users can update expenses for their business" ON expenses;
DROP POLICY IF EXISTS "Users can delete expenses for their business" ON expenses;
DROP POLICY IF EXISTS "allow_all_select_expenses" ON expenses;
DROP POLICY IF EXISTS "allow_all_insert_expenses" ON expenses;
DROP POLICY IF EXISTS "allow_all_update_expenses" ON expenses;
DROP POLICY IF EXISTS "allow_all_delete_expenses" ON expenses;
DROP POLICY IF EXISTS "allow_all_select_journal_entries" ON journal_entries;
DROP POLICY IF EXISTS "allow_all_insert_journal_entries" ON journal_entries;
DROP POLICY IF EXISTS "allow_all_update_journal_entries" ON journal_entries;
DROP POLICY IF EXISTS "allow_all_delete_journal_entries" ON journal_entries;
DROP POLICY IF EXISTS "allow_all_select_journal_entry_lines" ON journal_entry_lines;
DROP POLICY IF EXISTS "allow_all_insert_journal_entry_lines" ON journal_entry_lines;
DROP POLICY IF EXISTS "allow_all_update_journal_entry_lines" ON journal_entry_lines;
DROP POLICY IF EXISTS "allow_all_delete_journal_entry_lines" ON journal_entry_lines;