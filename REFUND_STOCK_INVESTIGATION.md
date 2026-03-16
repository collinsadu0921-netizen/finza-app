# Refund Stock Investigation

## Investigation: Why Inventory Stock Is Not Returned After Refund

### 1. Refund Stock Logic (What Happens on Refund)

#### File: `app/api/override/refund-sale/route.ts`

**Stock Restoration Process:**

1. **Read Sale Items** (Lines 198-202):
   ```typescript
   const { data: saleItems, error: itemsError } = await serviceRoleClient
     .from("sale_items")
     .select("product_id, variant_id, qty, name, store_id")
     .eq("sale_id", sale_id)
   ```
   - Reads: `product_id`, `variant_id`, `qty`, `name`, `store_id` from `sale_items`

2. **Restore Stock for Variants** (Lines 203-345):
   - **If `variant_id` exists** (Lines 207-345):
     - **Query products_stock** (Lines 220-230):
       ```typescript
       const { data: variantStock, error: variantStockError } = await serviceRoleClient
         .from("products_stock")
         .select("id, stock_quantity, stock")
         .eq("product_id", item.product_id)
         .eq("variant_id", variantId)
         .eq("store_id", sale.store_id)
         .maybeSingle()
       ```
       - Filters: `product_id`, `variant_id`, `store_id`
       - **CRITICAL**: Uses `sale.store_id` (from sale record)
     
     - **Update products_stock** (Lines 273-277):
       ```typescript
       const { error: updateError } = await serviceRoleClient
         .from("products_stock")
         .update({
           stock_quantity: newStock,
           stock: newStock,
         })
         .eq("id", variantStock.id)
       ```
       - Updates: `stock_quantity`, `stock` (both set to `newStock = currentStock + qty`)
       - Condition: `.eq("id", variantStock.id)` (by record ID)
       - **CRITICAL**: Uses `sale.store_id` to find the stock record

   - **If `variant_id` is NULL** (Lines 346-400):
     - **Query products_stock** (Lines 354-364):
       ```typescript
       const { data: storeStock, error: storeStockError } = await serviceRoleClient
         .from("products_stock")
         .select("id, stock_quantity, stock")
         .eq("product_id", item.product_id)
         .is("variant_id", null)
         .eq("store_id", sale.store_id)
         .maybeSingle()
       ```
       - Filters: `product_id`, `variant_id IS NULL`, `store_id`
       - **CRITICAL**: Uses `sale.store_id` (from sale record)
     
     - **Update products_stock** (Lines 380-384):
       ```typescript
       const { error: updateError } = await serviceRoleClient
         .from("products_stock")
         .update({
           stock_quantity: newStock,
           stock: newStock,
         })
         .eq("id", storeStock.id)
       ```
       - Updates: `stock_quantity`, `stock` (both set to `newStock = currentStock + qty`)
       - Condition: `.eq("id", storeStock.id)` (by record ID)

3. **Create Stock Movement Record** (Lines 396-398):
   ```typescript
   await serviceRoleClient
     .from("stock_movements")
     .insert({
       business_id: sale.business_id,
       product_id: item.product_id,
       variant_id: variantId || null,
       quantity_change: qty, // POSITIVE value (restoring stock)
       type: "refund",
       user_id: supervisorId,
       related_sale_id: sale_id,
       store_id: sale.store_id,
       note: `Refund: ${item.name} x${qty}`,
     })
   ```
   - Creates audit record with `type = "refund"`, `quantity_change = qty` (positive)

**Summary of Refund Stock Updates:**
- **Table**: `products_stock`
- **Fields Updated**: `stock_quantity`, `stock` (both incremented by `qty`)
- **Filter Used**: `product_id`, `variant_id` (or NULL), `store_id` (from `sale.store_id`)
- **Update Method**: Direct update by record ID

---

### 2. Inventory UI Stock Calculation (How Stock Is Displayed)

#### File: `app/admin/retail/inventory-dashboard/page.tsx`

**Stock Loading Process:**

