-- Combined migration to add inventory management (with policy fixes)
-- Run this in your Supabase SQL Editor

-- Add inventory fields to products table
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS stock int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS low_stock_threshold int DEFAULT 0;

-- Create stock_history table for auditing
CREATE TABLE IF NOT EXISTS stock_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  change int NOT NULL,           -- +10 = added, -2 = sale
  reason text NOT NULL,          -- 'stock_in', 'sale', 'manual_adjust'
  note text,                     -- Optional note
  created_at timestamp DEFAULT now()
);

-- Enable RLS
ALTER TABLE stock_history ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist, then recreate
DROP POLICY IF EXISTS "Enable read access for all users" ON stock_history;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON stock_history;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON stock_history;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON stock_history;

-- Create policies
CREATE POLICY "Enable read access for all users" ON stock_history FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users" ON stock_history FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Enable update for authenticated users" ON stock_history FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Enable delete for authenticated users" ON stock_history FOR DELETE USING (auth.uid() IS NOT NULL);


















