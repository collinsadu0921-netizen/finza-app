-- Ensure start_date column exists in businesses table
-- This fixes "Could not find the 'start_date' column" errors

DO $$
BEGIN
  -- Add start_date column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'businesses' 
      AND column_name = 'start_date'
  ) THEN
    ALTER TABLE businesses
      ADD COLUMN start_date DATE;
    
    RAISE NOTICE 'Added start_date column to businesses table';
  ELSE
    RAISE NOTICE 'start_date column already exists in businesses table';
  END IF;

  -- Add onboarding_step column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'businesses' 
      AND column_name = 'onboarding_step'
  ) THEN
    ALTER TABLE businesses
      ADD COLUMN onboarding_step TEXT DEFAULT 'business_profile';
    
    RAISE NOTICE 'Added onboarding_step column to businesses table';
  ELSE
    RAISE NOTICE 'onboarding_step column already exists in businesses table';
  END IF;

  -- Ensure created_at has a default value
  ALTER TABLE businesses
    ALTER COLUMN created_at SET DEFAULT NOW();

END $$;

-- Verify the columns exist
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'businesses'
  AND column_name IN ('start_date', 'onboarding_step', 'created_at')
ORDER BY column_name;

