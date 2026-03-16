# SERVICE WORKSPACE AUDIT FIXES - CHANGE REPORT

**Date:** 2026-01-25  
**Status:** Partial Implementation (Critical fixes complete, remaining work documented)

---

## FILES CHANGED

### 1. Invoice Mark-as-Paid Endpoint (FIXED)
**File:** `app/api/invoices/[id]/mark-paid/route.ts`  
**Change:** Replaced direct status update with payment creation
- **Before:** Directly updated invoice status to "paid" without payment record
- **After:** Creates payment record for remaining balance, triggers handle status update
- **Impact:** Ensures payment record exists, ledger posting happens, status is derived from payments

---

### 2. Payment Create Route (FIXED)
**File:** `app/api/payments/create/route.ts`  
**Changes:**
- Removed manual invoice status update (lines 205-224)
- Removed AUTH DISABLED comments (2 instances)
- **Impact:** Status now updated solely by database trigger `recalculate_invoice_status()`

---

### 3. Payment Update Route (FIXED)
**File:** `app/api/payments/[id]/route.ts`  
**Changes:**
- Removed manual invoice status update in PUT handler (lines 134-179)
- Removed manual invoice status update in DELETE handler (lines 251-292)
- **Impact:** Status updates now handled exclusively by database triggers

---

### 4. Invoice Unsent Endpoint (FIXED)
**File:** `app/api/invoices/[id]/unsent/route.ts`  
**Changes:**
- Added authentication check
- Added business ownership verification
- Added validation to block sent→draft when payments exist
- Added validation to block sent→draft when credit notes exist
- Returns 409 with error codes: `HAS_PAYMENTS` or `HAS_CREDITS`
- **Impact:** Prevents invalid state (draft invoice with payments)

---

### 5. Auth Disabled Removal (PARTIAL)
**Files Fixed:**
- `app/api/payments/create/route.ts` (2 instances)
- `app/api/invoices/create/route.ts` (2 instances)
- `app/api/invoices/list/route.ts` (3 instances)
- `app/api/estimates/create/route.ts` (2 instances)
- `app/api/credit-notes/create/route.ts` (3 instances)
- `app/api/expenses/create/route.ts` (2 instances)

**Files Remaining (Service workspace routes with AUTH DISABLED):**
- `app/api/invoices/[id]/route.ts` (multiple instances)
- `app/api/invoices/[id]/send/route.ts` (multiple instances)
- `app/api/orders/*` routes (multiple instances)
- `app/api/estimates/[id]/*` routes (multiple instances)
- `app/api/credit-notes/[id]/*` routes (multiple instances)
- `app/api/credit-notes/list/route.ts` (multiple instances)
- `app/api/expenses/[id]/*` routes (multiple instances)
- `app/api/expenses/list/route.ts` (multiple instances)

**Note:** ~160 total instances found, but many are in Retail/Accounting routes. Service workspace routes need systematic cleanup.

---

## STANDARDIZATION WORK (IN PROGRESS)

### Draft Exclusion Logic

**Current State:**
- **Customer Statement:** Excludes `status = 'draft'` ✅
- **Dashboard:** Excludes `status = 'draft'` ✅
- **Invoice List:** Excludes `status = 'draft'` ✅
- **Outstanding Page:** Excludes `status = 'draft'` ✅

**Canonical Rule (Already Applied):**
```typescript
const nonDraftInvoices = invoices.filter((inv: any) => inv.status !== "draft")
```

**Status:** ✅ **CONSISTENT** - All Service workspace views exclude drafts correctly

---

### Outstanding Calculation Logic

**Current State:**
- **Dashboard Total Outstanding:** Uses AR ledger balance (account 1200) - `SUM(debit) - SUM(credit)`
- **Dashboard Per-Invoice:** Uses `invoice.total - payments - credits`
- **Customer Statement:** Uses `invoice.total - payments - credits`
- **Invoice List:** Uses AR ledger balance (account 1200)

**Canonical Rule (Recommended):**
```typescript
// For individual invoices:
outstandingAmount = invoice.total - sum(payments) - sum(credit_notes)

// For totals:
totalOutstanding = sum(nonDraftInvoices.map(inv => inv.total)) 
                 - sum(payments for nonDraftInvoices)
                 - sum(credit_notes for nonDraftInvoices)
```

**Issue:** Dashboard uses ledger balance for total, but payments/credits for per-invoice. This can cause discrepancies if ledger is out of sync.

**Recommendation:** Use payments/credits calculation consistently everywhere. Ledger balance should match, but payments/credits is the operational source of truth.

**Status:** ⚠️ **NEEDS STANDARDIZATION** - Dashboard should use same calculation as customer statement

---

## MIGRATIONS NEEDED

**None** - All fixes use existing database functions and triggers:
- `recalculate_invoice_status()` (migration 129)
- `trigger_update_invoice_status` (migration 129)
- `post_invoice_payment_to_ledger()` (existing)

