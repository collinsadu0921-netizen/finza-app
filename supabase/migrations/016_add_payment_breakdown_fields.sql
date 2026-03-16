-- Add payment breakdown fields to sales table for split payments
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS cash_amount numeric,
  ADD COLUMN IF NOT EXISTS momo_amount numeric,
  ADD COLUMN IF NOT EXISTS card_amount numeric,
  ADD COLUMN IF NOT EXISTS payment_lines jsonb;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_sales_cash_amount ON sales(cash_amount) WHERE cash_amount IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_momo_amount ON sales(momo_amount) WHERE momo_amount IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_card_amount ON sales(card_amount) WHERE card_amount IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_payment_lines ON sales USING gin(payment_lines) WHERE payment_lines IS NOT NULL;


