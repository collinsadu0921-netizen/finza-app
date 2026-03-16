# Service Mode Write Paths Audit

**Date**: 2025-01-XX  
**Purpose**: Audit all service-mode write paths that create or modify tax data.  
**Scope**: Invoice creation, credit note creation, order→invoice conversion, estimates.

---

## Audit Summary

| Write Path | tax_lines Persisted | Legacy Columns Derived | No Rate Logic in Route | Status |
|------------|-------------------|----------------------|----------------------|--------|
| Invoice Creation | ✅ YES | ✅ YES | ✅ YES | ✅ **PASS** |
| Credit Note Creation | ✅ YES | ✅ YES | ✅ YES | ✅ **PASS** |
| Order → Invoice Conversion | ✅ YES | ✅ YES | ✅ YES | ✅ **PASS** |
| Estimates | ❌ NO | ❌ NO | ⚠️ YES | ⚠️ **LEGACY** |

---

## 1. Invoice Creation (`app/api/invoices/create/route.ts`)

### ✅ tax_lines Persisted

**Location**: Line 297  
**Implementation**: 
```typescript
tax_lines: taxResult ? toTaxLinesJsonb(taxResult) : null,
```

**Evidence**:
- Uses `getCanonicalTaxResultFromLineItems()` to get tax result (line 217)
- Converts result to canonical JSONB using `toTaxLinesJsonb()` (line 297)
- Persists to `invoices.tax_lines` column

**Status**: ✅ **CONFIRMED**

### ✅ Legacy Columns Derived from tax_lines

**Location**: Lines 223-224, 302-305  
**Implementation**:
```typescript
// Derive legacy columns from canonical tax lines (no rate logic, no cutoff logic, no country branching)
legacyTaxColumns = deriveLegacyTaxColumnsFromTaxLines(taxResult.lines)

// Later in invoiceData:
nhil: apply_taxes ? Math.round(legacyTaxColumns.nhil * 100) / 100 : 0,
getfund: apply_taxes ? Math.round(legacyTaxColumns.getfund * 100) / 100 : 0,
covid: apply_taxes ? Math.round(legacyTaxColumns.covid * 100) / 100 : 0,
vat: apply_taxes ? Math.round(legacyTaxColumns.vat * 100) / 100 : 0,
```

**Evidence**:
- Calls `deriveLegacyTaxColumnsFromTaxLines(taxResult.lines)` (line 224)
- No direct tax rate calculations in route
- Legacy columns populated from helper function output
- Comment explicitly states "no rate logic, no cutoff logic, no country branching"

**Status**: ✅ **CONFIRMED**

### ✅ No Rate Logic in Route

**Location**: Lines 201-236  
**Implementation**:
- Uses `getCanonicalTaxResultFromLineItems()` with config (line 217)
- Config passed to tax engine: `{ jurisdiction, effectiveDate, taxInclusive: true }` (lines 211-215)
- No hardcoded rates (no `0.025`, `0.015`, `0.01`, etc.)
- No country-specific branching for rates
- No date cutoff logic (`2026-01-01`)

**Evidence**:
- Zero hardcoded tax rate values in route
- All rate logic delegated to tax engine via `getCanonicalTaxResultFromLineItems()`
- No if/else blocks checking country or date for rates

**Status**: ✅ **CONFIRMED**

---

## 2. Credit Note Creation (`app/api/credit-notes/create/route.ts`)

### ✅ tax_lines Persisted

**Location**: Line 244  
**Implementation**:
```typescript
tax_lines: taxResult ? toTaxLinesJsonb(taxResult) : null,
```

**Evidence**:
- Uses `getCanonicalTaxResultFromLineItems()` to get tax result (line 135)
- Converts result to canonical JSONB using `toTaxLinesJsonb()` (line 244)
- Persists to `credit_notes.tax_lines` column

**Status**: ✅ **CONFIRMED**

### ✅ Legacy Columns Derived from tax_lines

**Location**: Lines 141-142, 249-252  
**Implementation**:
```typescript
// Derive legacy columns from canonical tax lines (no rate logic, no cutoff logic, no country branching)
legacyTaxColumns = deriveLegacyTaxColumnsFromTaxLines(taxResult.lines)

// Later in creditNoteData:
nhil: apply_taxes ? Math.round(legacyTaxColumns.nhil * 100) / 100 : 0,
getfund: apply_taxes ? Math.round(legacyTaxColumns.getfund * 100) / 100 : 0,
covid: apply_taxes ? Math.round(legacyTaxColumns.covid * 100) / 100 : 0,
vat: apply_taxes ? Math.round(legacyTaxColumns.vat * 100) / 100 : 0,
```