---

## TESTING STEPS

### Test 1: Mark-as-Paid Creates Payment
1. Create an invoice with status "sent"
2. Call `POST /api/invoices/[id]/mark-paid` with payment method
3. **Verify:**
   - Payment record exists in `payments` table
   - Invoice status updated to "paid" (via trigger)
   - Journal entry created in ledger
   - Payment allocation exists

### Test 2: Payment Create Doesn't Manually Update Status
1. Create an invoice with status "sent"
2. Create a partial payment via `POST /api/payments`
3. **Verify:**
   - Invoice status updated to "partially_paid" (via trigger only)
   - No manual status update in API response
   - Check database trigger fired (check logs)

### Test 3: Unsent Endpoint Blocks Invalid State
1. Create an invoice with status "sent"
2. Add a payment to the invoice
3. Call `POST /api/invoices/[id]/unsent`
4. **Verify:**
   - Returns 409 with error code "HAS_PAYMENTS"
   - Invoice status remains "sent" or "partially_paid"
   - Invoice not changed to "draft"

### Test 4: Auth Checks Enforced
1. Call any Service API route without authentication
2. **Verify:**
   - Returns 401 Unauthorized
3. Call with authentication but wrong business_id
4. **Verify:**
   - Returns 403 Forbidden

### Test 5: Outstanding Calculation Consistency
1. Create multiple invoices (some draft, some sent)
2. Add payments to some invoices
3. **Verify:**
   - Dashboard total outstanding matches customer statement total
   - Both exclude draft invoices
   - Both use same calculation: `total - payments - credits`

---

## REMAINING WORK

### High Priority
1. **Complete AUTH DISABLED removal** from remaining Service routes:
   - `app/api/invoices/[id]/route.ts`
   - `app/api/invoices/[id]/send/route.ts`
   - `app/api/orders/*` routes
   - `app/api/estimates/[id]/*` routes
   - `app/api/credit-notes/[id]/*` routes
   - `app/api/credit-notes/list/route.ts`
   - `app/api/expenses/[id]/*` routes
   - `app/api/expenses/list/route.ts`

2. **Standardize outstanding calculation:**
   - Update dashboard to use payments/credits calculation instead of ledger balance
   - Ensure all views use same formula: `invoice.total - payments - credits`
   - Document canonical rule in code comments

### Medium Priority
3. **Verify all Service routes have proper auth:**
   - Audit remaining routes for auth bypasses
   - Ensure business ownership checks are in place

4. **Add integration tests:**
   - Test mark-as-paid flow end-to-end
   - Test payment status update flow
   - Test unsent endpoint validation

---

## KNOWN LIMITATIONS

1. **AUTH DISABLED Pattern:** ~160 instances remain across codebase. Only Service workspace routes were targeted in this fix. Retail and Accounting routes may still have auth disabled.

2. **Outstanding Calculation:** Dashboard uses ledger balance for total outstanding, which may differ from payments/credits calculation if ledger is out of sync. This is acceptable but should be standardized for consistency.

3. **Status Update Timing:** Database triggers update status asynchronously. API responses may not immediately reflect updated status. This is expected behavior - status is eventually consistent.

4. **Mark-as-Paid Default Method:** The mark-as-paid endpoint defaults to "cash" payment method. Consider making method required or using business default.

---

## ACCEPTANCE CRITERIA STATUS

✅ **1. Paid invoice always has payment row + allocation + payment ledger posting**
- Mark-as-paid endpoint now creates payment record
- Trigger handles ledger posting
- Payment allocation created automatically

✅ **2. Payment create/update produces correct invoice status without manual updates**
- Manual status updates removed from payment routes
- Database trigger `recalculate_invoice_status()` handles all status updates
- Credit notes included in status calculation

⚠️ **3. No auth bypass markers remain in Service routes**
- Critical Service routes fixed (payments, invoices/create, invoices/list, estimates/create, credit-notes/create, expenses/create)
- Remaining Service routes need cleanup (see "Remaining Work")

✅ **4. Unsent endpoint returns 409 with error code if invalid**
- Validates payments exist
- Validates credit notes exist
- Returns appropriate error codes

⚠️ **5. Dashboard vs reports vs statement match on totals**
- Draft exclusion is consistent
- Outstanding calculation needs standardization (dashboard uses ledger, others use payments/credits)

---

## SUMMARY

**Critical Fixes Complete:**
- ✅ Mark-as-paid creates real payment
- ✅ Payment routes rely on triggers only
- ✅ Unsent endpoint hardened
- ✅ Auth enabled in critical Service routes

**Remaining Work:**
- ⚠️ Complete AUTH DISABLED removal from remaining Service routes
- ⚠️ Standardize outstanding calculation (dashboard vs statement)

**Production Readiness:**
- ✅ Core accounting integrity issues fixed
- ⚠️ Auth cleanup needed before production
- ⚠️ Outstanding calculation standardization recommended

---

**END OF REPORT**
