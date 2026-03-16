# Refund Stock Restoration - Root Cause Analysis

## Code Path Analysis

### Sale Creation (Stock Deduction)
**File:** `app/api/sales/create/route.ts`
- **Line 287:** `storeIdForStock = finalStoreId` (from sale creation)
- **Line 479:** `sale_items.store_id = finalStoreId` (set on each item)
- **Lines 748-871:** Updates `products_stock` using:
  - `.eq("product_id", item.product_id)`
  - `.eq("variant_id", variantId)` or `.is("variant_id", null)`
  - `.eq("store_id", storeIdForStock)`
- **Line 897:** Creates `stock_movements` with `store_id = storeIdForStock`

### Refund (Stock Restoration)
**File:** `app/api/override/refund-sale/route.ts`
- **Line 200:** Reads `sale_items` including `store_id`
- **Line 213:** `itemStoreId = sale.store_id || item.store_id`
- **Lines 246-252 (variant) / 320-326 (product):** Queries `products_stock` using:
  - `.eq("product_id", item.product_id)`
  - `.eq("variant_id", variantId)` or `.is("variant_id", null)`
  - `.eq("store_id", itemStoreId)`
- **Lines 301-307 (variant) / 407-413 (product):** Updates `products_stock` using `.eq("id", stockRecord.id)`
- **Line 403:** Creates `stock_movements` with `store_id = itemStoreId`

### Inventory Dashboard (Stock Reading)
**File:** `app/admin/retail/inventory-dashboard/page.tsx`
- **Line 151:** `storeIdForStock = activeStoreId && activeStoreId !== 'all' ? activeStoreId : null`
- **Line 193-194:** Queries `products_stock` with:
  - `.in("product_id", productsData.map((p: any) => p.id))`
  - `.eq("store_id", storeIdForStock)` if `storeIdForStock` is set

## Database Schema
**File:** `supabase/migrations/027_multi_store_support.sql` (Line 31)
- `UNIQUE(product_id, variant_id, store_id)` - Only ONE row per combination

## Potential Root Causes

### 1. Store ID Mismatch (MOST LIKELY)
**Scenario:** Refund updates stock for `sale.store_id`, but inventory dashboard reads from `activeStoreId` (session storage)

**Evidence:**
- Sale creation uses `finalStoreId` (from request)
- Refund uses `sale.store_id || item.store_id` (from database)
- Inventory dashboard uses `getActiveStoreId()` (from session storage)

**If these don't match:** Dashboard won't see the updated stock

### 2. Stock Movement Insert Fails Silently
**Scenario:** `stock_movements` insert fails but refund continues

**Evidence:**
- Lines 415-423: Error is logged but refund continues
- In dev, throws error (line 419-420)
- In production, only logs (line 422)

**If this fails:** Stock is restored but movement isn't recorded

### 3. Stock Update Fails But Verification Passes
**Scenario:** Update query fails but verification query reads old value

**Evidence:**
- Lines 407-413: Update query
- Lines 423-449: Verification query reads back value
- If update fails silently, verification might read stale data

### 4. RLS Policy Blocks Read
**Scenario:** Refund uses `serviceRoleClient` (bypasses RLS), but inventory dashboard uses regular `supabase` client

**Evidence:**
- Refund: `serviceRoleClient` (line 54)
- Inventory: Regular `supabase` client (line 4)
- RLS policy: `SELECT USING (true)` (should allow all reads)

**If RLS blocks:** Dashboard can't read updated stock

## Required Database Queries

Run `DIAGNOSE_REFUND_STOCK.sql` to verify:
1. Does `stock_movements` have refund entry?
2. Does `products_stock` show updated value?
3. Does `sale.store_id` match `activeStoreId` in dashboard?
4. Are there multiple `products_stock` rows for same product/store?

## Single Root Cause (After Database Verification)

**If refund `stock_movements` exists but stock doesn't increase:**
→ **Stock update writes to wrong store_id OR dashboard reads from wrong store_id**

**If refund `stock_movements` doesn't exist:**
→ **Stock movement insert fails silently (caught in try/catch)**

**If `products_stock` doesn't change:**
→ **Stock update query fails OR writes to wrong row**