**Evidence**:
- Calls `deriveLegacyTaxColumnsFromTaxLines(taxResult.lines)` (line 142)
- No direct tax rate calculations in route
- Legacy columns populated from helper function output
- Comment explicitly states "no rate logic, no cutoff logic, no country branching"

**Status**: ✅ **CONFIRMED**

### ✅ No Rate Logic in Route

**Location**: Lines 119-154  
**Implementation**:
- Uses `getCanonicalTaxResultFromLineItems()` with config (line 135)
- Config passed to tax engine: `{ jurisdiction, effectiveDate, taxInclusive: true }` (lines 129-133)
- No hardcoded rates (no `0.025`, `0.015`, `0.01`, etc.)
- No country-specific branching for rates
- No date cutoff logic (`2026-01-01`)

**Evidence**:
- Zero hardcoded tax rate values in route
- All rate logic delegated to tax engine via `getCanonicalTaxResultFromLineItems()`
- No if/else blocks checking country or date for rates

**Status**: ✅ **CONFIRMED**

---

## 3. Order → Invoice Conversion (`app/api/orders/[id]/convert-to-invoice/route.ts`)

### ✅ tax_lines Persisted

**Location**: Line 430  
**Implementation**:
```typescript
tax_lines: taxResult ? toTaxLinesJsonb(taxResult) : null,
```

**Evidence**:
- Uses `getCanonicalTaxResultFromLineItems()` to get tax result (line 297)
- Converts result to canonical JSONB using `toTaxLinesJsonb()` (line 430)
- Persists to `invoices.tax_lines` column
- **Note**: Taxes recalculated based on invoice date, NOT order date (line 274)

**Status**: ✅ **CONFIRMED**

### ✅ Legacy Columns Derived from tax_lines

**Location**: Lines 303-304, 435-438  
**Implementation**:
```typescript
// Derive legacy columns from canonical tax lines (no rate logic, no cutoff logic, no country branching)
legacyTaxColumns = deriveLegacyTaxColumnsFromTaxLines(taxResult.lines)

// Later in invoiceData:
nhil: applyTaxes ? Math.round(legacyTaxColumns.nhil * 100) / 100 : 0,
getfund: applyTaxes ? Math.round(legacyTaxColumns.getfund * 100) / 100 : 0,
covid: applyTaxes ? Math.round(legacyTaxColumns.covid * 100) / 100 : 0,
vat: applyTaxes ? Math.round(legacyTaxColumns.vat * 100) / 100 : 0,
```

**Evidence**:
- Calls `deriveLegacyTaxColumnsFromTaxLines(taxResult.lines)` (line 304)
- No direct tax rate calculations in route
- Legacy columns populated from helper function output
- Comment explicitly states "no rate logic, no cutoff logic, no country branching"
- **Note**: Does NOT reuse order tax fields - recalculates fresh (line 280)

**Status**: ✅ **CONFIRMED**

### ✅ No Rate Logic in Route

**Location**: Lines 280-316  
**Implementation**:
- Uses `getCanonicalTaxResultFromLineItems()` with config (line 297)
- Config passed to tax engine: `{ jurisdiction, effectiveDate, taxInclusive: true }` (lines 291-295)
- No hardcoded rates (no `0.025`, `0.015`, `0.01`, etc.)
- No country-specific branching for rates
- No date cutoff logic (`2026-01-01`)
- **Important**: Effective date is invoice date, NOT order date (line 274)

**Evidence**:
- Zero hardcoded tax rate values in route
- All rate logic delegated to tax engine via `getCanonicalTaxResultFromLineItems()`
- No if/else blocks checking country or date for rates
- Explicit comment: "DO NOT reuse order tax fields" (line 280)

**Status**: ✅ **CONFIRMED**

---

## 4. Estimates (`app/api/estimates/create/route.ts`)

### ❌ tax_lines NOT Persisted

