-- Ensure store_id columns exist for multi-store support
-- This migration safely adds store_id columns if they don't exist

-- Add store_id to sales table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sales' AND column_name = 'store_id'
  ) THEN
    ALTER TABLE sales ADD COLUMN store_id uuid REFERENCES stores(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_sales_store_id ON sales(store_id) WHERE store_id IS NOT NULL;
  END IF;
END $$;

-- Add store_id to cashier_sessions table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'cashier_sessions' AND column_name = 'store_id'
  ) THEN
    ALTER TABLE cashier_sessions ADD COLUMN store_id uuid REFERENCES stores(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_cashier_sessions_store_id ON cashier_sessions(store_id) WHERE store_id IS NOT NULL;
  END IF;
END $$;

-- Add store_id to stock_movements table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'stock_movements' AND column_name = 'store_id'
  ) THEN
    ALTER TABLE stock_movements ADD COLUMN store_id uuid REFERENCES stores(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_stock_movements_store_id ON stock_movements(store_id) WHERE store_id IS NOT NULL;
  END IF;
END $$;

-- Add store_id to users table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'store_id'
  ) THEN
    ALTER TABLE users ADD COLUMN store_id uuid REFERENCES stores(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_users_store_id ON users(store_id) WHERE store_id IS NOT NULL;
  END IF;
END $$;

-- Add store_id to registers table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'registers' AND column_name = 'store_id'
  ) THEN
    ALTER TABLE registers ADD COLUMN store_id uuid REFERENCES stores(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_registers_store_id ON registers(store_id);
  END IF;
END $$;

COMMENT ON COLUMN sales.store_id IS 'Store where sale was made (for multi-store support)';
COMMENT ON COLUMN cashier_sessions.store_id IS 'Store for this cashier session (for multi-store support)';
COMMENT ON COLUMN stock_movements.store_id IS 'Store where stock movement occurred (for multi-store support)';
COMMENT ON COLUMN users.store_id IS 'Store assignment for staff (null = superadmin can access all stores)';
COMMENT ON COLUMN registers.store_id IS 'Store that owns this register (for multi-store support)';







