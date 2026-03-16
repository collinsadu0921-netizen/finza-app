# Tax Recalculation Analysis - Affected Workspaces

**Search Date:** 2025-01-XX  
**Scope:** Invoice and receipt views that recalculate tax instead of reading from `tax_lines` JSONB

---

## ❌ **AFFECTED: Invoice View Page**

### **Workspace:** `app/invoices/[id]/view/page.tsx`

**Status:** ❌ **RECALCULATES TAX** (Regression Risk)

**Location:** Lines 595-663

**Code Pattern:**
```typescript
// Calculate tax breakdown using shared tax engine
const taxCalculationResult = calculateTaxesFromAmount(
  Number(invoice.total),
  businessCountry,
  effectiveDate,
  true // tax-inclusive pricing
)

const legacyTaxAmounts = getLegacyTaxAmounts(taxCalculationResult)
```

**Issue:**
- Uses `calculateTaxesFromAmount()` to recalculate tax on read
- Ignores stored `tax_lines` JSONB column
- Ignores stored `tax_engine_code` and `tax_engine_effective_from`
- Will show incorrect tax breakdowns for old invoices if tax rules change

**Fix Required:**
- Use stored `tax_lines` JSONB (same pattern as PDF preview)
- Import `jsonbToTaxResult` from `@/lib/taxEngine/helpers`
- Fallback to legacy columns if `tax_lines` is null
- Only recalculate as last resort (very old invoices)

---

## ✅ **CORRECT: Public Invoice Page**

### **Workspace:** `app/invoice-public/[token]/page.tsx`

**Status:** ✅ **CORRECT** (Uses Stored Values)

**Location:** Lines 253-277

**Code Pattern:**
```typescript
{invoice.apply_taxes && settings?.show_tax_breakdown && (
  <>
    <div className="flex justify-between text-sm">
      <span className="text-gray-600">NHIL (2.5%):</span>
      <span className="text-gray-700">{invoice.currency_symbol}{Number(invoice.nhil || 0).toFixed(2)}</span>
    </div>
    // ... displays stored legacy columns (nhil, getfund, covid, vat)
  </>
)}
```

**Confirmation:**
- ✅ Reads from stored legacy columns (`invoice.nhil`, `invoice.getfund`, `invoice.covid`, `invoice.vat`)
- ✅ Does NOT recalculate tax
- ✅ Displays stored values directly

**Note:** Uses legacy columns instead of `tax_lines` JSONB, but this is acceptable as a fallback for public-facing pages. Future enhancement could use `tax_lines` if needed.

---

## ✅ **CORRECT: PDF Preview**

### **Workspace:** `app/api/invoices/[id]/pdf-preview/route.ts`

**Status:** ✅ **CORRECT** (Uses Stored `tax_lines`)

**Location:** Lines 98-100

**Code Pattern:**
```typescript
// Parse tax_lines from stored JSONB if available (preferred source of truth)
const storedTaxResult = invoice.tax_lines ? jsonbToTaxResult(invoice.tax_lines) : null
const taxLines = storedTaxResult?.taxLines || []
```

**Confirmation:**
- ✅ Uses stored `tax_lines` JSONB
- ✅ Does NOT recalculate tax
- ✅ Uses `jsonbToTaxResult()` helper to parse stored values

---

## ✅ **EXPECTED: Invoice Edit Page**

### **Workspace:** `app/invoices/[id]/edit/page.tsx`

**Status:** ✅ **EXPECTED** (Form Calculation, Not View)

**Location:** Line 414

**Code Pattern:**
```typescript
const taxCalculationResult = calculateTaxes(
  lineItems,
  businessCountry,
  effectiveDate,
  true // tax-inclusive pricing
)
```

**Confirmation:**
- ✅ Uses `calculateTaxes()` for **form calculation** (editing invoice)
- ✅ This is **expected behavior** - user is editing, so tax must be recalculated
- ✅ Not a view page - it's an edit form

---

## ✅ **EXPECTED: Invoice New Page**

