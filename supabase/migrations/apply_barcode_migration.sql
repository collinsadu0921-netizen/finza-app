-- Add barcode column to products table
-- Run this in your Supabase SQL Editor

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS barcode text;

-- Create unique index for barcode per business
-- This allows multiple NULL values but ensures uniqueness when barcode is provided
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_business 
  ON products(barcode, business_id) 
  WHERE barcode IS NOT NULL;

-- Create regular index for faster lookups
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);


















