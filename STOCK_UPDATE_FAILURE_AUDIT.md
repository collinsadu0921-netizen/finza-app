# STOCK UPDATE FAILURE AUDIT REPORT
## Post-Fix Analysis - No Code Changes

---

## EXECUTIVE SUMMARY

**Error Message**: `"Stock update failed. Sale not completed. Unable to record stock movement."`

**Failure Point**: `stock_movements` INSERT operation (NOT `products_stock` UPDATE)

**Location**: 
- Line 617: Variant stock path
- Line 795: Product stock path

**Critical Finding**: The `products_stock` UPDATE/INSERT succeeds, but the subsequent `stock_movements` INSERT fails, causing the entire sale to rollback.

---

## 1. EXACT ERROR SOURCE IDENTIFICATION

### Failure Sequence:
1. ✅ **Sale INSERT** → SUCCESS (line 256-304)
2. ✅ **Sale Items INSERT** → SUCCESS (line 417-456)
3. ✅ **products_stock UPDATE/INSERT** → SUCCESS (lines 535-557 for variants, 723-747 for products)
4. ❌ **stock_movements INSERT** → **FAILS HERE** (lines 597-599 for variants, 787-789 for products)

### Error Handling:
- Error is caught at line 601 (variants) or 791 (products)
- Error object: `movementError` from Supabase insert operation
- Current logging: Console.error with error object, but error details may not be fully captured

---

## 2. REQUIRED DATA AT FAILURE TIME

### Data Being Inserted into `stock_movements`:

**For Variants** (line 582-590):
```javascript
{
  business_id: business_id,           // ✅ Required (NOT NULL)
  product_id: item.product_id,       // ✅ Required (NOT NULL)
  quantity_change: -quantitySold,    // ✅ Required (NOT NULL)
  type: "sale",                       // ✅ Required (NOT NULL, CHECK constraint)
  user_id: user_id,                   // ✅ Required (NOT NULL)
  related_sale_id: sale.id,          // ⚠️ Optional (can be NULL)
  note: `Variant sale: ...`,         // ⚠️ Optional (can be NULL)
  store_id: storeIdForStock           // ⚠️ Optional (nullable column)
}
```

**For Products** (line 772-780):
```javascript
{
  business_id: business_id,          // ✅ Required (NOT NULL)
  product_id: item.product_id,        // ✅ Required (NOT NULL)
  quantity_change: -quantitySold,     // ✅ Required (NOT NULL)
  type: "sale",                        // ✅ Required (NOT NULL, CHECK constraint)
  user_id: user_id,                    // ✅ Required (NOT NULL)
  related_sale_id: sale.id,           // ⚠️ Optional (can be NULL)
  note: `Sale: ...`,                  // ⚠️ Optional (can be NULL)
  store_id: storeIdForStock           // ⚠️ Optional (nullable column)
}
```

### Potential NULL Values:
- `business_id`: Should be set from request body
- `product_id`: Should be set from sale_items
- `user_id`: Should be set from request body
- `related_sale_id`: Set to `sale.id` (should exist since sale was created)
- `store_id`: Conditionally added if `storeIdForStock` exists (line 593-594, 783-784)

---

## 3. products_stock ROW EXISTENCE CHECK

### Query Pattern:
**For Variants** (line 477-483):
```sql
SELECT id, stock_quantity, stock
FROM products_stock
WHERE product_id = ?
  AND variant_id = ?
  AND store_id = ?
```

**For Products** (line 646-652):
```sql
SELECT id, stock_quantity, stock
FROM products_stock
WHERE product_id = ?
  AND variant_id IS NULL
  AND store_id = ?
```

### Behavior:
- **If row exists**: Updates existing record (line 535-541 for variants, 723-729 for products)
- **If row missing**: Creates new record (line 546-552 for variants, 736-742 for products)
- **Note**: Code allows creating `products_stock` row with negative stock (line 734 comment)

### Constraint:
- `UNIQUE(product_id, variant_id, store_id)` constraint exists (migration 030_simple_multi_store.sql:56)
- This prevents duplicate stock records per product/variant/store combination

---

## 4. DATABASE CONSTRAINTS ANALYSIS

### stock_movements Table Schema (from migration 020_stock_tracking.sql):

