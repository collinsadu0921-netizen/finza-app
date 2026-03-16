-- Add tax_id and registration_number columns to businesses table if they don't exist
-- These columns are used for invoice generation and business profile

DO $$
BEGIN
  -- Add tax_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'businesses' 
      AND column_name = 'tax_id'
  ) THEN
    ALTER TABLE businesses
      ADD COLUMN tax_id TEXT;
    
    RAISE NOTICE 'Added tax_id column to businesses table';
  ELSE
    RAISE NOTICE 'tax_id column already exists';
  END IF;

  -- Add registration_number column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'businesses' 
      AND column_name = 'registration_number'
  ) THEN
    ALTER TABLE businesses
      ADD COLUMN registration_number TEXT;
    
    RAISE NOTICE 'Added registration_number column to businesses table';
  ELSE
    RAISE NOTICE 'registration_number column already exists';
  END IF;
END $$;

-- Add comments to document the columns
COMMENT ON COLUMN businesses.tax_id IS 'Tax Identification Number (TIN) or VAT number for the business';
COMMENT ON COLUMN businesses.registration_number IS 'Business registration number or company registration number';

