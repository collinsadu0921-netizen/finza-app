# Ghana Tax Logic Leakage Audit Summary

**Date**: 2025-01-XX  
**Scope**: Codebase excluding `lib/taxEngine/**`, comments, documentation, and test assertions  
**Expected**: Zero findings in routes, UI, SQL

---

## Executive Summary

**Total Findings**: 4 categories of leakage identified  
**Critical Leakage**: Hardcoded tax component names in API routes (NHIL, GETFUND, COVID, VAT)  
**High Priority**: Hardcoded cutoff date (2026-01-01) in accounting export routes  
**High Priority**: Hardcoded tax labels with rates in UI (app/reports/vat/page.tsx)  
**SQL**: No findings (migrations already use canonical tax_lines structure)

---

## Findings by Category

### 1. API Routes - Database SELECT Queries

#### 1.1 `app/api/vat-returns/create/route.ts`
- **Lines**: 110, 121, 131, 147
- **Issue**: Direct SELECT of legacy tax columns
- **Code**:
  ```typescript
  .select("subtotal, nhil, getfund, covid, vat, total_tax, apply_taxes")
  .select("subtotal, nhil, getfund, covid, vat, total_tax")
  .select("total, nhil, getfund, covid, vat")
  ```
- **Impact**: Routes assume Ghana tax structure exists in database schema
- **Severity**: HIGH
- **Fix**: Should read from `tax_lines` JSONB column using helper functions

#### 1.2 `app/api/reports/tax-summary/route.ts`
- **Lines**: 52, 73, 94, 119
- **Issue**: Direct SELECT of legacy tax columns
- **Code**:
  ```typescript
  .select("nhil, getfund, covid, vat, total_tax_amount, status, issue_date")
  .select("nhil, getfund, covid, vat, date")
  .select("nhil, getfund, covid, vat, issue_date")
  .select("nhil, getfund, covid, vat, total_tax, date, invoice_id")
  ```
- **Impact**: Routes assume Ghana tax structure
- **Severity**: HIGH
- **Fix**: Should read from `tax_lines` JSONB column

---

### 2. API Routes - Filtering Logic

#### 2.1 `app/api/vat-returns/create/route.ts`
- **Lines**: 137-142, 153-158
- **Issue**: Filtering using individual tax component checks
- **Code**:
  ```typescript
  const expenses = (allExpenses || []).filter((exp: any) => {
    return Number(exp.nhil || 0) > 0 || 
           Number(exp.getfund || 0) > 0 || 
           Number(exp.covid || 0) > 0 || 
           Number(exp.vat || 0) > 0
  })
  ```
- **Impact**: Assumes Ghana tax components exist
- **Severity**: HIGH
- **Fix**: Should check `total_tax > 0` or `tax_lines.length > 0`

---

### 3. API Routes - Manual Tax Aggregation

#### 3.1 `app/api/vat-returns/create/route.ts`
- **Lines**: 164-176
- **Issue**: Manual summing of individual tax components
- **Code**:
  ```typescript
  const totalOutputNhil = (invoices || []).reduce((sum, inv) => sum + Number(inv.nhil || 0), 0)
  const totalOutputGetfund = (invoices || []).reduce((sum, inv) => sum + Number(inv.getfund || 0), 0)
  const totalOutputCovid = (invoices || []).reduce((sum, inv) => sum + Number(inv.covid || 0), 0)
  const totalOutputVat = (invoices || []).reduce((sum, inv) => sum + Number(inv.vat || 0), 0)
  ```
- **Impact**: Assumes Ghana tax structure
- **Severity**: CRITICAL
- **Fix**: Should use `total_tax` field or sum from `tax_lines` array

#### 3.2 `app/api/reports/tax-summary/route.ts`
- **Lines**: 136-147
- **Issue**: Manual aggregation of tax components with Ghana-specific logic
- **Code**:
  ```typescript
  const creditNhil = isGhana ? creditNotes.reduce((sum, cn) => sum + Number(cn.nhil || 0), 0) : 0
  const creditGetfund = isGhana ? creditNotes.reduce((sum, cn) => sum + Number(cn.getfund || 0), 0) : 0
  const creditCovid = isGhana ? creditNotes.reduce((sum, cn) => sum + Number(cn.covid || 0), 0) : 0
  const nhilTotal = isGhana ? ((invoices?.reduce(...) - creditNhil) : 0
  ```
- **Impact**: Country-specific aggregation logic hardcoded
- **Severity**: CRITICAL
- **Fix**: Should use `total_tax` or aggregate from `tax_lines` based on tax code

---

### 4. API Routes - Hardcoded Cutoff Date

#### 4.1 `app/api/accounting/exports/transactions/route.ts`
- **Lines**: 22 (comment), 94 (logic)
- **Issue**: Hardcoded cutoff date for COVID exclusion
- **Code**:
  ```typescript
  * Note: COVID is automatically excluded for periods >= 2026-01-01
  const excludeCovid = periodStart >= "2026-01-01"
  ```
- **Impact**: COVID removal logic hardcoded instead of using tax engine versioning
- **Severity**: HIGH
- **Fix**: Should check if COVID tax line exists in `tax_lines` for the effective date

#### 4.2 `app/api/accounting/exports/levies/route.ts`
- **Lines**: 20 (comment), 100 (logic)
- **Issue**: Hardcoded cutoff date for COVID exclusion
- **Code**:
  ```typescript
  * Note: COVID is automatically excluded for periods >= 2026-01-01
  const excludeCovid = periodStart >= "2026-01-01"
  ```
