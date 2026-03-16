-- Add pin_code column to users table for cashier PIN authentication
-- This column is nullable and only used for cashiers

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'pin_code'
  ) THEN
    ALTER TABLE users ADD COLUMN pin_code TEXT;
    CREATE INDEX IF NOT EXISTS idx_users_pin_code_store ON users(store_id, pin_code) WHERE pin_code IS NOT NULL;
    COMMENT ON COLUMN users.pin_code IS 'PIN code for cashier authentication (4-6 digits, unique per store)';
  END IF;
END $$;
