-- Migration: VAT Return Filing System for Ghana
-- Creates VAT return periods and calculations based on existing tax data

-- ============================================================================
-- VAT_RETURNS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS vat_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_start_date DATE NOT NULL,
  period_end_date DATE NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'paid')),
  
  -- Output Tax (Sales)
  total_taxable_sales NUMERIC DEFAULT 0,
  total_output_nhil NUMERIC DEFAULT 0,
  total_output_getfund NUMERIC DEFAULT 0,
  total_output_covid NUMERIC DEFAULT 0,
  total_output_vat NUMERIC DEFAULT 0,
  total_output_tax NUMERIC DEFAULT 0,
  
  -- Input Tax (Purchases)
  total_taxable_purchases NUMERIC DEFAULT 0,
  total_input_nhil NUMERIC DEFAULT 0,
  total_input_getfund NUMERIC DEFAULT 0,
  total_input_covid NUMERIC DEFAULT 0,
  total_input_vat NUMERIC DEFAULT 0,
  total_input_tax NUMERIC DEFAULT 0,
  
  -- Net Calculations
  net_vat_payable NUMERIC DEFAULT 0,
  net_vat_refund NUMERIC DEFAULT 0,
  
  -- Adjustments
  output_adjustment NUMERIC DEFAULT 0,
  input_adjustment NUMERIC DEFAULT 0,
  adjustment_reason TEXT,
  
  -- Submission Details
  submission_date DATE,
  payment_date DATE,
  payment_reference TEXT,
  notes TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  
  UNIQUE(business_id, period_start_date, period_end_date) -- One return per period
);

-- Indexes for vat_returns
CREATE INDEX IF NOT EXISTS idx_vat_returns_business_id ON vat_returns(business_id);
CREATE INDEX IF NOT EXISTS idx_vat_returns_period ON vat_returns(period_start_date, period_end_date);
CREATE INDEX IF NOT EXISTS idx_vat_returns_status ON vat_returns(status);
CREATE INDEX IF NOT EXISTS idx_vat_returns_deleted_at ON vat_returns(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- AUTO-UPDATE updated_at
-- ============================================================================
DROP TRIGGER IF EXISTS update_vat_returns_updated_at ON vat_returns;
CREATE TRIGGER update_vat_returns_updated_at
  BEFORE UPDATE ON vat_returns
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on vat_returns
ALTER TABLE vat_returns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view VAT returns for their business"
  ON vat_returns FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = vat_returns.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert VAT returns for their business"
  ON vat_returns FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = vat_returns.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update VAT returns for their business"
  ON vat_returns FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = vat_returns.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete VAT returns for their business"
  ON vat_returns FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = vat_returns.business_id
        AND businesses.owner_id = auth.uid()
    )
  );
