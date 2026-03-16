-- Fix payment_status constraint to include 'refunded' and 'voided'
-- The current constraint only allows 'pending', 'paid', 'failed'
-- But the code uses 'refunded' and 'voided' statuses

-- Drop the old constraint
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_status_check;

-- Add new constraint with all valid statuses
ALTER TABLE sales 
  ADD CONSTRAINT sales_payment_status_check 
  CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded', 'voided'));

-- Update comment to reflect the change
COMMENT ON COLUMN sales.payment_status IS 'Payment status: pending, paid, failed, refunded, or voided';




