# Refund Stock Movement Investigation

## Investigation: Why Refund Stock Movements Are Not Visible in Inventory History

### 1. Refund Stock Movement Insertion

#### File: `app/api/override/refund-sale/route.ts` (Lines 393-407)

**Stock Movement Creation:**
```typescript
// Create stock movement record for refund (using service role client)
try {
  const movementData: any = {
    business_id: sale.business_id,
    product_id: item.product_id,
    quantity_change: quantityReturned, // Positive for refund
    type: "refund",  // LINE 399: type is set to "refund" (lowercase)
    user_id: supervisorId, // Supervisor who approved the refund
    related_sale_id: sale_id,
    note: `Refund: ${item.name || product.name || "Product"} x${quantityReturned}`,
    store_id: itemStoreId,
  }

  if (variantId) {
    // Note: stock_movements may not have variant_id column, so we include it in note
    movementData.note = `Refund (variant): ${item.name || product.name || "Product"} x${quantityReturned}`
  }

  const { error: movementError } = await serviceRoleClient
    .from("stock_movements")
    .insert(movementData)

  if (movementError) {
    console.error(`Error creating stock movement for refund:`, movementError)
    // Don't fail the refund if stock movement logging fails, but log it
  }
} catch (serviceRoleError: any) {
  console.error(`Error getting service role client for refund stock movement:`, serviceRoleError)
  // Continue - stock was restored, movement logging is secondary
}
```

**Findings:**
- ✅ **Refund DOES insert into stock_movements** (Line 396-398)
- ✅ **Type value**: `"refund"` (lowercase string, Line 399)
- ✅ **Fields included**: `business_id`, `product_id`, `quantity_change`, `type`, `user_id`, `related_sale_id`, `note`, `store_id`
- ⚠️ **Error handling**: If insert fails, error is logged but refund still succeeds (Lines 400-407)
- ⚠️ **Service role client**: Uses `serviceRoleClient` to bypass RLS for insert

---

### 2. Inventory History Query

#### File: `app/inventory/history/page.tsx` (Lines 99-123)

**Stock Movements Query:**
```typescript
let query = supabase
  .from("stock_movements")
  .select(
    `
    id,
    product_id,
    quantity_change,
    type,
    created_at,
    note,
    related_sale_id,
    user_id,
    products:product_id (
      name
    )
  `,
    { count: "exact" }
  )
  .eq("business_id", business.id)
  .order("created_at", { ascending: false })

// Type filter
if (typeFilter !== "all") {
  query = query.eq("type", typeFilter)  // LINE 122: Filters by type if typeFilter is not "all"
}
```

**Type Filter State:**
```typescript
const [typeFilter, setTypeFilter] = useState<string>("all")  // LINE 38: Default is "all"
```

**Findings:**
- ✅ Query does NOT filter by `store_id` (no `.eq("store_id", ...)`)
- ✅ Query does filter by `business_id` (Line 117)
- ✅ Query filters by `type` ONLY if `typeFilter !== "all"` (Lines 121-123)
- ✅ **No client-side filtering**: No `.filter()` applied after query (Lines 192-209)

---

### 3. Type Filter UI Component

#### File: `app/inventory/history/page.tsx` (Lines 311-316)

**Type Filter Dropdown:**
```typescript
<select
  value={typeFilter}
  onChange={(e) => {
    setTypeFilter(e.target.value)
    setCurrentPage(1)
  }}
  className="w-full border rounded px-3 py-2"
>
  <option value="all">All Types</option>
  <option value="sale">Sale</option>
  <option value="refund">Refund</option>  // LINE 313: "refund" option IS present
  <option value="adjustment">Adjustment</option>
  <option value="initial_import">Import</option>
</select>
```

**Findings:**
- ✅ **UI DOES include "refund" option in type filter dropdown** (Line 313)
- ✅ Default filter is "all" (should show all types)
- ✅ User can explicitly filter to show only refunds
- ⚠️ If user selects a specific type (e.g., "sale"), refund movements are excluded (expected behavior)

---

### 4. Database Schema Check

#### File: `supabase/migrations/020_stock_tracking.sql` (Line 17)

**Type Constraint:**
```sql
CREATE TABLE IF NOT EXISTS stock_movements (
  ...
  type text NOT NULL CHECK (type IN ('sale', 'refund', 'adjustment', 'initial_import')),
  ...
);
```

**Findings:**
- ✅ **Database constraint explicitly allows `'refund'`** (lowercase)
- ✅ Type value `"refund"` from refund API matches database constraint
- ✅ No enum mismatch - both use lowercase "refund"

---

