-- Stock Tracking Functionality for Retail Mode
-- Stage 28.1: Basic stock tracking without adjustment UI

-- Add stock tracking fields to products table
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS stock_quantity int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS low_stock_threshold int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS track_stock boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS cost_price numeric;

-- Create stock_movements table for full history log
CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity_change int NOT NULL, -- positive or negative
  type text NOT NULL CHECK (type IN ('sale', 'refund', 'adjustment', 'initial_import')),
  user_id uuid NOT NULL,
  related_sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  note text,
  created_at timestamp with time zone DEFAULT now()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_stock_movements_business_id ON stock_movements(business_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_id ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_related_sale_id ON stock_movements(related_sale_id) WHERE related_sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements(type);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements(created_at);

-- Enable RLS
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Enable read access for all users" ON stock_movements;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON stock_movements;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON stock_movements;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON stock_movements;

-- Create policies
CREATE POLICY "Enable read access for all users" ON stock_movements FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users" ON stock_movements FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Enable update for authenticated users" ON stock_movements FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Enable delete for authenticated users" ON stock_movements FOR DELETE USING (auth.uid() IS NOT NULL);

