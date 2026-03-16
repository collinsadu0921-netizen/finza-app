# Tax Leakage Report

**Generated:** 2025-01-01  
**Scope:** Entire codebase excluding `lib/taxEngine/**`

This report identifies all instances where Ghana tax knowledge (component names, rates, cutoff dates, calculation logic) leaks into application code instead of being encapsulated within the tax engine.

---

## Executive Summary

**Total Findings:** 85+ instances  
**Critical Leakage:** Hardcoded tax component names in 40+ files  
**High Risk:** Total reconstruction logic in 15+ files  
**Medium Risk:** Hardcoded cutoff dates in 2 files  
**Low Risk:** Tax rate references in comments/docs only

---

## 1. Hardcoded Tax Component Names

### 1.1 Database Queries Selecting Tax Columns

**Issue:** Direct references to legacy tax columns (`nhil`, `getfund`, `covid`, `vat`) in database queries.

**Findings:**

#### `app/api/vat-returns/create/route.ts`
- **Lines:** 110, 121, 131, 147
- **What leaks:** Tax component names in SELECT queries
- **Code:**
  ```typescript
  .select("subtotal, nhil, getfund, covid, vat, total_tax, apply_taxes")
  .select("subtotal, nhil, getfund, covid, vat, total_tax")
  .select("total, nhil, getfund, covid, vat")
  .select("subtotal, nhil, getfund, covid, vat, total_tax")
  ```
- **Can replace with tax_lines?** Yes - should read from `tax_lines` JSONB column
- **Priority:** HIGH

#### `app/api/vat-returns/calculate/route.ts`
- **Lines:** 85, 102, 120, 142
- **What leaks:** Tax component names in SELECT queries
- **Code:**
  ```typescript
  .select("subtotal, nhil, getfund, covid, vat, total_tax, apply_taxes")
  .select("subtotal, nhil, getfund, covid, vat, total_tax")
  .select("total, nhil, getfund, covid, vat")
  .select("subtotal, nhil, getfund, covid, vat, total_tax")
  ```
- **Can replace with tax_lines?** Yes - should read from `tax_lines` JSONB column
- **Priority:** HIGH

#### `app/api/vat-returns/monthly/route.ts`
- **Lines:** 90, 104, 126
- **What leaks:** Tax component names in SELECT queries
- **Code:**
  ```typescript
  .select("id, invoice_number, issue_date, subtotal, nhil, getfund, covid, vat, total_tax, apply_taxes, status")
  .select("id, supplier, date, total, nhil, getfund, covid, vat")
  .select("id, bill_number, issue_date, subtotal, nhil, getfund, covid, vat, total_tax")
  ```
- **Can replace with tax_lines?** Yes - should read from `tax_lines` JSONB column
- **Priority:** HIGH

#### `app/api/vat-returns/[id]/route.ts`
- **Lines:** 102, 113, 123, 133
- **What leaks:** Tax component names in SELECT queries
- **Code:**
  ```typescript
  .select("id, invoice_number, issue_date, subtotal, nhil, getfund, covid, vat, total_tax, apply_taxes")
  .select("id, credit_number, date, subtotal, nhil, getfund, covid, vat, total_tax")
  .select("id, date, supplier, total, nhil, getfund, covid, vat")
  .select("id, bill_number, issue_date, subtotal, nhil, getfund, covid, vat, total_tax")
  ```
- **Can replace with tax_lines?** Yes - should read from `tax_lines` JSONB column
- **Priority:** HIGH

#### `app/api/reports/tax-summary/route.ts`
- **Lines:** 51, 72, 93, 118
- **What leaks:** Tax component names in SELECT queries
- **Code:**
  ```typescript
  .select("nhil, getfund, covid, vat, total_tax_amount, status, issue_date")
  .select("nhil, getfund, covid, vat, date")
  .select("nhil, getfund, covid, vat, issue_date")
  .select("nhil, getfund, covid, vat, total_tax, date, invoice_id")
  ```
- **Can replace with tax_lines?** Yes - should read from `tax_lines` JSONB column
- **Priority:** HIGH

