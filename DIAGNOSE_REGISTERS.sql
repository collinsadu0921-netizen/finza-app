-- Diagnostic script to investigate missing registers for testing@retail.com
-- Run this in your Supabase SQL editor

-- Step 1: Find the user and business
SELECT 
  u.id as user_id,
  u.email,
  b.id as business_id,
  b.name as business_name,
  b.industry
FROM users u
LEFT JOIN businesses b ON b.owner_id = u.id
WHERE u.email ILIKE '%testing%retail%'
UNION ALL
SELECT 
  u.id as user_id,
  u.email,
  b.id as business_id,
  b.name as business_name,
  b.industry
FROM users u
JOIN business_users bu ON bu.user_id = u.id
JOIN businesses b ON b.id = bu.business_id
WHERE u.email ILIKE '%testing%retail%';

-- Step 2: Check all stores for the business (replace BUSINESS_ID_HERE with actual business_id from Step 1)
-- SELECT 
--   s.id as store_id,
--   s.name as store_name,
--   s.created_at,
--   COUNT(r.id) as register_count
-- FROM stores s
-- LEFT JOIN registers r ON r.store_id = s.id
-- WHERE s.business_id = 'BUSINESS_ID_HERE'
-- GROUP BY s.id, s.name, s.created_at
-- ORDER BY s.created_at DESC;

-- Step 3: Check all registers for the business (including those without store_id)
-- SELECT 
--   r.id as register_id,
--   r.name as register_name,
--   r.store_id,
--   s.name as store_name,
--   r.business_id,
--   r.created_at
-- FROM registers r
-- LEFT JOIN stores s ON s.id = r.store_id
-- WHERE r.business_id = 'BUSINESS_ID_HERE'
-- ORDER BY r.created_at DESC;

-- Step 4: Check if there are any registers at all (even deleted ones - if you have audit logs)
-- This would require checking audit_logs table if it exists
-- SELECT * FROM audit_logs 
-- WHERE table_name = 'registers' 
-- AND action = 'DELETE'
-- AND business_id = 'BUSINESS_ID_HERE'
-- ORDER BY created_at DESC
-- LIMIT 20;

-- Step 5: List all stores to see if any were deleted
-- SELECT 
--   s.id,
--   s.name,
--   s.business_id,
--   s.created_at,
--   s.updated_at
-- FROM stores s
-- WHERE s.business_id = 'BUSINESS_ID_HERE'
-- ORDER BY s.created_at DESC;

-- Step 6: Check stock records for the business (replace BUSINESS_ID_HERE with actual business_id from Step 1)
-- SELECT 
--   ps.id,
--   ps.product_id,
--   p.name as product_name,
--   ps.variant_id,
--   pv.name as variant_name,
--   ps.store_id,
--   s.name as store_name,
--   ps.stock,
--   ps.stock_quantity,
--   ps.created_at
-- FROM products_stock ps
-- JOIN products p ON p.id = ps.product_id
-- LEFT JOIN products_variants pv ON pv.id = ps.variant_id
-- LEFT JOIN stores s ON s.id = ps.store_id
-- WHERE p.business_id = 'BUSINESS_ID_HERE'
-- ORDER BY ps.created_at DESC;

-- Step 7: Count stock records per store
-- SELECT 
--   s.id as store_id,
--   s.name as store_name,
--   COUNT(ps.id) as stock_record_count,
--   SUM(ps.stock_quantity) as total_stock_quantity
-- FROM stores s
-- LEFT JOIN products_stock ps ON ps.store_id = s.id
-- WHERE s.business_id = 'BUSINESS_ID_HERE'
-- GROUP BY s.id, s.name
-- ORDER BY s.created_at DESC;

