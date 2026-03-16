# Tax Engine Versioning Audit Report

**Date:** 2025-01-XX  
**Scope:** Country-based, versioned tax engines for invoices  
**Status:** ✅ Mostly Implemented, ⚠️ One Regression Risk Found

---

## 1️⃣ Country → Tax Engine Mapping

### ✅ **IMPLEMENTED**

**File Paths:**
- `lib/taxEngine/index.ts` (Lines 18-61)
- `lib/taxEngine/jurisdictions/ghana.ts`
- `lib/taxEngine/helpers.ts` (Lines 49-59)

**Entry Points:**
- `calculateTaxes()` - Main entry point for tax calculation
- `calculateTaxesFromAmount()` - Alternative entry point for amount-based calculation

**Resolver Logic:**
- **Registry:** `TAX_ENGINES` object maps country codes to tax engines (Lines 18-24 in `index.ts`)
- **Normalization:** `normalizeJurisdiction()` function maps country names/codes to jurisdiction codes (Lines 34-46)
- **Selection:** `getTaxEngine()` function selects engine based on normalized jurisdiction (Lines 51-61)
- **Ghana Auto-Load:** Ghana tax engine (`ghanaTaxEngine`) is automatically loaded for jurisdiction codes `'GH'` and `'GHA'` (Lines 19-20)

**Confirmation:**
- ✅ Tax logic is selected only by country (via `business.address_country`)
- ✅ Users do not configure rates manually (rates are hardcoded in engine)
- ✅ Ghana tax rules are auto-loaded (default fallback is `'GH'`)

---

## 2️⃣ Versioning by Effective Date

### ✅ **IMPLEMENTED**

**File Paths:**
- `lib/taxEngine/jurisdictions/ghana.ts` (Lines 35-65)

**Version Storage:**
- Tax versions are stored in `GHANA_TAX_VERSIONS` object (Lines 35-50)
- Each version key is an effective date (e.g., `'1970-01-01'`, `'2026-01-01'`)
- Each version value contains tax rates object with `nhil`, `getfund`, `covid`, `vat` properties

**Version Resolution:**
- **Function:** `getRatesForDate()` (Lines 56-65)
- **Logic:** Filters versions where `versionDate <= effectiveDate`, sorts descending, selects most recent
- **Effective Dates:** 
  - Version A: `'1970-01-01'` (includes COVID tax at 1%)
  - Version B: `'2026-01-01'` (removes COVID tax, sets to 0%)

**Confirmation:**
- ✅ Ghana tax rules are versioned (by object with effective dates)
- ✅ Each version has an effective_from date (keys in `GHANA_TAX_VERSIONS`)
- ✅ Resolver selects correct version based on invoice date (via `getRatesForDate()` in `calculateFromAmount()` and `reverseCalculate()`)

**Usage in Invoice Creation:**
- Effective date is passed to `calculateTaxes()` (e.g., Line 157 in `app/api/invoices/create/route.ts`)
- For sent invoices: Uses `sent_at` date (Line 140-142)
- For draft invoices: Uses `issue_date` (Line 142)

---

## 3️⃣ Invoice Immutability

### ⚠️ **PARTIALLY IMPLEMENTED**

### ✅ **What is Correct:**

**1. Tax Version Identifier Storage:**
- **Columns:** `tax_engine_code`, `tax_engine_effective_from`, `tax_jurisdiction` (Migration: `083_add_generic_tax_columns.sql`, Lines 10-12)
- **Storage in Create:** Lines 281-283 in `app/api/invoices/create/route.ts`
  ```typescript
  tax_engine_code: apply_taxes ? taxEngineCode : null,
  tax_engine_effective_from: apply_taxes ? effectiveDateForCalculation : null,
  tax_jurisdiction: apply_taxes ? jurisdiction : null,
  ```
- **Storage in Update:** Lines 299-301 in `app/api/invoices/[id]/route.ts`
  ```typescript
  updateData.tax_engine_code = taxEngineCode
  updateData.tax_engine_effective_from = effectiveDate
  updateData.tax_jurisdiction = jurisdiction
  ```

**2. Computed Tax Values Storage:**
- **Column:** `tax_lines` (JSONB) - Stores full tax calculation result (Migration: `083_add_generic_tax_columns.sql`, Line 9)
- **Storage in Create:** Line 280 in `app/api/invoices/create/route.ts`
  ```typescript
  tax_lines: taxCalculationResult ? taxResultToJSONB(taxCalculationResult) : null,
  ```
- **Storage in Update:** Line 298 in `app/api/invoices/[id]/route.ts`
  ```typescript
  updateData.tax_lines = taxResultToJSONB(taxCalculationResult)
  ```
- **Legacy Columns:** `nhil`, `getfund`, `covid`, `vat`, `total_tax`, `total` are also stored (derived from `tax_lines`) for backward compatibility (Lines 285-288 in create route)