#### `app/api/payments/create/route.ts`
- **Lines:** 125
- **What leaks:** Tax component names in SELECT query
- **Code:**
  ```typescript
  .select("id, total, subtotal, nhil, getfund, covid, vat, apply_taxes")
  ```
- **Can replace with tax_lines?** Yes - should read from `tax_lines` JSONB column
- **Priority:** MEDIUM

#### `app/reports/vat/page.tsx`
- **Lines:** 140
- **What leaks:** Tax component names in SELECT query
- **Code:**
  ```typescript
  .select("id, amount, nhil, getfund, covid, vat, created_at, store_id")
  ```
- **Can replace with tax_lines?** Yes - should read from `tax_lines` JSONB column
- **Priority:** HIGH

#### `app/reports/vat/diagnostic/page.tsx`
- **Lines:** 162
- **What leaks:** Tax component names in SELECT query
- **Code:**
  ```typescript
  .select("id, amount, nhil, getfund, covid, vat, created_at, store_id")
  ```
- **Can replace with tax_lines?** Yes - should read from `tax_lines` JSONB column
- **Priority:** MEDIUM

---

### 1.2 Aggregation Logic Using Tax Component Names

**Issue:** Code manually summing individual tax components instead of using `total_tax`.

#### `app/api/reports/tax-summary/route.ts`
- **Lines:** 135-146, 151-154
- **What leaks:** Manual aggregation of tax components
- **Code:**
  ```typescript
  const creditNhil = isGhana ? creditNotes.reduce((sum, cn) => sum + Number(cn.nhil || 0), 0) : 0
  const creditGetfund = isGhana ? creditNotes.reduce((sum, cn) => sum + Number(cn.getfund || 0), 0) : 0
  const creditCovid = isGhana ? creditNotes.reduce((sum, cn) => sum + Number(cn.covid || 0), 0) : 0
  const creditVat = creditNotes.reduce((sum, cn) => sum + Number(cn.vat || 0), 0)
  
  const nhilTotal = isGhana ? ((invoices?.reduce((sum, inv) => sum + Number(inv.nhil || 0), 0) || 0) - creditNhil) : 0
  const getfundTotal = isGhana ? ((invoices?.reduce((sum, inv) => sum + Number(inv.getfund || 0), 0) || 0) - creditGetfund) : 0
  const covidTotal = isGhana ? ((invoices?.reduce((sum, inv) => sum + Number(inv.covid || 0), 0) || 0) - creditCovid) : 0
  const vatTotal = (invoices?.reduce((sum, inv) => sum + Number(inv.vat || 0), 0) || 0) - creditVat
  ```
- **Can replace with tax_lines?** Yes - should sum from `tax_lines` array
- **Priority:** CRITICAL

#### `app/reports/vat/page.tsx`
- **Lines:** 230-233
- **What leaks:** Manual aggregation of tax components
- **Code:**
  ```typescript
  nhil_total += Number(sale.nhil || 0)
  getfund_total += Number(sale.getfund || 0)
  covid_total += Number(sale.covid || 0)
  vat_total += Number(sale.vat || 0)
  ```
- **Can replace with tax_lines?** Yes - should sum from `tax_lines` array
- **Priority:** HIGH

#### `app/reports/vat/diagnostic/page.tsx`
- **Lines:** 304-307
- **What leaks:** Manual extraction of tax components
- **Code:**
  ```typescript
  const nhil = Number(sale.nhil || 0)
  const getfund = Number(sale.getfund || 0)
  const covid = Number(sale.covid || 0)
  const vat = Number(sale.vat || 0)
  ```
- **Can replace with tax_lines?** Yes - should read from `tax_lines` array
- **Priority:** MEDIUM

---

### 1.3 Frontend Display Code Using Tax Component Names

**Issue:** UI components directly accessing tax component properties.

#### `app/sales/[id]/receipt/page.tsx`
- **Lines:** 176-179, 546-549, 585, 699, 706, 828-829, 869, 872, 875, 878, 881, 884, 887, 890, 980-981, 988-989
- **What leaks:** Direct property access to tax components for display
- **Code:**
  ```typescript
  nhil: saleData.nhil ? Number(saleData.nhil) : 0,
  getfund: saleData.getfund ? Number(saleData.getfund) : 0,
  covid: saleData.covid ? Number(saleData.covid) : 0,
  vat: saleData.vat ? Number(saleData.vat) : 0,
  
  const totalTax = (sale.nhil || 0) + (sale.getfund || 0) + (sale.covid || 0) + (sale.vat || 0)
  ```
