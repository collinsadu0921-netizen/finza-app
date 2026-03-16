-- Migration: Add updated_at column to businesses table if missing
-- Also ensures the update trigger exists

-- ============================================================================
-- ADD updated_at COLUMN TO businesses TABLE
-- ============================================================================
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Update existing rows to have updated_at = created_at if created_at exists
UPDATE businesses
SET updated_at = COALESCE(created_at, NOW())
WHERE updated_at IS NULL;

-- Set default for future inserts
ALTER TABLE businesses
  ALTER COLUMN updated_at SET DEFAULT NOW();

-- ============================================================================
-- CREATE OR REPLACE update_updated_at_column FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- CREATE TRIGGER FOR businesses TABLE
-- ============================================================================
DROP TRIGGER IF EXISTS update_businesses_updated_at ON businesses;

CREATE TRIGGER update_businesses_updated_at
  BEFORE UPDATE ON businesses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

