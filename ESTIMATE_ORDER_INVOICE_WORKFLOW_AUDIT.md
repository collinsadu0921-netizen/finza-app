# 🔍 ESTIMATE → ORDER → INVOICE WORKFLOW AUDIT REPORT

**Date:** 2026-01-25  
**Scope:** Estimate, Order, Invoice lifecycle and conversions  
**Type:** Analysis-only (no fixes applied)

---

## 1️⃣ ESTIMATE WORKFLOW AUDIT

### Estimate Creation

**File:** `app/api/estimates/create/route.ts`  
**Status:** ✅ **CORRECT**

**Flow:**
1. Validates required fields (business_id, issue_date, items)
2. Generates estimate number via `generate_estimate_number()` RPC (or fallback timestamp)
3. Calculates taxes using canonical tax engine
4. Creates estimate with `status: "draft"` (line 198)
5. Creates estimate_items

**Key Findings:**
- ✅ Estimates start as `draft`
- ✅ Estimate numbers are generated (separate from invoice numbering)
- ✅ Tax calculations use canonical tax engine
- ✅ No invoice numbers assigned (correct - estimates are non-financial)

---

### Estimate Statuses

**Valid Statuses:**
- `draft` - Default on creation
- `sent` - When estimate is sent to customer
- `accepted` - When converted to order or invoice
- `rejected` - Customer rejection
- `expired` - Past expiry date

**Evidence:** `app/api/estimates/[id]/send/route.ts` lines 66-79

---

### Can Estimate Be "Sent"?

**Answer:** ✅ **YES**

**File:** `app/api/estimates/[id]/send/route.ts`  
**Flow:**
- Draft estimates can be sent (draft → sent transition)
- Sending updates status to "sent" (lines 140-143, 195-198, 242-245)
- Sending does NOT finalize anything - estimates remain non-financial
- Sending does NOT assign invoice numbers (correct)

**Status:** ✅ **CORRECT** - Sending estimate is just communication, not finalization

---

### Estimate → Order Conversion

**File:** `app/api/orders/convert-from-estimate/route.ts`  
**Status:** ✅ **CORRECT**

**Flow:**
1. Validates estimate exists and not already converted (lines 54-60)
2. Fetches estimate items (lines 62-81)
3. Maps estimate_items to order_items format (lines 84-89)
4. Creates order with:
   - `status: "draft"` (commercial state - line 130)
   - `execution_status: "pending"` (execution state - line 131)
   - `estimate_id` link (line 129)
5. Updates estimate status to `"accepted"` and `converted_to: "order"` (lines 172-180)

**Data Copied:**
- ✅ Customer ID
- ✅ All estimate items
- ✅ Tax calculations (reused from estimate)
- ✅ Notes
- ✅ Business ID

**Missing Validations:**
- ⚠️ No currency validation (estimate currency vs business currency)
- ⚠️ No tax recalculation (reuses estimate tax values)

**Status:** ✅ **FUNCTIONAL** - Creates order correctly, but tax/currency validation missing

---

### Estimate → Invoice Conversion (Direct)

**File:** `app/api/estimates/[id]/convert/route.ts`  
**Status:** ❌ **CRITICAL ISSUE - BYPASSES CANONICAL NUMBERING**

**Flow:**
1. Validates estimate exists and not converted (lines 66-72)
2. Fetches estimate items (lines 74-93)
3. **GENERATES INVOICE NUMBER MANUALLY** (lines 95-108):
   ```typescript
   const { data: lastInvoice } = await supabase
     .from("invoices")
     .select("invoice_number")
     .eq("business_id", business.id)
     .order("created_at", { ascending: false })
     .limit(1)
     .maybeSingle()

   let invoiceNumber = "INV-0001"
   if (lastInvoice?.invoice_number) {
     const lastNum = parseInt(lastInvoice.invoice_number.replace("INV-", "")) || 0
     invoiceNumber = `INV-${String(lastNum + 1).padStart(4, "0")}`
   }
   ```
4. Creates invoice with `status: "draft"` BUT assigns `invoice_number` immediately (line 118)
5. Creates invoice_items from estimate_items

**CRITICAL ISSUES:**

