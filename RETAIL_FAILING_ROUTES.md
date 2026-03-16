# Retail Failing Routes: Track C1.0 Analysis

**Date:** 2025-01-17  
**Purpose:** Document Retail/POS routes with potential failures (NO FIXES YET)  
**Scope:** READ-ONLY analysis to identify failure points

---

## TASK C1.0 — Failing Routes List

### Classification Methodology

Routes analyzed for:
- Missing `tax_lines` field in state (loaded from DB but not copied to component state)
- Calls to `getGhanaLegacyView` with potentially undefined `tax_lines`
- Missing null guards around tax calculations
- Missing `tax_lines` field in API responses

---

## Failing Routes (Potential Issues)

| Route/Page | File | Issue | Symptom | Line(s) |
|------------|------|-------|---------|---------|
| `/sales/[id]/receipt` | `app/sales/[id]/receipt/page.tsx` | `tax_lines` not copied to state | `sale.tax_lines` will be `undefined` when passed to `getGhanaLegacyView` | 171-195 (setSale missing tax_lines), 591 (usage) |
| `/sales-history/[id]/receipt` | `app/sales-history/[id]/receipt/page.tsx` | Depends on API response including `tax_lines` | If API omits `tax_lines`, `sale.tax_lines` will be `undefined` | 135 (API response), 282 (usage) |
| `/pos` (POS Dashboard) | `app/(dashboard)/pos/page.tsx` | No direct `tax_lines` reads found | Appears safe - uses `calculateTaxes` and `getLegacyTaxAmounts` | - |

---

## Detailed Analysis

### 1. `/sales/[id]/receipt` - Receipt Page

**File:** `app/sales/[id]/receipt/page.tsx`

**Issue:**
- Sale is loaded with `select("*")` which includes `tax_lines` from DB (line 148)
- `setSale` call (lines 171-195) does NOT copy `tax_lines` from `saleData` to state
- `tax_lines` is used on line 591: `getGhanaLegacyView(sale.tax_lines)`

**Potential Failure:**
- `sale.tax_lines` will be `undefined` even if DB has the data
- `getGhanaLegacyView` handles null safely (returns all zeros), so no crash
- But tax breakdown will show zeros even if tax_lines exists in DB

**Missing Field:**
```typescript
// Line 171-195: setSale() missing:
tax_lines: saleData.tax_lines || null,
total_tax: saleData.total_tax || null,
```

---

### 2. `/sales-history/[id]/receipt` - Receipt Reprint Page

**File:** `app/sales-history/[id]/receipt/page.tsx`

**Issue:**
- Sale loaded from API: `/api/sales-history/${saleId}/receipt` (line 124-135)
- `tax_lines` usage on line 282: `getGhanaLegacyView(sale.tax_lines)`
- Depends on API route including `tax_lines` in response

**Potential Failure:**
- If API route omits `tax_lines`, `sale.tax_lines` will be `undefined`
- `getGhanaLegacyView` handles null safely, but tax breakdown will be wrong

**API Dependency:**
- Need to verify `/api/sales-history/[id]/receipt` includes `tax_lines` in response

---

### 3. `/pos` - POS Dashboard

**File:** `app/(dashboard)/pos/page.tsx`

**Analysis:**
- Uses `calculateTaxes` and `getLegacyTaxAmounts` for tax calculation (line 1170-1177)
- Does not directly read `tax_lines` from sales records
- Creates sales with `tax_lines` in request body (line 1984)
- Appears safe - no direct reads of potentially missing `tax_lines`

**Status:** ✅ No issues found

---

## Helper Function Safety

**Function:** `getGhanaLegacyView` (from `lib/taxes/readTaxLines.ts`)

**Null Handling:**
```typescript
export function getGhanaLegacyView(tax_lines: any): {
  vat: number
  nhil: number
  getfund: number
  covid: number
} {
  const breakdown = getTaxBreakdown(tax_lines)  // Returns {} if null
  
  return {
    vat: breakdown.VAT || breakdown.vat || 0,
    nhil: breakdown.NHIL || breakdown.nhil || 0,
    getfund: breakdown.GETFUND || breakdown.GETFund || breakdown.getfund || 0,
    covid: breakdown.COVID || breakdown.Covid || breakdown.covid || 0,
  }
}
```

**Status:** ✅ Null-safe (returns zeros if `tax_lines` is null/undefined)

**Note:** While safe from crashes, missing `tax_lines` will show incorrect tax breakdown (zeros instead of actual values).

---

## Root Causes (Preliminary)

1. **State Mapping Bug:** Receipt page loads `tax_lines` from DB but doesn't copy it to component state
2. **API Response Dependency:** Receipt reprint page depends on API including `tax_lines` in response
3. **Missing Field Propagation:** `tax_lines` exists in DB but not propagated through component state

---

## Next Steps (After C1.0)

1. Fix `tax_lines` state mapping in receipt page
2. Verify API route includes `tax_lines` in response
3. Add defensive null guards (already exists in helper, but ensure state propagation)

---

**END OF C1.0 ANALYSIS**