**Location**: Lines 98-119  
**Implementation**:
```typescript
const { data: estimate, error: estimateError } = await supabase
  .from("estimates")
  .insert({
    // ... other fields ...
    // NO tax_lines field
    nhil_amount: Math.round(taxResult.nhil * 100) / 100,
    getfund_amount: Math.round(taxResult.getfund * 100) / 100,
    covid_amount: Math.round(taxResult.covid * 100) / 100,
    vat_amount: Math.round(taxResult.vat * 100) / 100,
    // ...
  })
```

**Evidence**:
- Uses legacy `calculateGhanaTaxesFromLineItems()` function (imported on line 4)
- Uses legacy `calculateBaseFromTotalIncludingTaxes()` function (line 76)
- **NO** `toTaxLinesJsonb()` call
- **NO** `tax_lines` field in insert statement
- **NO** `tax_engine_code`, `tax_engine_effective_from`, `tax_jurisdiction` fields

**Schema Check**:
- Checked migrations: `estimates` table has NO `tax_lines` column
- Schema has legacy columns: `nhil_amount`, `getfund_amount`, `covid_amount`, `vat_amount`, `total_tax_amount`

**Status**: ❌ **LEGACY - NOT CANONICAL**

### ❌ Legacy Columns NOT Derived from tax_lines

**Location**: Lines 73-95  
**Implementation**:
```typescript
if (apply_taxes && subtotal > 0) {
  const reverseCalc = calculateBaseFromTotalIncludingTaxes(subtotal, true)
  baseSubtotal = reverseCalc.baseAmount
  taxResult = reverseCalc.taxBreakdown  // Legacy format: { nhil, getfund, covid, vat, totalTax, grandTotal }
  estimateTotal = taxResult.grandTotal
} else {
  taxResult = {
    nhil: 0,
    getfund: 0,
    covid: 0,
    vat: 0,
    totalTax: 0,
    grandTotal: subtotal,
  }
}
```

**Evidence**:
- Uses legacy `calculateGhanaTaxesFromLineItems()` or `calculateBaseFromTotalIncludingTaxes()`
- **NO** call to `deriveLegacyTaxColumnsFromTaxLines()`
- Legacy columns directly populated from legacy tax result object
- Tax result format: `{ nhil, getfund, covid, vat, totalTax, grandTotal }` (not canonical)

**Status**: ❌ **LEGACY - NOT DERIVED FROM CANONICAL**

### ⚠️ No Rate Logic in Route (BUT Uses Legacy Engine)

**Location**: Lines 73-95  
**Implementation**:
- Uses `calculateBaseFromTotalIncludingTaxes()` (line 76)
- Function delegates to legacy `lib/ghanaTaxEngine.ts`
- Route itself has no hardcoded rates
- **BUT**: Rate logic is in legacy engine, not canonical tax engine

**Evidence**:
- Zero hardcoded tax rate values in route itself
- Rate logic exists in legacy `lib/ghanaTaxEngine.ts` (not canonical `lib/taxEngine/`)
- Route does not import or use canonical tax engine helpers

**Status**: ⚠️ **PARTIAL - Uses Legacy Engine (Not Canonical)**

---

## Summary Checklist

### ✅ Invoice Creation
- [x] tax_lines persisted using `toTaxLinesJsonb()`
- [x] Legacy columns derived via `deriveLegacyTaxColumnsFromTaxLines()`
- [x] No rate logic in route (all delegated to canonical tax engine)
- [x] Uses canonical tax engine (`getCanonicalTaxResultFromLineItems()`)

### ✅ Credit Note Creation
- [x] tax_lines persisted using `toTaxLinesJsonb()`
- [x] Legacy columns derived via `deriveLegacyTaxColumnsFromTaxLines()`
- [x] No rate logic in route (all delegated to canonical tax engine)
- [x] Uses canonical tax engine (`getCanonicalTaxResultFromLineItems()`)

### ✅ Order → Invoice Conversion
- [x] tax_lines persisted using `toTaxLinesJsonb()`
- [x] Legacy columns derived via `deriveLegacyTaxColumnsFromTaxLines()`
- [x] No rate logic in route (all delegated to canonical tax engine)
- [x] Uses canonical tax engine (`getCanonicalTaxResultFromLineItems()`)
- [x] **Note**: Taxes recalculated (does not reuse order tax fields)

### ❌ Estimates (LEGACY)
- [ ] tax_lines persisted (NOT IMPLEMENTED - uses legacy columns only)
- [ ] Legacy columns derived from tax_lines (NOT IMPLEMENTED - uses legacy engine directly)
- [x] No rate logic in route (BUT uses legacy engine, not canonical)
- [ ] Uses canonical tax engine (NO - uses `lib/ghanaTaxEngine.ts`)