1. **Load Products with Stock** (Lines 150-220):
   ```typescript
   const { data: productsData, error: productsError } = await supabase
     .from("products")
     .select(`
       id,
       name,
       sku,
       cost_price,
       selling_price,
       products_stock!inner (
         id,
         stock_quantity,
         stock,
         store_id,
         variant_id
       )
     `)
     .eq("business_id", business.id)
     .eq("products_stock.store_id", storeIdForStock)
     .is("deleted_at", null)
   ```
   - **CRITICAL**: Uses `products_stock!inner` join (INNER JOIN - only products with stock records)
   - **Filter**: `.eq("products_stock.store_id", storeIdForStock)`
   - **CRITICAL**: Filters by `storeIdForStock` (from `getActiveStoreId()` or user's assigned store)

2. **Stock Display** (Lines 220-280):
   - Uses `products_stock.stock_quantity` or `products_stock.stock` directly
   - No aggregation or calculation from `stock_movements`
   - **CRITICAL**: Stock value comes directly from `products_stock` table

**Summary of Inventory Stock Query:**
- **Table**: `products_stock` (via INNER JOIN with `products`)
- **Fields Used**: `stock_quantity`, `stock`
- **Filter**: `store_id = storeIdForStock` (active store or user's assigned store)
- **No Filter**: `deleted_at` is NOT checked on `products_stock` (only on `products`)

---

### 3. Root Cause Analysis

#### Mismatch Identified:

**Refund Stock Update:**
- Uses `sale.store_id` to find and update `products_stock` record
- Updates `stock_quantity` and `stock` fields directly

**Inventory UI Query:**
- Reads `products_stock` filtered by `storeIdForStock` (active store from session)
- Uses INNER JOIN, so only products with matching `store_id` in `products_stock` are shown

#### Potential Root Causes:

1. **Store ID Mismatch**:
   - Refund uses `sale.store_id` (from sale record at time of sale)
   - Inventory UI uses `storeIdForStock` (current active store from session)
   - **If sale was made in Store A, but user is viewing Store B, refund updates Store A's stock, but UI shows Store B's stock**

2. **Missing Stock Record**:
   - Refund queries `products_stock` with `.maybeSingle()` (allows null)
   - If stock record doesn't exist, refund silently fails to restore stock
   - Inventory UI uses INNER JOIN, so products without stock records don't appear

3. **Variant ID Mismatch**:
   - Refund handles both `variant_id` and NULL `variant_id` cases
   - If variant structure changed between sale and refund, stock record might not be found

4. **No Error Handling**:
   - Refund stock update errors are logged but don't fail the refund
   - If stock update fails, refund still succeeds, but stock is not restored

---

### 4. Exact Root Cause

**PRIMARY ROOT CAUSE: Store ID Context Mismatch**

The refund updates stock using `sale.store_id` (the store where the sale was originally made), but the inventory UI displays stock filtered by `storeIdForStock` (the currently active store in the user's session).

**Scenario:**
1. Sale made in Store A → `sale.store_id = Store A`
2. User switches to Store B → `storeIdForStock = Store B`
3. Refund processes → Updates `products_stock` where `store_id = Store A`
4. Inventory UI queries → Shows `products_stock` where `store_id = Store B`
5. **Result**: Refund updated Store A's stock, but UI shows Store B's stock (no change visible)

**Secondary Issues:**
- If `products_stock` record doesn't exist for the `product_id + variant_id + store_id` combination, refund silently fails to restore stock (`.maybeSingle()` returns null, update is skipped)
- No validation that stock record exists before attempting update
- Stock update errors are logged but don't prevent refund completion

---

## Summary

### Root Cause
**Store ID context mismatch**: Refund uses `sale.store_id` (historical), inventory UI uses `storeIdForStock` (current session).

### Affected Tables
- `products_stock` (updated by refund, read by inventory UI)
- `stock_movements` (audit record created, but not used by inventory UI)

### Affected Files
- `app/api/override/refund-sale/route.ts` (Lines 220-230, 273-277, 354-364, 380-384)
- `app/admin/retail/inventory-dashboard/page.tsx` (Lines 150-220)

### Why Refund Stock Update Is Ignored
1. **Store Context Mismatch**: Refund updates stock for `sale.store_id`, but inventory UI displays stock for `storeIdForStock`. If these differ, the update is invisible to the user.
2. **Missing Stock Record**: If `products_stock` record doesn't exist for the exact `product_id + variant_id + store_id` combination, refund cannot update it (`.maybeSingle()` returns null, update is skipped silently).
3. **No Error Propagation**: Stock update failures don't prevent refund completion, so refund succeeds even if stock restoration fails.




