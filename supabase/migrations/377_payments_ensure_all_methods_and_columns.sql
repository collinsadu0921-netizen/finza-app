-- Ensure payments table has all required columns and method constraint is up to date.
-- Safe to re-run (all IF NOT EXISTS / DROP IF EXISTS guards).

-- Add any missing columns
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS public_token      TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS e_levy_amount     NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settlement_fx_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS wht_amount        NUMERIC DEFAULT 0;

-- Drop and recreate the method constraint to include all methods
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments
  ADD CONSTRAINT payments_method_check
  CHECK (method IN ('cash', 'bank', 'momo', 'card', 'cheque', 'paystack', 'other'));