- **Can replace with tax_lines?** Yes - should map `tax_lines` array to display components
- **Priority:** MEDIUM

#### `app/invoices/[id]/view/page.tsx`
- **Lines:** 718-721, 750, 754, 756, 759, 764, 773
- **What leaks:** Direct property access to tax components for display
- **Code:**
  ```typescript
  nhil: invoice.nhil || 0,
  getfund: invoice.getfund || 0,
  covid: invoice.covid || 0,
  vat: invoice.vat || 0,
  ```
- **Can replace with tax_lines?** Yes - should map `tax_lines` array
- **Priority:** MEDIUM

#### `app/invoices/[id]/edit/page.tsx`
- **Lines:** 984, 988, 990, 993, 998, 1013
- **What leaks:** Direct property access to tax components for display
- **Code:**
  ```typescript
  {legacyTaxAmounts.nhil.toFixed(2)}
  {legacyTaxAmounts.getfund.toFixed(2)}
  {legacyTaxAmounts.covid > 0 && ...}
  {legacyTaxAmounts.vat.toFixed(2)}
  ```
- **Can replace with tax_lines?** Yes - should map `tax_lines` array
- **Priority:** MEDIUM

#### `app/invoices/new/page.tsx`
- **Lines:** 1096, 1100, 1104, 1108, 1123
- **What leaks:** Direct property access to tax components for display
- **Code:**
  ```typescript
  {legacyTaxAmounts.nhil.toFixed(2)}
  {legacyTaxAmounts.getfund.toFixed(2)}
  {legacyTaxAmounts.covid.toFixed(2)}
  {legacyTaxAmounts.vat.toFixed(2)}
  ```
- **Can replace with tax_lines?** Yes - should map `tax_lines` array
- **Priority:** MEDIUM

#### `app/bills/[id]/view/page.tsx`
- **Lines:** 320, 339, 343, 347, 351, 360
- **What leaks:** Direct property access to tax components for display
- **Code:**
  ```typescript
  {(bill.nhil > 0 || bill.vat > 0) && ...}
  {Number(bill.nhil || 0).toFixed(2)}
  {Number(bill.getfund || 0).toFixed(2)}
  {Number(bill.covid || 0).toFixed(2)}
  {Number(bill.vat || 0).toFixed(2)}
  ```
- **Can replace with tax_lines?** Yes - should map `tax_lines` array
- **Priority:** MEDIUM

#### `app/bills/create/page.tsx`
- **Lines:** 112-115, 471, 475, 479, 483, 498
- **What leaks:** Direct property access to tax components for display
- **Code:**
  ```typescript
  nhil: taxBreakdown.nhil,
  getfund: taxBreakdown.getfund,
  covid: taxBreakdown.covid,
  vat: taxBreakdown.vat,
  ```
- **Can replace with tax_lines?** Yes - should use tax engine result structure
- **Priority:** MEDIUM

#### `app/bills/[id]/edit/page.tsx`
- **Lines:** 62, 164-167, 500, 504, 508, 512, 527
- **What leaks:** Direct property access to tax components for display
- **Code:**
  ```typescript
  setApplyTaxes(bill.nhil > 0 || bill.vat > 0)
  nhil: taxBreakdown.nhil,
  getfund: taxBreakdown.getfund,
  covid: taxBreakdown.covid,
  vat: taxBreakdown.vat,
  ```
- **Can replace with tax_lines?** Yes - should use tax engine result structure
- **Priority:** MEDIUM

