# Estimates Canonical Tax Compliance Audit

**Date**: 2025-01-XX  
**Scope**: `app/api/estimates/**` routes  
**Audit Type**: Compliance verification for canonical tax engine usage

---

## Audit Result: **PASS** ✅

All 8 compliance requirements are met. No violations found.

---

## Detailed Findings

### 1. ✅ Estimates table has tax_lines JSONB column

**Status**: PASS  
**Evidence**:
- **File**: `supabase/migrations/131_add_tax_lines_to_estimates.sql`
- **Line**: 10
- **Code**: `ADD COLUMN IF NOT EXISTS tax_lines JSONB,`

**Additional columns added**:
- `tax_jurisdiction TEXT` (line 11)
- `tax_engine_code TEXT` (line 12)
- `tax_engine_effective_from DATE` (line 13)

---

### 2. ✅ Estimate creation uses getCanonicalTaxResultFromLineItems()

**Status**: PASS  
**Evidence**:
- **File**: `app/api/estimates/create/route.ts`
- **Line**: 4 (import), 129 (usage)
- **Code**:
  ```typescript
  import { getCanonicalTaxResultFromLineItems } from "@/lib/taxEngine/helpers"
  // ...
  taxResult = getCanonicalTaxResultFromLineItems(lineItems, config)
  ```

**Configuration**:
- Uses `TaxEngineConfig` type (line 7, 123-127)
- `jurisdiction` from business country (normalized)
- `effectiveDate` from estimate `issue_date` (line 111)
- `taxInclusive: true` (line 126)

---

### 3. ✅ tax_lines is persisted using toTaxLinesJsonb()

**Status**: PASS  
**Evidence**:
- **File**: `app/api/estimates/create/route.ts`
- **Line**: 5 (import), 202 (usage)
- **Code**:
  ```typescript
  import { toTaxLinesJsonb } from "@/lib/taxEngine/serialize"
  // ...
  tax_lines: taxResult ? toTaxLinesJsonb(taxResult) : null,
  ```

**Persistence**:
- Stored in `.insert()` call (line 202)
- Only persisted when `taxResult` exists (conditional)
- Null when taxes not applied

---

### 4. ✅ Legacy tax columns are derived from tax_lines using deriveLegacyTaxColumnsFromTaxLines()

**Status**: PASS  
**Evidence**:
- **File**: `app/api/estimates/create/route.ts`
- **Line**: 4 (import), 136 (usage)
- **Code**:
  ```typescript
  import { deriveLegacyTaxColumnsFromTaxLines } from "@/lib/taxEngine/helpers"
  // ...
  legacyTaxColumns = deriveLegacyTaxColumnsFromTaxLines(taxResult.lines)
  ```

**Derived columns** (lines 195-198):
- `nhil_amount` from `legacyTaxColumns.nhil`
- `getfund_amount` from `legacyTaxColumns.getfund`
- `covid_amount` from `legacyTaxColumns.covid`
- `vat_amount` from `legacyTaxColumns.vat`

**No rate logic**: Helper function extracts directly from `tax_lines.lines[]` by code

---

### 5. ✅ No usage of calculateGhanaTaxesFromLineItems()

**Status**: PASS  
**Evidence**:
- **Grep result**: No matches found in `app/api/estimates/**`
- **Files checked**: 
  - `app/api/estimates/create/route.ts`
  - `app/api/estimates/[id]/route.ts`
  - `app/api/estimates/[id]/convert/route.ts`
  - `app/api/estimates/[id]/send/route.ts`

**Note**: Legacy function not imported or used anywhere in estimate routes.

---

### 6. ✅ No usage of calculateBaseFromTotalIncludingTaxes()

**Status**: PASS  
**Evidence**:
- **Grep result**: No matches found in `app/api/estimates/**`
- **Files checked**: All estimate API routes

**Note**: Legacy reverse calculation function not used. Canonical engine handles tax-inclusive calculations internally.

---

### 7. ✅ No hardcoded rates, cutoff dates, or country branching

**Status**: PASS  
**Evidence**:
- **Grep results**: 
  - No matches for `0.15`, `0.025`, `0.01` in `app/api/estimates/**`
  - No matches for `2026-01-01` in `app/api/estimates/**`
  - No matches for `isGhana` or `country.*branch` patterns