**3. PDF Generation (Correct):**
- **File:** `app/api/invoices/[id]/pdf-preview/route.ts` (Lines 98-100)
- **Behavior:** ✅ Uses stored `tax_lines` JSONB, does NOT recalculate
  ```typescript
  const storedTaxResult = invoice.tax_lines ? jsonbToTaxResult(invoice.tax_lines) : null
  const taxLines = storedTaxResult?.taxLines || []
  ```

### ❌ **What is Missing (Regression Risk):**

**Invoice View Page (RECALCULATES TAX):**
- **File:** `app/invoices/[id]/view/page.tsx` (Lines 596-663)
- **Problem:** ❌ **RECALCULATES tax on read** instead of using stored values
- **Code:**
  ```typescript
  // Calculate tax breakdown using shared tax engine
  const taxCalculationResult = calculateTaxesFromAmount(
    Number(invoice.total),
    businessCountry,
    effectiveDate,
    true // tax-inclusive pricing
  )
  ```
- **Impact:** ⚠️ **CRITICAL REGRESSION RISK**
  - If tax rules change (e.g., COVID removed in 2026), old invoices will show NEW tax calculation
  - Invoice immutability is violated - invoice totals will change retroactively
  - The stored `tax_lines` JSONB column is ignored, `tax_engine_code` and `tax_engine_effective_from` are not used

**Invoice Fetch Flow:**
- **Status:** ✅ Correct - Invoice data is fetched from database, stored values are available
- **Issue:** The view page chooses to recalculate instead of using stored values

---

## 4️⃣ Regression Risk Summary

### ❌ **FOUND: Invoice View Page Recalculates Tax**

**Location:** `app/invoices/[id]/view/page.tsx` (Lines 596-663)

**Current Behavior:**
1. Fetches invoice from database (stored values available)
2. **Ignores** stored `tax_lines` JSONB column
3. **Ignores** stored `tax_engine_code` and `tax_engine_effective_from`
4. **Recalculates** tax using current tax engine with current business country
5. Uses `sent_at` or `issue_date` as effective date (but still uses current tax rules, not invoice-locked version)

**Risk:**
- ⚠️ **HIGH:** Old invoices will show incorrect tax breakdowns if tax rules change
- Example: Invoice created in 2025 with COVID tax will show COVID removed if viewed after 2026-01-01
- Invoice totals (`invoice.total`) remain correct (stored), but tax breakdown display will be wrong
- Violates invoice immutability principle

**Fix Required:**
- Use stored `tax_lines` JSONB instead of recalculating
- Fallback to stored legacy columns (`nhil`, `getfund`, `covid`, `vat`) if `tax_lines` is null
- Only recalculate if `tax_lines` is null AND invoice has no legacy columns (very old invoices)

### ✅ **What is Safe:**

1. **Invoice Create Flow:** ✅ Correct - Stores computed values and version identifiers
2. **Invoice Update Flow:** ✅ Correct - Stores computed values and version identifiers
3. **PDF Generation:** ✅ Correct - Uses stored `tax_lines` JSONB
4. **Tax Engine Versioning:** ✅ Correct - Versions stored and resolved correctly
5. **Country Mapping:** ✅ Correct - Country → engine mapping works correctly

---

## 🔧 Minimal Fixes Required

### **Fix 1: Invoice View Page (Critical)**

**File:** `app/invoices/[id]/view/page.tsx`

**Change:**
- Replace tax recalculation (Lines 606-611) with reading from stored `tax_lines` JSONB
- Use `jsonbToTaxResult()` helper to parse stored tax lines (same as PDF preview)
- Fallback to legacy columns if `tax_lines` is null
- Only recalculate as last resort (very old invoices without tax data)

**Code Pattern to Follow:**
- Use same pattern as `app/api/invoices/[id]/pdf-preview/route.ts` (Lines 98-100)
- Import `jsonbToTaxResult` from `@/lib/taxEngine/helpers`

**Impact:**
- ✅ Eliminates regression risk
- ✅ Ensures invoice immutability
- ✅ Old invoices show correct tax breakdowns regardless of current tax rules

---

## ✅ Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Country → Tax Engine Mapping | ✅ Implemented | Ghana auto-loaded, registry-based |
| Versioning by Effective Date | ✅ Implemented | Two versions, resolver selects correctly |
| Invoice Tax Version Storage | ✅ Implemented | `tax_engine_code`, `tax_engine_effective_from`, `tax_jurisdiction` stored |
| Invoice Tax Values Storage | ✅ Implemented | `tax_lines` JSONB stored, legacy columns derived |
| Invoice Create Flow | ✅ Correct | Stores computed values and version identifiers |
| Invoice Update Flow | ✅ Correct | Stores computed values and version identifiers |
| PDF Generation | ✅ Correct | Uses stored `tax_lines`, no recalculation |
| **Invoice View Page** | ❌ **Regression Risk** | **RECALCULATES tax instead of using stored values** |

---

## 🎯 Conclusion

The tax engine versioning system is **mostly implemented correctly**, with one critical regression risk in the invoice view page. The fix is straightforward: use stored `tax_lines` JSONB instead of recalculating, following the pattern already established in PDF generation.

