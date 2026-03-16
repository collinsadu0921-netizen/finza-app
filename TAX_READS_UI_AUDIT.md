# UI Tax Reads Audit Report

**Date:** 2025-01-XX  
**Scope:** Audit of UI code to confirm tax reading patterns follow canonical `tax_lines` approach

## Audit Criteria

1. ✅ UI imports `lib/taxes/readTaxLines.ts`
2. ❌ No UI reads `invoice.vat`, `nhil`, `getfund`, `covid` directly
3. ⚠️ Fallbacks only exist for records without `tax_lines`

## Summary

- **Total Files Checked:** 12 UI files
- **Files Using readTaxLines:** 3 ✅
- **Files with Acceptable Fallbacks:** 3 ✅
- **Files with Direct Reads (VIOLATIONS):** 1 ❌

---

## ✅ Files Correctly Using readTaxLines

### 1. `app/invoices/[id]/view/page.tsx`
- **Import:** ✅ Line 13: `import { getGhanaLegacyView, sumTaxLines } from "@/lib/taxes/readTaxLines"`
- **Usage:** Lines 708-715
  ```typescript
  const legacyTaxAmounts = invoice.tax_lines
    ? getGhanaLegacyView(invoice.tax_lines)
    : {
        nhil: invoice.nhil || 0,
        getfund: invoice.getfund || 0,
        covid: invoice.covid || 0,
        vat: invoice.vat || 0,
      }
  ```
- **Status:** ✅ **ACCEPTABLE** - Uses canonical helper first, fallback only when `tax_lines` is null/undefined

### 2. `app/invoices/page.tsx`
- **Import:** ✅ Line 16: `import { getGhanaLegacyView, sumTaxLines } from "@/lib/taxes/readTaxLines"`
- **Usage:** Lines 257-258 (CSV export), 341-342 (Excel export)
  ```typescript
  const { vat } = getGhanaLegacyView(invoice.tax_lines)
  const vatAmount = vat > 0 ? vat : (invoice.vat || 0)
  ```
- **Status:** ⚠️ **MINOR ISSUE** - Uses canonical helper but has redundant fallback. Should check `tax_lines` existence first:
  ```typescript
  // Current (minor issue):
  const { vat } = getGhanaLegacyView(invoice.tax_lines)
  const vatAmount = vat > 0 ? vat : (invoice.vat || 0)
  
  // Should be:
  const { vat } = invoice.tax_lines 
    ? getGhanaLegacyView(invoice.tax_lines)
    : { vat: invoice.vat || 0, nhil: 0, getfund: 0, covid: 0 }
  ```

### 3. `app/invoice-public/[token]/page.tsx`
- **Import:** ✅ Line 5: `import { getGhanaLegacyView, sumTaxLines } from "@/lib/taxes/readTaxLines"`
- **Usage:** Lines 256-263
  ```typescript
  const legacyTaxAmounts = invoice.tax_lines
    ? getGhanaLegacyView(invoice.tax_lines)
    : {
        nhil: invoice.nhil || 0,
        getfund: invoice.getfund || 0,
        covid: invoice.covid || 0,
        vat: invoice.vat || 0,
      }
  ```
- **Status:** ✅ **ACCEPTABLE** - Uses canonical helper first, fallback only when `tax_lines` is null/undefined

---

## ❌ Files with Direct Reads (VIOLATIONS)

### 1. `app/vat-returns/[id]/page.tsx`
- **Import:** ❌ **MISSING** - Does not import `readTaxLines.ts`
- **Direct Reads:** 
  - Lines 199-202: Direct reads of `inv.nhil`, `inv.getfund`, `inv.covid`, `inv.vat`
  - Lines 215-218: Direct reads of `cn.nhil`, `cn.getfund`, `cn.covid`, `cn.vat` (credit notes)
  - Lines 231-235: Direct reads of `exp.nhil`, `exp.getfund`, `exp.covid`, `exp.vat` (expenses)
  - Lines 247-250: Direct reads of `bill.nhil`, `bill.getfund`, `bill.covid`, `bill.vat` (bills)
  