1. **❌ BYPASSES CANONICAL NUMBERING FUNCTION**
   - Uses manual query + increment logic
   - Does NOT call `generate_invoice_number_with_settings()`
   - Hardcodes prefix "INV-" (ignores invoice_settings.invoice_prefix)
   - Hardcodes padding to 4 digits (ignores invoice_settings)
   - Fallback to "INV-0001" (ignores invoice_settings.starting_number)

2. **❌ ASSIGNS INVOICE NUMBER TO DRAFT**
   - Line 118: `invoice_number: invoiceNumber` even though `status: "draft"`
   - Violates rule: "Invoice numbers only when finalized"

3. **❌ NUMBERING RESET RISK**
   - If no invoices exist, defaults to "INV-0001"
   - Ignores `invoice_settings.starting_number`
   - Could restart numbering sequence

4. **❌ NOT TRANSACTION-SAFE**
   - Race condition: Two concurrent conversions could get same number
   - No locking or atomic increment

**Root Cause:** This endpoint was created before canonical numbering function existed, or intentionally bypassed it.

**Impact:** 
- Invoice numbering sequence can be broken
- Draft invoices get numbers (violates business rule)
- Numbering can restart at 0001

---

## 2️⃣ ORDER WORKFLOW AUDIT

### Order Creation

**Files:**
- `app/api/orders/create/route.ts` - Direct creation
- `app/api/orders/convert-from-estimate/route.ts` - From estimate

**Status:** ✅ **CORRECT**

**Flow:**
1. Validates items exist
2. Creates order with:
   - `status: "draft"` (commercial state - line 70 in create, line 130 in convert-from-estimate)
   - `execution_status: "pending"` (execution state)
3. Creates order_items
4. If from estimate, updates estimate status to "accepted"

**Key Findings:**
- ✅ Orders start as `draft` (commercial) + `pending` (execution)
- ✅ No invoice numbers assigned (correct)
- ✅ Orders are non-financial until converted to invoice

---

### Order Status Transitions

**Commercial States (status):**
- `draft` - Editable, not yet issued
- `issued` - Immutable commercial agreement (per migration 208)
- `converted` - Converted to invoice
- `cancelled` - Cancelled

**Execution States (execution_status):**
- `pending` - Not started
- `active` - In progress
- `completed` - Fulfilled

**Evidence:** `supabase/migrations/208_orders_commercial_execution_state_separation.sql`

**Status:** ✅ **CORRECT** - Proper separation of commercial vs execution state

---

### Order → Invoice Conversion

**File:** `app/api/orders/[id]/convert-to-invoice/route.ts`  
**Status:** ⚠️ **PARTIAL ISSUE - INVOICE NUMBER NOT GENERATED WHEN STATUS="SENT"**

**Flow:**
1. Validates order status is "issued" (line 97)
2. Checks order not already converted (line 104)
3. Finds latest issued revision if order was revised (lines 111-134)
4. Fetches order items (lines 144-162)
5. Validates business country/currency (lines 165-222)
6. Prepares invoice items (lines 254-302)
7. Recalculates taxes using canonical tax engine (lines 310-349)
8. **Sets `finalInvoiceNumber = null`** (line 233)
9. Creates invoice with:
   - `status: "draft"` (default, line 460)
   - `invoice_number: finalInvoiceNumber` (null, line 447)
   - OR `status: "sent"` if body.status === "sent" (lines 478-487)

**CRITICAL ISSUE:**

**❌ INVOICE NUMBER NOT GENERATED WHEN STATUS="SENT"**

**Lines 231-233:**
```typescript
// Invoice number is system-controlled: only assign when status is "sent"
// For draft invoices created from orders, invoice_number will be null until the invoice is issued
let finalInvoiceNumber: string | null = null
```

**Lines 478-487:**
```typescript
const invoiceStatus = body.status || "draft"
if (invoiceStatus === "sent") {
  invoiceData.status = "sent"
  invoiceData.sent_at = new Date().toISOString()
  // ... but finalInvoiceNumber is still null!
} else {
  invoiceData.status = invoiceStatus
}
```

**Problem:** 
- Comment says "only assign when status is 'sent'"
- But code never generates invoice number even when `invoiceStatus === "sent"`
- Invoice created with `status: "sent"` but `invoice_number: null`
- Violates rule: "Sent invoices MUST have invoice number"

