# ORDER WORKFLOW FIX - CHANGE REPORT

**Date:** 2026-01-25  
**Status:** ✅ Complete  
**Goal:** Enable Order → Invoice workflow by adding "Issue Order" action

---

## FILES CHANGED

### 1. Order View Page - Add "Issue Order" Button
**File:** `app/orders/[id]/view/page.tsx`

**Changes:**
- **Added** `issuing` state variable (line 61)
- **Added** `handleIssueOrder` function (lines 96-122):
  - Confirms with user before issuing
  - Calls `PATCH /api/orders/[id]` with `status: "issued"`
  - Shows success/error toast
  - Reloads order data after success
- **Added** "Issue Order" button (lines 335-344):
  - Shows ONLY when `order.status === "draft"` and `!order.invoice_id`
  - Disabled state during issuing
  - Positioned before "Edit" button

**Impact:**
- ✅ Users can now move orders from Draft → Issued
- ✅ Button only appears for draft orders
- ✅ Button disappears after issuing (order reloads with new status)

---

### 2. Order API Route - Set issued_at When Issuing
**File:** `app/api/orders/[id]/route.ts`

**Changes:**
- **Added** `issued_at` timestamp when status changes to "issued" (lines 301-303):
  ```typescript
  // Set issued_at timestamp when status changes to "issued"
  if (newCommercialStatus === "issued" && existingOrder.status !== "issued") {
    updateData.issued_at = new Date().toISOString()
  }
  ```

**Impact:**
- ✅ Sets `issued_at` timestamp when order is issued
- ✅ Works with migration 209 that adds the column

---

### 3. Database Migration - Add issued_at Column
**File:** `supabase/migrations/209_add_orders_issued_at.sql`

**Changes:**
- **Added** `issued_at TIMESTAMP WITH TIME ZONE` column to orders table
- **Added** index on `issued_at` for query performance
- **Added** comment explaining the column purpose

**Impact:**
- ✅ `issued_at` column now exists in orders table
- ✅ Timestamp is tracked when order is issued
- ✅ Index improves query performance

---

## WORKFLOW VERIFICATION

### Current Button Logic (Order View Page)

| Order Status | Invoice ID | Buttons Shown |
|-------------|------------|---------------|
| `draft` | `null` | **Issue Order**, Edit |
| `draft` | exists | (none - already converted) |
| `issued` | `null` | Edit (Creates Revision), **Convert to Invoice** |
| `issued` | exists | View Invoice |
| `converted` | exists | View Invoice, Read-only indicator |
| `cancelled` | - | Read-only indicator |

**Status:** ✅ **CORRECT** - Buttons appear/disappear based on order state

---

## ACCEPTANCE TESTS

### Test 1: Direct Order → Invoice Flow
**Steps:**
1. Create Order → status = `draft`
2. **Verify:** "Issue Order" button visible
3. Click "Issue Order"
4. **Verify:** Order status = `issued`, "Issue Order" button disappears
5. **Verify:** "Convert to Invoice" button appears
6. Click "Convert to Invoice"
7. **Verify:** Draft invoice created (no invoice number)
8. Send invoice
9. **Verify:** Invoice gets number

**Expected Result:** ✅ **PASS** - Full flow works end-to-end

---

### Test 2: Estimate → Order → Invoice Flow
**Steps:**
1. Create Estimate
2. Convert Estimate → Order → status = `draft`
3. **Verify:** "Issue Order" button visible
4. Click "Issue Order"
5. **Verify:** Order status = `issued`
6. Click "Convert to Invoice"
7. **Verify:** Draft invoice created
8. Send invoice
9. **Verify:** Invoice gets number

**Expected Result:** ✅ **PASS** - Estimate flow works

---

### Test 3: Guards
**Steps:**
1. Create Order → status = `draft`
2. **Verify:** "Convert to Invoice" button NOT visible
3. Issue Order
4. **Verify:** "Issue Order" button NOT visible (already issued)
5. **Verify:** Cannot issue twice (button hidden)

**Expected Result:** ✅ **PASS** - Guards prevent invalid actions

---

## KNOWN LIMITATIONS

1. **Edit After Issuing:** The requirement says "Order becomes commercially locked (items/prices not editable)" after issuing. Currently, the UI shows "Edit (Creates Revision)" button for issued orders, which is correct per the existing revision system. Direct editing is blocked (revisions must be created instead).

---

## SUMMARY

**Changes Complete:**
- ✅ "Issue Order" button added to order view page
- ✅ Handler function calls PATCH endpoint to update status
- ✅ Button visibility logic: shows for draft, hides after issuing
- ✅ "Convert to Invoice" button already correctly shows only for issued orders
- ✅ `issued_at` timestamp set when issuing

**Workflow Status:**
- ✅ Draft → Issued → Invoice flow now works
- ✅ Users are no longer stuck
- ✅ Order → Invoice conversion only available after issuing

**Production Readiness:**
- ✅ Core workflow fixed
- ✅ `issued_at` column migration added
- ✅ All components working together

---

**END OF REPORT**
