# 🔍 ORDER → INVOICE CONVERSION AUDIT REPORT

**Date:** 2026-01-24  
**File:** `app/api/orders/[id]/convert-to-invoice/route.ts`  
**Status:** READ-ONLY AUDIT (No fixes applied)

---

## 1️⃣ CONVERSION LOGIC LOCATION

**Route:** `app/api/orders/[id]/convert-to-invoice/route.ts`  
**Function:** `POST` handler (lines 30-708)

---

## 2️⃣ FULL CONVERSION FLOW TRACE

### Step-by-Step Flow:

1. **Parameter Resolution** (lines 36-44)
   - Resolves Next.js 16 params
   - Validates `orderId` exists
   - **Early return:** 400 if `orderId` missing

2. **Supabase Client Initialization** (line 46)
   - ✅ Uses `createSupabaseServerClient()` (correct - server client)
   - Gets user (auth check disabled in dev mode)

3. **Request Body Parsing** (lines 57-68)
   - Safely parses JSON body
   - Extracts: `issue_date`, `due_date`, `invoice_number`
   - **No early return** - defaults to empty object if parse fails

4. **Order Fetch** (lines 71-93)
   - Fetches order with embedded customer relation
   - **Early return:** 404 if order not found or fetch error

5. **State Validation - PRIMARY GUARD** (lines 97-102)
   ```typescript
   if (order.status !== "issued") {
     return NextResponse.json(
       { error: `Cannot convert order with commercial status "${order.status}". Only issued orders can be converted to invoices.` },
       { status: 400 }
     )
   }
   ```
   - **CRITICAL:** Checks if `order.status === "issued"`
   - **Early return:** 400 if status is NOT "issued"
   - ⚠️ **ISSUE:** This check happens BEFORE revision lookup

6. **Duplicate Conversion Check** (lines 104-109)
   - Checks if `order.invoice_id` already exists
   - **Early return:** 400 if already converted

7. **Revision Selection Logic** (lines 111-134)
   ```typescript
   if (order.supersedes_id) {
     // Find latest issued revision
     const { data: allRevisions } = await supabase
       .from("orders")
       .select("*")
       .or(`id.eq.${orderId},supersedes_id.eq.${orderId},supersedes_id.eq.${order.supersedes_id}`)
       .eq("status", "issued")
       .order("revision_number", { ascending: false })
       .limit(1)
   ```
   - ⚠️ **ISSUE:** Only runs if `order.supersedes_id` exists
   - If order is the ORIGINAL (no supersedes_id), it won't look for newer revisions
   - Logic assumes: if order has supersedes_id, it's a revision, so look for newer ones
   - **Problem:** If original order has status "issued" but a newer revision exists, it won't find it

8. **Redundant Cancelled Check** (lines 136-141)
   - Checks `order.status === "cancelled"`
   - **DEAD CODE:** This check is redundant because:
     - Line 97 already blocks non-"issued" statuses
     - "cancelled" would have been caught at line 97
   - This check happens AFTER the "issued" check, so it never executes for cancelled orders

9. **Order Items Fetch** (lines 144-162)
   - Fetches items from `orderToConvertId` (latest revision or original)
   - **Early return:** 500 if fetch error
   - **Early return:** 400 if no items

10. **Business Validation** (lines 165-222)
    - Fetches business for country/currency
    - **Early return:** 400 if country missing
    - **Early return:** 400 if currency missing
    - **Early return:** 400 if country-currency mismatch
    - **Early return:** 400 if currency symbol invalid

11. **Invoice Items Preparation** (lines 254-302)
    - Maps order_items to invoice_items format
    - Validates line items
    - **Early return:** 400 if invalid line items

