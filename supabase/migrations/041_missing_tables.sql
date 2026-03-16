-- Migration: Add Missing Tables (Estimates, Estimate Items)
-- This migration adds tables that are referenced in the codebase but may be missing
-- It uses IF NOT EXISTS to be safe if tables already exist

-- ============================================================================
-- ESTIMATES TABLE
-- ============================================================================
-- Handle existing table with wrong column name (customer_id -> client_id)
DO $$
BEGIN
  -- If table exists with customer_id, rename it
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'estimates' AND column_name = 'customer_id'
  ) THEN
    ALTER TABLE estimates RENAME COLUMN customer_id TO client_id;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  estimate_number TEXT NOT NULL,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expiry_date DATE,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  subtotal NUMERIC NOT NULL DEFAULT 0,
  subtotal_before_tax NUMERIC DEFAULT 0,
  nhil_amount NUMERIC DEFAULT 0,
  getfund_amount NUMERIC DEFAULT 0,
  covid_amount NUMERIC DEFAULT 0,
  vat_amount NUMERIC DEFAULT 0,
  total_tax_amount NUMERIC DEFAULT 0,
  tax NUMERIC DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for estimates
CREATE INDEX IF NOT EXISTS idx_estimates_business_id ON estimates(business_id);

-- Only create client_id index if column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'estimates' AND column_name = 'client_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_estimates_client_id ON estimates(client_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_estimates_estimate_number ON estimates(estimate_number);
CREATE INDEX IF NOT EXISTS idx_estimates_status ON estimates(status);
CREATE INDEX IF NOT EXISTS idx_estimates_deleted_at ON estimates(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- ESTIMATE_ITEMS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS estimate_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  price NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for estimate_items
CREATE INDEX IF NOT EXISTS idx_estimate_items_estimate_id ON estimate_items(estimate_id);
CREATE INDEX IF NOT EXISTS idx_estimate_items_product_id ON estimate_items(product_id);

-- ============================================================================
-- FUNCTION: Generate estimate number
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_estimate_number(business_uuid UUID)
RETURNS TEXT AS $$
DECLARE
  last_number INTEGER := 0;
  prefix TEXT := 'EST-';
  new_number TEXT;
BEGIN
  -- Get the last estimate number for this business
  SELECT COALESCE(
    MAX(CAST(SUBSTRING(estimate_number FROM LENGTH(prefix) + 1) AS INTEGER)),
    0
  )
  INTO last_number
  FROM estimates
  WHERE business_id = business_uuid
    AND estimate_number LIKE prefix || '%'
    AND deleted_at IS NULL;

  -- Generate new number
  new_number := prefix || LPAD((last_number + 1)::TEXT, 4, '0');

  RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- UPDATE TRIGGERS
-- ============================================================================

-- Auto-update updated_at for estimates
DROP TRIGGER IF EXISTS update_estimates_updated_at ON estimates;
CREATE TRIGGER update_estimates_updated_at
  BEFORE UPDATE ON estimates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at for estimate_items
DROP TRIGGER IF EXISTS update_estimate_items_updated_at ON estimate_items;
CREATE TRIGGER update_estimate_items_updated_at
  BEFORE UPDATE ON estimate_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on estimates
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view estimates for their business"
  ON estimates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = estimates.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert estimates for their business"
  ON estimates FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = estimates.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update estimates for their business"
  ON estimates FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = estimates.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete estimates for their business"
  ON estimates FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = estimates.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- Enable RLS on estimate_items
ALTER TABLE estimate_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view estimate items for their business"
  ON estimate_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM estimates
      JOIN businesses ON businesses.id = estimates.business_id
      WHERE estimates.id = estimate_items.estimate_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert estimate items for their business"
  ON estimate_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM estimates
      JOIN businesses ON businesses.id = estimates.business_id
      WHERE estimates.id = estimate_items.estimate_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update estimate items for their business"
  ON estimate_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM estimates
      JOIN businesses ON businesses.id = estimates.business_id
      WHERE estimates.id = estimate_items.estimate_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete estimate items for their business"
  ON estimate_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM estimates
      JOIN businesses ON businesses.id = estimates.business_id
      WHERE estimates.id = estimate_items.estimate_id
        AND businesses.owner_id = auth.uid()
    )
  );

