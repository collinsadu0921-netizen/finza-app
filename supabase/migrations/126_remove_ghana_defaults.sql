-- Migration: Remove Ghana Defaults from Business Profile
-- Removes DEFAULT 'Ghana' and DEFAULT 'GHS' from businesses table
-- This ensures new businesses must explicitly select country and currency

-- Remove default country (was 'Ghana')
-- This handles both migration 037 and 051 which set DEFAULT 'Ghana'
DO $$
BEGIN
  -- Check if column exists and has default
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' 
    AND column_name = 'address_country'
    AND column_default IS NOT NULL
  ) THEN
    ALTER TABLE businesses ALTER COLUMN address_country DROP DEFAULT;
  END IF;
END $$;

-- Remove default currency (was 'GHS')
-- This handles both migration 037 and 051 which set DEFAULT 'GHS'
DO $$
BEGIN
  -- Check if column exists and has default
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' 
    AND column_name = 'default_currency'
    AND column_default IS NOT NULL
  ) THEN
    ALTER TABLE businesses ALTER COLUMN default_currency DROP DEFAULT;
  END IF;
END $$;

-- Note: This migration does NOT modify existing data
-- Existing businesses with Ghana/GHS will keep their values
-- New businesses will require explicit country/currency selection