---

## Findings

### ✅ Canonical Implementation (3 of 4 write paths)

**Invoice Creation**, **Credit Note Creation**, and **Order → Invoice Conversion** all follow the canonical pattern:

1. ✅ Use `getCanonicalTaxResultFromLineItems()` with config
2. ✅ Persist `tax_lines` JSONB using `toTaxLinesJsonb()`
3. ✅ Derive legacy columns via `deriveLegacyTaxColumnsFromTaxLines()`
4. ✅ No hardcoded rates, country branching, or date cutoff logic in routes

### ❌ Legacy Implementation (1 of 4 write paths)

**Estimates** still uses legacy tax system:

1. ❌ Uses `calculateGhanaTaxesFromLineItems()` (legacy engine)
2. ❌ Does NOT persist `tax_lines` JSONB
3. ❌ Does NOT derive legacy columns from canonical format
4. ⚠️ No rate logic in route (but uses legacy engine with hardcoded rates)

**Impact**: Estimates are not compatible with canonical tax system. If estimates are converted to orders/invoices later, taxes are recalculated using canonical engine.

---

## Recommendations

### Immediate Actions

1. **Estimates Refactor** (If estimates need canonical tax support):
   - Update `app/api/estimates/create/route.ts` to use canonical tax engine
   - Add `tax_lines` column to `estimates` table (migration)
   - Update route to persist `tax_lines` and derive legacy columns
   - Update `app/api/estimates/[id]/route.ts` (PUT) similarly

2. **Migration for Estimates Schema**:
   - Add `tax_lines JSONB` column to `estimates` table
   - Add `tax_engine_code`, `tax_engine_effective_from`, `tax_jurisdiction` columns
   - Keep legacy columns for backward compatibility

### Long-term

- Consider if estimates need canonical tax support (since they're converted to orders/invoices which use canonical)
- If estimates are only for display and always recalculated on conversion, legacy may be acceptable

---

## Final Status

**Canonical Write Paths**: ✅ **3 of 4** (75%)  
**Legacy Write Paths**: ❌ **1 of 4** (25%)

**Service Mode Write Paths Audit**: ⚠️ **MOSTLY CANONICAL** (estimates remain legacy)

---

## Confirmation Checklist

### ✅ Invoice Creation (`app/api/invoices/create/route.ts`)
- [x] **tax_lines persisted**: Line 297 - `tax_lines: taxResult ? toTaxLinesJsonb(taxResult) : null`
- [x] **Legacy columns derived from tax_lines**: Line 224 - `deriveLegacyTaxColumnsFromTaxLines(taxResult.lines)`
- [x] **No rate logic in route**: All rates in canonical tax engine, no hardcoded values

### ✅ Credit Note Creation (`app/api/credit-notes/create/route.ts`)
- [x] **tax_lines persisted**: Line 244 - `tax_lines: taxResult ? toTaxLinesJsonb(taxResult) : null`
- [x] **Legacy columns derived from tax_lines**: Line 142 - `deriveLegacyTaxColumnsFromTaxLines(taxResult.lines)`
- [x] **No rate logic in route**: All rates in canonical tax engine, no hardcoded values

### ✅ Order → Invoice Conversion (`app/api/orders/[id]/convert-to-invoice/route.ts`)
- [x] **tax_lines persisted**: Line 430 - `tax_lines: taxResult ? toTaxLinesJsonb(taxResult) : null`
- [x] **Legacy columns derived from tax_lines**: Line 304 - `deriveLegacyTaxColumnsFromTaxLines(taxResult.lines)`
- [x] **No rate logic in route**: All rates in canonical tax engine, no hardcoded values

### ❌ Estimates (`app/api/estimates/create/route.ts`)
- [ ] **tax_lines persisted**: ❌ NO - Uses legacy columns only, no `tax_lines` column in schema
- [ ] **Legacy columns derived from tax_lines**: ❌ NO - Uses legacy `calculateGhanaTaxesFromLineItems()` directly
- [x] **No rate logic in route**: ✅ YES - But uses legacy engine (not canonical)

---

*This audit confirms that 3 of 4 service-mode write paths use canonical tax handling. Estimates remain on legacy system.*