**Code review**:
- No rate constants found
- No cutoff date logic found
- No country branching logic (uses `normalizeCountry()` and `getTaxEngineCode()` which are generic)

**Tax calculation logic**:
- Uses canonical `getCanonicalTaxResultFromLineItems()` which handles versioning internally
- Uses `TaxEngineConfig` which passes jurisdiction/date to engine (no branching)
- Derives legacy columns via pure extraction helper (no rate/cutoff logic)

---

### 8. ✅ Totals (subtotal, total_tax, total) come directly from TaxResult

**Status**: PASS  
**Evidence**:
- **File**: `app/api/estimates/create/route.ts`
- **Lines**: 190-192
- **Code**:
  ```typescript
  subtotal: baseSubtotal, // result.base_amount
  total_tax_amount: taxResult ? Math.round(taxResult.total_tax * 100) / 100 : 0, // result.total_tax
  total_amount: estimateTotal, // result.total_amount
  ```

**Source assignments** (lines 132-133):
```typescript
baseSubtotal = Math.round(taxResult.base_amount * 100) / 100
estimateTotal = Math.round(taxResult.total_amount * 100) / 100
```

**Verification**:
- `subtotal` = `result.base_amount` (rounded to 2dp)
- `total_tax_amount` = `result.total_tax` (rounded to 2dp)
- `total_amount` = `result.total_amount` (rounded to 2dp)
- No reconstruction from individual tax components
- No manual summing of tax lines

---

## Update Route Compliance

**File**: `app/api/estimates/[id]/route.ts` (PUT handler)

All 8 requirements also met in update route:
- ✅ Uses `getCanonicalTaxResultFromLineItems()` (line 205)
- ✅ Uses `toTaxLinesJsonb()` (line 276)
- ✅ Uses `deriveLegacyTaxColumnsFromTaxLines()` (line 212)
- ✅ Totals come from TaxResult (lines 265-267)
- ✅ No legacy tax engine functions
- ✅ No hardcoded rates/cutoff dates/country branching

**Additional compliance**:
- Recomputes taxes on every update (line 188 comment)
- Overwrites `tax_lines` and totals (lines 265-279)

---

## Other Routes Checked

### GET `/api/estimates/[id]` (Read)
- **Status**: N/A (read-only, no tax calculations)
- No tax logic found

### POST `/api/estimates/[id]/send` (Send)
- **Status**: N/A (read-only, no tax calculations)
- No tax logic found

### POST `/api/estimates/[id]/convert` (Convert to Invoice)
- **Status**: N/A (copies existing estimate data, no new tax calculations)
- Copies estimate tax fields to invoice (lines 82-89)
- **Note**: Invoice creation route will recompute taxes using canonical engine

---

## Summary

| Requirement | Status | File Reference |
|------------|--------|----------------|
| 1. tax_lines JSONB column | ✅ PASS | `supabase/migrations/131_add_tax_lines_to_estimates.sql:10` |
| 2. Uses getCanonicalTaxResultFromLineItems() | ✅ PASS | `app/api/estimates/create/route.ts:129`<br>`app/api/estimates/[id]/route.ts:205` |
| 3. Uses toTaxLinesJsonb() | ✅ PASS | `app/api/estimates/create/route.ts:202`<br>`app/api/estimates/[id]/route.ts:276` |
| 4. Uses deriveLegacyTaxColumnsFromTaxLines() | ✅ PASS | `app/api/estimates/create/route.ts:136`<br>`app/api/estimates/[id]/route.ts:212` |
| 5. No calculateGhanaTaxesFromLineItems() | ✅ PASS | No matches in `app/api/estimates/**` |
| 6. No calculateBaseFromTotalIncludingTaxes() | ✅ PASS | No matches in `app/api/estimates/**` |
| 7. No hardcoded rates/cutoff dates/branching | ✅ PASS | No matches in `app/api/estimates/**` |
| 8. Totals from TaxResult | ✅ PASS | `app/api/estimates/create/route.ts:190-192`<br>`app/api/estimates/[id]/route.ts:265-267` |

---

## Final Verdict

**RESULT: PASS** ✅

All estimate API routes are fully compliant with canonical tax engine requirements. No violations detected.
