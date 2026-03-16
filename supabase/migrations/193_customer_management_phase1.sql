-- ============================================================================
-- MIGRATION: Customer Management (Phase 1 - Identity Only)
-- ============================================================================
-- This migration adds customer management to POS with ZERO accounting impact.
-- Customers are identity only. No balances. No credit. No AR.
--
-- Changes:
-- 1. Create customers table (identity only - no financial fields)
-- 2. Add customer_id to sales table (nullable)
-- 3. Add customer_id to refunds (via overrides table if needed, or track via sale)
--
-- GUARDRAILS:
-- - No customer balances
-- - No AR creation
-- - No credit logic
-- - No invoice math
-- - Ledger posting must remain unchanged
-- ============================================================================

-- ============================================================================
-- STEP 1: Create customers table
-- ============================================================================
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add status column if it doesn't exist (table may already exist from accounting system)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('active', 'blocked')) DEFAULT 'active';

-- Indexes for customers
CREATE INDEX IF NOT EXISTS idx_customers_business_id ON customers(business_id);
-- Status index must be created after status column is added
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(business_id, name);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(business_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(business_id, email) WHERE email IS NOT NULL;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_customers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_customers_updated_at ON customers;
CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION update_customers_updated_at();

-- ============================================================================
-- STEP 2: Add customer_id to sales table
-- ============================================================================
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_customer_id ON sales(customer_id) WHERE customer_id IS NOT NULL;

-- ============================================================================
-- STEP 3: RLS Policies for customers
-- ============================================================================
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- Users can view customers for their business
CREATE POLICY "Users can view customers for their business"
  ON customers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = customers.business_id
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  );

-- Users can insert customers for their business
CREATE POLICY "Users can insert customers for their business"
  ON customers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = customers.business_id
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  );

-- Users can update customers for their business
CREATE POLICY "Users can update customers for their business"
  ON customers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = customers.business_id
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = customers.business_id
      AND (
        businesses.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM business_users
          WHERE business_users.business_id = businesses.id
          AND business_users.user_id = auth.uid()
        )
      )
    )
  );

-- ============================================================================
-- STEP 4: Add comment documenting Phase 1 constraints
-- ============================================================================
COMMENT ON TABLE customers IS 
'Customer Management Phase 1 - Identity Only. 
NO balances, NO credit, NO AR. 
Customers are identity only for sales tracking and receipt delivery.';

COMMENT ON COLUMN sales.customer_id IS 
'Optional customer reference for identity tracking only. 
Does NOT affect ledger posting or accounting calculations.';
