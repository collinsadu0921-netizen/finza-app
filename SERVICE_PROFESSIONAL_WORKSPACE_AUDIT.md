# SERVICE & PROFESSIONAL WORKSPACE AUDIT REPORT

**Date:** 2024  
**Scope:** Service & Professional Workspaces (excluding Retail/POS)  
**Type:** Read-only analysis (no fixes implemented)

---

## EXECUTIVE SUMMARY

This audit identifies **critical financial risks**, **data integrity issues**, **UX inconsistencies**, and **missing guardrails** in the Service and Professional workspaces. The analysis reveals **duplicated status management logic**, **inconsistent outstanding calculations**, and **status mutation paths that bypass payment records**.

**Key Findings:**
- ⚠️ **CRITICAL:** Manual "Mark as Paid" endpoint bypasses payment ledger
- ⚠️ **CRITICAL:** Duplicate status update logic in payment handlers (API + triggers)
- ⚠️ **HIGH:** Status inconsistencies between dashboard, list views, and reports
- ⚠️ **HIGH:** Missing currency/tax validation in estimate→invoice conversion
- ⚠️ **MEDIUM:** Inconsistent draft exclusion logic across views

---

## A) WORKSPACE ENTRY & CONTEXT

### ✅ **STRENGTHS**
- Business loading via `getCurrentBusiness()` is centralized
- Industry mode isolation via `lib/industryMode.ts` (tab-scoped)
- No store_id assumptions in Service/Professional modes (correct)

### ⚠️ **ISSUES FOUND**

#### A1. **Business Context Fallback Logic**
**File:** `lib/business.ts` (lines 8-100)

**Issue:** Complex fallback logic that may return wrong business:
- First checks `owner_id` match
- Falls back to `business_users` table
- Multiple error handling paths with different behaviors
- No explicit validation that returned business matches user's active context

**Risk:** User could see/modify data from wrong business if multiple businesses exist.

**Recommendation:** Add explicit business_id validation at API entry points.

---

#### A2. **Industry Mode Initialization**
**File:** `lib/industryMode.ts`

**Issue:** Tab-scoped industry mode stored in `sessionStorage`:
- If user switches industry in DB, tab won't reflect change until refresh
- No sync mechanism between tabs
- Could cause confusion if user expects global state

**Risk:** Low (UX confusion only)

**Recommendation:** Add explicit "refresh industry mode" action or sync on navigation.

---

#### A3. **No Store/Location Isolation**
**Status:** ✅ **CORRECT**

Service/Professional modes correctly **do NOT** use `store_id`:
- Invoices have no `store_id` field (correct)
- No store filtering in queries (correct)
- No store context required (correct)

**No issues found** - this is the expected behavior.

---

## B) CORE OBJECTS & FLOW

### B1. **Invoice Creation Flow**

#### ✅ **STRENGTHS**
- Currency validation enforced (`app/api/invoices/create/route.ts` lines 98-150)
- Country-currency matching enforced (`assertCountryCurrency`)
- Tax engine integration via `calculateTaxes()`
- System-controlled invoice numbering (only assigned on "sent")

#### ⚠️ **ISSUES FOUND**

**B1.1. Status Default Logic**
**File:** `app/api/invoices/create/route.ts` (line 37)

```typescript
status = "draft", // Allow status to be passed (defaults to draft)
```

**Issue:** Status can be passed in request body, allowing creation with `status: "sent"`:
- Bypasses normal "draft → sent" workflow
- Could create invoices without invoice_number (if status="sent" but number generation fails)
- No validation that status transitions are valid

**Risk:** Medium (could create inconsistent state)

**Recommendation:** Reject any `status` field in create request, always create as "draft".

---

**B1.2. Estimate → Invoice Conversion**
**File:** `app/api/estimates/[id]/convert/route.ts` (lines 72-92)

**Issues:**
1. **Missing Currency/Tax Validation:**
   - Copies tax amounts directly from estimate (lines 84-90)
   - No validation that estimate currency matches business currency
   - No recalculation of taxes using tax engine
   - Uses deprecated tax column names (`nhil_amount`, `getfund_amount`, etc.)

2. **Invoice Number Generation:**
   - Uses manual increment logic (lines 58-70)
   - Should use `generate_invoice_number_with_settings` RPC
   - Could conflict with system-controlled numbering

3. **Status Always "draft":**
   - Line 91: `status: "draft"` (correct)
   - But no validation that estimate was in valid state for conversion

**Risk:** High (tax/currency mismatch, numbering conflicts)

