-- ============================================================================
-- SCRIPT: Detect Orphaned Sales (Read-Only)
-- ============================================================================
-- PHASE A3: Detection query for sales without corresponding journal entries
-- 
-- Purpose: Identify sales that violate Completeness Invariant
-- Use case: Audit existing data for orphaned sales (before migration 174)
-- 
-- Scope: READ-ONLY (no mutations)
-- ============================================================================

-- Query: Find all sales without journal entries
-- Criteria: sales.id NOT IN (journal_entries.reference_id WHERE reference_type = 'sale')
SELECT 
  s.id as sale_id,
  s.business_id,
  s.amount,
  s.created_at,
  s.payment_status,
  s.description,
  s.store_id,
  COUNT(si.id) as item_count,
  COALESCE(SUM(si.cogs), 0) as total_cogs
FROM sales s
LEFT JOIN sale_items si ON si.sale_id = s.id
LEFT JOIN journal_entries je ON je.reference_type = 'sale' AND je.reference_id = s.id
WHERE je.id IS NULL -- No journal entry found
GROUP BY s.id, s.business_id, s.amount, s.created_at, s.payment_status, s.description, s.store_id
ORDER BY s.created_at DESC;

-- Query: Summary statistics
SELECT 
  COUNT(*) as orphaned_sales_count,
  COUNT(DISTINCT business_id) as affected_businesses_count,
  SUM(amount) as total_orphaned_amount,
  MIN(created_at) as earliest_orphaned_sale,
  MAX(created_at) as latest_orphaned_sale
FROM sales s
LEFT JOIN journal_entries je ON je.reference_type = 'sale' AND je.reference_id = s.id
WHERE je.id IS NULL; -- No journal entry found

-- Query: Orphaned sales by business
SELECT 
  s.business_id,
  b.name as business_name,
  COUNT(*) as orphaned_sales_count,
  SUM(s.amount) as total_orphaned_amount
FROM sales s
LEFT JOIN journal_entries je ON je.reference_type = 'sale' AND je.reference_id = s.id
LEFT JOIN businesses b ON b.id = s.business_id
WHERE je.id IS NULL -- No journal entry found
GROUP BY s.business_id, b.name
ORDER BY orphaned_sales_count DESC;

-- Query: Orphaned sales by payment status
SELECT 
  s.payment_status,
  COUNT(*) as orphaned_sales_count,
  SUM(s.amount) as total_orphaned_amount
FROM sales s
LEFT JOIN journal_entries je ON je.reference_type = 'sale' AND je.reference_id = s.id
WHERE je.id IS NULL -- No journal entry found
GROUP BY s.payment_status
ORDER BY orphaned_sales_count DESC;

COMMENT ON SCRIPT IS 
'PHASE A3: Read-only detection query for orphaned sales (sales without journal entries). Use to audit data before/after migration 174.';
