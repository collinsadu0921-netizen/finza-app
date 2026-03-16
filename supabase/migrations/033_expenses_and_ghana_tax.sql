-- Migration: Add expenses table and enhance invoices with Ghana tax breakdown
-- This migration adds expense tracking and detailed Ghana tax fields to invoices

-- Create expense_categories table
CREATE TABLE IF NOT EXISTS expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(business_id, name)
);

-- Create expenses table
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_name TEXT NOT NULL,
  category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  expense_date DATE NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  tax_amount NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  description TEXT,
  receipt_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add Ghana tax breakdown fields to invoices
ALTER TABLE invoices 
  ADD COLUMN IF NOT EXISTS subtotal_before_tax NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nhil_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS getfund_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS covid_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_tax_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT;

-- Add Ghana tax breakdown fields to estimates
ALTER TABLE estimates 
  ADD COLUMN IF NOT EXISTS subtotal_before_tax NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nhil_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS getfund_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS covid_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_tax_amount NUMERIC DEFAULT 0;

-- Add fields to recurring_invoices for template storage
ALTER TABLE recurring_invoices
  ADD COLUMN IF NOT EXISTS template_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS end_date DATE,
  ADD COLUMN IF NOT EXISTS last_generated_at TIMESTAMP WITH TIME ZONE;

-- Create indexes for expenses
CREATE INDEX IF NOT EXISTS idx_expense_categories_business_id ON expense_categories(business_id);
CREATE INDEX IF NOT EXISTS idx_expenses_business_id ON expenses(business_id);
CREATE INDEX IF NOT EXISTS idx_expenses_category_id ON expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses(expense_date);

-- Enable RLS for new tables
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for expense_categories
CREATE POLICY "Users can view expense categories for their business" ON expense_categories
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert expense categories for their business" ON expense_categories
  FOR INSERT WITH CHECK (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update expense categories for their business" ON expense_categories
  FOR UPDATE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete expense categories for their business" ON expense_categories
  FOR DELETE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

-- Create RLS policies for expenses
CREATE POLICY "Users can view expenses for their business" ON expenses
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert expenses for their business" ON expenses
  FOR INSERT WITH CHECK (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update expenses for their business" ON expenses
  FOR UPDATE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete expenses for their business" ON expenses
  FOR DELETE USING (
    business_id IN (SELECT business_id FROM business_users WHERE user_id = auth.uid())
  );