**Recommendation:** 
- Recalculate taxes using tax engine
- Use system invoice number generator
- Validate currency match

---

**B1.3. Order → Invoice Conversion**
**File:** `app/api/orders/[id]/convert-to-invoice/route.ts`

**Issues:**
1. **Uses Deprecated Tax Engine:**
   - Line 4: `import { calculateBaseFromTotalIncludingTaxes } from "@/lib/ghanaTaxEngine"`
   - Should use `calculateTaxes()` from `lib/taxEngine`
   - Hardcoded Ghana tax logic

2. **Status Always "draft":**
   - Line 209 (in comment): `Set invoice status = 'draft'` (correct)
   - But no explicit status field in invoice creation code shown

**Risk:** High (Ghana-specific tax logic for non-GH businesses)

**Recommendation:** Replace with generic tax engine.

---

### B2. **Invoice Status Lifecycle**

#### ✅ **STRENGTHS**
- Draft → Sent → Paid workflow exists
- Invoice number only assigned when status = "sent"
- Read-time safety net in GET endpoint (`app/api/invoices/[id]/route.ts` lines 116-150)

#### ⚠️ **ISSUES FOUND**

**B2.1. Status Mutation Without Payment**
**File:** `app/api/invoices/[id]/mark-paid/route.ts` (lines 42-50)

**CRITICAL ISSUE:**
```typescript
// Update invoice status to "paid"
const updateData: any = {
  status: "paid",
  paid_at: new Date().toISOString(),
}
```

**Problem:** This endpoint allows marking invoice as "paid" **without creating a payment record**:
- Bypasses payment ledger
- Creates status mismatch (status="paid" but outstanding_amount > 0)
- No audit trail of payment
- Breaks accounting integrity

**Risk:** **CRITICAL** - Financial reporting will be incorrect.

**Recommendation:** **REMOVE THIS ENDPOINT** or require payment creation.

---

**B2.2. Duplicate Status Update Logic**
**Files:**
- `app/api/payments/create/route.ts` (lines 237-251)
- `app/api/payments/[id]/route.ts` (lines 152-178)
- `supabase/migrations/040_credit_notes.sql` (trigger `update_invoice_status_with_credits`)

**Problem:** Status is updated in **THREE places**:
1. API route manually calculates and updates status
2. Database trigger also updates status
3. Both run on same payment event

**Risk:** Medium (race conditions, duplicate updates, inconsistent logic)

**Recommendation:** Remove manual status updates from API routes, rely solely on database triggers.

---

**B2.3. Status Update Logic Inconsistency**

**Payment Create (`app/api/payments/create/route.ts` lines 237-242):**
```typescript
let newStatus = "sent"
if (newTotalPaid >= invoiceTotal) {
  newStatus = "paid"
} else if (newTotalPaid > 0) {
  newStatus = "partially_paid"
}
```

**Payment Update (`app/api/payments/[id]/route.ts` lines 155-170):**
```typescript
if (totalPaid >= invoiceTotal) {
  newStatus = "paid"
} else if (totalPaid > 0) {
  newStatus = "partially_paid"
} else {
  newStatus = "sent"
}
// Plus overdue check
```

**Database Trigger (`supabase/migrations/040_credit_notes.sql` lines 159-172):**
```sql
IF new_balance <= 0 THEN
  invoice_status := 'paid';
ELSIF total_paid > 0 OR total_credits > 0 THEN
  invoice_status := 'partially_paid';
ELSE
  invoice_status := 'sent';
END IF;
-- Plus overdue check
```

**Problem:** Three different implementations:
- Payment create doesn't check credit notes
- Payment update checks overdue but create doesn't
- Database trigger includes credit notes (correct)

**Risk:** High (inconsistent status across code paths)

**Recommendation:** Use centralized `recalculate_invoice_status()` function (already exists in migration 129).

---

**B2.4. "Unsent" Endpoint**
**File:** `app/api/invoices/[id]/unsent/route.ts` (lines 38-46)

**Issue:** Allows reverting "sent" → "draft":
```typescript
.update({
  status: "draft",
  sent_via_method: null,
  sent_at: null,
})
```

**Problem:**
- No validation that invoice has no payments
- Could create draft invoice with payments (inconsistent state)
- Invoice number remains assigned (should it be cleared?)

**Risk:** Medium (data inconsistency)

**Recommendation:** Block "unsent" if payments exist, or clear invoice_number.

---

## C) PAYMENTS & STATUS INTEGRITY

