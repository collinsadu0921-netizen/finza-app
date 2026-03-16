-- ============================================================================
-- MIGRATION: Receipt Sends Table (Email/SMS Receipts Phase 1)
-- ============================================================================
-- This migration creates a table to log receipt sends (email/SMS).
-- No accounting impact - read-only logging of send attempts.
--
-- GUARDRAILS:
-- - Sending receipt must NOT mutate sale or ledger
-- - Failure to send must NOT block sale
-- - No receipt math outside ledger-final values
-- ============================================================================

-- ============================================================================
-- STEP 1: Create receipt_sends table
-- ============================================================================
CREATE TABLE IF NOT EXISTS receipt_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  destination TEXT NOT NULL, -- Email address or phone number
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  provider_response TEXT, -- JSON or text response from email/SMS provider
  error_message TEXT, -- Error details if status = 'failed'
  sent_at TIMESTAMP WITH TIME ZONE, -- When receipt was successfully sent
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for receipt_sends
CREATE INDEX IF NOT EXISTS idx_receipt_sends_sale_id ON receipt_sends(sale_id);
CREATE INDEX IF NOT EXISTS idx_receipt_sends_status ON receipt_sends(status);
CREATE INDEX IF NOT EXISTS idx_receipt_sends_channel ON receipt_sends(channel);
CREATE INDEX IF NOT EXISTS idx_receipt_sends_created_at ON receipt_sends(created_at DESC);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_receipt_sends_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_receipt_sends_updated_at ON receipt_sends;
CREATE TRIGGER update_receipt_sends_updated_at
  BEFORE UPDATE ON receipt_sends
  FOR EACH ROW
  EXECUTE FUNCTION update_receipt_sends_updated_at();

-- ============================================================================
-- STEP 2: RLS Policies for receipt_sends
-- ============================================================================
ALTER TABLE receipt_sends ENABLE ROW LEVEL SECURITY;

-- Users can view receipt sends for sales in their business
CREATE POLICY "Users can view receipt sends for their business"
  ON receipt_sends FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM sales
      JOIN businesses ON businesses.id = sales.business_id
      WHERE sales.id = receipt_sends.sale_id
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

-- Users can insert receipt sends for sales in their business
CREATE POLICY "Users can insert receipt sends for their business"
  ON receipt_sends FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales
      JOIN businesses ON businesses.id = sales.business_id
      WHERE sales.id = receipt_sends.sale_id
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

-- Users can update receipt sends for sales in their business
CREATE POLICY "Users can update receipt sends for their business"
  ON receipt_sends FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM sales
      JOIN businesses ON businesses.id = sales.business_id
      WHERE sales.id = receipt_sends.sale_id
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
      SELECT 1 FROM sales
      JOIN businesses ON businesses.id = sales.business_id
      WHERE sales.id = receipt_sends.sale_id
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
-- STEP 3: Add comment documenting Phase 1 constraints
-- ============================================================================
COMMENT ON TABLE receipt_sends IS 
'Receipt Sends Logging (Email/SMS Receipts Phase 1).
Read-only logging of receipt send attempts.
NO mutation of sale or ledger data.
Failures do NOT block sales.';
