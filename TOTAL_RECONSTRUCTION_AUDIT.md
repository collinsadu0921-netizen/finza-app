# Total Reconstruction Logic Audit

**Date:** 2026-01-27  
**Purpose:** Audit codebase for any total reconstruction logic (subtotal + tax, base + tax, sum(vat), sum(nhil))

## Summary

**CRITICAL ISSUES FOUND:** Multiple locations reconstruct totals instead of using authoritative stored values.

## Exclusions (As Requested)

- ✅ Tax engine internals (`lib/ghanaTaxEngine.ts`, `lib/vat.ts`) - These are the source of truth for calculations
- ✅ Test files - All `__tests__` files excluded
- ✅ VAT return aggregations - These are reporting/summarization, not total reconstruction

---

## 🚨 CRITICAL: Total Reconstruction Issues

### 1. **Parked Sales API Routes** (HIGH PRIORITY)

#### `app/api/sales-history/[id]/receipt/route.ts` (Line 90)
```typescript
amount: Number(parkedSale.subtotal || 0) + Number(parkedSale.taxes || 0),
```
**Issue:** Reconstructs total from subtotal + taxes instead of using stored `parkedSale.total`  
**Impact:** May cause discrepancies if parked sales have rounding differences or VAT-inclusive logic  
**Fix:** Use `parkedSale.total` directly

#### `app/api/sales-history/list/route.ts` (Line 409)
```typescript
total_amount: Number(parked.subtotal || 0) + Number(parked.taxes || 0),
```
**Issue:** Same reconstruction pattern for parked sales in list view  
**Fix:** Use `parked.total` directly

#### `app/sales-history/[id]/page.tsx` (Line 230)
```typescript
amount: Number(parkedSale.subtotal || 0) + Number(parkedSale.taxes || 0),
```
**Issue:** Client-side reconstruction of parked sale amount  
**Fix:** Use `parkedSale.total` from API response

---

### 2. **SQL Database Function** (HIGH PRIORITY)

#### `supabase/migrations/039_recurring_invoices_statements.sql` (Line 144)
```sql
total := subtotal + total_tax;
```
**Issue:** Database function reconstructs total for recurring invoices using simplified tax calculation  
**Context:** This function has hardcoded tax rates (0.025, 0.025, 0.01, 0.15) and doesn't use the tax engine  
**Impact:** Recurring invoices may have incorrect totals if tax logic changes  
**Recommendation:** 
- This function should call the tax engine or use the same logic as invoice creation
- The `total` should come from the tax engine's `grandTotal`, not reconstruction

**Full context:**
```sql
-- Calculate taxes (simplified - would need full GhanaTaxEngine logic)
IF apply_taxes AND subtotal > 0 THEN
  nhil := subtotal * 0.025;
  getfund := subtotal * 0.025;
  covid := subtotal * 0.01;
  vat := (subtotal + nhil + getfund + covid) * 0.15;
  total_tax := nhil + getfund + covid + vat;
END IF;

total := subtotal + total_tax;  -- ❌ RECONSTRUCTION
```

---

### 3. **Receipt Display Pages** (MEDIUM PRIORITY - Fallback Logic)

#### `app/sales/[id]/receipt/page.tsx` (Line 601)
```typescript
const grandTotal = vatInclusive 
  ? (sale.amount || subtotal)  // Tax already included in prices, don't add again
  : (sale.amount || subtotal + totalTax)  // ❌ Fallback reconstructs if sale.amount missing
```
**Issue:** Fallback reconstructs total when `sale.amount` is missing  
**Context:** Has good comment explaining logic, but reconstruction is still problematic  
**Impact:** Should never happen if data integrity is maintained, but creates inconsistency if `sale.amount` is NULL  
**Recommendation:** Ensure `sale.amount` is always populated, or throw error if missing

#### `app/sales-history/[id]/receipt/page.tsx` (Line 292)
```typescript
const grandTotal = vatInclusive 
  ? (sale.amount || subtotal)
  : (sale.amount || subtotal + totalTax)  // ❌ Same fallback pattern
```
**Issue:** Identical fallback reconstruction pattern  
**Fix:** Same as above

---

## ✅ CORRECT PATTERNS (Reference Implementation)