**Root Cause:** Missing logic to call `generate_invoice_number_with_settings()` when `invoiceStatus === "sent"`

**Impact:**
- Sent invoices from orders have no invoice number
- Dashboard/reports may exclude them (if filtering by invoice_number IS NOT NULL)
- Violates business rule

**Other Findings:**
- ✅ Uses canonical tax engine (correct)
- ✅ Creates draft by default (correct)
- ✅ Links to order via source_type/source_id (correct)
- ✅ Updates order status to "converted" (correct)

---

## 3️⃣ INVOICE FINALIZATION AUDIT

### Direct Invoice Creation

**File:** `app/api/invoices/create/route.ts`  
**Status:** ✅ **CORRECT**

**Flow:**
1. Validates required fields
2. **If `status === "sent"`**: Generates invoice number via `generate_invoice_number_with_settings()` (lines 75-87)
3. **If `status === "draft"`**: `invoice_number = null` (line 67)
4. Creates invoice with appropriate status

**Key Findings:**
- ✅ Draft invoices: `invoice_number = null` (correct)
- ✅ Sent invoices: `invoice_number` assigned via canonical function (correct)
- ✅ Uses `generate_invoice_number_with_settings()` (correct)

---

### Order → Invoice Conversion

**File:** `app/api/orders/[id]/convert-to-invoice/route.ts`  
**Status:** ❌ **BROKEN - DOES NOT GENERATE INVOICE NUMBER WHEN STATUS="SENT"**

**Flow:**
1. Sets `finalInvoiceNumber = null` (line 233)
2. Allows `body.status` to override default "draft" (line 478)
3. If `invoiceStatus === "sent"`, sets status to "sent" but **never generates invoice number**
4. Creates invoice with `invoice_number: null` even when `status: "sent"`

**Problem:** Missing logic to generate invoice number when converting with status="sent"

**Expected Behavior:**
```typescript
if (invoiceStatus === "sent") {
  const { data: invoiceNumData } = await supabase.rpc("generate_invoice_number_with_settings", {
    business_uuid: orderToConvert.business_id,
  })
  finalInvoiceNumber = invoiceNumData || null
  if (!finalInvoiceNumber) {
    return NextResponse.json({ error: "Failed to generate invoice number" }, { status: 500 })
  }
  invoiceData.status = "sent"
  invoiceData.invoice_number = finalInvoiceNumber
}
```

**Actual Behavior:**
- `finalInvoiceNumber` remains `null`
- Invoice created with `status: "sent"` but `invoice_number: null`

---

### Estimate → Invoice Conversion (Direct)

**File:** `app/api/estimates/[id]/convert/route.ts`  
**Status:** ❌ **BROKEN - BYPASSES CANONICAL NUMBERING + ASSIGNS TO DRAFT**

**Flow:**
1. Manually generates invoice number (lines 95-108) - **BYPASSES canonical function**
2. Creates invoice with `status: "draft"` BUT `invoice_number: invoiceNumber` (line 118)
3. Violates rule: "Draft invoices have NO invoice number"

**Problem:** 
- Uses manual numbering logic instead of `generate_invoice_number_with_settings()`
- Assigns invoice number to draft invoice
- Hardcodes "INV-" prefix and 4-digit padding

---

### Invoice Send (Finalization)

**File:** `app/api/invoices/[id]/send/route.ts`  
**Status:** ✅ **CORRECT**

**Flow:**
1. Fetches invoice
2. Handles send actions (WhatsApp, Email, Copy Link)
3. **If invoice has no invoice_number**: Generates via `generate_invoice_number_with_settings()` (lines 247-256, 336-345)
4. Updates invoice:
   - `status: "sent"`
   - `invoice_number: [generated]` (if not already assigned)
   - `sent_at: [timestamp]`

**Key Findings:**
- ✅ "Send Invoice" finalizes the invoice (assigns number, sets status to "sent")
- ✅ Uses canonical numbering function
- ✅ Only assigns number when sending (correct)

**Answer:** ✅ **"Send Invoice" IS finalization** - It assigns invoice number and sets status to "sent"

---

## 4️⃣ INVOICE NUMBERING AUDIT (CRITICAL)

### Canonical Numbering Function

