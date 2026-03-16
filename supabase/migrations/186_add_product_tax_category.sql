-- Step 1: Product Tax Classification (safe)
-- Add product-level tax_category (taxable | zero_rated | exempt).
-- No tax amounts, rates, or defaults. Explicit only.
--
-- Apply: Run this migration (e.g. supabase db push, or run this SQL in Supabase SQL Editor).
-- After applying, reload PostgREST schema cache if you see "Could not find the 'tax_category'
-- column of 'products' in the schema cache" (Supabase Dashboard -> Project Settings -> API ->
-- Reload schema cache, or redeploy). Existing products keep tax_category NULL until set via Edit.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS tax_category TEXT;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_tax_category_check;

ALTER TABLE products
  ADD CONSTRAINT products_tax_category_check
  CHECK (tax_category IS NULL OR tax_category IN ('taxable', 'zero_rated', 'exempt'));

COMMENT ON COLUMN products.tax_category IS 'Product tax classification: taxable, zero_rated, or exempt. Must be explicitly set on create/update. No default. Existing rows: set via edit UI.';
