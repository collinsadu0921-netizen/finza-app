-- Add image_url field to products table
-- BATCH 1: Product Image Field

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_url text;

-- Add comment for documentation
COMMENT ON COLUMN products.image_url IS 'URL to product image (stored in business-assets bucket or external URL)';