**File:** `supabase/migrations/037_business_profile_invoice_settings.sql`  
**Function:** `generate_invoice_number_with_settings(business_uuid UUID)`

**Logic:**
1. Gets or creates invoice_settings for business
2. If `number_initialized = false`: Uses `starting_number`, marks as initialized
3. If initialized: Finds MAX invoice number, increments by 1
4. Returns: `prefix || LPAD(number, 6, '0')`

**Features:**
- ✅ Per-business sequence
- ✅ Respects `invoice_prefix` from settings
- ✅ Respects `starting_number` from settings
- ✅ Uses 6-digit padding (configurable via prefix)
- ✅ Only considers invoices with matching prefix pattern

**Status:** ✅ **CORRECT** - Single source of truth for invoice numbering

---

### Where Invoice Numbers Are Generated

| Path | File | Function Used | Status |
|------|------|---------------|--------|
| **Direct Invoice Create (status="sent")** | `app/api/invoices/create/route.ts:77` | `generate_invoice_number_with_settings()` | ✅ Correct |
| **Invoice Send** | `app/api/invoices/[id]/send/route.ts:248,337` | `generate_invoice_number_with_settings()` | ✅ Correct |
| **Invoice Update (draft→sent)** | `app/api/invoices/[id]/route.ts:445` | `generate_invoice_number_with_settings()` | ✅ Correct |
| **Order → Invoice (status="sent")** | `app/api/orders/[id]/convert-to-invoice/route.ts:233` | ❌ **NONE** | ❌ **BROKEN** |
| **Estimate → Invoice** | `app/api/estimates/[id]/convert/route.ts:95-108` | ❌ **Manual logic** | ❌ **BROKEN** |
| **Recurring Invoice Generate** | `app/api/recurring-invoices/generate/route.ts:78` | `generate_invoice_number_with_settings()` | ✅ Correct |

---

### Is There ONE Source of Truth?

**Answer:** ⚠️ **NO - Multiple Numbering Sources**

**Canonical Source:**
- ✅ `generate_invoice_number_with_settings()` - Used by 4 paths

**Bypass Sources:**
- ❌ `app/api/estimates/[id]/convert/route.ts` - Manual numbering (lines 95-108)
- ❌ `app/api/orders/[id]/convert-to-invoice/route.ts` - No numbering when status="sent"

**Impact:**
- Estimate→Invoice can create duplicate numbers
- Order→Invoice creates sent invoices without numbers
- Numbering sequence can be broken

---

### Can Order → Invoice Bypass Main Counter?

**Answer:** ⚠️ **PARTIALLY**

**Current Behavior:**
- Order→Invoice with `status="draft"`: No invoice number (correct)
- Order→Invoice with `status="sent"`: No invoice number (❌ **BROKEN**)

**If Fixed:**
- Would use `generate_invoice_number_with_settings()` (same as direct create)
- Would NOT bypass counter

**Status:** ⚠️ **Currently broken, but fixable** - Just needs to call canonical function when status="sent"

---

### Is There Code That Initializes Invoice Numbers?

**Answer:** ✅ **YES - But Controlled**

**File:** `supabase/migrations/037_business_profile_invoice_settings.sql` lines 92-100

**Logic:**
```sql
IF NOT settings_record.number_initialized THEN
  UPDATE invoice_settings
  SET number_initialized = true
  WHERE business_id = business_uuid;
  
  new_number := prefix || LPAD(settings_record.starting_number::TEXT, 6, '0');
  RETURN new_number;
END IF;
```

**Status:** ✅ **CORRECT** - Uses `invoice_settings.starting_number` on first use, then continues sequentially

**Risk:** ⚠️ **Estimate→Invoice bypass** could reset numbering if it uses "INV-0001" fallback

---

### Is Numbering Transaction-Safe?

**Answer:** ⚠️ **PARTIALLY**

**Canonical Function:**
- Uses `MAX()` query - **NOT transaction-safe**
- Race condition: Two concurrent calls could get same number
- No locking mechanism

**Manual Estimate→Invoice Logic:**
- Uses `MAX()` query - **NOT transaction-safe**
- Same race condition risk

**Impact:**
- Low probability (requires concurrent conversions)
- But possible duplicate invoice numbers

