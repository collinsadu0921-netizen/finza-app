-- Add multi-currency support fields to sales table
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS foreign_currency text,
  ADD COLUMN IF NOT EXISTS foreign_amount numeric,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric,
  ADD COLUMN IF NOT EXISTS converted_ghs_amount numeric;

-- Add index for currency queries
CREATE INDEX IF NOT EXISTS idx_sales_foreign_currency ON sales(foreign_currency) WHERE foreign_currency IS NOT NULL;


