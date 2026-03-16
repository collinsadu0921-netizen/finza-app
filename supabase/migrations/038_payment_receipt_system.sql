-- Migration: Payment Receipt System
-- Adds public_token to payments and updates method constraint

-- ============================================================================
-- ENHANCE PAYMENTS TABLE
-- ============================================================================
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS public_token TEXT UNIQUE;

-- Update method constraint to include 'cheque'
DO $$
BEGIN
  -- Drop existing constraint if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'payments_method_check'
  ) THEN
    ALTER TABLE payments DROP CONSTRAINT payments_method_check;
  END IF;
  
  -- Add new constraint with cheque
  ALTER TABLE payments
    ADD CONSTRAINT payments_method_check 
    CHECK (method IN ('cash', 'bank', 'momo', 'card', 'cheque', 'other'));
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payments_public_token ON payments(public_token) WHERE public_token IS NOT NULL;

