-- Comprehensive Multi-Store Support Migration
-- This migration ensures all multi-store components are in place
-- Run this migration to set up complete multi-store functionality

-- Step 0: Drop any problematic foreign key constraints that reference non-existent tables
-- This must happen FIRST before any other operations
-- Simply try to drop common constraint names without checking (to avoid triggering validation)
DO $$
BEGIN
  -- Try to drop the constraint - if it doesn't exist, that's fine
  ALTER TABLE products_stock DROP CONSTRAINT IF EXISTS products_stock_variant_id_fkey;
EXCEPTION 
  WHEN undefined_table THEN
    -- Table doesn't exist yet, that's fine
    NULL;
  WHEN OTHERS THEN
    -- Any other error, continue anyway
    NULL;
END $$;

-- Step 1: Ensure stores table exists first
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

-- Create index for stores
CREATE INDEX IF NOT EXISTS idx_stores_business_id ON stores(business_id);

-- Enable RLS on stores
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Enable read access for all users" ON stores;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON stores;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON stores;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON stores;

-- Create policies for stores
CREATE POLICY "Enable read access for all users" ON stores FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users" ON stores FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Enable update for authenticated users" ON stores FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Enable delete for authenticated users" ON stores FOR DELETE USING (auth.uid() IS NOT NULL);

-- Step 2: Ensure products_stock table exists
-- Handle existing table that might have foreign key to products_variants
DO $$
BEGIN
  -- Check if products_stock table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'products_stock'
  ) THEN
    -- Table doesn't exist, create it without variant_id FK
    CREATE TABLE products_stock (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      variant_id uuid, -- Nullable, no FK constraint
      store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      stock int DEFAULT 0,
      stock_quantity int DEFAULT 0,
      low_stock_threshold int DEFAULT 0,
      created_at timestamp with time zone DEFAULT now(),
      updated_at timestamp with time zone DEFAULT now(),
      UNIQUE(product_id, variant_id, store_id)
    );
  ELSE
    -- Table exists, check if it has a problematic foreign key
    -- Drop the foreign key if it references products_variants and that table doesn't exist
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu 
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_schema = 'public' 
        AND tc.table_name = 'products_stock'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'variant_id'
        AND ccu.table_name = 'products_variants'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'products_variants'
    ) THEN
      -- Drop the foreign key constraint
      ALTER TABLE products_stock 
      DROP CONSTRAINT IF EXISTS products_stock_variant_id_fkey;
    END IF;
    
    -- Ensure variant_id column exists (without FK)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'products_stock' 
        AND column_name = 'variant_id'
    ) THEN
      ALTER TABLE products_stock ADD COLUMN variant_id uuid;
    END IF;
    
    -- Ensure store_id column exists
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'products_stock' 
        AND column_name = 'store_id'
    ) THEN
      ALTER TABLE products_stock ADD COLUMN store_id uuid REFERENCES stores(id) ON DELETE CASCADE;
    END IF;
  END IF;
  
  -- If products_variants table exists, add the foreign key constraint (if it doesn't exist)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'products_variants'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_schema = 'public' 
    AND table_name = 'products_stock' 
    AND constraint_name = 'products_stock_variant_id_fkey'
  ) THEN
    ALTER TABLE products_stock 
    ADD CONSTRAINT products_stock_variant_id_fkey 
    FOREIGN KEY (variant_id) REFERENCES products_variants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Create indexes for products_stock
CREATE INDEX IF NOT EXISTS idx_products_stock_product_id ON products_stock(product_id);
CREATE INDEX IF NOT EXISTS idx_products_stock_variant_id ON products_stock(variant_id);
CREATE INDEX IF NOT EXISTS idx_products_stock_store_id ON products_stock(store_id);
CREATE INDEX IF NOT EXISTS idx_products_stock_product_store ON products_stock(product_id, store_id);

-- Enable RLS on products_stock
ALTER TABLE products_stock ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Enable read access for all users" ON products_stock;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON products_stock;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON products_stock;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON products_stock;

-- Create policies for products_stock
CREATE POLICY "Enable read access for all users" ON products_stock FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users" ON products_stock FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Enable update for authenticated users" ON products_stock FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Enable delete for authenticated users" ON products_stock FOR DELETE USING (auth.uid() IS NOT NULL);

-- Step 3: Add store_id to sales table (CRITICAL for analytics)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'store_id'
  ) THEN
    ALTER TABLE sales ADD COLUMN store_id uuid REFERENCES stores(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_sales_store_id ON sales(store_id) WHERE store_id IS NOT NULL;
    COMMENT ON COLUMN sales.store_id IS 'Store where sale was made (for multi-store support)';
  END IF;
END $$;

-- Step 4: Add store_id to cashier_sessions table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'cashier_sessions' AND column_name = 'store_id'
  ) THEN
    ALTER TABLE cashier_sessions ADD COLUMN store_id uuid REFERENCES stores(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_cashier_sessions_store_id ON cashier_sessions(store_id) WHERE store_id IS NOT NULL;
    COMMENT ON COLUMN cashier_sessions.store_id IS 'Store for this cashier session (for multi-store support)';
  END IF;
END $$;

-- Step 5: Add store_id to stock_movements table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'stock_movements' AND column_name = 'store_id'
  ) THEN
    ALTER TABLE stock_movements ADD COLUMN store_id uuid REFERENCES stores(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_stock_movements_store_id ON stock_movements(store_id) WHERE store_id IS NOT NULL;
    COMMENT ON COLUMN stock_movements.store_id IS 'Store where stock movement occurred (for multi-store support)';
  END IF;
END $$;

-- Step 6: Add store_id to users table (for staff assignment)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'store_id'
  ) THEN
    ALTER TABLE users ADD COLUMN store_id uuid REFERENCES stores(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_users_store_id ON users(store_id) WHERE store_id IS NOT NULL;
    COMMENT ON COLUMN users.store_id IS 'Store assignment for staff (null = superadmin can access all stores)';
  END IF;
END $$;

-- Step 7: Add store_id to registers table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'registers' AND column_name = 'store_id'
  ) THEN
    ALTER TABLE registers ADD COLUMN store_id uuid REFERENCES stores(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_registers_store_id ON registers(store_id);
    COMMENT ON COLUMN registers.store_id IS 'Store that owns this register (for multi-store support)';
  END IF;
END $$;

-- Add table comments
COMMENT ON TABLE stores IS 'Store/branch locations for multi-store support';
COMMENT ON TABLE products_stock IS 'Per-store inventory quantities for products and variants';

