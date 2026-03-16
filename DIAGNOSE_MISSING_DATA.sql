-- Comprehensive diagnostic script to find missing registers and stock
-- Business: Asafo Market (4eccb02c-d5e0-4f49-a896-4743e7660c04)

-- ============================================
-- STEP 2: Check ALL stores for the business
-- ============================================
SELECT 
  s.id as store_id,
  s.name as store_name,
  s.created_at,
  s.updated_at
FROM stores s
WHERE s.business_id = '4eccb02c-d5e0-4f49-a896-4743e7660c04'
ORDER BY s.created_at DESC;

-- ============================================
-- STEP 3: Check ALL registers for the business
-- (Including those with NULL store_id or wrong store_id)
-- ============================================
SELECT 
  r.id as register_id,
  r.name as register_name,
  r.store_id,
  s.name as store_name,
  r.business_id,
  r.created_at,
  CASE 
    WHEN r.store_id IS NULL THEN '⚠️ NO STORE ASSIGNED'
    WHEN s.id IS NULL THEN '⚠️ STORE NOT FOUND (orphaned)'
    ELSE '✓ OK'
  END as status
FROM registers r
LEFT JOIN stores s ON s.id = r.store_id
WHERE r.business_id = '4eccb02c-d5e0-4f49-a896-4743e7660c04'
ORDER BY r.created_at DESC;

-- ============================================
-- STEP 4: Check ALL stock records for the business
-- (Including those with NULL store_id or wrong store_id)
-- ============================================
SELECT 
  ps.id,
  ps.product_id,
  p.name as product_name,
  ps.variant_id,
  pv.variant_name,
  ps.store_id,
  s.name as store_name,
  ps.stock,
  ps.stock_quantity,
  ps.created_at,
  CASE 
    WHEN ps.store_id IS NULL THEN '⚠️ NO STORE ASSIGNED'
    WHEN s.id IS NULL THEN '⚠️ STORE NOT FOUND (orphaned)'
    ELSE '✓ OK'
  END as status
FROM products_stock ps
JOIN products p ON p.id = ps.product_id
LEFT JOIN products_variants pv ON pv.id = ps.variant_id
LEFT JOIN stores s ON s.id = ps.store_id
WHERE p.business_id = '4eccb02c-d5e0-4f49-a896-4743e7660c04'
ORDER BY ps.created_at DESC
LIMIT 100;

-- ============================================
-- STEP 5: Count registers and stock per store
-- ============================================
SELECT 
  s.id as store_id,
  s.name as store_name,
  COUNT(DISTINCT r.id) as register_count,
  COUNT(DISTINCT ps.id) as stock_record_count,
  SUM(ps.stock_quantity) as total_stock_quantity
FROM stores s
LEFT JOIN registers r ON r.store_id = s.id
LEFT JOIN products_stock ps ON ps.store_id = s.id
WHERE s.business_id = '4eccb02c-d5e0-4f49-a896-4743e7660c04'
GROUP BY s.id, s.name
ORDER BY s.created_at DESC;

-- ============================================
-- STEP 6: Find registers with NULL store_id
-- (These won't show up in the UI if store filtering is active)
-- ============================================
SELECT 
  r.id,
  r.name,
  r.store_id,
  r.business_id,
  r.created_at,
  '⚠️ REGISTER HAS NO STORE ASSIGNED' as issue
FROM registers r
WHERE r.business_id = '4eccb02c-d5e0-4f49-a896-4743e7660c04'
  AND r.store_id IS NULL;

-- ============================================
-- STEP 7: Find stock records with NULL store_id
-- ============================================
SELECT 
  ps.id,
  ps.product_id,
  p.name as product_name,
  ps.store_id,
  ps.stock_quantity,
  '⚠️ STOCK HAS NO STORE ASSIGNED' as issue
FROM products_stock ps
JOIN products p ON p.id = ps.product_id
WHERE p.business_id = '4eccb02c-d5e0-4f49-a896-4743e7660c04'
  AND ps.store_id IS NULL;

-- ============================================
-- STEP 8: Check if products exist but have no stock records
-- ============================================
SELECT 
  p.id,
  p.name,
  p.business_id,
  COUNT(ps.id) as stock_record_count,
  CASE 
    WHEN COUNT(ps.id) = 0 THEN '⚠️ NO STOCK RECORDS'
    ELSE '✓ HAS STOCK'
  END as status
FROM products p
LEFT JOIN products_stock ps ON ps.product_id = p.id
WHERE p.business_id = '4eccb02c-d5e0-4f49-a896-4743e7660c04'
GROUP BY p.id, p.name, p.business_id
HAVING COUNT(ps.id) = 0
ORDER BY p.name;

-- ============================================
-- STEP 9: Check for orphaned registers (store_id points to non-existent store)
-- ============================================
SELECT 
  r.id,
  r.name,
  r.store_id,
  r.business_id,
  '⚠️ ORPHANED: Store does not exist' as issue
FROM registers r
WHERE r.business_id = '4eccb02c-d5e0-4f49-a896-4743e7660c04'
  AND r.store_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM stores s WHERE s.id = r.store_id
  );

-- ============================================
-- STEP 10: Check for orphaned stock (store_id points to non-existent store)
-- ============================================
SELECT 
  ps.id,
  ps.product_id,
  p.name as product_name,
  ps.store_id,
  ps.stock_quantity,
  '⚠️ ORPHANED: Store does not exist' as issue
FROM products_stock ps
JOIN products p ON p.id = ps.product_id
WHERE p.business_id = '4eccb02c-d5e0-4f49-a896-4743e7660c04'
  AND ps.store_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM stores s WHERE s.id = ps.store_id
  );