#### `app/vat-returns/[id]/page.tsx`
- **Lines:** 249, 253, 257, 261, 272, 276, 280, 284, 421, 422, 427
- **What leaks:** Direct property access to tax components for display
- **Code:**
  ```typescript
  {selectedMonth.output_nhil.toFixed(2)}
  {selectedMonth.output_getfund.toFixed(2)}
  {selectedMonth.output_covid.toFixed(2)}
  {selectedMonth.output_vat.toFixed(2)}
  {selectedMonth.input_nhil.toFixed(2)}
  {selectedMonth.input_getfund.toFixed(2)}
  {selectedMonth.input_covid.toFixed(2)}
  {selectedMonth.input_vat.toFixed(2)}
  ```
- **Can replace with tax_lines?** Yes - should aggregate from `tax_lines` arrays
- **Priority:** MEDIUM

---

### 1.4 Filtering Logic Using Tax Component Names

**Issue:** Code filtering records based on tax component values.

#### `app/api/vat-returns/create/route.ts`
- **Lines:** 137-141, 153-157
- **What leaks:** Filtering logic checking individual tax components
- **Code:**
  ```typescript
  const expenses = (allExpenses || []).filter((exp: any) => {
    return Number(exp.nhil || 0) > 0 || 
           Number(exp.getfund || 0) > 0 || 
           Number(exp.covid || 0) > 0 || 
           Number(exp.vat || 0) > 0
  })
  
  const bills = (allBills || []).filter((bill: any) => {
    return Number(bill.nhil || 0) > 0 || 
           Number(bill.getfund || 0) > 0 || 
           Number(bill.covid || 0) > 0 || 
           Number(bill.vat || 0) > 0
  })
  ```
- **Can replace with tax_lines?** Yes - should check if `tax_lines` array has any items or `total_tax > 0`
- **Priority:** HIGH

#### `app/api/vat-returns/monthly/route.ts`
- **Lines:** 116-119, 137-140
- **What leaks:** Filtering logic checking individual tax components
- **Code:**
  ```typescript
  const hasTax = Number(exp.nhil || 0) > 0 || 
                 Number(exp.getfund || 0) > 0 || 
                 Number(exp.covid || 0) > 0 || 
                 Number(exp.vat || 0) > 0
  ```
- **Can replace with tax_lines?** Yes - should check `total_tax > 0` or `tax_lines.length > 0`
- **Priority:** HIGH

---

### 1.5 API Route Update Logic Using Tax Component Names

**Issue:** Code updating database records with individual tax component values.

#### `app/api/invoices/[id]/route.ts`
- **Lines:** 359-362, 390-393
- **What leaks:** Setting individual tax component values in update operations
- **Code:**
  ```typescript
  updateData.nhil = isGhana ? Math.round(legacyGhanaTaxes.nhil * 100) / 100 : 0
  updateData.getfund = isGhana ? Math.round(legacyGhanaTaxes.getfund * 100) / 100 : 0
  updateData.covid = isGhana ? Math.round(legacyGhanaTaxes.covid * 100) / 100 : 0
  updateData.vat = Math.round(legacyGhanaTaxes.vat * 100) / 100
  
  updateData.nhil = 0
  updateData.getfund = 0
  updateData.covid = 0
  updateData.vat = 0
  ```
- **Can replace with tax_lines?** Yes - should serialize tax engine result to `tax_lines` JSONB
- **Priority:** CRITICAL

#### `app/api/orders/[id]/convert-to-invoice/route.ts`
- **Lines:** 370-373
- **What leaks:** Setting individual tax component values
- **Code:**
  ```typescript
  nhil: taxResult.nhil,
  getfund: taxResult.getfund,
  covid: taxResult.covid,
  vat: taxResult.vat,
  ```
- **Can replace with tax_lines?** Yes - should serialize tax engine result to `tax_lines` JSONB
- **Priority:** HIGH

---

## 2. Total Reconstruction Logic

**Issue:** Code manually reconstructing totals by adding `subtotal + nhil + getfund + covid + vat`.

### `app/api/estimates/create/route.ts`
- **Lines:** 81-82, 86, 107, 109
- **What leaks:** Total reconstruction formula
- **Code:**
  ```typescript
  // Formula: grandTotal = baseSubtotal + nhil + getfund + covid + vat
  const calculatedTotal = baseSubtotal + taxResult.nhil + taxResult.getfund + taxResult.covid + taxResult.vat
  
  // Final validation: estimate.total_amount MUST equal baseSubtotal + nhil + getfund + covid + vat
  const finalCheck = baseSubtotal + taxResult.nhil + taxResult.getfund + taxResult.covid + taxResult.vat
  ```