**Recommendation:** Add database-level unique constraint on `(business_id, invoice_number)` if not exists

---

## 5️⃣ DASHBOARD & REPORT VISIBILITY

### Draft Exclusion Logic

**Dashboard:** `app/dashboard/page.tsx`  
**Logic:** Filters by `status !== "draft"` (implicit - only loads sent/partially_paid/overdue/paid)

**Customer Statement:** `app/api/customers/[id]/statement/route.ts`  
**Logic:** Explicitly filters `status !== "draft"` (line 104)

**Invoice List:** `app/api/invoices/list/route.ts`  
**Logic:** Explicitly filters `status !== "draft"` (line 158)

**Outstanding Page:** `app/outstanding/page.tsx`  
**Logic:** Explicitly filters `status !== "draft"` (line 127)

**Status:** ✅ **CONSISTENT** - All views exclude drafts correctly

---

### Sent Invoice Visibility

**Why a Sent Invoice Might Not Appear on Dashboard:**

1. **❌ Missing Invoice Number**
   - If invoice has `status: "sent"` but `invoice_number IS NULL`
   - Dashboard may filter by `invoice_number IS NOT NULL` (needs verification)
   - **Root Cause:** Order→Invoice conversion with status="sent" doesn't generate number

2. **✅ Draft Status**
   - If invoice is still `status: "draft"` (not sent)
   - Correctly excluded

3. **✅ Deleted Invoice**
   - If `deleted_at IS NOT NULL`
   - Correctly excluded

**Evidence:** Dashboard query (line 309-314) loads all invoices, then filters by status in memory (line 424)

**Status:** ⚠️ **POTENTIAL ISSUE** - Sent invoices without invoice_number may be excluded if dashboard filters by `invoice_number IS NOT NULL`

---

### Are Draft Invoices Correctly Excluded?

**Answer:** ✅ **YES**

**Evidence:**
- Dashboard: Only loads invoices with valid outstanding statuses (sent/partially_paid/overdue)
- Customer Statement: Explicitly filters `status !== "draft"` (line 104)
- Invoice List: Explicitly filters `status !== "draft"` (line 158)
- Outstanding Page: Explicitly filters `status !== "draft"` (line 127)

**Status:** ✅ **CONSISTENT** - Drafts correctly excluded everywhere

---

### Are Sent Invoices Sometimes Marked Draft?

**Answer:** ⚠️ **POTENTIALLY**

**Scenarios:**
1. **Order→Invoice with status="sent" but no invoice number**
   - Invoice has `status: "sent"` but `invoice_number: null`
   - May be treated as draft by some queries

2. **Invoice Send Fails**
   - If `generate_invoice_number_with_settings()` fails
   - Invoice remains `status: "draft"` (correct fallback)
   - But user expects it to be sent

**Status:** ⚠️ **Edge case exists** - Order→Invoice can create sent invoice without number

---

## 6️⃣ STATUS TRANSITION MATRIX

| Entity   | From  | To      | Trigger | Valid? | Evidence |
|---------|-------|---------|---------|--------|----------|
| **Estimate** | draft | sent    | Send action | ✅ Yes | `app/api/estimates/[id]/send/route.ts:140-143` |
| **Estimate** | draft | accepted | Convert to Order | ✅ Yes | `app/api/orders/convert-from-estimate/route.ts:177` |
| **Estimate** | draft | accepted | Convert to Invoice | ✅ Yes | `app/api/estimates/[id]/convert/route.ts:202` |
| **Estimate** | sent | sent    | Resend | ✅ Yes | `app/api/estimates/[id]/send/route.ts:67-68` |
| **Estimate** | sent | accepted | Convert to Order | ✅ Yes | Allowed (no status check) |
| **Estimate** | sent | accepted | Convert to Invoice | ✅ Yes | Allowed (no status check) |
| **Order** | draft | issued | Issue action | ✅ Yes | Migration 208 defines this |
| **Order** | issued | converted | Convert to Invoice | ✅ Yes | `app/api/orders/[id]/convert-to-invoice/route.ts:97` |
| **Order** | draft | converted | ❌ Invalid | ❌ No | Blocked by status check (line 97) |
| **Invoice** | draft | sent    | Send action | ✅ Yes | `app/api/invoices/[id]/send/route.ts:241-256` |
| **Invoice** | sent  | paid    | Payment | ✅ Yes | Trigger `recalculate_invoice_status()` |
| **Invoice** | sent  | partially_paid | Partial Payment | ✅ Yes | Trigger `recalculate_invoice_status()` |
| **Invoice** | sent  | overdue | Time-based | ✅ Yes | Trigger `recalculate_invoice_status()` |
| **Invoice** | sent  | draft   | Unsent action | ⚠️ Conditional | `app/api/invoices/[id]/unsent/route.ts` - Only if no payments |

