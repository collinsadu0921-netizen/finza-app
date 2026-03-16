-- Add tax fields to sales table for VAT tracking
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS nhil numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS getfund numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS covid numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat numeric DEFAULT 0;


