## Root Cause Analysis

### Is Refund Row Written?
**YES** - Refund inserts into `stock_movements` with `type = "refund"` (lowercase, Line 399)

**Verification:**
- ✅ Code inserts with `type: "refund"` (matches database constraint)
- ✅ Database constraint allows `'refund'` (lowercase)
- ✅ All required fields are included: `business_id`, `product_id`, `store_id`, etc.
- ⚠️ **Insert errors are logged but do NOT fail the refund** (Lines 400-407)

### Why UI Hides It

**If refunds are NOT visible when filter = "all" (default):**

**Possible Root Causes:**

1. **Silent Insert Failure** (MOST LIKELY):
   - Stock movement insert fails (e.g., RLS policy, constraint violation, network error)
   - Error is logged to console but refund still succeeds
   - User sees refund completed but no movement record exists
   - **Check**: Review server logs for `"Error creating stock movement for refund"` messages

2. **RLS Policy Blocking Read**:
   - Refund uses `serviceRoleClient` to bypass RLS for INSERT
   - Inventory History uses regular `supabase` client (subject to RLS)
   - If RLS policy blocks reads, refund movements won't be visible
   - **Check**: Verify RLS policies on `stock_movements` table allow SELECT for authenticated users

3. **Business ID Mismatch**:
   - Refund inserts with `sale.business_id`
   - Inventory History queries with `business.id` (from `getCurrentBusiness()`)
   - If these don't match, refund movements are excluded
   - **Check**: Verify `sale.business_id` matches the business context in Inventory History

4. **Store ID Context** (UNLIKELY):
   - Inventory History query does NOT filter by `store_id`
   - Refund includes `store_id: itemStoreId`
   - This should not cause exclusion

**If refunds are NOT visible when filter = "refund":**
- **Possible cause**: Type value mismatch (but code shows `"refund"` matches constraint)

**If refunds ARE visible when filter = "all" but NOT when filter = "sale":**
- **Expected behavior**: User selected "sale" filter, refunds are correctly excluded

### Exact Field Causing Exclusion

**When filter = "all" (default):**
- **No field exclusion** - query should return all types including refunds
- **If refunds missing**: Check insert success (server logs) or RLS policies

**When filter = specific type (e.g., "sale"):**
- **Field**: `type` (Line 122: `.eq("type", typeFilter)`)
- **Value mismatch**: `typeFilter = "sale"` vs `movement.type = "refund"`
- **Result**: Refund rows excluded by query filter (expected behavior)

**When filter = "refund":**
- **Should show refunds only**: Query filters `.eq("type", "refund")`
- **If no refunds shown**: Either no refund movements exist OR insert failed silently

---

## Summary

### Is Refund Row Written?
**YES** - Code inserts into `stock_movements` with `type: "refund"` (Line 399)

**Verification:**
- ✅ Insert code present (Lines 393-407)
- ✅ Type value matches database constraint (`"refund"` lowercase)
- ✅ All required fields included
- ⚠️ **Insert errors are silent** - logged but don't fail refund

### If Written, Why UI Hides It

**Scenario 1: Filter = "all" (default)**
- **Should be visible**: Query does NOT filter by type (Line 121-123)
- **If not visible**: Most likely cause is **silent insert failure**
  - Check server logs for `"Error creating stock movement for refund"`
  - Verify RLS policies allow SELECT on `stock_movements`
  - Verify `business_id` matches between refund and query

**Scenario 2: Filter = "sale"**
- **Correctly hidden**: Query filters `.eq("type", "sale")`, refunds excluded
- **This is expected behavior**

**Scenario 3: Filter = "refund"**
- **Should show refunds only**: Query filters `.eq("type", "refund")`
- **If no refunds shown**: Either no refund movements exist OR insert failed silently

### Exact Field Causing Exclusion

**When filter = "all" (default):**
- **No field exclusion** - query should return refunds
- **If refunds missing**: 
  - **Root cause**: Silent insert failure OR RLS policy blocking read
  - **Check**: Server logs for insert errors
  - **Check**: RLS policies on `stock_movements` table

**When filter = specific type (e.g., "sale"):**
- **Field**: `type` (Line 122: `.eq("type", typeFilter)`)
- **Value mismatch**: `typeFilter = "sale"` vs `movement.type = "refund"`
- **Result**: Refund rows excluded by query filter (expected behavior)

**When filter = "refund":**
- **Field**: `type` (Line 122: `.eq("type", "refund")`)
- **Should match**: `typeFilter = "refund"` vs `movement.type = "refund"`
- **If no refunds shown**: Insert likely failed silently