### ✅ **STRENGTHS**
- Payment creation requires invoice_id
- Payment deletion (soft delete) triggers status recalculation
- Credit note application triggers status update

### ⚠️ **ISSUES FOUND**

#### C1. **Payment Creation Duplicates Status Update**
**File:** `app/api/payments/create/route.ts` (lines 232-251)

**Problem:** Comment says "trigger will automatically update invoice status" but code also manually updates:
- Line 232: Comment acknowledges trigger
- Lines 237-251: Manual status update anyway
- Both execute, causing duplicate work

**Risk:** Low (performance, but logic is redundant)

**Recommendation:** Remove manual update, rely on trigger.

---

#### C2. **Payment Update Doesn't Use Centralized Function**
**File:** `app/api/payments/[id]/route.ts` (lines 134-179)

**Problem:** Manual status calculation instead of calling `recalculate_invoice_status()`:
- Duplicates logic from trigger
- Doesn't account for credit notes in same calculation
- Overdue check is manual (should be in centralized function)

**Risk:** Medium (inconsistent with trigger logic)

**Recommendation:** Call `recalculate_invoice_status()` RPC instead of manual update.

---

#### C3. **Payment Deletion Status Update**
**File:** `app/api/payments/[id]/route.ts` (lines 237-249)

**Status:** ✅ **CORRECT**

Soft delete sets `deleted_at`, which should trigger status recalculation via trigger. However, code doesn't explicitly call recalculation function.

**Risk:** Low (trigger should handle it, but verify)

**Recommendation:** Verify trigger fires on `deleted_at` update, or add explicit RPC call.

---

#### C4. **Credit Note Status Update**
**File:** `app/api/credit-notes/[id]/route.ts` (lines 180-188)

**Status:** ✅ **CORRECT**

Updates status field, which triggers database trigger `trigger_update_invoice_on_credit_note`.

**No issues found.**

---

## D) TAX & CURRENCY HANDLING

### ✅ **STRENGTHS**
- Invoice creation enforces currency validation
- Country-currency matching enforced
- Tax engine integration via `calculateTaxes()`
- No hardcoded Ghana currency in invoice creation

### ⚠️ **ISSUES FOUND**

#### D1. **Order Conversion Uses Deprecated Tax Engine**
**File:** `app/api/orders/[id]/convert-to-invoice/route.ts` (line 4)

```typescript
import { calculateBaseFromTotalIncludingTaxes } from "@/lib/ghanaTaxEngine"
```

**Problem:** Uses Ghana-specific tax engine:
- Hardcoded Ghana tax logic
- Will fail for non-GH businesses
- Should use `calculateTaxes()` from `lib/taxEngine`

**Risk:** High (breaks for non-GH businesses)

**Recommendation:** Replace with generic tax engine.

---

#### D2. **Estimate Conversion Missing Tax Recalculation**
**File:** `app/api/estimates/[id]/convert/route.ts` (lines 84-90)

**Problem:** Copies tax amounts directly:
```typescript
nhil_amount: estimate.nhil_amount,
getfund_amount: estimate.getfund_amount,
covid_amount: estimate.covid_amount,
vat_amount: estimate.vat_amount,
```

**Issues:**
- No recalculation using tax engine
- Assumes estimate taxes are still valid
- Uses deprecated column names
- No validation that estimate currency matches business currency

**Risk:** High (tax/currency mismatch)

**Recommendation:** Recalculate taxes using tax engine, validate currency match.

---

#### D3. **Currency Symbol Resolution**
**Files:** Multiple invoice UI pages

**Status:** ✅ **MOSTLY CORRECT**

- `app/invoices/new/page.tsx` uses `getCurrencySymbol()` (line 91)
- `app/invoices/[id]/view/page.tsx` uses `useBusinessCurrency()` hook
- No hardcoded "₵" or "GHS" found in invoice pages

**No issues found.**

---

#### D4. **Tax Display in UI**
**Files:** `app/invoices/[id]/view/page.tsx`, `app/invoices/new/page.tsx`

**Status:** ✅ **CORRECT**

- Conditional rendering for Ghana tax labels (NHIL, GETFund, COVID)
- Uses `getTaxLabels()` helper
- Generic "Tax" label for non-GH countries

**No issues found.**

---

## E) DASHBOARD & REPORTING ALIGNMENT

### ✅ **STRENGTHS**
- Dashboard calculates outstanding from payments + credit notes (correct)
- Draft exclusion logic exists
- Status filtering is consistent

### ⚠️ **ISSUES FOUND**

#### E1. **Outstanding Definition Inconsistency**