- **Violation Details:**
  ```typescript
  // Lines 192-204: Invoice processing
  sourceData.invoices?.forEach((inv: any) => {
    rows.push({
      // ... other fields ...
      nhil: Number(inv.nhil || 0),        // ❌ Direct read
      getfund: Number(inv.getfund || 0),  // ❌ Direct read
      covid: Number(inv.covid || 0),      // ❌ Direct read
      vat: Number(inv.vat || 0),          // ❌ Direct read
    })
  })
  ```
  
- **Status:** ❌ **VIOLATION** - Reads legacy tax fields directly without checking for `tax_lines` first

- **Required Fix:**
  ```typescript
  import { getGhanaLegacyView } from "@/lib/taxes/readTaxLines"
  
  // For invoices:
  const legacyTaxAmounts = inv.tax_lines
    ? getGhanaLegacyView(inv.tax_lines)
    : {
        nhil: inv.nhil || 0,
        getfund: inv.getfund || 0,
        covid: inv.covid || 0,
        vat: inv.vat || 0,
      }
  
  rows.push({
    // ... other fields ...
    nhil: legacyTaxAmounts.nhil,
    getfund: legacyTaxAmounts.getfund,
    covid: legacyTaxAmounts.covid,
    vat: legacyTaxAmounts.vat,
  })
  ```

---

## ✅ Files Not Reading Tax Data (No Action Needed)

These files don't read tax fields at all, so no changes needed:
- `app/invoices/new/page.tsx` - Only calculates taxes, doesn't read stored values
- `app/invoices/[id]/edit/page.tsx` - Only calculates taxes, doesn't read stored values
- `components/invoices/InvoicePreviewModal.tsx` - Wrapper component, doesn't read tax data
- `components/invoices/SendInvoiceModal.tsx` - Doesn't read tax data
- `app/invoices/page.tsx` (list view) - Only displays totals, doesn't break down taxes

---

## Notes on Type Definitions

Several files have TypeScript types that include legacy tax fields:
- `app/invoices/[id]/view/page.tsx` lines 28-31, 41: Invoice type includes `nhil`, `getfund`, `covid`, `vat`, `tax_lines`
- `app/invoice-public/[token]/page.tsx` lines 18-21: Invoice type includes legacy fields

**Status:** ✅ **ACCEPTABLE** - Type definitions are fine as long as the runtime code uses `tax_lines` first.

---

## Exceptions Found

### Exception 1: `app/vat-returns/[id]/page.tsx` ❌
**Type:** Direct reads without canonical helper  
**Lines:** 199-202, 215-218, 231-235, 247-250  
**Severity:** HIGH  
**Action Required:** MUST FIX - Import and use `getGhanaLegacyView` from `readTaxLines.ts`

### Exception 2: `app/invoices/page.tsx` ⚠️
**Type:** Minor pattern issue  
**Lines:** 257-258, 341-342  
**Severity:** LOW  
**Action Required:** OPTIONAL - Improve fallback pattern (works correctly but could be clearer)

---

## Recommendations

1. **HIGH PRIORITY:** Fix `app/vat-returns/[id]/page.tsx`
   - Import `getGhanaLegacyView` from `@/lib/taxes/readTaxLines`
   - Check for `tax_lines` existence before reading legacy fields
   - Apply fix to invoices, credit notes, expenses, and bills processing

2. **OPTIONAL:** Improve `app/invoices/page.tsx` export functions
   - Change fallback pattern to explicitly check `tax_lines` existence
   - Makes intent clearer for future maintainers

3. **VERIFICATION:** Ensure API routes that serve data to these UI components include `tax_lines` in response
   - Check `/api/vat-returns/[id]/route.ts` includes `tax_lines` in invoice/expense/bill/credit_note data

---

## Conclusion

**Overall Status:** ⚠️ **NEEDS ATTENTION**

- ✅ Core invoice viewing pages correctly use canonical tax reading
- ❌ VAT returns page has direct reads that violate the pattern
- ✅ Fallback patterns are mostly correct (only used when `tax_lines` is missing)

**Expected Exceptions:** 0  
**Actual Exceptions:** 1 (VAT returns page)

The audit found one violation that must be fixed. Once `app/vat-returns/[id]/page.tsx` is updated to use `readTaxLines.ts`, the codebase will be fully compliant with the canonical tax reading pattern.
