-- Add cash_received and change_given columns to sales table for change calculation
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS cash_received numeric,
  ADD COLUMN IF NOT EXISTS change_given numeric DEFAULT 0;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_sales_cash_received ON sales(cash_received) WHERE cash_received IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_change_given ON sales(change_given) WHERE change_given IS NOT NULL;