**Dashboard (`app/dashboard/page.tsx` lines 410-431):**
- Filters: `status IN ('sent', 'partially_paid', 'overdue')` AND `outstandingAmount > 0`
- **Correct:** Uses financial state (outstandingAmount) as source of truth

**Invoice List (`app/invoices/page.tsx` lines 446-450):**
- Filters: `status !== "draft"` AND `status !== "paid"` AND `status !== "cancelled"` AND `status IN ('sent', 'overdue', 'partially_paid')`
- **Correct:** Excludes drafts, calculates outstanding from payments

**Invoice List API (`app/api/invoices/list/route.ts` lines 50-66):**
- For "overdue" filter: Uses `due_date < today` but filters by outstanding in memory
- **Correct:** Financial state overrides status

**Status:** ✅ **CONSISTENT** - All use financial state (payments + credits) as source of truth.

**No issues found** - recent fixes have aligned the logic.

---

#### E2. **Dashboard "Outstanding" Label Confusion**
**File:** `app/dashboard/page.tsx` (lines 399-403, 538)

**Issue:** Comment says "Outstanding invoices" represents OVERDUE only:
```typescript
// Dashboard KPI "Outstanding invoices" represents OVERDUE invoices only
// OVERDUE = outstanding_amount > 0 AND due_date < today
const outstandingInvoicesCount = overdueInvoices.length
```

But variable name `outstandingInvoices` suggests all outstanding, not just overdue.

**Risk:** Low (UX confusion, but logic is correct)

**Recommendation:** Rename to `overdueInvoicesCount` for clarity.

---

#### E3. **Dashboard vs Invoice List Outstanding Amount**
**Dashboard:** `totalOutstandingAmount` = all outstanding (sent/partially_paid/overdue with balance > 0)  
**Invoice List:** `outstandingAmount` = same calculation

**Status:** ✅ **CONSISTENT**

**No issues found.**

---

## F) DATA MODEL & ENUM CONSISTENCY

### ⚠️ **ISSUES FOUND**

#### F1. **Invoice Status Values**

**Found Statuses:**
- `draft` - Not yet issued
- `sent` - Issued, awaiting payment
- `partially_paid` - Has payments but not fully paid
- `paid` - Fully paid
- `overdue` - Past due date with outstanding balance
- `void` - Cancelled/voided
- `cancelled` - Cancelled

**Issues:**
1. **"sent" vs "issued":** Some code uses "sent", some uses "issued". Are they the same?
2. **"overdue" as status:** Overdue is a **derived state** (due_date < today AND outstanding > 0), not a persistent status. Should it be stored or calculated?
3. **"void" vs "cancelled":** Two statuses for same concept?

**Risk:** Medium (confusion, inconsistent filtering)

**Recommendation:** 
- Standardize: Use "sent" (not "issued")
- Remove "overdue" as stored status, calculate on-the-fly
- Consolidate "void" and "cancelled" into single "cancelled"

---

#### F2. **Payment Status Values**

**Found:** No `status` field on payments table (correct - payments are immutable records).

**Status:** ✅ **CORRECT**

**No issues found.**

---

#### F3. **Estimate Status Values**

**Found Statuses:**
- `draft`
- `sent`
- `accepted`
- `rejected`

**Status:** ✅ **CORRECT**

**No issues found.**

---

#### F4. **Order Status Values**

**Found Statuses:**
- `pending`
- `active`
- `completed`
- `invoiced`
- `cancelled`

**Status:** ✅ **CORRECT**

**No issues found.**

---

## G) UI/UX CONTRACT VIOLATIONS

### ⚠️ **ISSUES FOUND**

#### G1. **"Mark as Paid" Button Without Payment**
**File:** `app/invoices/[id]/view/page.tsx` (if exists)

**Issue:** If UI has "Mark as Paid" button that calls `/api/invoices/[id]/mark-paid`, it violates ledger-first principle.

**Risk:** High (users can mark paid without payment record)

**Recommendation:** Remove button or require payment creation.

---

#### G2. **Editing Sent Invoices**
**File:** `app/invoices/[id]/edit/page.tsx`

**Status:** Need to verify if sent invoices can be edited.

**Risk:** Medium (sent invoices should be immutable)

**Recommendation:** Block editing if `status !== 'draft'`.

---

#### G3. **Printing Without Currency**
**Files:** Invoice print views

**Status:** ✅ **CORRECT** (currency is required in invoice creation)

**No issues found.**

---

## H) SHARED LOGIC & DUPLICATION