**Invalid/Missing Transitions:**
- ❌ **Order draft → converted** - Blocked (correct - must be issued first)
- ⚠️ **Invoice sent → draft** - Allowed only if no payments (correct per recent fix)

**Status:** ✅ **MOSTLY CORRECT** - Status transitions are properly guarded

---

## 7️⃣ BROKEN OR DANGEROUS BEHAVIOR

### B1. Estimate→Invoice Bypasses Canonical Numbering
**File:** `app/api/estimates/[id]/convert/route.ts` lines 95-108  
**Issue:** Manual invoice number generation instead of `generate_invoice_number_with_settings()`  
**Root Cause:** Code predates canonical function or intentionally bypassed  
**Impact:**
- Ignores `invoice_settings.invoice_prefix`
- Ignores `invoice_settings.starting_number`
- Hardcodes "INV-" prefix
- Hardcodes 4-digit padding (should be 6)
- Not transaction-safe
- Can create duplicate numbers

---

### B2. Estimate→Invoice Assigns Number to Draft
**File:** `app/api/estimates/[id]/convert/route.ts` line 118  
**Issue:** Creates invoice with `status: "draft"` but `invoice_number: invoiceNumber`  
**Root Cause:** Number generated before status check  
**Impact:**
- Violates rule: "Draft invoices have NO invoice number"
- Draft invoices appear in numbering sequence
- Can cause numbering gaps if draft is deleted

---

### B3. Order→Invoice Doesn't Generate Number When Status="Sent"
**File:** `app/api/orders/[id]/convert-to-invoice/route.ts` lines 231-233, 478-487  
**Issue:** When converting with `body.status = "sent"`, invoice number is never generated  
**Root Cause:** Missing logic to call `generate_invoice_number_with_settings()` when `invoiceStatus === "sent"`  
**Impact:**
- Sent invoices created without invoice numbers
- Violates rule: "Sent invoices MUST have invoice number"
- May be excluded from dashboard/reports
- Breaks invoice numbering sequence

---

### B4. Invoice Numbering Not Transaction-Safe
**Files:** 
- `supabase/migrations/037_business_profile_invoice_settings.sql` (canonical function)
- `app/api/estimates/[id]/convert/route.ts` (manual logic)

**Issue:** Uses `MAX()` query without locking  
**Root Cause:** No database-level locking or atomic increment  
**Impact:**
- Race condition: Concurrent conversions could get same number
- Duplicate invoice numbers possible (low probability but possible)

---

### B5. Estimate→Invoice Numbering Reset Risk
**File:** `app/api/estimates/[id]/convert/route.ts` line 104  
**Issue:** Fallback to "INV-0001" if no invoices exist  
**Root Cause:** Ignores `invoice_settings.starting_number`  
**Impact:**
- If business has custom starting_number (e.g., 1000), estimate conversion resets to 0001
- Breaks numbering sequence

---

### B6. Order→Invoice Allows Status Override Without Numbering
**File:** `app/api/orders/[id]/convert-to-invoice/route.ts` line 478  
**Issue:** Allows `body.status = "sent"` but doesn't generate invoice number  
**Root Cause:** Missing conditional logic  
**Impact:**
- Creates sent invoices without numbers
- User expects invoice to be finalized, but it's missing number

---

## 8️⃣ VERDICT & REQUIRED FIXES

### Is the Lifecycle Structurally Sound?

**Answer:** ⚠️ **PARTIALLY - Core flow works, but numbering is broken**

**What Works:**
- ✅ Estimate creation and sending
- ✅ Estimate → Order conversion
- ✅ Order creation and status management
- ✅ Order → Invoice conversion (creates draft correctly)
- ✅ Invoice send finalization
- ✅ Direct invoice creation

