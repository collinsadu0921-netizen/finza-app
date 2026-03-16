-- Multi-Store Support for Retail Mode
-- Stage 32: Multi-Store Support

-- Create stores table
CREATE TABLE IF NOT EXISTS stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  location text,
  phone text,
  email text,
  opening_hours jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Create index
CREATE INDEX IF NOT EXISTS idx_stores_business_id ON stores(business_id);

-- Create products_stock table for per-store inventory
CREATE TABLE IF NOT EXISTS products_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES products_variants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  stock int DEFAULT 0,
  stock_quantity int DEFAULT 0,
  low_stock_threshold int DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(product_id, variant_id, store_id)
);

-- Create indexes for products_stock
CREATE INDEX IF NOT EXISTS idx_products_stock_product_id ON products_stock(product_id);
CREATE INDEX IF NOT EXISTS idx_products_stock_variant_id ON products_stock(variant_id);
CREATE INDEX IF NOT EXISTS idx_products_stock_store_id ON products_stock(store_id);
CREATE INDEX IF NOT EXISTS idx_products_stock_product_store ON products_stock(product_id, store_id);

-- Add store_id to users table (for staff assignment)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_store_id ON users(store_id) WHERE store_id IS NOT NULL;

-- Add store_id to registers table
ALTER TABLE registers
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_registers_store_id ON registers(store_id);

-- Add store_id to sales table
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_store_id ON sales(store_id) WHERE store_id IS NOT NULL;

-- Add store_id to stock_movements table
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_store_id ON stock_movements(store_id) WHERE store_id IS NOT NULL;

-- Add store_id to cashier_sessions table
ALTER TABLE cashier_sessions
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cashier_sessions_store_id ON cashier_sessions(store_id) WHERE store_id IS NOT NULL;

-- Enable RLS
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE products_stock ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Enable read access for all users" ON stores;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON stores;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON stores;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON stores;

DROP POLICY IF EXISTS "Enable read access for all users" ON products_stock;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON products_stock;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON products_stock;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON products_stock;

-- Create policies for stores
CREATE POLICY "Enable read access for all users" ON stores FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users" ON stores FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Enable update for authenticated users" ON stores FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Enable delete for authenticated users" ON stores FOR DELETE USING (auth.uid() IS NOT NULL);

-- Create policies for products_stock
CREATE POLICY "Enable read access for all users" ON products_stock FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users" ON products_stock FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Enable update for authenticated users" ON products_stock FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Enable delete for authenticated users" ON products_stock FOR DELETE USING (auth.uid() IS NOT NULL);

COMMENT ON TABLE stores IS 'Store/branch locations for multi-store support';
COMMENT ON TABLE products_stock IS 'Per-store inventory quantities for products and variants';
COMMENT ON COLUMN users.store_id IS 'Store assignment for staff (null = superadmin can access all stores)';
COMMENT ON COLUMN registers.store_id IS 'Store that owns this register';
COMMENT ON COLUMN sales.store_id IS 'Store where sale was made';
COMMENT ON COLUMN stock_movements.store_id IS 'Store where stock movement occurred';
COMMENT ON COLUMN cashier_sessions.store_id IS 'Store for this cashier session';