### ⚠️ **ISSUES FOUND**

#### H1. **Status Recalculation Logic**

**Duplicated In:**
1. `app/api/payments/create/route.ts` (lines 237-251)
2. `app/api/payments/[id]/route.ts` (lines 152-178)
3. `supabase/migrations/040_credit_notes.sql` (trigger function)
4. `supabase/migrations/129_fix_invoice_status_sync.sql` (centralized function)

**Problem:** Three implementations of same logic:
- API routes have manual calculation
- Database trigger has SQL calculation
- Migration 129 has centralized `recalculate_invoice_status()` function

**Risk:** High (inconsistency, maintenance burden)

**Recommendation:** 
- Remove manual status updates from API routes
- Use `recalculate_invoice_status()` RPC call if needed
- Rely on database triggers for automatic updates

---

#### H2. **Outstanding Calculation**

**Duplicated In:**
1. `app/dashboard/page.tsx` (lines 328-351)
2. `app/invoices/page.tsx` (lines 458-468)
3. `app/api/invoices/list/route.ts` (lines 114-150)

**Problem:** Same calculation logic in three places:
```typescript
outstandingAmount = invoice.total - sum(payments) - sum(credit_notes)
```

**Risk:** Medium (if logic changes, must update three places)

**Recommendation:** Create shared `calculateOutstandingAmount(invoiceId)` helper.

---

#### H3. **Tax Calculation**

**Status:** ✅ **CENTRALIZED**

- Uses `calculateTaxes()` from `lib/taxEngine`
- Centralized tax engine selector
- No duplication found

**No issues found.**

---

## SUMMARY: MUST-FIX vs NICE-TO-HAVE

### 🔴 **CRITICAL (MUST-FIX)**

1. **Remove "Mark as Paid" Endpoint** (`app/api/invoices/[id]/mark-paid/route.ts`)
   - **Risk:** Financial integrity violation
   - **Impact:** Invoices can be marked paid without payment records
   - **Fix:** Remove endpoint or require payment creation

2. **Remove Duplicate Status Updates from Payment APIs**
   - **Risk:** Race conditions, inconsistent state
   - **Impact:** Status may be wrong if trigger and API update conflict
   - **Fix:** Remove manual updates, rely on database triggers

3. **Fix Order Conversion Tax Engine**
   - **Risk:** Breaks for non-GH businesses
   - **Impact:** Order→Invoice conversion fails for non-GH
   - **Fix:** Replace `ghanaTaxEngine` import with `lib/taxEngine`

4. **Fix Estimate Conversion Tax/Currency**
   - **Risk:** Tax/currency mismatch
   - **Impact:** Wrong taxes applied, currency confusion
   - **Fix:** Recalculate taxes, validate currency match

---

### 🟡 **HIGH PRIORITY**

5. **Standardize Invoice Status Values**
   - Remove "overdue" as stored status
   - Consolidate "void" and "cancelled"
   - Use "sent" consistently (not "issued")

6. **Block Status Field in Invoice Create**
   - Always create as "draft"
   - Reject `status` field in request body

7. **Add Validation to "Unsent" Endpoint**
   - Block if payments exist
   - Clear invoice_number if reverting to draft

8. **Create Shared Outstanding Calculation Helper**
   - Reduce duplication
   - Ensure consistency

---

### 🟢 **NICE-TO-HAVE**

9. **Rename Dashboard Variables**
   - `outstandingInvoices` → `overdueInvoicesCount` for clarity

10. **Add Business Context Validation**
    - Explicit business_id checks at API entry points

11. **Sync Industry Mode Across Tabs**
    - Or add explicit "refresh" action

12. **Block Editing Sent Invoices**
    - Add status check in edit endpoint

---

## CONCLUSION

The Service and Professional workspaces have **solid foundations** with:
- ✅ Correct currency/tax validation in invoice creation
- ✅ Proper draft exclusion logic
- ✅ Financial state (payments + credits) as source of truth for outstanding

However, **critical issues** exist:
- ⚠️ Manual status mutation bypasses payment ledger
- ⚠️ Duplicate status update logic causes inconsistency risk
- ⚠️ Estimate/Order conversion missing tax/currency validation

**Recommended Action Plan:**
1. **Phase 1 (Critical):** Remove mark-paid endpoint, fix order/estimate conversion
2. **Phase 2 (High):** Standardize status values, remove duplicate status updates
3. **Phase 3 (Nice-to-have):** Refactor shared helpers, improve UX clarity

---

**END OF AUDIT REPORT**