**What's Broken:**
- ❌ Estimate → Invoice bypasses canonical numbering
- ❌ Estimate → Invoice assigns number to draft
- ❌ Order → Invoice doesn't generate number when status="sent"
- ❌ Invoice numbering not transaction-safe

---

### Is Invoice Numbering Safe?

**Answer:** ❌ **NO - Multiple Issues**

**Problems:**
1. **Multiple numbering sources** - Estimate→Invoice uses manual logic
2. **Draft invoices get numbers** - Estimate→Invoice violates rule
3. **Sent invoices without numbers** - Order→Invoice with status="sent"
4. **Not transaction-safe** - Race conditions possible
5. **Numbering reset risk** - Estimate→Invoice ignores starting_number

**Impact:** Invoice numbering sequence can be broken, duplicates possible, drafts get numbers

---

### Must Conversion Logic Be Centralized?

**Answer:** ✅ **YES - Critical**

**Current State:**
- 3 different conversion paths (Estimate→Invoice, Order→Invoice, Direct Create)
- 2 different numbering approaches (canonical function vs manual)
- Inconsistent behavior

**Required:**
- All conversions must use `generate_invoice_number_with_settings()`
- All conversions must create draft invoices (no number)
- Invoice number only assigned when status changes to "sent"
- Single source of truth for numbering

---

### Minimum Required Fixes

#### Fix 1: Estimate→Invoice Use Canonical Numbering
**File:** `app/api/estimates/[id]/convert/route.ts`  
**Change:**
- Remove manual numbering logic (lines 95-108)
- Set `invoice_number: null` for draft invoices (line 118)
- Do NOT assign invoice number (let send endpoint handle it)

**Acceptance:**
- Estimate→Invoice creates draft with `invoice_number: null`
- Invoice number assigned only when invoice is sent

---

#### Fix 2: Order→Invoice Generate Number When Status="Sent"
**File:** `app/api/orders/[id]/convert-to-invoice/route.ts`  
**Change:**
- Add logic after line 478 to generate invoice number when `invoiceStatus === "sent"`
- Call `generate_invoice_number_with_settings()` before creating invoice
- Set `finalInvoiceNumber` before line 447

**Acceptance:**
- Order→Invoice with status="sent" creates invoice with invoice_number
- Order→Invoice with status="draft" creates invoice with invoice_number=null

---

#### Fix 3: Add Transaction Safety (Optional but Recommended)
**File:** `supabase/migrations/037_business_profile_invoice_settings.sql`  
**Change:**
- Add `SELECT FOR UPDATE` lock on invoice_settings
- Or use database sequence
- Or add unique constraint on `(business_id, invoice_number)`

**Acceptance:**
- Concurrent conversions cannot create duplicate numbers

---

## SUMMARY TABLE

| Issue | Severity | File | Line | Impact |
|-------|----------|------|------|--------|
| Estimate→Invoice bypasses numbering | 🔴 Critical | `app/api/estimates/[id]/convert/route.ts` | 95-108 | Numbering sequence broken |
| Estimate→Invoice assigns number to draft | 🔴 Critical | `app/api/estimates/[id]/convert/route.ts` | 118 | Violates business rule |
| Order→Invoice no number when sent | 🔴 Critical | `app/api/orders/[id]/convert-to-invoice/route.ts` | 233, 478-487 | Sent invoices without numbers |
| Numbering not transaction-safe | 🟡 High | `supabase/migrations/037_business_profile_invoice_settings.sql` | 104 | Duplicate numbers possible |
| Estimate→Invoice ignores starting_number | 🟡 High | `app/api/estimates/[id]/convert/route.ts` | 104 | Numbering reset risk |

---

## FINAL ANSWER

**Is the lifecycle structurally sound?** ⚠️ **PARTIALLY** - Core flow works, numbering is broken

**Is invoice numbering safe?** ❌ **NO** - Multiple bypasses, draft invoices get numbers, sent invoices can be missing numbers

**Must conversion logic be centralized?** ✅ **YES** - All conversions must use canonical numbering function

**Production Readiness:** ❌ **NOT READY** - Critical numbering issues must be fixed before production

---

**END OF AUDIT**
