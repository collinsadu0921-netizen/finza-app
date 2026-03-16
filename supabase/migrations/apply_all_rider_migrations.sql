-- Combined migration file to apply all rider-related schema changes
-- Run this in your Supabase SQL Editor if migrations haven't been applied

-- Migration 003: Add pricing columns to rider_deliveries and businesses
ALTER TABLE rider_deliveries
  ADD COLUMN IF NOT EXISTS distance_km NUMERIC,
  ADD COLUMN IF NOT EXISTS base_fee NUMERIC,
  ADD COLUMN IF NOT EXISTS distance_fee NUMERIC,
  ADD COLUMN IF NOT EXISTS total_fee NUMERIC;

-- Add rider pricing settings to businesses
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS rider_base_fee NUMERIC,
  ADD COLUMN IF NOT EXISTS rider_price_per_km NUMERIC;

-- Migration 004: Add rider_distance_tiers JSONB column to businesses
ALTER TABLE businesses 
  ADD COLUMN IF NOT EXISTS rider_distance_tiers JSONB;

-- Add comment to document the structure
COMMENT ON COLUMN businesses.rider_distance_tiers IS 'Array of pricing tiers: [{"min_km": 0, "max_km": 5, "price": 20}, ...]';


