### **Workspace:** `app/invoices/new/page.tsx`

**Status:** ✅ **EXPECTED** (Form Calculation, Not View)

**Location:** Line 338

**Code Pattern:**
```typescript
const taxCalculationResult = calculateTaxes(
  lineItems,
  businessCountry,
  effectiveDate,
  true // tax-inclusive pricing
)
```

**Confirmation:**
- ✅ Uses `calculateTaxes()` for **form calculation** (creating invoice)
- ✅ This is **expected behavior** - user is creating, so tax must be calculated
- ✅ Not a view page - it's a create form

---

## ✅ **CORRECT: Receipt Pages**

### **Workspaces:**
- `app/sales/[id]/receipt/page.tsx`
- `app/sales-history/[id]/receipt/page.tsx`

**Status:** ✅ **CORRECT** (Display Stored Values)

**Code Pattern:**
```typescript
// Uses stored sale.nhil, sale.getfund, sale.covid, sale.vat directly
const totalTax = (sale.nhil || 0) + (sale.getfund || 0) + (sale.covid || 0) + (sale.vat || 0)
```

**Confirmation:**
- ✅ Reads from stored sale columns directly
- ✅ Does NOT recalculate tax
- ✅ Receipts are not affected by tax versioning issues

**Note:** Receipts use legacy columns, but this is acceptable since receipts are tied to sales (which have their own tax storage). Future enhancement could use `tax_lines` if sales table has this column.

---

## ✅ **CORRECT: Invoice Preview Modal**

### **Workspace:** `components/invoices/InvoicePreviewModal.tsx`

**Status:** ✅ **CORRECT** (Uses PDF Preview API)

**Code Pattern:**
```typescript
// Uses /api/invoices/${invoiceId}/pdf-preview endpoint
const previewUrl = `/api/invoices/${invoiceId}/pdf-preview`
```

**Confirmation:**
- ✅ Uses PDF preview API endpoint
- ✅ PDF preview API correctly uses stored `tax_lines` (see above)
- ✅ No direct tax recalculation in modal component

---

## 📋 **Summary**

| Workspace | Status | Type | Issue |
|-----------|--------|------|-------|
| `app/invoices/[id]/view/page.tsx` | ❌ **AFFECTED** | View Page | **RECALCULATES tax instead of using stored `tax_lines`** |
| `app/invoice-public/[token]/page.tsx` | ✅ Correct | View Page | Uses stored legacy columns |
| `app/api/invoices/[id]/pdf-preview/route.ts` | ✅ Correct | API Endpoint | Uses stored `tax_lines` JSONB |
| `app/invoices/[id]/edit/page.tsx` | ✅ Expected | Edit Form | Recalculates for form (expected) |
| `app/invoices/new/page.tsx` | ✅ Expected | Create Form | Calculates for form (expected) |
| `app/sales/[id]/receipt/page.tsx` | ✅ Correct | Receipt View | Uses stored sale columns |
| `app/sales-history/[id]/receipt/page.tsx` | ✅ Correct | Receipt View | Uses stored sale columns |
| `components/invoices/InvoicePreviewModal.tsx` | ✅ Correct | Preview Modal | Uses PDF preview API |

---

## 🎯 **Conclusion**

**Only ONE workspace is affected:**
- ❌ **`app/invoices/[id]/view/page.tsx`** - The main invoice view page recalculates tax instead of using stored `tax_lines` JSONB

**All other workspaces are correct:**
- ✅ Public invoice page uses stored values
- ✅ PDF preview uses stored `tax_lines`
- ✅ Edit/Create forms correctly recalculate (expected behavior)
- ✅ Receipt pages use stored values
- ✅ Preview modal uses PDF preview API (which is correct)

---

## 🔧 **Recommended Fix**

**File:** `app/invoices/[id]/view/page.tsx`

**Change:** Replace tax recalculation (Lines 606-611) with reading from stored `tax_lines` JSONB, following the pattern used in `app/api/invoices/[id]/pdf-preview/route.ts` (Lines 98-100).