```sql
CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity_change int NOT NULL,
  type text NOT NULL CHECK (type IN ('sale', 'refund', 'adjustment', 'initial_import')),
  user_id uuid NOT NULL,
  related_sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  note text,
  created_at timestamp with time zone DEFAULT now()
);
```

### Potential Constraint Violations:

1. **Foreign Key Constraints**:
   - `business_id` → `businesses(id)` - Could fail if business_id doesn't exist
   - `product_id` → `products(id)` - Could fail if product_id doesn't exist
   - `related_sale_id` → `sales(id)` - Could fail if sale.id doesn't exist (unlikely since sale was just created)
   - `store_id` → `stores(id)` - Could fail if store_id doesn't exist (nullable, but if provided must be valid)

2. **CHECK Constraint**:
   - `type` must be one of: 'sale', 'refund', 'adjustment', 'initial_import'
   - Code uses `type: "sale"` ✅ (should pass)

3. **NOT NULL Constraints**:
   - `business_id`: NOT NULL ✅
   - `product_id`: NOT NULL ✅
   - `quantity_change`: NOT NULL ✅
   - `type`: NOT NULL ✅
   - `user_id`: NOT NULL ✅

4. **Negative Stock**:
   - No constraint preventing negative `quantity_change` values
   - Code uses negative values for sales: `quantity_change: -quantitySold` ✅

---

## 5. TRANSACTION SCOPE ANALYSIS

### Critical Finding: **NO DATABASE TRANSACTION**

The code does NOT use database transactions. Each operation is independent:

1. `sales` INSERT → Commits immediately
2. `sale_items` INSERT → Commits immediately
3. `products_stock` UPDATE/INSERT → Commits immediately
4. `stock_movements` INSERT → **FAILS HERE**
5. Manual rollback via DELETE statements (lines 611-612, 801-802)

### Transaction Behavior:
- **Each Supabase operation is auto-committed**
- **No BEGIN/COMMIT/ROLLBACK wrapper**
- **Rollback is manual**: Deletes sale and sale_items, then attempts to restore stock

### Problem:
- If `stock_movements` INSERT fails, the `products_stock` has already been updated
- Manual rollback attempts to restore stock (lines 615-621, 805-811)
- But if rollback fails, stock remains deducted without movement record

---

## 6. ROW LEVEL SECURITY (RLS) ANALYSIS

### RLS Policy for stock_movements (migration 020_stock_tracking.sql:42):

```sql
CREATE POLICY "Enable insert for authenticated users" 
ON stock_movements 
FOR INSERT 
WITH CHECK (auth.uid() IS NOT NULL);
```

### Critical Issue: **RLS Policy Requires auth.uid()**

**Service Role Key Usage** (line 4-7):
```javascript
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
```

### Problem Scenarios:

1. **If `SUPABASE_SERVICE_ROLE_KEY` is NOT set**:
   - Falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Anon key is subject to RLS policies
   - `auth.uid()` will be NULL (no authenticated user context)
   - **RLS policy will BLOCK the insert** ❌

2. **If `SUPABASE_SERVICE_ROLE_KEY` is set correctly**:
   - Service role key bypasses RLS
   - Insert should succeed ✅

### Verification Needed:
- Check if `SUPABASE_SERVICE_ROLE_KEY` environment variable is set
- If not set, RLS policy will block inserts

---

## 7. ROOT CAUSE ANALYSIS

### Most Likely Causes (in order of probability):

#### A) **RLS Policy Blocking Insert** (HIGHEST PROBABILITY)
- **Cause**: `SUPABASE_SERVICE_ROLE_KEY` not set, using anon key
- **Symptom**: RLS policy requires `auth.uid() IS NOT NULL`, but anon key has no user context
- **Error**: Would return RLS policy violation error
- **Fix**: Ensure `SUPABASE_SERVICE_ROLE_KEY` is set in environment

#### B) **Foreign Key Constraint Violation** (MEDIUM PROBABILITY)
- **Cause**: Invalid `business_id`, `product_id`, `related_sale_id`, or `store_id`
- **Symptom**: Foreign key constraint error
- **Error**: Would return foreign key violation error
- **Fix**: Validate all foreign keys exist before insert

