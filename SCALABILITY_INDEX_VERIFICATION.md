# Scalability Index Verification Checklist

**Migration:** `211_scalability_performance_indexes.sql`  
**Date:** 2026-01-27  
**Purpose:** Verify that all indexes are created and being used by queries

---

## Pre-Verification Steps

1. **Run the migration:**
   ```bash
   # Apply migration via Supabase CLI or dashboard
   supabase migration up
   ```

2. **Verify indexes exist:**
   ```sql
   SELECT 
     schemaname,
     tablename,
     indexname,
     pg_size_pretty(pg_relation_size(indexrelid)) as index_size
   FROM pg_stat_user_indexes
   WHERE schemaname = 'public'
     AND indexname LIKE 'idx_%'
     AND indexname IN (
       'idx_sales_business_created',
       'idx_sales_business_payment_status_created',
       'idx_sales_business_store_created',
       'idx_invoices_business_status_created',
       'idx_payments_business_created',
       'idx_products_stock_store_product_variant',
       'idx_invoices_tax_lines_gin',
       'idx_journal_entry_lines_business_account_date'
     )
   ORDER BY tablename, indexname;
   ```

---

## Critical Query Verification

### 1. Sales History Query (Dashboard)

**Query:**
```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM sales 
WHERE business_id = '<test-business-id>' 
  AND created_at >= '2025-01-01' 
  AND created_at <= '2025-12-31'
ORDER BY created_at DESC
LIMIT 100;
```

**Expected:**
- ✅ Uses `idx_sales_business_created` (Index Scan or Bitmap Index Scan)
- ✅ No Sequential Scan on `sales` table
- ✅ Execution time < 50ms (with index)
- ❌ If Sequential Scan appears, index is not being used

**Check:**
- Look for `Index Scan using idx_sales_business_created` in EXPLAIN output
- Verify `Planning Time` and `Execution Time` are reasonable

---

### 2. Sales by Payment Status Query

**Query:**
```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM sales 
WHERE business_id = '<test-business-id>' 
  AND payment_status = 'paid'
  AND created_at >= '2025-01-01'
ORDER BY created_at DESC
LIMIT 50;
```

**Expected:**
- ✅ Uses `idx_sales_business_payment_status_created` (Index Scan)
- ✅ No Sequential Scan on `sales` table
- ✅ Execution time < 100ms (with index)

---

### 3. Invoice List Query

**Query:**
```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM invoices 
WHERE business_id = '<test-business-id>' 
  AND status IN ('sent', 'paid')
  AND created_at >= '2025-01-01'
ORDER BY created_at DESC
LIMIT 50;
```

**Expected:**
- ✅ Uses `idx_invoices_business_status_created` (Index Scan)
- ✅ No Sequential Scan on `invoices` table
- ✅ Execution time < 100ms (with index)

**Check:**
- Look for `Index Scan using idx_invoices_business_status_created`
- Verify filter conditions match index columns

---

### 4. Stock Lookup Query (POS Critical Path)

**Query:**
```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM products_stock 
WHERE store_id = '<test-store-id>' 
  AND product_id = '<test-product-id>' 
  AND variant_id IS NULL;
```

**Expected:**
- ✅ Uses `idx_products_stock_store_product_variant` (Index Scan)
- ✅ No Sequential Scan on `products_stock` table
- ✅ Execution time < 10ms (critical for POS performance)

**Check:**
- Look for `Index Scan using idx_products_stock_store_product_variant`
- This is the **hottest query path** - must be fast

---

### 5. Customer Search Query

**Query:**
```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM customers 
WHERE business_id = '<test-business-id>' 
  AND name ILIKE '%test%'
ORDER BY name
LIMIT 20;
```

**Expected:**
- ✅ Uses `idx_customers_business_name` (Index Scan)
- ✅ No Sequential Scan on `customers` table
- ✅ Execution time < 50ms

**Check:**
- Look for `Index Scan using idx_customers_business_name`
- Note: ILIKE with leading wildcard may still require sequential scan, but index helps with business_id filter

---

### 6. Payment History Query

**Query:**
```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM payments 
WHERE business_id = '<test-business-id>' 
  AND created_at >= '2025-01-01'
ORDER BY created_at DESC
LIMIT 50;
```

**Expected:**
- ✅ Uses `idx_payments_business_created` (Index Scan)
- ✅ No Sequential Scan on `payments` table
- ✅ Execution time < 50ms

**Check:**
- Look for `Index Scan using idx_payments_business_created`

---

### 6. Invoice Payment Lookup (Customer 360)

**Query:**
```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM payments 
WHERE invoice_id IN (
  SELECT id FROM invoices 
  WHERE business_id = '<test-business-id>' 
    AND customer_id = '<test-customer-id>'
)
ORDER BY created_at DESC;
```

**Expected:**
- ✅ Uses `idx_payments_invoice_created` (Index Scan)
- ✅ Uses `idx_invoices_business_customer` for subquery
- ✅ No Sequential Scan on either table
- ✅ Execution time < 100ms

**Check:**
- Look for index scans on both tables
- Verify nested loop or hash join uses indexes

---

### 8. VAT Report Query (JSONB)

