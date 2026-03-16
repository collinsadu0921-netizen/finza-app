-- Product Variants and Modifiers for Retail Mode
-- Stage 29: Variants & Modifiers

-- Create products_variants table
CREATE TABLE IF NOT EXISTS products_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_name text NOT NULL,
  sku text,
  price numeric,
  cost_price numeric,
  stock int DEFAULT 0,
  stock_quantity int DEFAULT 0,
  barcode text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Create unique index for variant SKU per product
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_variants_sku_product 
  ON products_variants(sku, product_id) 
  WHERE sku IS NOT NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_products_variants_product_id ON products_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_products_variants_barcode ON products_variants(barcode) WHERE barcode IS NOT NULL;

-- Create product_modifiers table
CREATE TABLE IF NOT EXISTS product_modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name text NOT NULL,
  price numeric NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_product_modifiers_product_id ON product_modifiers(product_id);

-- Add variant_id to sale_items table
ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES products_variants(id) ON DELETE SET NULL;

-- Create index for variant_id
CREATE INDEX IF NOT EXISTS idx_sale_items_variant_id ON sale_items(variant_id) WHERE variant_id IS NOT NULL;

-- Enable RLS
ALTER TABLE products_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_modifiers ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Enable read access for all users" ON products_variants;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON products_variants;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON products_variants;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON products_variants;

DROP POLICY IF EXISTS "Enable read access for all users" ON product_modifiers;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON product_modifiers;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON product_modifiers;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON product_modifiers;

-- Create policies for products_variants
CREATE POLICY "Enable read access for all users" ON products_variants FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users" ON products_variants FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Enable update for authenticated users" ON products_variants FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Enable delete for authenticated users" ON products_variants FOR DELETE USING (auth.uid() IS NOT NULL);

-- Create policies for product_modifiers
CREATE POLICY "Enable read access for all users" ON product_modifiers FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users" ON product_modifiers FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Enable update for authenticated users" ON product_modifiers FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Enable delete for authenticated users" ON product_modifiers FOR DELETE USING (auth.uid() IS NOT NULL);

COMMENT ON TABLE products_variants IS 'Product variants (size, color, capacity, etc.)';
COMMENT ON TABLE product_modifiers IS 'Optional add-ons for products (warranty, gift box, etc.)';
COMMENT ON COLUMN sale_items.variant_id IS 'Reference to products_variants if this sale item used a variant';







