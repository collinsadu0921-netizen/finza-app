-- SIMPLE Multi-Store Migration - Run this in Supabase SQL Editor
-- This version handles all edge cases and should work without errors

-- Step 1: Create stores table
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

CREATE INDEX IF NOT EXISTS idx_stores_business_id ON stores(business_id);

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all users" ON stores;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON stores;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON stores;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON stores;

CREATE POLICY "Enable read access for all users" ON stores FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users" ON stores FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Enable update for authenticated users" ON stores FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Enable delete for authenticated users" ON stores FOR DELETE USING (auth.uid() IS NOT NULL);

-- Step 2: Fix products_stock table (drop problematic FK, ensure it exists)
DO $$
BEGIN
  -- Try to drop the problematic constraint
  BEGIN
    ALTER TABLE products_stock DROP CONSTRAINT IF EXISTS products_stock_variant_id_fkey;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  
  -- Create products_stock if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'products_stock'
  ) THEN
    CREATE TABLE products_stock (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      variant_id uuid,
      store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      stock int DEFAULT 0,
      stock_quantity int DEFAULT 0,
      low_stock_threshold int DEFAULT 0,
      created_at timestamp with time zone DEFAULT now(),
      updated_at timestamp with time zone DEFAULT now(),
      UNIQUE(product_id, variant_id, store_id)
    );
  ELSE
    -- Table exists, ensure columns exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'products_stock' AND column_name = 'store_id'
    ) THEN
      ALTER TABLE products_stock ADD COLUMN store_id uuid REFERENCES stores(id) ON DELETE CASCADE;
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'products_stock' AND column_name = 'variant_id'
    ) THEN
      ALTER TABLE products_stock ADD COLUMN variant_id uuid;
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_stock_product_id ON products_stock(product_id);
CREATE INDEX IF NOT EXISTS idx_products_stock_variant_id ON products_stock(variant_id);
CREATE INDEX IF NOT EXISTS idx_products_stock_store_id ON products_stock(store_id);
CREATE INDEX IF NOT EXISTS idx_products_stock_product_store ON products_stock(product_id, store_id);

ALTER TABLE products_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all users" ON products_stock;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON products_stock;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON products_stock;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON products_stock;

CREATE POLICY "Enable read access for all users" ON products_stock FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users" ON products_stock FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Enable update for authenticated users" ON products_stock FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Enable delete for authenticated users" ON products_stock FOR DELETE USING (auth.uid() IS NOT NULL);

-- Step 3: Add store_id to sales table (CRITICAL)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'store_id'
  ) THEN
    ALTER TABLE sales ADD COLUMN store_id uuid REFERENCES stores(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_sales_store_id ON sales(store_id) WHERE store_id IS NOT NULL;
  END IF;
END $$;

-- Step 4: Add store_id to other tables
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'cashier_sessions' AND column_name = 'store_id'
  ) THEN
    ALTER TABLE cashier_sessions ADD COLUMN store_id uuid REFERENCES stores(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_cashier_sessions_store_id ON cashier_sessions(store_id) WHERE store_id IS NOT NULL;
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'stock_movements' AND column_name = 'store_id'
  ) THEN
    ALTER TABLE stock_movements ADD COLUMN store_id uuid REFERENCES stores(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_stock_movements_store_id ON stock_movements(store_id) WHERE store_id IS NOT NULL;
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'store_id'
  ) THEN
    ALTER TABLE users ADD COLUMN store_id uuid REFERENCES stores(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_users_store_id ON users(store_id) WHERE store_id IS NOT NULL;
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'registers' AND column_name = 'store_id'
  ) THEN
    ALTER TABLE registers ADD COLUMN store_id uuid REFERENCES stores(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_registers_store_id ON registers(store_id);
  END IF;
END $$;

COMMENT ON TABLE stores IS 'Store/branch locations for multi-store support';
COMMENT ON TABLE products_stock IS 'Per-store inventory quantities for products and variants';
COMMENT ON COLUMN sales.store_id IS 'Store where sale was made (for multi-store support)';



