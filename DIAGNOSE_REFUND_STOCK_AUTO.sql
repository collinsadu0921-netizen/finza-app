-- DIAGNOSTIC QUERIES FOR REFUND STOCK RESTORATION
-- These queries automatically use the MOST RECENT refunded sale
-- No manual replacement needed - just run each query one at a time

-- ============================================================================
-- QUERY 1: Check the most recent refunded sale
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
LIMIT 1;

-- ============================================================================
-- QUERY 2: Check sale_items for the most recent refunded sale
-- ============================================================================
SELECT 
  si.id,
  si.product_id,
  si.variant_id,
  si.qty,
  si.sale_id,
  s.payment_status,
  s.store_id as sale_store_id
FROM sale_items si
JOIN sales s ON s.id = si.sale_id
WHERE s.payment_status = 'refunded'
ORDER BY s.created_at DESC
LIMIT 10;

-- ============================================================================
-- QUERY 3: Check ALL stock_movements for the most recent refunded sale
-- NOTE: stock_movements table does NOT have variant_id column
-- ============================================================================
SELECT 
  sm.id,
  sm.type,
  sm.quantity_change,
  sm.product_id,
  sm.store_id,
  sm.related_sale_id,
  sm.created_at,
  sm.note,
  s.payment_status
FROM stock_movements sm
JOIN sales s ON s.id = sm.related_sale_id
WHERE s.payment_status = 'refunded'
  AND s.id = (SELECT id FROM sales WHERE payment_status = 'refunded' ORDER BY created_at DESC LIMIT 1)
ORDER BY sm.created_at;

-- ============================================================================
-- QUERY 4: Count movements by type for the most recent refunded sale
-- ============================================================================
SELECT 
  sm.type,
  COUNT(*) as count,
  SUM(sm.quantity_change) as total_quantity_change
FROM stock_movements sm
JOIN sales s ON s.id = sm.related_sale_id
WHERE s.payment_status = 'refunded'
  AND s.id = (SELECT id FROM sales WHERE payment_status = 'refunded' ORDER BY created_at DESC LIMIT 1)
GROUP BY sm.type;

-- ============================================================================
-- QUERY 5: Verify store_id match between sale and products_stock
-- Shows if refund updated the correct store
-- ============================================================================
SELECT 
  s.id as sale_id,
  s.store_id as sale_store_id,
  si.product_id,
  si.variant_id,
  ps.id as stock_record_id,
  ps.store_id as stock_store_id,
  ps.stock,
  ps.stock_quantity,
  CASE 
    WHEN s.store_id = ps.store_id THEN 'MATCH ✓'
    WHEN ps.store_id IS NULL THEN 'NO STOCK RECORD ✗'
    ELSE 'MISMATCH ✗'
  END as store_match
FROM sales s
JOIN sale_items si ON si.sale_id = s.id
LEFT JOIN products_stock ps ON ps.product_id = si.product_id 
  AND (ps.variant_id = si.variant_id OR (ps.variant_id IS NULL AND si.variant_id IS NULL))
WHERE s.payment_status = 'refunded'
  AND s.id = (SELECT id FROM sales WHERE payment_status = 'refunded' ORDER BY created_at DESC LIMIT 1);

-- ============================================================================
-- QUERY 6: Get products_stock for products in the most recent refunded sale
-- Shows current stock state after refund
-- ============================================================================
SELECT 
  ps.id,
  ps.product_id,
  ps.variant_id,
  ps.store_id,
  ps.stock,
  ps.stock_quantity,
  ps.created_at,
  si.qty as refunded_quantity,
  s.store_id as sale_store_id,
  CASE 
    WHEN ps.store_id = s.store_id THEN 'CORRECT STORE ✓'
    ELSE 'WRONG STORE ✗'
  END as store_check
FROM products_stock ps
JOIN sale_items si ON si.product_id = ps.product_id
  AND (si.variant_id = ps.variant_id OR (si.variant_id IS NULL AND ps.variant_id IS NULL))
JOIN sales s ON s.id = si.sale_id
WHERE s.payment_status = 'refunded'
  AND s.id = (SELECT id FROM sales WHERE payment_status = 'refunded' ORDER BY created_at DESC LIMIT 1);

-- ============================================================================
-- QUERY 7: Summary - Does refund have stock movement?
-- ============================================================================
SELECT 
  s.id as sale_id,
  s.payment_status,
  s.store_id,
  COUNT(DISTINCT sm.id) FILTER (WHERE sm.type = 'sale') as sale_movements,
  COUNT(DISTINCT sm.id) FILTER (WHERE sm.type = 'refund') as refund_movements,
  COUNT(DISTINCT si.id) as item_count,
  COUNT(DISTINCT ps.id) as stock_records_found,
  CASE 
    WHEN COUNT(DISTINCT sm.id) FILTER (WHERE sm.type = 'refund') > 0 THEN 'HAS REFUND MOVEMENT ✓'
    ELSE 'MISSING REFUND MOVEMENT ✗'
  END as refund_movement_status
FROM sales s
LEFT JOIN sale_items si ON si.sale_id = s.id
LEFT JOIN stock_movements sm ON sm.related_sale_id = s.id
LEFT JOIN products_stock ps ON ps.product_id = si.product_id
  AND ps.store_id = s.store_id
  AND (ps.variant_id = si.variant_id OR (ps.variant_id IS NULL AND si.variant_id IS NULL))
WHERE s.payment_status = 'refunded'
  AND s.id = (SELECT id FROM sales WHERE payment_status = 'refunded' ORDER BY created_at DESC LIMIT 1)
GROUP BY s.id, s.payment_status, s.store_id;

