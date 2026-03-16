-- Add missing pricing columns to rider_deliveries table
-- Run this in your Supabase SQL Editor

ALTER TABLE rider_deliveries
  ADD COLUMN IF NOT EXISTS distance_km NUMERIC,
  ADD COLUMN IF NOT EXISTS base_fee NUMERIC,
  ADD COLUMN IF NOT EXISTS distance_fee NUMERIC,
  ADD COLUMN IF NOT EXISTS total_fee NUMERIC;


















