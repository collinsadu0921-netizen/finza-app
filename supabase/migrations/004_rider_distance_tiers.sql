-- Add rider_distance_tiers JSONB column to businesses table
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS rider_distance_tiers JSONB;

-- Add comment to document the structure
COMMENT ON COLUMN businesses.rider_distance_tiers IS 'Array of pricing tiers: [{"min_km": 0, "max_km": 5, "price": 20}, ...]';






















