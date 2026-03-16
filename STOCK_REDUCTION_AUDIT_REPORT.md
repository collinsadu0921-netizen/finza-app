# STOCK REDUCTION AUDIT REPORT
## CHECK — STOCK REDUCTION AFTER SALE (AUDIT ONLY)

**Date**: Current Session  
**Scope**: Stock reduction logic after completed sales  
**Status**: Findings Only - No Code Changes

---

## 1. INVENTORY MODEL ANALYSIS

### 1.1 Inventory Tables

**Primary Table: `products_stock`**
- **Purpose**: Per-store inventory tracking
- **Schema**: 
  - `id` (uuid, PK)
  - `product_id` (uuid, FK to products)
  - `variant_id` (uuid, nullable, FK to products_variants)
  - `store_id` (uuid, FK to stores) - **REQUIRED**
  - `stock` (int, default 0)
  - `stock_quantity` (int, default 0)
  - `low_stock_threshold` (int, default 0)
  - **UNIQUE constraint**: `(product_id, variant_id, store_id)`
- **Usage**: This is the **source of truth** for stock quantities per store

**Legacy Table: `products`**
- **Stock Fields**: 
  - `stock` (int, default 0)
  - `stock_quantity` (int, default 0)
  - `track_stock` (boolean, default true)
- **Usage**: Should NOT be used for stock tracking in multi-store setup
- **Note**: Code comments indicate "ALWAYS update products_stock - never modify products.stock"

**Audit Table: `stock_movements`**
- **Purpose**: History log of all stock changes
- **Schema**:
  - `id` (uuid, PK)
  - `business_id` (uuid, FK)
  - `product_id` (uuid, FK)
  - `quantity_change` (int) - positive or negative
  - `type` (text) - 'sale', 'refund', 'adjustment', 'initial_import'
  - `user_id` (uuid)
  - `related_sale_id` (uuid, nullable, FK to sales)
  - `note` (text, nullable)
  - `store_id` (uuid, nullable) - **May not exist if migration incomplete**
  - `created_at` (timestamp)

### 1.2 Stock Model Summary

- **Per-Store**: Stock is tracked per store in `products_stock` table
- **Global Fallback**: `products` table has stock fields but should not be used
- **Variants**: Variants have their own stock records in `products_stock` (with `variant_id` set)
- **Base Products**: Base products have stock records with `variant_id = null`

---

## 2. SALE FLOW TRACE

### 2.1 Sale Creation Flow (`app/api/sales/create/route.ts`)

**Step 1: Sale Record Creation** (Lines 256-311)
- Sale record is inserted into `sales` table FIRST
- Includes: `business_id`, `user_id`, `store_id`, `register_id`, `amount`, etc.
- Sale is created **BEFORE** stock deduction

**Step 2: Sale Items Creation** (Lines 335-458)
- Condition: `if (sale_items && Array.isArray(sale_items) && sale_items.length > 0)`
- Creates `sale_items` records linked to the sale
- Stores product snapshots (name, price, quantity)

**Step 3: Stock Deduction** (Lines 460-738)
- **Location**: Inside the same `if` block as sale items creation
- **Condition**: Only runs if `sale_items` array exists and has length > 0
- **Timing**: Runs AFTER sale and sale_items are created

### 2.2 Stock Deduction Logic Flow

**For Each Sale Item:**

1. **Check if item has variant** (Line 467)
   - If `variant_id` exists → Handle variant stock
   - If `variant_id` is null → Handle product stock

2. **Variant Stock Deduction** (Lines 470-584)
   - Queries `products_stock` for variant + store
   - Validates stock availability
   - Updates `products_stock` record
   - Creates `stock_movements` record
   - **No `track_stock` check** - variants always deduct stock

3. **Product Stock Deduction** (Lines 587-738)
   - **CRITICAL CONDITION**: `if (product.track_stock !== false)` (Line 636)
   - Queries `products_stock` for product + store
   - Validates stock availability
   - Updates `products_stock` record
   - Creates `stock_movements` record

