-- Fix script for missing registers and stock
-- ⚠️ WARNING: Run the diagnostic script first to identify the issue!
-- Replace BUSINESS_ID_HERE and STORE_ID_HERE with actual IDs from diagnostic results

-- ============================================
-- FIX 1: Assign registers with NULL store_id to a store
-- ============================================
-- UPDATE registers
-- SET store_id = 'STORE_ID_HERE'  -- Replace with your store ID
-- WHERE business_id = 'BUSINESS_ID_HERE'
--   AND store_id IS NULL;

-- ============================================
-- FIX 2: Move registers from wrong store to correct store
-- ============================================
-- UPDATE registers
-- SET store_id = 'CORRECT_STORE_ID_HERE'  -- Replace with correct store ID
-- WHERE business_id = 'BUSINESS_ID_HERE'
--   AND store_id = 'WRONG_STORE_ID_HERE';  -- Replace with wrong store ID

-- ============================================
-- FIX 3: Assign stock records with NULL store_id to a store
-- ============================================
-- UPDATE products_stock ps
-- SET store_id = 'STORE_ID_HERE'  -- Replace with your store ID
-- FROM products p
-- WHERE ps.product_id = p.id
--   AND p.business_id = 'BUSINESS_ID_HERE'
--   AND ps.store_id IS NULL;

-- ============================================
-- FIX 4: Move stock from wrong store to correct store
-- ============================================
-- UPDATE products_stock ps
-- SET store_id = 'CORRECT_STORE_ID_HERE'  -- Replace with correct store ID
-- FROM products p
-- WHERE ps.product_id = p.id
--   AND p.business_id = 'BUSINESS_ID_HERE'
--   AND ps.store_id = 'WRONG_STORE_ID_HERE';  -- Replace with wrong store ID

-- ============================================
-- FIX 5: Initialize missing stock records for a store
-- (Creates products_stock rows for all products that don't have stock records for this store)
-- ============================================
-- INSERT INTO products_stock (product_id, variant_id, store_id, stock, stock_quantity)
-- SELECT 
--   p.id as product_id,
--   NULL as variant_id,
--   'STORE_ID_HERE' as store_id,  -- Replace with your store ID
--   0 as stock,
--   0 as stock_quantity
-- FROM products p
-- WHERE p.business_id = 'BUSINESS_ID_HERE'
--   AND NOT EXISTS (
--     SELECT 1 FROM products_stock ps
--     WHERE ps.product_id = p.id
--       AND ps.store_id = 'STORE_ID_HERE'  -- Replace with your store ID
--       AND ps.variant_id IS NULL
--   );

-- ============================================
-- FIX 6: Initialize missing stock records for variants
-- ============================================
-- INSERT INTO products_stock (product_id, variant_id, store_id, stock, stock_quantity)
-- SELECT 
--   pv.product_id,
--   pv.id as variant_id,
--   'STORE_ID_HERE' as store_id,  -- Replace with your store ID
--   0 as stock,
--   0 as stock_quantity
-- FROM products_variants pv
-- JOIN products p ON p.id = pv.product_id
-- WHERE p.business_id = 'BUSINESS_ID_HERE'
--   AND NOT EXISTS (
--     SELECT 1 FROM products_stock ps
--     WHERE ps.product_id = pv.product_id
--       AND ps.variant_id = pv.id
--       AND ps.store_id = 'STORE_ID_HERE'  -- Replace with your store ID
--   );

-- ============================================
-- VERIFICATION: Check results after fixes
-- ============================================
-- SELECT 
--   s.id as store_id,
--   s.name as store_name,
--   COUNT(DISTINCT r.id) as register_count,
--   COUNT(DISTINCT ps.id) as stock_record_count
-- FROM stores s
-- LEFT JOIN registers r ON r.store_id = s.id
-- LEFT JOIN products_stock ps ON ps.store_id = s.id
-- WHERE s.business_id = 'BUSINESS_ID_HERE'
-- GROUP BY s.id, s.name;