12. **Tax Calculation** (lines 310-349)
    - Uses canonical tax engine
    - Recomputes taxes (doesn't reuse order tax fields)

13. **Invoice Creation** (lines 442-598)
    - Prepares invoice data
    - Attempts insert with source tracking
    - Falls back to insert without source tracking if schema error
    - **Early return:** 500 if invoice creation fails

14. **Invoice Items Creation** (lines 600-628)
    - Inserts invoice items
    - **Early return:** 500 if items fail (deletes invoice)

15. **Order Update** (lines 632-645)
    - Updates order status to "converted"
    - Links invoice_id
    - Updates all revisions in chain
    - **Non-fatal:** Logs error but doesn't fail if update fails

16. **Success Response** (lines 682-696)
    - Returns success with invoice and order data

17. **Outer Catch Block** (lines 697-707)
    - Catches ANY unhandled errors
    - Returns generic error: `"Order could not be converted to invoice"`
    - ⚠️ **ISSUE:** This is likely where the user's error is coming from

---

## 3️⃣ STATE MODEL AUDIT

### Order State Fields Checked:

| Field | Line | Check | Value Expected | Issue |
|-------|------|-------|----------------|-------|
| `order.status` | 97 | `!== "issued"` | Must be "issued" | ✅ Correct for new model |
| `order.status` | 136 | `=== "cancelled"` | Dead code | ❌ Redundant check |
| `order.invoice_id` | 104 | Exists check | Must be null | ✅ Correct |
| `order.supersedes_id` | 117 | Exists check | Used for revision lookup | ⚠️ Logic gap |
| `order.revision_number` | 129 | Comparison | Used to find latest | ✅ Correct |

### Execution Status:
- ❌ **NOT CHECKED** - `execution_status` is never evaluated
- ✅ **CORRECT** - Execution status is independent and shouldn't block conversion

### State Assumptions:
- ✅ Code correctly expects `status === "issued"` (new commercial state model)
- ❌ Code does NOT check for old status values (`pending`, `active`, `completed`, `invoiced`)
- ⚠️ **POTENTIAL ISSUE:** If migration 208 hasn't run, orders might still have old status values

---

## 4️⃣ SCHEMA MAPPING AUDIT

### Order → Invoice Header Mapping:

| Source (Order) | Destination (Invoice) | Line | Status |
|----------------|----------------------|------|--------|
| `business_id` | `business_id` | 445 | ✅ Valid |
| `customer_id` | `customer_id` | 446 | ✅ Valid |
| `null` | `invoice_number` | 447 | ✅ Valid (null for draft) |
| `issue_date` (from body) | `issue_date` | 448 | ✅ Valid |
| `due_date` (calculated) | `due_date` | 449 | ✅ Valid |
| `invoiceSettings.default_payment_terms` | `payment_terms` | 450 | ✅ Valid |
| `orderReferenceNote` | `notes` | 451 | ✅ Valid |
| `invoiceSettings.default_footer_message` | `footer_message` | 452 | ✅ Valid |
| `businessCurrencyCode` | `currency_code` | 453 | ✅ Valid |
| `businessCurrencySymbol` | `currency_symbol` | 454 | ✅ Valid |
| `baseSubtotal` (calculated) | `subtotal` | 456 | ✅ Valid |
| `taxResult.total_tax` | `total_tax` | 457 | ✅ Valid |
| `invoiceTotal` (calculated) | `total` | 458 | ✅ Valid |
| `applyTaxes` | `apply_taxes` | 459 | ✅ Valid |
| `"draft"` | `status` | 460 | ✅ Valid |
| `publicToken` | `public_token` | 461 | ✅ Valid |
| `toTaxLinesJsonb(taxResult)` | `tax_lines` | 463 | ✅ Valid |
| `taxEngineCode` | `tax_engine_code` | 464 | ✅ Valid |
| `effectiveDate` | `tax_engine_effective_from` | 465 | ✅ Valid |
| `jurisdiction` | `tax_jurisdiction` | 466 | ✅ Valid |
| `legacyTaxColumns.nhil` | `nhil` | 468 | ✅ Valid |
| `legacyTaxColumns.getfund` | `getfund` | 469 | ✅ Valid |
| `legacyTaxColumns.covid` | `covid` | 470 | ✅ Valid |
| `legacyTaxColumns.vat` | `vat` | 471 | ✅ Valid |
| `"order"` | `source_type` | 493 | ⚠️ Optional (fallback exists) |
| `orderToConvertId` | `source_id` | 494 | ⚠️ Optional (fallback exists) |

**Schema Mapping Status:** ✅ **ALL COLUMNS VALID** - No legacy column names, all match current schema

### Order Items → Invoice Items Mapping:

| Source (order_items) | Destination (invoice_items) | Line | Status |
|---------------------|----------------------------|------|--------|
| `invoice.id` | `invoice_id` | 602 | ✅ Valid |
| `item.product_service_id` | `product_service_id` | 603 | ✅ Valid |
| `item.description` | `description` | 604 | ✅ Valid |
| `item.qty` (from `quantity ?? qty`) | `qty` | 605 | ✅ Valid |
| `item.unit_price` | `unit_price` | 606 | ✅ Valid |
| `item.discount_amount ?? 0` | `discount_amount` | 607 | ✅ Valid |
| `item.line_subtotal` (recalculated) | `line_subtotal` | 608 | ✅ Valid |

**Items Mapping Status:** ✅ **ALL COLUMNS VALID** - Correctly maps `quantity` → `qty`

---

## 5️⃣ SUPABASE CLIENT AUDIT

- ✅ **Uses:** `createSupabaseServerClient()` (line 46)
- ✅ **Correct:** Server client for API routes
- ✅ **Auth:** User fetched but check disabled in dev mode (line 52-54)
- ⚠️ **RLS:** Could potentially block inserts if RLS policies are strict, but no explicit RLS bypass

---

## 6️⃣ ERROR HANDLING AUDIT

### Error Return Patterns:

| Line | Error Type | Return Format | Status |
|------|------------|---------------|--------|
| 40-43 | Missing orderId | `NextResponse.json({ error: "..." }, { status: 400 })` | ✅ Proper |
| 89-92 | Order not found | `NextResponse.json({ error: "..." }, { status: 404 })` | ✅ Proper |
| 98-101 | Invalid status | `NextResponse.json({ error: "..." }, { status: 400 })` | ✅ Proper |
| 105-108 | Already converted | `NextResponse.json({ error: "..." }, { status: 400 })` | ✅ Proper |
| 151-154 | Items fetch error | `NextResponse.json({ error: "..." }, { status: 500 })` | ✅ Proper |
| 173-180 | Missing country | `NextResponse.json({ success: false, error: "...", message: "..." }, { status: 400 })` | ✅ Proper |
| 588-597 | Invoice creation error | `NextResponse.json({ success: false, error: "...", message: "...", code: "...", details: "..." }, { status: 500 })` | ✅ Proper |
| 620-627 | Items creation error | `NextResponse.json({ success: false, error: "...", message: "..." }, { status: 500 })` | ✅ Proper |
| 697-706 | **Outer catch block** | `NextResponse.json({ success: false, error: "Order could not be converted to invoice", message: "..." }, { status: 500 })` | ⚠️ **GENERIC ERROR** |

### Error Swallowing:

- ❌ **No errors swallowed** - All errors are returned
- ⚠️ **Order update error** (line 642-645): Logged but not returned (non-fatal by design)
- ⚠️ **Audit log errors** (lines 660, 678): Swallowed in try-catch (non-fatal by design)

### Console Logging:

- ✅ Errors are logged with `console.error()` before returning
- ✅ Invoice creation errors include detailed logging (lines 565-572)

---

## 7️⃣ ROOT CAUSE ANALYSIS

### Most Likely Failure Points:

#### **PRIMARY SUSPECT: State Check Failure (Line 97)**

**Issue:** Order status is NOT "issued"

**Possible Reasons:**
1. Migration 208 hasn't run - orders still have old status values (`pending`, `active`, `completed`, `invoiced`)
2. Order was created before migration and has status `"draft"` or old value
3. Order status was set incorrectly during creation

**Error Message User Would See:**
```
Cannot convert order with commercial status "{actual_status}". Only issued orders can be converted to invoices.
```

**But User Reports:** `"Order could not be converted to invoice" {}`

This suggests the error is coming from the **outer catch block** (line 702), not the state check.

---

#### **SECONDARY SUSPECT: Outer Catch Block (Line 697-707)**

**Issue:** An unhandled exception is being caught

**Possible Reasons:**
1. **Invoice creation fails** but error handling doesn't catch it properly
2. **Database constraint violation** (e.g., unique constraint on invoice_number)
3. **RLS policy blocks insert** silently
4. **Type error** or null reference during invoice creation
5. **Tax calculation error** throws exception instead of returning error

**Error Message User Sees:**
```
Order could not be converted to invoice
```

**Empty object `{}` suggests:**
- Error object might not have a `message` property
- Or error is being stringified incorrectly
- Or error is a non-Error type (e.g., database constraint)

---

#### **TERTIARY SUSPECT: Revision Selection Logic Gap (Lines 117-134)**

**Issue:** Logic only looks for newer revisions if `order.supersedes_id` exists

**Scenario:**
- Original order has status "issued"
- Newer revision exists with higher revision_number
- Original order doesn't have `supersedes_id` (it's the original)
- Code won't find the newer revision
- Converts the wrong (older) revision

