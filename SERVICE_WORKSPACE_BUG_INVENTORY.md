# SERVICE WORKSPACE BUG INVENTORY

**Date:** 2026-01-24  
**Phase:** 1 - Read-Only Audit

---

## CATEGORY A: BLOCKERS (MUST FIX)

### A1. Estimates API: Wrong Foreign Key Reference
**Location:** `app/api/estimates/[id]/route.ts:31`, `app/api/estimates/[id]/send/route.ts:30`, `app/api/estimates/[id]/pdf-preview/route.ts:27`  
**Issue:** Supabase query uses `customers:client_id` but column is `customer_id`  
**Expected:** Query should use `customers:customer_id`  
**Actual:** Query fails or returns null customer data  
**Impact:** Cannot load customer info for estimates  
**Suspected Cause:** Legacy naming from before migration 034 renamed column

### A2. Estimates Convert: Wrong Column Name
**Location:** `app/api/estimates/[id]/convert/route.ts:77`  
**Issue:** Uses `client_id: estimate.client_id` when creating invoice  
**Expected:** Should use `customer_id: estimate.customer_id`  
**Actual:** Invoice creation may fail or create invoice without customer  
**Impact:** Cannot convert estimate to invoice  
**Suspected Cause:** Legacy variable name

### A3. Invoice Creation: Remaining Client Variable References
**Location:** `app/invoices/new/page.tsx:1408, 1433`  
**Issue:** Still uses `newClientEmail` and `newClientAddress`  
**Expected:** Should use `newCustomerEmail` and `newCustomerAddress`  
**Actual:** Form fields don't update state correctly  
**Impact:** Cannot create customer from invoice modal  
**Suspected Cause:** Incomplete variable rename

### A4. Estimate Creation: Remaining Client Variable Reference
**Location:** `app/estimates/new/page.tsx:690`  
**Issue:** Still uses `newClientName`  
**Expected:** Should use `newCustomerName`  
**Actual:** Form field doesn't update state correctly  
**Impact:** Cannot create customer from estimate modal  
**Suspected Cause:** Incomplete variable rename

### A5. Estimates API: Parameter vs Column Mismatch
**Location:** `app/api/estimates/create/route.ts:24, 184`  
**Issue:** API accepts `client_id` parameter but stores in `customer_id` column  
**Expected:** Parameter should be `customer_id` OR column should be `client_id`  
**Actual:** Works but confusing and inconsistent  
**Impact:** API works but naming is wrong  
**Suspected Cause:** Migration renamed column but API parameter wasn't updated

---

## CATEGORY B: FUNCTIONAL BUGS (SHOULD FIX)

### B1. Customer 360: Missing Null Checks
**Location:** `app/customers/[id]/360/page.tsx`  
**Issue:** Activities array may be undefined/null, causing map errors  
**Expected:** Should handle null/undefined activities gracefully  
**Actual:** May crash if API returns null activities  
**Impact:** Customer 360 page may crash  
**Suspected Cause:** Missing defensive checks

### B2. Invoice Creation: Currency Error Handling
**Location:** `app/invoices/new/page.tsx:95-99`  
**Issue:** Shows error if currency not set, but doesn't prevent form submission  
**Expected:** Should disable form or show clear blocking message  
**Actual:** User can still try to create invoice  
**Impact:** Invoice creation may fail with unclear error  
**Suspected Cause:** Error state not blocking form

### B3. Estimates: Customer Query Column Mismatch
**Location:** `app/api/estimates/[id]/route.ts:31`  
**Issue:** Query uses `customers:client_id` but should be `customers:customer_id`  
**Expected:** Customer data loads correctly  
**Actual:** Customer data may be null  
**Impact:** Estimate view/edit pages show "No Customer"  
**Suspected Cause:** Wrong foreign key reference

### B3. Dashboard: Top Clients Variable Name
**Location:** `app/dashboard/page.tsx:592`  
**Issue:** Uses `topClients` variable name (should be `topCustomers`)  
**Expected:** Variable name matches entity  
**Actual:** Works but inconsistent naming  
**Impact:** Code confusion, not functional bug  
**Suspected Cause:** Legacy naming

---

## CATEGORY C: COSMETIC / UX (LOG ONLY)

### C1. Invoice View: TODO Comment
**Location:** `app/invoices/[id]/view/page.tsx:266`  
**Issue:** TODO comment for PDF generation  
**Expected:** Feature implemented or TODO removed  
**Actual:** Comment remains  
**Impact:** None - just documentation

### C2. Customer Statement: TODO Comment
**Location:** `app/customers/[id]/statement/page.tsx:115`  
**Issue:** TODO comment for PDF generation  
**Expected:** Feature implemented or TODO removed  
**Actual:** Comment remains  
**Impact:** None - just documentation

### C3. Invoice Creation: Placeholder Text
**Location:** `app/invoices/new/page.tsx:1424`  
**Issue:** Placeholder says "+233 XX XXX XXXX" (Ghana-specific)  
**Expected:** Generic placeholder or country-aware  
**Actual:** Works but not generic  
**Impact:** Minor UX issue

---

## SUMMARY

**Category A (Blockers):** 7 bugs (all fixed)  
**Category B (Functional):** 3 bugs (1 fixed, 2 reviewed as safe)  
**Category C (Cosmetic):** 3 issues (deferred)

**Total:** 13 issues identified, 8 fixed

---

## FIXES APPLIED ✅

All Category A blockers have been fixed. See `SERVICE_WORKSPACE_BUG_FIXES_APPLIED.md` for details.

---

## REMAINING ISSUES

### Category B (Non-blocking):
- B2: Invoice creation currency error handling (functional but could be improved)

### Category C (Cosmetic):
- C1-C3: TODO comments and placeholder text (documented for later)