- **Impact**: Same as above
- **Severity**: HIGH
- **Fix**: Should use tax engine versioning to determine if COVID exists

---

### 5. API Routes - Hardcoded Tax Code Strings

#### 5.1 `app/api/accounting/exports/transactions/route.ts`
- **Lines**: 98-113
- **Issue**: Hardcoded tax code mappings
- **Code**:
  ```typescript
  taxCodeMap[taxControlCodes.vat] = "VAT"
  taxCodeMap[taxControlCodes.nhil] = "NHIL"
  taxCodeMap[taxControlCodes.getfund] = "GETFUND"
  taxCodeMap[taxControlCodes.covid] = "COVID"
  ```
- **Impact**: Ghana-specific tax codes hardcoded in route
- **Severity**: HIGH
- **Fix**: Should query tax engine for available tax codes for the business country

#### 5.2 `app/api/accounting/exports/levies/route.ts`
- **Lines**: 101-107
- **Issue**: Hardcoded levy code strings
- **Code**:
  ```typescript
  const levyMappings: Array<{ code: string; name: string; accountCode: string | null }> = [
    { code: "NHIL", name: "NHIL", accountCode: taxControlCodes.nhil },
    { code: "GETFUND", name: "GETFUND", accountCode: taxControlCodes.getfund },
  ]
  if (!excludeCovid && taxControlCodes.covid) {
    levyMappings.push({ code: "COVID", name: "COVID", accountCode: taxControlCodes.covid })
  }
  ```
- **Impact**: Ghana-specific levy codes hardcoded
- **Severity**: HIGH
- **Fix**: Should query tax engine for available levy codes

---

### 6. UI Components - Hardcoded Tax Labels

#### 6.1 `app/reports/vat/page.tsx`
- **Lines**: 430, 436, 442, 448
- **Issue**: Hardcoded tax labels with rates in display
- **Code**:
  ```tsx
  <span className="text-gray-700">NHIL (2.5%):</span>
  <span className="text-gray-700">GETFund (2.5%):</span>
  <span className="text-gray-700">COVID Levy (1%):</span>
  <span className="text-gray-700">VAT (15%):</span>
  ```
- **Impact**: Ghana-specific tax names and rates displayed for all countries
- **Severity**: HIGH
- **Fix**: Should query tax engine for tax labels and display dynamically based on business country
- **Note**: The calculation logic (lines 230-234) correctly uses `getGhanaLegacyView` helper, but the UI labels are hardcoded

---

## Summary by Severity

### CRITICAL (2 findings)
1. `app/api/vat-returns/create/route.ts` - Manual tax aggregation (lines 164-176)
2. `app/api/reports/tax-summary/route.ts` - Manual tax aggregation with country checks (lines 136-147)

### HIGH (8 findings)
1. `app/api/vat-returns/create/route.ts` - SELECT queries (4 instances)
2. `app/api/reports/tax-summary/route.ts` - SELECT queries (4 instances)
3. `app/api/vat-returns/create/route.ts` - Filtering logic (2 instances)
4. `app/api/accounting/exports/transactions/route.ts` - Hardcoded cutoff date (1 instance)
5. `app/api/accounting/exports/levies/route.ts` - Hardcoded cutoff date (1 instance)
6. `app/api/accounting/exports/transactions/route.ts` - Hardcoded tax code strings (1 instance)
7. `app/api/accounting/exports/levies/route.ts` - Hardcoded levy codes (1 instance)
8. `app/reports/vat/page.tsx` - Hardcoded tax labels with rates (4 instances)

---

## SQL Migrations

**Status**: ✅ No findings

The current migration file (`130_refactor_ledger_posting_to_use_tax_lines_canonical.sql`) correctly uses the canonical `tax_lines` JSONB structure. No hardcoded tax component names or rates found in SQL migrations.

---

## Tax Rates (0.15, 0.025, 0.01)

**Status**: ✅ No findings

No hardcoded tax rate values (0.15, 0.025, 0.01) found in routes, UI, or SQL outside of comments/documentation/tests.

---

## Recommendations

1. **Migrate API routes to use `tax_lines` JSONB**
   - Replace all `SELECT "nhil, getfund, covid, vat"` queries with `SELECT "tax_lines, total_tax"`
   - Use `getGhanaLegacyView()` helper or similar to extract tax components when needed

2. **Remove hardcoded filtering logic**
   - Replace tax component checks with `total_tax > 0` or `tax_lines.length > 0`

3. **Use `total_tax` for aggregation**
   - Replace manual summing of individual components with `total_tax` field

4. **Remove hardcoded cutoff dates**
   - Use tax engine versioning to determine if COVID exists for a given date
   - Query `tax_lines` to check if COVID tax line exists

5. **Make tax codes dynamic**
   - Query tax engine for available tax codes based on business country
   - Remove hardcoded "NHIL", "GETFUND", "COVID" strings

6. **Dynamic tax labels in UI**
   - Query tax engine for tax labels and rates
   - Display tax breakdown based on `tax_lines` array instead of hardcoded labels

---

## Test Exclusions

This audit excludes:
- ✅ `lib/taxEngine/**` (authoritative source for tax logic)
- ✅ Comments (documentation only)
- ✅ Test files explicitly asserting behavior
- ✅ Documentation files (*.md)

---

**Total Findings**: 10 instances across 5 files
**Expected Findings**: 0 (zero findings expected in routes, UI, SQL)
**Status**: ❌ Leakage detected - requires refactoring to use canonical tax engine interface
