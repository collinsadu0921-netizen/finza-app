# Track C1 — Retail Boot & Flow Stabilization: Progress Summary

**Date:** 2025-01-17  
**Status:** C1.0 ✅ COMPLETE, C1.1 ✅ COMPLETE, C1.2 ⏳ IN PROGRESS, C1.3 ⏳ PENDING

---

## TASK C1.0 — Failing Routes List (COMPLETE)

**Deliverable:** `RETAIL_FAILING_ROUTES.md`

**Key Findings:**
1. `/sales/[id]/receipt` - `tax_lines` not copied from DB to component state
2. `/sales-history/[id]/receipt` - Depends on API route including `tax_lines` in response
3. `/pos` - No direct `tax_lines` reads found (safe)

---

## TASK C1.1 — Fix "tax_lines not in place" failures (COMPLETE)

### Fix 1: Receipt Page State Mapping

**File:** `app/sales/[id]/receipt/page.tsx`

**Issue:** `tax_lines` loaded from DB (line 148 `select("*")`) but not copied to `sale` state (lines 171-195)

**Fix:** Added `tax_lines` and `total_tax` to `setSale` call (line ~195)
```typescript
tax_lines: saleData.tax_lines || null,
total_tax: saleData.total_tax ? Number(saleData.total_tax) : null,
```

**Status:** ✅ FIXED

---

### Fix 2: API Route Response

**File:** `app/api/sales-history/[id]/receipt/route.ts`

**Issue:** API route transforms sale data but omits `tax_lines` and `total_tax` (lines 156-196)

**Fix:** Added `tax_lines` and `total_tax` to transformed sale object (line ~196)
```typescript
tax_lines: saleData.tax_lines || null,
total_tax: saleData.total_tax ? Number(saleData.total_tax) : null,
```

**Status:** ✅ FIXED

---

### Fix 3: POS Sale Creation Request

**File:** `app/(dashboard)/pos/page.tsx`

**Issue:** POS page calculates taxes using `calculateTaxes()` but doesn't send `tax_lines` in API request (line ~1984)

**Fix:** 
- Added imports: `taxResultToJSONB`, `getTaxEngineCode`, `normalizeCountry`
- Recalculate taxes in `handleCompletePayment` (same logic as `cartTotals`)
- Convert `TaxCalculationResult` to `tax_lines` JSONB using `taxResultToJSONB`
- Add `tax_lines`, `tax_engine_code`, `tax_engine_effective_from`, `tax_jurisdiction` to API request

**Code Added (lines ~1918-1954):**
```typescript
// TRACK C1.1: Recalculate taxes for tax_lines JSONB (required by API)
const taxCalculationResult = calculateTaxes(lineItemsForTax, businessCountry, effectiveDate, true)
const taxLinesJsonb = taxResultToJSONB(taxCalculationResult)
const countryCode = businessCountry ? normalizeCountry(businessCountry) : null
const jurisdiction = countryCode || null
const taxEngineCode = jurisdiction ? getTaxEngineCode(jurisdiction) : null

// In API request body:
tax_lines: taxLinesJsonb,
tax_engine_code: taxEngineCode,
tax_engine_effective_from: effectiveDate.split('T')[0],
tax_jurisdiction: jurisdiction,
```

**Status:** ✅ FIXED

---

## TASK C1.2 — Restore Core POS Happy Path (IN PROGRESS)

**Status:** Next steps - verify POS dashboard, product list, cart, sale creation, payment status updates work without crashing.

---

## TASK C1.3 — Refund Path Integration Check (PENDING)

**Status:** To be verified after C1.2

---

## Files Changed

### Retail UI (Pages)
- `app/sales/[id]/receipt/page.tsx` - Fixed `tax_lines` state mapping

### Retail API Routes
- `app/api/sales-history/[id]/receipt/route.ts` - Added `tax_lines` to API response
- `app/(dashboard)/pos/page.tsx` - Added `tax_lines` calculation and sending in API request

**Total Files Changed:** 3

---

## Root Causes Addressed

1. **State Mapping Bug:** Receipt page loaded `tax_lines` from DB but didn't copy to component state ✅ FIXED
2. **API Response Omission:** Sales history receipt API didn't include `tax_lines` in response ✅ FIXED
3. **Missing Tax Metadata:** POS sale creation didn't send `tax_lines` or tax metadata to API ✅ FIXED

---

## Remaining Work

- C1.2: Verify core POS happy path (dashboard load, product list, cart, sale creation, payment status)
- C1.3: Verify refund path integration (UI → API → ledger posting)

---

**END OF TRACK C1 SUMMARY**