- **Can replace with tax_lines?** Yes - should use `total_amount` from tax engine result or sum `tax_lines[].amount`
- **Priority:** CRITICAL

### `app/sales/[id]/receipt/page.tsx`
- **Lines:** 585
- **What leaks:** Total reconstruction formula
- **Code:**
  ```typescript
  const totalTax = (sale.nhil || 0) + (sale.getfund || 0) + (sale.covid || 0) + (sale.vat || 0)
  ```
- **Can replace with tax_lines?** Yes - should use `total_tax` field or sum `tax_lines[].amount`
- **Priority:** HIGH

---

## 3. Hardcoded Cutoff Dates

**Issue:** Code checking for `2026-01-01` cutoff date instead of using tax engine versioning.

### `app/api/accounting/exports/transactions/route.ts`
- **Lines:** 22, 93-94
- **What leaks:** COVID exclusion cutoff date
- **Code:**
  ```typescript
  * Note: COVID is automatically excluded for periods >= 2026-01-01
  
  // Build tax account codes list (exclude COVID for periods >= 2026-01-01)
  const excludeCovid = periodStart >= "2026-01-01"
  ```
- **Can replace with tax_lines?** Yes - should check if COVID tax line exists in `tax_lines` for that period's effective date
- **Priority:** MEDIUM

### `app/api/accounting/exports/levies/route.ts`
- **Lines:** 20, 99-100
- **What leaks:** COVID exclusion cutoff date
- **Code:**
  ```typescript
  * Note: COVID is automatically excluded for periods >= 2026-01-01
  
  // Build levy mappings (exclude COVID for periods >= 2026-01-01)
  const excludeCovid = periodStart >= "2026-01-01"
  ```
- **Can replace with tax_lines?** Yes - should check if COVID tax line exists in `tax_lines` for that period's effective date
- **Priority:** MEDIUM

---

## 4. Legacy Tax Engine Interface Usage

**Issue:** Code still using legacy `ghanaTaxEngine.ts` interface that exposes individual tax components.

### `app/api/estimates/create/route.ts`
- **Lines:** 4-5, 76, 86, 95-99, 107-109
- **What leaks:** Using `GhanaTaxResult` interface with named properties
- **Code:**
  ```typescript
  import { calculateBaseFromTotalIncludingTaxes } from "@/lib/ghanaTaxEngine"
  
  const reverseCalc = calculateBaseFromTotalIncludingTaxes(subtotal, true)
  baseSubtotal = reverseCalc.baseAmount
  taxResult = reverseCalc.taxBreakdown  // Returns { nhil, getfund, covid, vat, ... }
  
  const calculatedTotal = baseSubtotal + taxResult.nhil + taxResult.getfund + taxResult.covid + taxResult.vat
  
  taxResult = {
    nhil: 0,
    getfund: 0,
    covid: 0,
    vat: 0,
    ...
  }
  ```
- **Can replace with tax_lines?** Yes - should migrate to canonical `TaxResult` with `tax_lines` array
- **Priority:** HIGH

### `app/bills/create/page.tsx`
- **Lines:** 103-128
- **What leaks:** Using legacy tax engine result structure
- **Code:**
  ```typescript
  const { baseAmount, taxBreakdown } = calculateBaseFromTotalIncludingTaxes(...)
  return {
    subtotalBeforeTax: baseAmount,
    nhil: taxBreakdown.nhil,
    getfund: taxBreakdown.getfund,
    covid: taxBreakdown.covid,
    vat: taxBreakdown.vat,
    ...
  }
  ```
- **Can replace with tax_lines?** Yes - should use canonical `TaxResult` structure
- **Priority:** HIGH

### `app/bills/[id]/edit/page.tsx`
- **Lines:** 164-167
- **What leaks:** Using legacy tax engine result structure
- **Code:**
  ```typescript
  nhil: taxBreakdown.nhil,
  getfund: taxBreakdown.getfund,
  covid: taxBreakdown.covid,
  vat: taxBreakdown.vat,
  ```
