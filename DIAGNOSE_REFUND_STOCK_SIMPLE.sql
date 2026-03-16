-- DIAGNOSTIC QUERIES FOR REFUND STOCK RESTORATION
-- Run these queries ONE AT A TIME in Supabase SQL Editor
-- 
-- IMPORTANT INSTRUCTIONS:
-- 1. Start with QUERY 0 to find a refunded sale ID
-- 2. Copy the sale_id from QUERY 0 results
-- 3. For queries 1-8: Uncomment the SELECT statement and replace placeholders:
--    - 'YOUR_SALE_ID_HERE' → actual UUID from QUERY 0
--    - 'YOUR_PRODUCT_ID_HERE' → product_id from QUERY 2 results
--    - 'YOUR_STORE_ID_HERE' → store_id from QUERY 1 results
--    - 'YOUR_VARIANT_ID_HERE' → variant_id from QUERY 2 (or use NULL if no variant)
-- 4. Run each query one at a time
-- 
-- NOTE: stock_movements table does NOT have a variant_id column
-- 
-- STEP 0: First, find a refunded sale ID to use
-- ============================================================================
-- QUERY 0: Find recent refunded sales (run this first to get a sale_id)
-- ============================================================================
SELECT 
  id,
  payment_status,
  store_id,
  created_at,
  amount
FROM sales
WHERE payment_status = 'refunded'
ORDER BY created_at DESC
LIMIT 10;

-- Copy one of the 'id' values from above, then use it in the queries below
-- Example: If the id is '123e4567-e89b-12d3-a456-426614174000', use that

-- ============================================================================
-- QUERY 1: Check the refunded sale
-- IMPORTANT: First run QUERY 0 above to get a sale_id, then replace 'YOUR_SALE_ID_HERE' below
-- Example: If QUERY 0 returned id '123e4567-e89b-12d3-a456-426614174000', use that
-- ============================================================================
-- SELECT 
--   id,
--   payment_status,
--   store_id,
--   created_at
-- FROM sales
-- WHERE id = 'YOUR_SALE_ID_HERE';  -- REPLACE THIS WITH ACTUAL UUID FROM QUERY 0

-- ============================================================================
-- QUERY 2: Check sale_items for this sale
-- IMPORTANT: Replace 'YOUR_SALE_ID_HERE' with actual UUID from QUERY 0
-- ============================================================================
-- SELECT 
--   id,
--   product_id,
--   variant_id,
--   qty,
--   sale_id
-- FROM sale_items
-- WHERE sale_id = 'YOUR_SALE_ID_HERE';  -- REPLACE THIS WITH ACTUAL UUID FROM QUERY 0

-- ============================================================================
-- QUERY 3: Check ALL stock_movements for this sale
-- IMPORTANT: Replace 'YOUR_SALE_ID_HERE' with actual UUID from QUERY 0
-- NOTE: stock_movements table does NOT have variant_id column
-- ============================================================================
-- SELECT 
--   id,
--   type,
--   quantity_change,
--   product_id,
--   store_id,
--   related_sale_id,
--   created_at,
--   note
-- FROM stock_movements
-- WHERE related_sale_id = 'YOUR_SALE_ID_HERE'  -- REPLACE THIS WITH ACTUAL UUID FROM QUERY 0
-- ORDER BY created_at;

-- ============================================================================
-- QUERY 4: Count movements by type for this sale
-- IMPORTANT: Replace 'YOUR_SALE_ID_HERE' with actual UUID from QUERY 0
-- ============================================================================
-- SELECT 
--   type,
--   COUNT(*) as count,
--   SUM(quantity_change) as total_quantity_change
-- FROM stock_movements
-- WHERE related_sale_id = 'YOUR_SALE_ID_HERE'  -- REPLACE THIS WITH ACTUAL UUID FROM QUERY 0
-- GROUP BY type;

-- ============================================================================
-- QUERY 5: Get products_stock for a specific product and store
-- IMPORTANT: Replace placeholders with actual values from QUERY 2
-- For variant_id: If item has variant, use actual variant_id, otherwise use: variant_id IS NULL
-- ============================================================================
-- SELECT 
--   id,
--   product_id,
--   variant_id,
--   store_id,
--   stock,
--   stock_quantity,
--   created_at
-- FROM products_stock
-- WHERE product_id = 'YOUR_PRODUCT_ID_HERE'  -- REPLACE WITH product_id FROM QUERY 2
--   AND store_id = 'YOUR_STORE_ID_HERE'  -- REPLACE WITH store_id FROM QUERY 1
--   AND (variant_id = 'YOUR_VARIANT_ID_HERE' OR variant_id IS NULL)  -- REPLACE OR USE NULL
-- ORDER BY created_at DESC;

-- ============================================================================
-- QUERY 6: Check ALL products_stock rows for a product (all stores)
-- IMPORTANT: Replace 'YOUR_PRODUCT_ID_HERE' with product_id from QUERY 2
-- ============================================================================
-- SELECT 
--   id,
--   product_id,
--   variant_id,
--   store_id,
--   stock,
--   stock_quantity,
--   created_at
-- FROM products_stock
-- WHERE product_id = 'YOUR_PRODUCT_ID_HERE'  -- REPLACE WITH product_id FROM QUERY 2
-- ORDER BY store_id, variant_id, created_at DESC;

-- ============================================================================
-- QUERY 7: Verify store_id match between sale and products_stock
-- IMPORTANT: Replace 'YOUR_SALE_ID_HERE' with actual sale_id from QUERY 0
-- ============================================================================
-- SELECT 
--   s.id as sale_id,
--   s.store_id as sale_store_id,
--   si.product_id,
--   si.variant_id,
--   ps.id as stock_record_id,
--   ps.store_id as stock_store_id,
--   ps.stock,
--   ps.stock_quantity,
--   CASE 
--     WHEN s.store_id = ps.store_id THEN 'MATCH ✓'
--     WHEN ps.store_id IS NULL THEN 'NO STOCK RECORD ✗'
--     ELSE 'MISMATCH ✗'
--   END as store_match
-- FROM sales s
-- JOIN sale_items si ON si.sale_id = s.id
-- LEFT JOIN products_stock ps ON ps.product_id = si.product_id 
--   AND (ps.variant_id = si.variant_id OR (ps.variant_id IS NULL AND si.variant_id IS NULL))
-- WHERE s.id = 'YOUR_SALE_ID_HERE';  -- REPLACE THIS WITH ACTUAL UUID FROM QUERY 0

-- ============================================================================
-- QUERY 8: Find duplicate products_stock rows (should be none due to UNIQUE constraint)
-- IMPORTANT: Replace 'YOUR_PRODUCT_ID_HERE' with product_id from QUERY 2
-- ============================================================================
-- SELECT 
--   product_id,
--   variant_id,
--   store_id,
--   COUNT(*) as row_count,
--   STRING_AGG(id::text, ', ') as record_ids,
--   STRING_AGG(stock_quantity::text, ', ') as stock_values
-- FROM products_stock
-- WHERE product_id = 'YOUR_PRODUCT_ID_HERE'  -- REPLACE WITH product_id FROM QUERY 2
-- GROUP BY product_id, variant_id, store_id
-- HAVING COUNT(*) > 1;
