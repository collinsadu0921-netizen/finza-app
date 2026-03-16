-- Add pricing columns to rider_deliveries
ALTER TABLE rider_deliveries
  ADD COLUMN IF NOT EXISTS distance_km NUMERIC,
  ADD COLUMN IF NOT EXISTS base_fee NUMERIC,
  ADD COLUMN IF NOT EXISTS distance_fee NUMERIC,
  ADD COLUMN IF NOT EXISTS total_fee NUMERIC;

-- Add rider pricing settings to businesses
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS rider_base_fee NUMERIC,
  ADD COLUMN IF NOT EXISTS rider_price_per_km NUMERIC;






