---

## 3. STOCK DEDUCTION CONDITIONS

### 3.1 Prerequisites for Stock Deduction

**Must be met:**
1. ✅ `sale_items` array exists and has length > 0 (Line 335)
2. ✅ Sale record created successfully (Line 306 check)
3. ✅ `storeIdForStock` (finalStoreId) is set (Line 462)
4. ✅ For products (not variants): `product.track_stock !== false` (Line 636)

**If any fail:**
- Missing `sale_items`: Stock deduction loop never runs
- Missing `storeIdForStock`: Sale is rolled back (Lines 705-711)
- `track_stock === false`: Stock deduction skipped (Line 636)

### 3.2 Stock Update Logic

**For Variants** (Lines 530-538):
```typescript
if (storeIdForStock && stockRecordId) {
  // Update existing products_stock record
  await supabase.from("products_stock").update({...})
} else if (storeIdForStock && !stockRecordId) {
  // Create new products_stock record
  await supabase.from("products_stock").insert({...})
} else {
  // Rollback sale - fail
}
```

**For Products** (Lines 668-712):
```typescript
if (storeIdForStock && stockRecordId) {
  // Update existing products_stock record
  await supabase.from("products_stock").update({...})
} else if (storeIdForStock && !stockRecordId) {
  // Create new products_stock record
  await supabase.from("products_stock").insert({...})
} else {
  // Rollback sale - fail
}
```

### 3.3 Error Handling

**Stock Update Errors** (Lines 678-683, 696-700):
- Errors are **logged** but **do NOT fail the sale**
- Console error: `console.error("Error updating products_stock...")`
- Comment: `// Don't fail the sale, but log the error`
- **RESULT**: Sale completes successfully even if stock update fails

**Stock Movement Errors** (Lines 734-737):
- Errors are **logged** but **do NOT fail the sale**
- Comment: `// Don't fail the sale if stock movement logging fails`

---

## 4. FINDINGS: WHY STOCK MAY NOT BE REDUCED

### 4.1 Condition: `track_stock === false`

**Location**: Line 636 in `app/api/sales/create/route.ts`

**Code**:
```typescript
// Only validate/deduct stock if track_stock is true
if (product.track_stock !== false) {
  // Stock deduction logic here
}
```

**Finding**: 
- If `product.track_stock === false`, stock deduction is **completely skipped**
- This is **intentional** for service items that don't track inventory
- **Status**: Working as designed

### 4.2 Condition: Missing `sale_items` Array

**Location**: Line 335 in `app/api/sales/create/route.ts`

**Code**:
```typescript
if (sale_items && Array.isArray(sale_items) && sale_items.length > 0) {
  // Create sale items
  // Stock deduction happens inside this block
}
```

**Finding**:
- If `sale_items` is missing, null, empty array, or not an array → Stock deduction never runs
- **Status**: Potential issue if sale is created without items

### 4.3 Condition: Stock Update Errors Are Silent

**Location**: Lines 678-683, 696-700 in `app/api/sales/create/route.ts`

**Code**:
```typescript
if (updateError) {
  console.error(`Error updating products_stock for product ${item.product_id}:`, updateError)
  // Don't fail the sale, but log the error
} else {
  console.log(`Successfully updated products_stock...`)
}
```

**Finding**:
- **CRITICAL**: Stock update errors are logged but **do NOT fail the sale**
- Sale completes successfully even if stock update fails
- **Status**: This is likely the root cause - errors are silent

### 4.4 Condition: Missing `storeIdForStock`

**Location**: Lines 702-712 in `app/api/sales/create/route.ts`

**Code**:
```typescript
} else {
  // This should never happen - storeIdForStock must be set
  // But if it does, fail the sale rather than updating products.stock
  await supabase.from("sales").delete().eq("id", sale.id)
  await supabase.from("sale_items").delete().eq("sale_id", sale.id)
  
  return NextResponse.json({
    error: `Cannot deduct stock: No store_id available...`
  }, { status: 400 })
}
```

