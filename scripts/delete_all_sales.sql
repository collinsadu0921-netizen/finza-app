-- WARNING: This will delete ALL sales and sale_items
-- Use only for testing/development
-- Run this in Supabase SQL Editor

-- Delete all sale_items first (due to foreign key constraint)
DELETE FROM sale_items;

-- Delete all sales
DELETE FROM sales;

-- Verify deletion
SELECT COUNT(*) as remaining_sales FROM sales;
SELECT COUNT(*) as remaining_sale_items FROM sale_items;

