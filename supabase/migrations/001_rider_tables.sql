-- Create riders table
CREATE TABLE IF NOT EXISTS riders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  vehicle_type TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create rider_deliveries table
CREATE TABLE IF NOT EXISTS rider_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  pickup_location TEXT NOT NULL,
  dropoff_location TEXT NOT NULL,
  fee NUMERIC NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'momo', 'card')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_riders_business_id ON riders(business_id);
CREATE INDEX IF NOT EXISTS idx_rider_deliveries_business_id ON rider_deliveries(business_id);
CREATE INDEX IF NOT EXISTS idx_rider_deliveries_rider_id ON rider_deliveries(rider_id);
CREATE INDEX IF NOT EXISTS idx_rider_deliveries_status ON rider_deliveries(status);






