**Finding**:
- If `storeIdForStock` is missing, sale is **rolled back**
- This should prevent sales without store_id
- **Status**: Working as designed (fails fast)

### 4.5 Condition: Stock Record Not Found

**Location**: Lines 618-620, 684-700 in `app/api/sales/create/route.ts`

**Behavior**:
- If `products_stock` record doesn't exist, code attempts to **create** it
- Creates record with **negative stock** if `currentStock = 0` and `quantitySold > 0`
- Comment: "If currentStock is 0, newStock will be negative - this is OK for initial setup"
- **Status**: Should work, but creates negative stock records

---

## 5. RELATED AREAS VERIFICATION

### 5.1 Parked Sales (`app/api/sales/park/route.ts`)

**Finding**: ✅ **CORRECT**
- Parked sales are stored in `parked_sales` table
- **No stock deduction** happens when parking a sale
- Stock is only deducted when parked sale is completed (converted to regular sale)
- **Status**: Working as designed

### 5.2 Refund Sales (`app/api/override/refund-sale/route.ts`)

**Finding**: ⚠️ **INCONSISTENCY**
- **Location**: Lines 190-197
- **Problem**: Refund restores stock to `products` table, NOT `products_stock` table
- **Code**:
  ```typescript
  await supabase.from("products").update({
    stock_quantity: newStock,
    stock: newStock,
  }).eq("id", item.product_id)
  ```
- **Issue**: Should update `products_stock` per store, not `products` table
- **Status**: **BUG** - Refunds don't restore stock correctly in multi-store setup

### 5.3 Void Sales (`app/api/override/void-sale/route.ts`)

**Finding**: ⚠️ **MISSING LOGIC**
- **Location**: Lines 123-137
- **Behavior**: Sale is deleted, but **stock is NOT restored**
- **Code**: Only deletes sale and sale_items, no stock restoration
- **Status**: **BUG** - Voided sales should restore stock

---

## 6. ROOT CAUSE ANALYSIS

### 6.1 Why Stock May Not Be Reduced

**Primary Issue**: **Silent Failure**
- Stock update errors are logged but **do NOT fail the sale** (Lines 678-683, 696-700)
- If `products_stock.update()` fails, sale still completes successfully
- Error is only visible in console logs

**Secondary Issues**:
1. **`track_stock === false`**: Intentionally skips stock deduction (by design)
2. **Missing `sale_items`**: Stock deduction never runs (edge case)
3. **Database errors**: Update/insert failures are silent

### 6.2 Where Stock Reduction Should Happen

**Expected Location**: `app/api/sales/create/route.ts` Lines 460-738

**Expected Behavior**:
1. Sale created ✅
2. Sale items created ✅
3. For each item:
   - Check stock availability ✅
   - Deduct from `products_stock` ✅
   - Create `stock_movements` record ✅