- **Can replace with tax_lines?** Yes - should use canonical `TaxResult` structure
- **Priority:** HIGH

### `app/api/bills/create/route.ts`
- **Lines:** 85-107
- **What leaks:** Using legacy tax engine result structure
- **Code:**
  ```typescript
  const { baseAmount, taxBreakdown } = calculateBaseFromTotalIncludingTaxes(...)
  taxResult = {
    subtotalBeforeTax: baseAmount,
    nhil: taxBreakdown.nhil,
    getfund: taxBreakdown.getfund,
    covid: taxBreakdown.covid,
    vat: taxBreakdown.vat,
    ...
  }
  ```
- **Can replace with tax_lines?** Yes - should use canonical `TaxResult` structure
- **Priority:** HIGH

---

## 5. Hardcoded Tax Rates in Comments

**Issue:** Comments documenting tax rates (not executable code, but knowledge leakage).

### `lib/ghanaTaxEngine.ts`
- **Lines:** 11-20
- **What leaks:** Tax rate documentation in comments
- **Code:**
  ```typescript
  * Tax Structure (Version A - pre-2026):
  * - NHIL: 2.5% of taxable amount
  * - GETFund: 2.5% of taxable amount
  * - COVID: 1% of taxable amount
  * - VAT: 15% of (taxable amount + NHIL + GETFund + COVID)
  ```
- **Can replace with tax_lines?** N/A - Documentation only
- **Priority:** LOW

---

## 6. SQL Migration Files

**Issue:** Database schema includes legacy tax columns.

### `supabase/migrations/012_sales_tax_fields.sql`
- **Lines:** 3-6
- **What leaks:** Database schema with individual tax columns
- **Code:**
  ```sql
  ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS nhil numeric DEFAULT 0,
    ADD COLUMN IF NOT EXISTS getfund numeric DEFAULT 0,
    ADD COLUMN IF NOT EXISTS covid numeric DEFAULT 0,
    ADD COLUMN IF NOT EXISTS vat numeric DEFAULT 0;
  ```
- **Can replace with tax_lines?** Yes - but requires migration strategy (keep columns for backward compatibility, use `tax_lines` for new records)
- **Priority:** LOW (infrastructure - requires migration planning)

---

## Summary by Priority

### CRITICAL (Must Fix)
1. `app/api/invoices/[id]/route.ts` - Setting individual tax components in updates
2. `app/api/estimates/create/route.ts` - Total reconstruction logic
3. `app/api/reports/tax-summary/route.ts` - Manual tax aggregation

### HIGH (Should Fix Soon)
1. All VAT return API routes - SELECT queries and filtering
2. All report generation routes - SELECT queries and aggregation
3. Legacy tax engine interface usage in bills/estimates

### MEDIUM (Can Fix Later)
1. Frontend display code - Property access for UI rendering
2. Receipt generation - Tax component access
3. VAT diagnostic pages

### LOW (Nice to Have)
1. Comment documentation
2. SQL migration files (requires migration strategy)

---

## Recommendations

1. **Create adapter helpers** to extract tax components from `tax_lines` array
   - `getTaxAmountByCode(taxLines: TaxLine[], code: string): number`
   - `sumTaxLines(taxLines: TaxLine[]): number`
   - `hasTax(taxLines: TaxLine[]): boolean`

2. **Migrate database reads** to use `tax_lines` JSONB column with fallback to legacy columns

3. **Migrate database writes** to serialize canonical `TaxResult` to `tax_lines` JSONB

4. **Create UI helper components** that accept `tax_lines` array instead of individual props

5. **Refactor API routes** to use canonical tax engine instead of legacy interface

---

## Notes

- All findings exclude `lib/taxEngine/**` as this is the authoritative source
- `lib/ghanaTaxEngine.ts` is marked as legacy but still widely used - migration priority
- `lib/vat.ts` contains retail-specific helpers but uses shared versioning logic (acceptable)
- Database columns should remain for backward compatibility during migration period
- Frontend code can be migrated incrementally with backward-compatible adapters
