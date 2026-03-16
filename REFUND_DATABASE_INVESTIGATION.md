# Refund Stock Restoration - Database Truth Investigation

## PHASE 1: Database Queries to Run

### Query 1: Check stock_movements for refunded sale
```sql
-- Replace <SALE_ID> with actual refunded sale_id
SELECT 
  id,
  type,
  quantity_change,
  product_id,
  store_id,
  related_sale_id,
  created_at,
  note
FROM stock_movements
WHERE related_sale_id = '<SALE_ID>'
ORDER BY created_at;
```

**Expected:** Should show both:
- `type = 'sale'` with `quantity_change < 0` (negative)
- `type = 'refund'` with `quantity_change > 0` (positive)

### Query 2: Check products_stock for affected products
```sql
-- Replace <PRODUCT_ID> and <STORE_ID> with actual values from the refunded sale
SELECT 
  id,
  product_id,
  variant_id,
  store_id,
  stock,
  stock_quantity,
  updated_at
FROM products_stock
WHERE product_id = '<PRODUCT_ID>'
  AND store_id = '<STORE_ID>'
  AND (variant_id IS NULL OR variant_id = '<VARIANT_ID>');
```

**Expected:** Should show current stock values after refund

### Query 3: Get sale details including store_id
```sql
-- Replace <SALE_ID> with actual refunded sale_id
SELECT 
  id,
  payment_status,
  store_id,
  created_at
FROM sales
WHERE id = '<SALE_ID>';
```

### Query 4: Get all sale_items for the refunded sale
```sql
-- Replace <SALE_ID> with actual refunded sale_id
SELECT 
  id,
  product_id,
  variant_id,
  qty,
  store_id
FROM sale_items
WHERE sale_id = '<SALE_ID>';
```

## PHASE 2: Code Path Analysis

### Sale Creation Stock Deduction
**File:** `app/api/sales/create/route.ts`
- **Lines 746-871:** Stock deduction logic
- Uses `storeIdForStock` (from `finalStoreId`)
- Updates `products_stock` table
- Creates `stock_movements` with `type = 'sale'`, `quantity_change = -quantitySold`

### Refund Stock Restoration
**File:** `app/api/override/refund-sale/route.ts`
- **Lines 195-452:** Stock restoration logic
- Uses `itemStoreId = sale.store_id || item.store_id`
- Updates `products_stock` table
- Creates `stock_movements` with `type = 'refund'`, `quantity_change = quantityReturned` (positive)

### Inventory Dashboard Stock Reading
**File:** `app/admin/retail/inventory-dashboard/page.tsx`
- **Lines 188-213:** Stock query
- Uses `storeIdForStock = activeStoreId && activeStoreId !== 'all' ? activeStoreId : null`
- Queries `products_stock` filtered by `store_id` if `storeIdForStock` is set

## PHASE 3: Potential Root Causes

1. **Refund writes to wrong store_id** - If `sale.store_id` doesn't match `activeStoreId` in dashboard
2. **Multiple products_stock rows** - If refund creates/updates a different row than sale used
3. **RLS blocking read** - If inventory dashboard can't read the updated row
4. **Stock movement insert fails silently** - If insert error is caught but not surfaced
5. **Stock update fails but refund continues** - If update error is logged but not thrown