**Impact:** Would convert successfully but use wrong data

---

## 8️⃣ GUARD CONDITIONS SUMMARY

### All Early Return Points:

1. **Line 40-43:** Missing orderId → 400
2. **Line 89-92:** Order not found → 404
3. **Line 97-101:** Status !== "issued" → 400 ⚠️ **LIKELY FAILURE POINT**
4. **Line 104-108:** Already converted → 400
5. **Line 136-140:** Status === "cancelled" → 400 (dead code)
6. **Line 151-154:** Items fetch error → 500
7. **Line 157-161:** No items → 400
8. **Line 172-180:** Missing country → 400
9. **Line 185-193:** Missing currency → 400
10. **Line 199-208:** Country-currency mismatch → 400
11. **Line 212-221:** Invalid currency symbol → 400
12. **Line 293-300:** Invalid line items → 400
13. **Line 431-439:** Missing business_id → 400
14. **Line 564-597:** Invoice creation error → 500 ⚠️ **LIKELY FAILURE POINT**
15. **Line 616-627:** Invoice items error → 500
16. **Line 697-706:** Unhandled exception → 500 ⚠️ **USER'S ERROR MESSAGE**

---

## 9️⃣ OUTDATED ASSUMPTIONS

### Assumptions That May Be Outdated:

1. ❌ **Order status values:** Code assumes migration 208 has run and orders have new status values
   - **Reality:** If migration hasn't run, orders might have `pending`, `active`, `completed`, `invoiced`
   - **Impact:** Line 97 check fails for orders with old status values

2. ⚠️ **Revision lookup:** Assumes if order has `supersedes_id`, it's a revision (not original)
   - **Reality:** Original orders don't have `supersedes_id`, so newer revisions won't be found
   - **Impact:** Might convert wrong revision

3. ✅ **Execution status:** Correctly ignores execution_status (independent from commercial state)

4. ✅ **Schema:** All column names match current schema (no legacy columns)

---

## 🔟 FINAL DIAGNOSIS

### **ROOT CAUSE (Most Likely):**

**The error `"Order could not be converted to invoice" {}` is coming from the outer catch block (line 702), which means:**

1. An **unhandled exception** is being thrown somewhere in the conversion flow
2. The exception is **NOT** being caught by the specific error handlers
3. The exception might be:
   - A database constraint violation (e.g., unique constraint on `invoice_number` or `public_token`)
   - An RLS policy blocking the insert
   - A null reference error
   - A type error during tax calculation or invoice creation

### **Secondary Issue:**

**If migration 208 hasn't run**, orders with old status values (`pending`, `active`, `completed`) will fail the check at line 97, but the error message would be different from what the user reports.

### **Recommended Next Steps:**

1. **Check server logs** for the actual exception/error details
2. **Verify migration 208 has run** - check if orders table has `execution_status` column
3. **Check order status** - verify the order being converted has `status = "issued"`
4. **Check database constraints** - verify no unique constraint violations
5. **Check RLS policies** - verify they allow invoice creation

---

## 📋 SUMMARY

| Category | Status | Issue |
|----------|--------|-------|
| **State Check** | ⚠️ | Assumes migration 208 has run |
| **Revision Logic** | ⚠️ | Gap in finding newer revisions |
| **Schema Mapping** | ✅ | All columns valid |
| **Supabase Client** | ✅ | Correct server client |
| **Error Handling** | ⚠️ | Generic catch block hides real error |
| **Execution Status** | ✅ | Correctly ignored |

**Most Likely Failure:** Unhandled exception caught by outer catch block (line 697-707), possibly due to database constraint or RLS policy.
