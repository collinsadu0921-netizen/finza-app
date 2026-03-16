-- Fix bill_payments method constraint to ensure it matches allowed values
-- This fixes the "violates check constraint bill_payments_method_check" error

-- Drop existing constraint if it exists (might have different values)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'bill_payments_method_check'
  ) THEN
    ALTER TABLE bill_payments DROP CONSTRAINT bill_payments_method_check;
  END IF;
END $$;

-- Add correct constraint with all allowed payment methods
ALTER TABLE bill_payments
  ADD CONSTRAINT bill_payments_method_check 
  CHECK (method IN ('cash', 'bank', 'momo', 'cheque', 'card', 'other'));

-- Ensure method column is NOT NULL
ALTER TABLE bill_payments
  ALTER COLUMN method SET NOT NULL;

