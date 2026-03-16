# INVOICE NUMBERING FIXES - CHANGE REPORT

**Date:** 2026-01-25  
**Status:** ✅ Complete  
**Goal:** Ensure all invoices use canonical numbering, drafts have null invoice_number, sent invoices get numbers immediately

---

## FILES CHANGED

### 1. Estimate → Invoice Conversion (FIXED)
**File:** `app/api/estimates/[id]/convert/route.ts`

**Changes:**
- **Removed** manual invoice number generation logic (lines 95-108):
  - Deleted query to fetch last invoice
  - Deleted manual increment logic with hardcoded "INV-0001" fallback
  - Deleted hardcoded prefix and 4-digit padding
- **Changed** invoice creation (line 118):
  - Before: `invoice_number: invoiceNumber` (assigned number to draft)
  - After: `invoice_number: null` (draft invoices must have null)
- **Added** comment explaining system-controlled numbering

**Impact:**
- ✅ Estimate→Invoice now creates draft invoices with `invoice_number: null`
- ✅ Invoice number assigned only when invoice is sent via `/api/invoices/[id]/send`
- ✅ No longer bypasses canonical numbering function
- ✅ No longer resets numbering to "INV-0001"

---

### 2. Order → Invoice Conversion When Status="Sent" (FIXED)
**File:** `app/api/orders/[id]/convert-to-invoice/route.ts`

**Changes:**
- **Added** early invoice status determination (line 236):
  ```typescript
  const invoiceStatus = body.status || "draft"
  ```
- **Added** invoice number generation when status="sent" (lines 238-254):
  ```typescript
  if (invoiceStatus === "sent") {
    const { data: invoiceNumData } = await supabase.rpc("generate_invoice_number_with_settings", {
      business_uuid: orderToConvert.business_id,
    })
    finalInvoiceNumber = invoiceNumData || null
    if (!finalInvoiceNumber) {
      return NextResponse.json({ error: "Failed to generate invoice number..." }, { status: 500 })
    }
  }
  ```
- **Updated** status assignment logic (lines 497-509):
  - If status="sent": Sets `invoice_number = finalInvoiceNumber` (generated above)
  - If status="draft": Sets `invoice_number = null` (explicit)

**Impact:**
- ✅ Order→Invoice with `status="sent"` now generates invoice number immediately
- ✅ Order→Invoice with `status="draft"` (default) creates invoice with `invoice_number: null`
- ✅ Uses canonical `generate_invoice_number_with_settings()` function
- ✅ Continues existing numbering sequence (never resets)

---

### 3. Unique Constraint Verification (VERIFIED)
**Status:** ✅ Already exists