### `app/api/estimates/create/route.ts` (Lines 80-82)
```typescript
// Use taxResult.grandTotal as authoritative - it's already correctly calculated by the tax engine
// Do NOT reconstruct from individual tax components
estimateTotal = taxResult.grandTotal
```
**✅ Correct:** Uses tax engine's authoritative `grandTotal`

### `app/api/invoices/create/route.ts`
**✅ Correct:** Uses tax engine results, stores authoritative totals

### `app/bills/create/page.tsx` (Line 117)
```typescript
grandTotal: subtotalIncludingTaxes, // Total stays the same (includes taxes)
```
**✅ Correct:** For tax-inclusive, total = subtotal (no addition)

---

## 📊 VAT Report Aggregations (ACCEPTABLE - Not Total Reconstruction)

These patterns are **acceptable** because they aggregate across multiple documents for reporting purposes, not reconstructing a single document's total:

- `app/api/reports/tax-summary/route.ts` - Sums VAT amounts across invoices for reporting
- `app/api/vat-returns/monthly/route.ts` - Aggregates VAT amounts across months
- `app/api/vat-returns/calculate/route.ts` - Sums VAT from multiple invoices for VAT return
- `app/api/vat-returns/create/route.ts` - Same aggregation pattern

**Pattern:**
```typescript
const creditVat = creditNotes.reduce((sum, cn) => sum + Number(cn.vat || 0), 0)
```
**Status:** ✅ Acceptable - This is aggregation, not reconstruction

---

## 🔍 POS Cart Calculation (CORRECT)

### `app/(dashboard)/pos/page.tsx` (Line 1187)
```typescript
// POS totals: subtotal = total payable (no tax added)
const total = subtotal // Total payable equals subtotal (VAT already included in price)
```
**✅ Correct:** For VAT-inclusive pricing, total equals subtotal. No reconstruction.

**Parking Logic (Line 1781):**
```typescript
total: cartTotals.total,  // ✅ Uses calculated total from cartTotals
```
**✅ Correct:** Sends the authoritative `cartTotals.total` to API

---

## 🎯 Recommendations

### Immediate Actions (High Priority)

1. **Fix Parked Sales Routes** - Use stored `total` field instead of reconstructing:
   - `app/api/sales-history/[id]/receipt/route.ts`
   - `app/api/sales-history/list/route.ts`
   - `app/sales-history/[id]/page.tsx`

2. **Fix Recurring Invoices SQL Function** - Replace hardcoded tax calculation with tax engine call or use stored total:
   - `supabase/migrations/039_recurring_invoices_statements.sql`

3. **Data Integrity Check** - Ensure `sale.amount` is never NULL:
   - Add database constraints if needed
   - Fix receipt pages to throw error if `sale.amount` is missing instead of reconstructing

### Medium Priority

4. **Remove Fallback Reconstruction** - Receipt pages should fail gracefully if `sale.amount` is missing rather than reconstructing

### Verification

5. **Add Integration Tests** - Verify that:
   - Parked sales preserve exact totals
   - Receipt displays match stored totals
   - No rounding differences from reconstruction

---

## 📋 Files Requiring Changes

### Routes (API)
- `app/api/sales-history/[id]/receipt/route.ts` - Line 90
- `app/api/sales-history/list/route.ts` - Line 409

### UI Pages
- `app/sales-history/[id]/page.tsx` - Line 230
- `app/sales/[id]/receipt/page.tsx` - Line 601 (fallback)
- `app/sales-history/[id]/receipt/page.tsx` - Line 292 (fallback)

### SQL Migrations
- `supabase/migrations/039_recurring_invoices_statements.sql` - Line 144

---

## ✅ Verification Checklist

- [ ] No route reconstructs totals (except excluded areas)
- [ ] No UI reconstructs totals (except fallbacks for missing data)
- [ ] No SQL reconstructs totals (except excluded tax engine)
- [ ] All totals come from authoritative tax engine `grandTotal`
- [ ] Parked sales use stored `total` field
- [ ] Receipt pages use stored `sale.amount` field

---

## Notes

- The tax engine (`lib/ghanaTaxEngine.ts`) is the **single source of truth** for tax calculations
- VAT-inclusive pricing means: `total = subtotal` (tax already included, not added)
- VAT-exclusive pricing means: `total = subtotal + tax` (but this should come from tax engine, not manual calculation)
- All document creation routes correctly use tax engine results
- The issues are primarily in **display/retrieval** routes, not creation routes