**Query:**
```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM invoices 
WHERE business_id = '<test-business-id>' 
  AND tax_lines @> '[{"code": "VAT"}]'::jsonb
  AND created_at >= '2025-01-01';
```

**Expected:**
- ✅ Uses `idx_invoices_tax_lines_gin` (Bitmap Index Scan)
- ✅ Uses `idx_invoices_business_status_created` or `idx_invoices_business_sent_at` for business_id filter
- ✅ No Sequential Scan on `invoices` table
- ✅ Execution time < 200ms (JSONB queries are slower but should use GIN index)

**Check:**
- Look for `Bitmap Index Scan using idx_invoices_tax_lines_gin`
- Verify GIN index is used for JSONB containment

---

### 9. Trial Balance Query (Report Function)

**Query:**
```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT 
  a.id,
  a.code,
  a.name,
  COALESCE(SUM(jel.debit), 0) as debit_total,
  COALESCE(SUM(jel.credit), 0) as credit_total
FROM accounts a
LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
  AND je.business_id = '<test-business-id>'
  AND je.date >= '2025-01-01'
  AND je.date <= '2025-12-31'
WHERE a.business_id = '<test-business-id>'
  AND a.deleted_at IS NULL
GROUP BY a.id, a.code, a.name
ORDER BY a.code;
```

**Expected:**
- ✅ Uses `idx_journal_entry_lines_business_account_date` (Index Scan)
- ✅ Uses `idx_journal_entries_business_date_id` (if exists from migration 139)
- ✅ No Sequential Scan on `journal_entry_lines` or `journal_entries`
- ✅ Execution time < 500ms (for 1 year of data)

**Check:**
- Look for index scans on both `journal_entry_lines` and `journal_entries`
- Verify covering index includes debit/credit (avoids table lookups)

---

## Index Size Monitoring

**Query:**
```sql
SELECT 
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
  idx_scan as index_scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
  AND indexname IN (
    'idx_sales_business_created',
    'idx_sales_business_payment_status_created',
    'idx_invoices_business_status_created',
    'idx_payments_business_created',
    'idx_products_stock_store_product_variant',
    'idx_invoices_tax_lines_gin',
    'idx_journal_entry_lines_business_account_date'
  )
ORDER BY pg_relation_size(indexrelid) DESC;
```

**Expected:**
- Index sizes should be reasonable (typically 10-50% of table size)
- `idx_scans` should be > 0 after queries run (indicates index usage)
- Monitor index bloat over time

---

## Performance Baseline

**Before indexes:**
- Sales history query: 500ms - 5s (sequential scan)
- Invoice list query: 200ms - 2s (sequential scan)
- Stock lookup: 50ms - 500ms (sequential scan)

**After indexes:**
- Sales history query: < 50ms (index scan)
- Invoice list query: < 100ms (index scan)
- Stock lookup: < 10ms (index scan)

**Target improvements:**
- 10x faster for sales/invoice queries
- 5x faster for stock lookups
- 2x faster for report queries

---

## Verification Checklist

- [ ] All 24 indexes created successfully
- [ ] Sales history query uses `idx_sales_business_created`
- [ ] Sales by payment status uses `idx_sales_business_payment_status_created`
- [ ] Invoice list query uses `idx_invoices_business_status_created`
- [ ] Stock lookup uses `idx_products_stock_store_product_variant`
- [ ] Customer search uses `idx_customers_business_name`
- [ ] Payment queries use `idx_payments_business_created`
- [ ] VAT report uses `idx_invoices_tax_lines_gin` (GIN index)
- [ ] Trial Balance uses `idx_journal_entry_lines_business_account_date`
- [ ] No sequential scans on critical tables
- [ ] Query execution times meet targets
- [ ] Index sizes are reasonable
- [ ] Index usage stats show scans > 0

---

## Troubleshooting

### Index Not Being Used

**Possible causes:**
1. **Statistics outdated:** Run `ANALYZE <table_name>;`
2. **Query doesn't match index:** Check WHERE clause matches index columns
3. **Small table:** PostgreSQL may choose sequential scan for small tables (< 1000 rows)
4. **Index not created:** Verify index exists with `\d+ <table_name>` in psql

**Fix:**
```sql
-- Update statistics
ANALYZE sales;
ANALYZE invoices;
ANALYZE payments;
ANALYZE products_stock;

-- Force index usage (for testing only)
SET enable_seqscan = OFF;
-- Run query
SET enable_seqscan = ON;
```

### Index Too Large

**If index size > 50% of table size:**
- Consider partial indexes (WHERE clauses)
- Consider index-only scans (INCLUDE columns)
- Monitor for bloat: `VACUUM ANALYZE <table_name>;`

### Slow Query Despite Index

**Possible causes:**
1. **Index not covering query:** Add INCLUDE columns
2. **Too many rows:** Consider pagination
3. **Complex joins:** Verify all joined tables have indexes
4. **Lock contention:** Check for blocking queries

---

## Next Steps

After verification:
1. Monitor query performance in production
2. Set up alerts for slow queries (> 1s)
3. Review `pg_stat_statements` weekly
4. Re-analyze tables after bulk inserts
5. Consider additional indexes based on actual query patterns

---

**Verification Complete:** ✅ / ❌  
**Date:** _______________  
**Verified By:** _______________