#### C) **Missing Required Field** (LOW PROBABILITY)
- **Cause**: One of the NOT NULL fields is actually NULL
- **Symptom**: NOT NULL constraint violation
- **Error**: Would return NOT NULL constraint error
- **Fix**: Validate all required fields are set

#### D) **CHECK Constraint Violation** (VERY LOW PROBABILITY)
- **Cause**: `type` value doesn't match allowed values
- **Symptom**: CHECK constraint violation
- **Error**: Would return CHECK constraint error
- **Fix**: Code uses `"sale"` which is valid ✅

---

## 8. EXACT QUERY THAT FAILS

### For Variants:
```sql
INSERT INTO stock_movements (
  business_id,
  product_id,
  quantity_change,
  type,
  user_id,
  related_sale_id,
  note,
  store_id  -- Conditionally added
)
VALUES (
  '<business_id>',
  '<product_id>',
  -<quantitySold>,
  'sale',
  '<user_id>',
  '<sale.id>',
  'Variant sale: <product_name> x<quantitySold>',
  '<storeIdForStock>'  -- May be NULL
);
```

### For Products:
```sql
INSERT INTO stock_movements (
  business_id,
  product_id,
  quantity_change,
  type,
  user_id,
  related_sale_id,
  note,
  store_id  -- Conditionally added
)
VALUES (
  '<business_id>',
  '<product_id>',
  -<quantitySold>,
  'sale',
  '<user_id>',
  '<sale.id>',
  'Sale: <product_name> x<quantitySold>',
  '<storeIdForStock>'  -- May be NULL
);
```

---

## 9. ERROR MESSAGE CAPTURE

### Current Error Handling (lines 601-631, 791-820):
- Logs error object to console
- Returns error message in response
- **BUT**: Error details may not be fully serialized

### What Error Object Contains:
- `movementError.message`: Error message string
- `movementError.code`: Error code (e.g., "42501" for RLS violation, "23503" for FK violation)
- `movementError.details`: Additional error details
- `movementError.hint`: Database hint

### Expected Error Codes:
- **42501**: Insufficient privilege (RLS policy violation)
- **23503**: Foreign key violation
- **23502**: NOT NULL constraint violation
- **23514**: CHECK constraint violation

---

## 10. CLASSIFICATION

### This is: **A) RLS Policy Issue** (Most Likely)

**Evidence**:
1. Service role key fallback pattern suggests it may not be set
2. RLS policy requires `auth.uid() IS NOT NULL`
3. Anon key has no authenticated user context
4. Error occurs specifically on INSERT operation
5. `products_stock` operations succeed (may have different RLS policies)

### Alternative: **B) Foreign Key Constraint Violation**

**If not RLS**, then likely:
- Invalid `store_id` reference (if `storeIdForStock` is set but store doesn't exist)
- Invalid `business_id` reference
- Invalid `product_id` reference

---

## 11. VERIFICATION STEPS NEEDED

1. **Check Environment Variables**:
   - Verify `SUPABASE_SERVICE_ROLE_KEY` is set
   - If not set, this is the root cause

2. **Check Error Code**:
   - Look for error code "42501" (RLS violation)
   - Look for error code "23503" (FK violation)

3. **Check Error Message**:
   - Look for "new row violates row-level security policy"
   - Look for "violates foreign key constraint"

4. **Verify Data**:
   - Confirm `business_id` exists in `businesses` table
   - Confirm `product_id` exists in `products` table
   - Confirm `store_id` exists in `stores` table (if provided)
   - Confirm `sale.id` exists in `sales` table

5. **Check RLS Policies**:
   - Verify RLS is enabled on `stock_movements`
   - Verify policy requires `auth.uid() IS NOT NULL`
   - Verify service role key bypasses RLS

---

## 12. CONCLUSION

**Primary Issue**: Most likely an **RLS policy violation** due to missing `SUPABASE_SERVICE_ROLE_KEY`, causing the code to use the anon key which is subject to RLS policies that require an authenticated user context.

**Secondary Issue**: No database transaction wrapping the operations, meaning partial commits occur before the failure point.

**Next Steps**: 
1. Verify `SUPABASE_SERVICE_ROLE_KEY` is set
2. Check actual error code and message from failed inserts
3. Verify all foreign key references exist
4. Consider wrapping operations in a database transaction

---

**END OF AUDIT REPORT**













