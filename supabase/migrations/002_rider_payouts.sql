-- Add commission_rate column to riders table
ALTER TABLE riders ADD COLUMN IF NOT EXISTS commission_rate NUMERIC;

-- Create rider_payouts table
CREATE TABLE IF NOT EXISTS rider_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_rider_payouts_business_id ON rider_payouts(business_id);
CREATE INDEX IF NOT EXISTS idx_rider_payouts_rider_id ON rider_payouts(rider_id);
CREATE INDEX IF NOT EXISTS idx_rider_payouts_created_at ON rider_payouts(created_at);






















