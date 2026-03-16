-- Add barcode column to products table
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS barcode text;

-- Create unique index for barcode per business
-- Note: PostgreSQL doesn't support partial unique indexes with IF NOT EXISTS in the same way
-- We'll use a unique constraint that allows NULL values (multiple NULLs are allowed)
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_business 
  ON products(barcode, business_id) 
  WHERE barcode IS NOT NULL;

-- Create regular index for faster lookups
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);


