**Evidence:**
- Migration `036_complete_invoice_system_setup.sql` line 113-115:
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_business_invoice_number 
    ON invoices(business_id, invoice_number) 
    WHERE deleted_at IS NULL;
  ```

**Impact:**
- ✅ Duplicate invoice numbers cannot exist for same business
- ✅ Constraint applies only to non-deleted invoices (correct)
- ✅ No migration needed

---

## TESTING STEPS

### Test 1: Estimate → Invoice → Send (Numbering Sequence)
1. **Prerequisites:**
   - Create a business with existing invoices (e.g., INV-0005, INV-0006)
   - Verify `invoice_settings.starting_number` is set (if custom)

2. **Steps:**
   - Create an estimate
   - Convert estimate to invoice via `POST /api/estimates/[id]/convert`
   - **Verify:** Invoice created with `status: "draft"` and `invoice_number: null`
   - Send invoice via `POST /api/invoices/[id]/send`
   - **Verify:** Invoice now has `status: "sent"` and `invoice_number: "INV-0007"` (continues sequence)

3. **Expected Result:**
   - ✅ Draft invoice has no number
   - ✅ Sent invoice gets next number in sequence (not "INV-0001")
   - ✅ Numbering continues from existing invoices

---

### Test 2: Order → Invoice as Sent (Immediate Numbering)
1. **Prerequisites:**
   - Create a business with existing invoices (e.g., INV-0005, INV-0006)
   - Create an order with status="issued"

2. **Steps:**
   - Convert order to invoice with `body.status = "sent"` via `POST /api/orders/[id]/convert-to-invoice`
   - **Verify:** Invoice created with:
     - `status: "sent"`
     - `invoice_number: "INV-0007"` (continues sequence)
     - `sent_at: [timestamp]`

3. **Expected Result:**
   - ✅ Sent invoice gets number immediately (not null)
   - ✅ Number continues sequence (not "INV-0001")
   - ✅ Invoice appears in dashboard/reports

---

### Test 3: Order → Invoice as Draft (No Number)
1. **Prerequisites:**
   - Create an order with status="issued"

2. **Steps:**
   - Convert order to invoice (default, no status override) via `POST /api/orders/[id]/convert-to-invoice`
   - **Verify:** Invoice created with:
     - `status: "draft"`
     - `invoice_number: null`

3. **Expected Result:**
   - ✅ Draft invoice has no number
   - ✅ Invoice excluded from dashboard/reports
   - ✅ Number assigned when invoice is sent

---

### Test 4: No Numbering Reset
1. **Prerequisites:**
   - Create a business with existing invoices (e.g., INV-0100)
   - Set `invoice_settings.starting_number = 1000` (if custom)

2. **Steps:**
   - Create estimate → convert to invoice → send
   - Create order → convert to invoice as sent
   - **Verify:** Both get numbers continuing from INV-0100 (e.g., INV-0101, INV-0102)

3. **Expected Result:**
   - ✅ No invoice starts at "INV-0001" or "INV-1001" unless `starting_number` is set to that value
   - ✅ All conversions use canonical numbering function
   - ✅ Numbering sequence is never reset

---

### Test 5: Duplicate Prevention
1. **Prerequisites:**
   - Create a business with existing invoice INV-0005

2. **Steps:**
   - Attempt to create invoice with `invoice_number: "INV-0005"` manually (if possible)
   - **Verify:** Database constraint prevents duplicate

3. **Expected Result:**
   - ✅ Unique constraint blocks duplicate invoice numbers
   - ✅ Error returned: "duplicate key value violates unique constraint"

---

## ACCEPTANCE CRITERIA STATUS

✅ **1. All invoices follow ONE numbering source: `generate_invoice_number_with_settings(business_uuid)`**
- Estimate→Invoice: Removed manual numbering, now uses canonical function via send endpoint
- Order→Invoice: Uses canonical function when status="sent"
- Direct invoice create: Already uses canonical function
- Invoice send: Already uses canonical function

✅ **2. Draft invoices must have `invoice_number = null` always**
- Estimate→Invoice: Sets `invoice_number: null` for drafts
- Order→Invoice: Sets `invoice_number: null` for drafts
- Direct invoice create: Already sets `invoice_number: null` for drafts

✅ **3. Any invoice created as "sent" must receive a valid invoice_number immediately**
- Order→Invoice with status="sent": Generates number immediately
- Direct invoice create with status="sent": Already generates number immediately

✅ **4. Order→Invoice must continue existing numbering; never reset to 1001 / INV-0001**
- Order→Invoice: Uses `generate_invoice_number_with_settings()` which respects existing sequence
- Estimate→Invoice: No longer uses hardcoded "INV-0001" fallback

---

## KNOWN LIMITATIONS

1. **Transaction Safety:** The `generate_invoice_number_with_settings()` function uses `MAX()` query without locking. Race conditions are possible but low probability. The unique constraint prevents duplicates at database level.

2. **Estimate→Invoice:** This endpoint does not support creating sent invoices directly. Users must convert to draft, then send via `/api/invoices/[id]/send`. This is by design to ensure proper finalization flow.

---

## SUMMARY

**Critical Fixes Complete:**
- ✅ Estimate→Invoice no longer bypasses canonical numbering
- ✅ Estimate→Invoice no longer assigns number to drafts
- ✅ Order→Invoice generates number when status="sent"
- ✅ All conversions use canonical numbering function
- ✅ Draft invoices always have `invoice_number: null`
- ✅ Sent invoices always have valid invoice numbers

**Production Readiness:**
- ✅ Core numbering issues fixed
- ✅ Numbering sequence integrity maintained
- ✅ Business rules enforced (draft=null, sent=number)

---

**END OF REPORT**
