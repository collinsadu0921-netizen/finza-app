-- MULTI-STORE REFUND VERIFICATION
-- This query verifies that refunds only affect the store where the sale occurred
-- Run this for a refunded sale to confirm cross-store isolation

-- ============================================================================
-- PHASE 1: DATA PROOF
-- ============================================================================

-- STEP 1: Get the most recent refunded sale (or replace with specific sale_id)
-- ============================================================================
SELECT 
  s.id as sale_id,
  s.store_id as sale_store_id,
  s.payment_status,
  s.created_at as sale_created_at,
  s.amount
FROM sales s
WHERE s.payment_status = 'refunded'
ORDER BY s.created_at DESC
LIMIT 1;

-- Copy the sale_id from above, then replace <SALE_ID> in queries below
-- Example: If sale_id is '123e4567-e89b-12d3-a456-426614174000', use that

-- ============================================================================
-- STEP 2: Verify refund stock movements match sale.store_id
-- ============================================================================
-- Replace <SALE_ID> with actual sale_id from STEP 1
-- SELECT 
--   sm.id as movement_id,
--   sm.type,
--   sm.store_id as movement_store_id,
--   sm.product_id,
--   sm.quantity_change,
--   sm.related_sale_id,
--   s.id as sale_id,
--   s.store_id as sale_store_id,
--   CASE 
--     WHEN sm.store_id = s.store_id THEN 'MATCH ✓'
--     WHEN sm.store_id IS NULL THEN 'MISSING STORE_ID ✗'
--     ELSE 'MISMATCH ✗'
--   END as store_verification
-- FROM stock_movements sm
-- JOIN sales s ON s.id = sm.related_sale_id
-- WHERE sm.related_sale_id = '<SALE_ID>'  -- REPLACE WITH ACTUAL sale_id
--   AND sm.type = 'refund'
-- ORDER BY sm.created_at;

-- ============================================================================
-- STEP 3: Check products_stock across ALL stores for refunded products
-- This proves only the sale's store was affected
-- ============================================================================
-- Replace <SALE_ID> with actual sale_id from STEP 1
-- SELECT 
--   s.id as sale_id,
--   s.store_id as sale_store_id,
--   si.product_id,
--   si.variant_id,
--   si.qty as refunded_quantity,
--   ps.store_id as stock_store_id,
--   ps.stock_quantity as current_stock,
--   CASE 
--     WHEN ps.store_id = s.store_id THEN 'SALE STORE ✓'
--     WHEN ps.store_id IS NULL THEN 'NO STOCK RECORD'
--     ELSE 'OTHER STORE'
--   END as store_context,
--   CASE 
--     WHEN ps.store_id = s.store_id THEN 'SHOULD INCREASE'
--     ELSE 'SHOULD BE UNCHANGED'
--   END as expected_behavior
-- FROM sales s
-- JOIN sale_items si ON si.sale_id = s.id
-- LEFT JOIN products_stock ps ON ps.product_id = si.product_id
--   AND (ps.variant_id = si.variant_id OR (ps.variant_id IS NULL AND si.variant_id IS NULL))
-- WHERE s.id = '<SALE_ID>'  -- REPLACE WITH ACTUAL sale_id
-- ORDER BY si.product_id, ps.store_id;

-- ============================================================================
-- STEP 4: Summary - Verify store isolation
-- ============================================================================
-- Replace <SALE_ID> with actual sale_id from STEP 1
-- SELECT 
--   s.id as sale_id,
--   s.store_id as sale_store_id,
--   COUNT(DISTINCT sm.id) FILTER (WHERE sm.type = 'refund') as refund_movements,
--   COUNT(DISTINCT sm.id) FILTER (WHERE sm.type = 'refund' AND sm.store_id = s.store_id) as correct_store_movements,
--   COUNT(DISTINCT sm.id) FILTER (WHERE sm.type = 'refund' AND sm.store_id != s.store_id) as wrong_store_movements,
--   COUNT(DISTINCT sm.id) FILTER (WHERE sm.type = 'refund' AND sm.store_id IS NULL) as missing_store_movements,
--   COUNT(DISTINCT si.id) as sale_item_count,
--   COUNT(DISTINCT ps.id) FILTER (WHERE ps.store_id = s.store_id) as stock_records_in_sale_store,
--   COUNT(DISTINCT ps.id) FILTER (WHERE ps.store_id != s.store_id) as stock_records_in_other_stores,
--   CASE 
--     WHEN COUNT(DISTINCT sm.id) FILTER (WHERE sm.type = 'refund' AND sm.store_id != s.store_id) > 0 THEN 'FAIL: Wrong store movements ✗'
--     WHEN COUNT(DISTINCT sm.id) FILTER (WHERE sm.type = 'refund' AND sm.store_id IS NULL) > 0 THEN 'FAIL: Missing store_id in movements ✗'
--     WHEN COUNT(DISTINCT sm.id) FILTER (WHERE sm.type = 'refund') = 0 THEN 'FAIL: No refund movements ✗'
--     WHEN COUNT(DISTINCT sm.id) FILTER (WHERE sm.type = 'refund') != COUNT(DISTINCT si.id) THEN 'WARN: Movement count mismatch'
--     ELSE 'PASS: Store isolation correct ✓'
--   END as verification_result
-- FROM sales s
-- LEFT JOIN sale_items si ON si.sale_id = s.id
-- LEFT JOIN stock_movements sm ON sm.related_sale_id = s.id
-- LEFT JOIN products_stock ps ON ps.product_id = si.product_id
--   AND (ps.variant_id = si.variant_id OR (ps.variant_id IS NULL AND si.variant_id IS NULL))
-- WHERE s.id = '<SALE_ID>'  -- REPLACE WITH ACTUAL sale_id
-- GROUP BY s.id, s.store_id;

-- ============================================================================
-- PHASE 2: CODE VERIFICATION (Manual Review Required)
-- ============================================================================
-- 
-- Verified in app/api/override/refund-sale/route.ts:
-- 
-- Line 60: Fetches sale.store_id from sales table
-- Line 194-198: Hard assertion - sale.store_id must exist
-- Line 201: const itemStoreId = sale.store_id (ONLY source)
-- Line 243: stock_movements.store_id = itemStoreId (uses sale.store_id)
-- Line 308, 327, 411, 430: products_stock operations use itemStoreId
-- 
-- NO FALLBACKS FOUND:
-- ✓ No active store fallback
-- ✓ No session store fallback  
-- ✓ No user default store fallback
-- ✓ No request body store_id usage
-- 
-- CONCLUSION: Code uses ONLY sale.store_id - CORRECT

-- ============================================================================
-- PHASE 3: EDGE CASE TESTING (Manual Test Required)
-- ============================================================================
-- 
-- To test edge case:
-- 1. Create product in Store A and Store B
-- 2. Make sale in Store A
-- 3. View inventory in Store B context
-- 4. Refund the sale
-- 5. Verify:
--    - Store A stock increases
--    - Store B stock unchanged
--    - Inventory dashboard shows correct values when switching stores
-- 
-- Use STEP 3 query above to verify cross-store isolation after refund

