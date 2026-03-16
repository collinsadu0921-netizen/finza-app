-- Migration to add start_date and onboarding_step to businesses table

DO $$
BEGIN
  -- Add start_date column (optional field for business start date)
  ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS start_date DATE;

  -- Add onboarding_step column to track onboarding progress
  ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS onboarding_step TEXT DEFAULT 'business_profile';

  -- Ensure created_at is always set (should already exist, but ensure it has default)
  ALTER TABLE businesses
    ALTER COLUMN created_at SET DEFAULT NOW();
END $$;