**Actual Behavior**:
- Logic exists and appears correct
- **BUT**: Errors in stock update are silent (don't fail sale)
- **RESULT**: Sale completes even if stock update fails

---

## 7. SUMMARY OF FINDINGS

### 7.1 Stock Reduction Logic Status

| Component | Status | Notes |
|-----------|--------|-------|
| Logic Exists | ✅ YES | Lines 460-738 in `app/api/sales/create/route.ts` |
| Executes for Variants | ✅ YES | Always executes (no `track_stock` check) |
| Executes for Products | ⚠️ CONDITIONAL | Only if `track_stock !== false` |
| Updates `products_stock` | ✅ YES | Per-store inventory table |
| Creates `stock_movements` | ✅ YES | Audit log record |
| Error Handling | ❌ SILENT | Errors logged but don't fail sale |

### 7.2 Conditions That Block Stock Reduction

1. **`track_stock === false`** (Line 636)
   - **Type**: Intentional skip
   - **Impact**: Products with `track_stock = false` never reduce stock
   - **Status**: By design

2. **Missing `sale_items`** (Line 335)
   - **Type**: Edge case
   - **Impact**: If sale created without items, stock deduction never runs
   - **Status**: Unlikely but possible

3. **Stock Update Errors** (Lines 678-683, 696-700)
   - **Type**: Silent failure
   - **Impact**: Sale completes successfully even if stock update fails
   - **Status**: **LIKELY ROOT CAUSE**

4. **Missing `storeIdForStock`** (Lines 702-712)
   - **Type**: Validation failure
   - **Impact**: Sale is rolled back (doesn't complete)
   - **Status**: Working as designed

### 7.3 Related Issues Found

1. **Refund Stock Restoration** (Line 192 in `refund-sale/route.ts`)
   - Updates `products` table instead of `products_stock`
   - **Status**: **BUG** - Wrong table

2. **Void Stock Restoration** (`void-sale/route.ts`)
   - No stock restoration logic
   - **Status**: **BUG** - Missing functionality

---

## 8. CONCLUSION

### 8.1 Stock Reduction Logic

**Status**: ✅ **EXISTS AND APPEARS CORRECT**

**Location**: `app/api/sales/create/route.ts` Lines 460-738

**Flow**:
1. Sale created ✅
2. Sale items created ✅
3. Stock deduction loop runs ✅
4. Updates `products_stock` per store ✅
5. Creates `stock_movements` audit record ✅

### 8.2 Why Stock May Not Be Reduced

**Primary Root Cause**: **Silent Error Handling**

- Stock update errors are **logged but don't fail the sale**
- If `products_stock.update()` fails (database error, constraint violation, etc.), sale still completes
- Error only visible in server console logs
- **Result**: Sale appears successful but stock wasn't reduced

**Secondary Causes**:
1. `track_stock === false` (intentional skip)
2. Missing `sale_items` array (edge case)
3. Database errors during stock update (silent failure)

### 8.3 Blocking Conditions

**Condition 1**: `product.track_stock === false`
- **Blocks**: Stock deduction for products (not variants)
- **Reason**: Intentional - service items don't track stock
- **Status**: Working as designed

**Condition 2**: Stock update error
- **Blocks**: Stock reduction (but sale still completes)
- **Reason**: Error handling doesn't fail the sale
- **Status**: **LIKELY ROOT CAUSE**

**Condition 3**: Missing `storeIdForStock`
- **Blocks**: Entire sale (rolled back)
- **Reason**: Validation prevents sale without store
- **Status**: Working as designed

---

## 9. VERIFICATION CHECKLIST

- [x] Stock reduction logic exists
- [x] Logic executes after sale creation
- [x] Logic updates `products_stock` table (per-store)
- [x] Logic creates `stock_movements` audit record
- [x] Logic handles variants correctly
- [x] Logic handles products correctly (with `track_stock` check)
- [x] Error handling is silent (doesn't fail sale)
- [x] Parked sales don't reduce stock (correct)
- [x] Refunds attempt to restore stock (but wrong table)
- [x] Voids don't restore stock (missing logic)

---

## 10. RECOMMENDATIONS (For Future Implementation)

**Not implemented per audit requirements - findings only**

### Potential Fixes (Not Implemented):

1. **Make stock update errors fail the sale**
   - Currently: Errors logged, sale completes
   - Should: Rollback sale if stock update fails

2. **Fix refund stock restoration**
   - Currently: Updates `products` table
   - Should: Update `products_stock` table per store

3. **Add void stock restoration**
   - Currently: No stock restoration
   - Should: Restore stock when sale is voided

4. **Add error handling for missing stock records**
   - Currently: Creates negative stock records
   - Should: Handle edge cases more gracefully

---

**END OF AUDIT REPORT**












