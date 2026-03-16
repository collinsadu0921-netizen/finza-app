-- Add payment settings to businesses table
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS momo_settings jsonb,
  ADD COLUMN IF NOT EXISTS hubtel_settings jsonb;

-- Add payment tracking fields to sales table
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed')),
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS momo_transaction_id text,
  ADD COLUMN IF NOT EXISTS hubtel_transaction_id text;

-- Create index for payment status lookups
CREATE INDEX IF NOT EXISTS idx_sales_payment_status ON sales(payment_status);
CREATE INDEX IF NOT EXISTS idx_sales_momo_transaction_id ON sales(momo_transaction_id);


















