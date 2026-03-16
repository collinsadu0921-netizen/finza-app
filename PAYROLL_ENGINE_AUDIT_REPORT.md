# Payroll Engine Pre-Flight Audit Report

**Date**: 2024-12-XX  
**Scope**: READ-ONLY inspection of existing Payroll Engine implementation  
**Purpose**: Document current state before adding new country plugins

---

## 1. Existing Payroll Country Plugins

### 1.1 Ghana (GH) - Tier 1 - ✅ Fully Implemented

**File Path**: `lib/payrollEngine/jurisdictions/ghana.ts`

**Effective Date Versions**:
- **Version A** (`1970-01-01`): Current implementation (all dates)
  - PAYE: Progressive tax bands (6 bands: 0-490: 0%, 491-650: 5%, 651-3850: 10%, 3851-20000: 17.5%, 20001-50000: 25%, 50000+: 30%)
  - SSNIT Employee: 5.5% of gross salary (tax-deductible)
  - SSNIT Employer: 13% of gross salary (expense to employer)

**Implementation Status**: ✅ Complete
- PAYE calculation: Implemented (if-else chain matching SQL exactly)
- SSNIT calculations: Implemented (employee and employer)
- Effective date versioning: Structure exists (only one version currently)
- Tests: Comprehensive test coverage in `lib/__tests__/payrollEngine.test.ts`

**Key Constants**:
- SSNIT Employee Rate: 0.055 (5.5%)
- SSNIT Employer Rate: 0.13 (13%)
- PAYE bands: 6 progressive bands (defined in `GHANA_PAYE_VERSIONS`)

---

### 1.2 Kenya (KE) - Tier 2 - ✅ Fully Implemented

**File Path**: `lib/payrollEngine/jurisdictions/kenya.ts`

**Effective Date Versions**:
- **Version A (Legacy)** (`1970-01-01` to `2024-06-30`): NHIF-based regime
  - PAYE: Progressive tax bands (5 bands: 0-24000: 10%, 24001-32333: 25%, 32334-500000: 30%, 500001-800000: 32.5%, 800001+: 35%)
  - NSSF Employee: 6% (Tier I: up to KES 9,000 + Tier II: 9,001-108,000)
  - NSSF Employer: 6% (matches employee)
  - NHIF: Flat amount based on gross salary bands (KES 150 to 1,700)
  - Personal Relief: KES 2,400/month (applied after PAYE calculation)

- **Version B (Current)** (`2024-07-01` onwards): SHIF + AHL regime
  - PAYE: Same progressive bands as Version A
  - NSSF Employee: 6% (Tier I + Tier II)
  - NSSF Employer: 6% (matches employee)
  - SHIF: 2.75% of gross salary (replaces NHIF)
  - AHL Employee: 1.5% of gross salary
  - AHL Employer: 1.5% of gross salary
  - Personal Relief: KES 2,400/month (applied after PAYE calculation)

**Implementation Status**: ✅ Complete
- PAYE calculation: Implemented (progressive bands with Personal Relief)
- NSSF calculations: Implemented (Tier I + Tier II)
- NHIF calculation: Implemented (legacy, flat band amounts)
- SHIF calculation: Implemented (current, percentage-based)
- AHL calculation: Implemented (current, employee and employer)
- Effective date versioning: ✅ Working (regime selection based on `SHIF_INTRODUCTION_DATE = '2024-07-01'`)
- Tests: Comprehensive test coverage in `lib/__tests__/payrollEngine.kenya.test.ts`

**Key Constants**:
- NSSF Employee Rate: 0.06 (6%)
- NSSF Employer Rate: 0.06 (6%)
- NSSF Tier I Limit: 9,000 KES
- NSSF Tier II Limit: 108,000 KES
- SHIF Rate: 0.0275 (2.75%)
- AHL Employee Rate: 0.015 (1.5%)
- AHL Employer Rate: 0.015 (1.5%)
- Personal Relief: 2,400 KES/month
- SHIF Introduction Date: `2024-07-01`

**Regime Selection Logic**:
- Function: `isShifRegime(effectiveDate: string): boolean`
- Returns `true` if `effectiveDate >= '2024-07-01'`, `false` otherwise
- Used to switch between NHIF (legacy) and SHIF+AHL (current) logic

---

## 2. Payroll Engine Contract

### 2.1 Input Interface: `PayrollEngineConfig`

**File**: `lib/payrollEngine/types.ts` (lines 8-39)

**Required Fields**:
- `jurisdiction: string` - ISO 3166-1 alpha-2 country code (e.g., "GH", "KE")
  - Note: This is auto-populated by registry, but must be in config
- `effectiveDate: string` - ISO date string (YYYY-MM-DD)
  - Used to determine which version of tax/contribution rates to apply
  - Defaults to `payroll_month` from API route
  - Must be valid ISO date format
- `basicSalary: number` - Basic salary amount (before allowances)
  - Required, typically >= 0
- `allowances: number` - Total recurring allowances (transport, housing, etc.)
  - Default: 0
- `otherDeductions: number` - Total recurring deductions (loans, advances, etc.)
  - Default: 0
  - Excludes statutory deductions (SSNIT, PAYE, NSSF, SHIF, AHL, NHIF) which are calculated separately

**No Optional Fields**: All fields are required (allowances and otherDeductions default to 0 if not provided)

---

### 2.2 Output Interface: `PayrollCalculationResult`

**File**: `lib/payrollEngine/types.ts` (lines 144-201)

**Required Output Structure**:

```typescript
{
  earnings: {
    basicSalary: number        // Rounded to 2 decimals
    allowances: number         // Rounded to 2 decimals
    grossSalary: number        // basicSalary + allowances, rounded to 2 decimals
  }
  
  statutoryDeductions: StatutoryDeduction[]  // Array of deductions (PAYE, SSNIT, NSSF, SHIF, AHL, NHIF)
  
  otherDeductions: number      // Pass-through from input, rounded to 2 decimals
  
  employerContributions: EmployerContribution[]  // Array of employer expenses (SSNIT employer, NSSF employer, AHL employer)
  
  totals: {
    grossSalary: number                    // Same as earnings.grossSalary
    totalStatutoryDeductions: number       // Sum of all statutoryDeductions amounts
    totalOtherDeductions: number           // Same as otherDeductions
    taxableIncome: number                  // grossSalary - tax-deductible statutory deductions
    netSalary: number                      // taxableIncome - PAYE - otherDeductions (never negative, Math.max(0, ...))
    totalEmployerContributions: number     // Sum of all employerContributions amounts
  }
}
```

**StatutoryDeduction Interface** (lines 64-99):
- `code: string` - Deduction code (e.g., "PAYE", "SSNIT_EMPLOYEE", "NSSF_EMPLOYEE", "SHIF", "AHL_EMPLOYEE", "NHIF")
- `name: string` - Human-readable name
- `rate: number` - Rate as decimal (e.g., 0.055 for 5.5%). Use 0 if not rate-based (e.g., PAYE bands, NHIF flat amounts)
- `base: number` - Base amount on which deduction is calculated
- `amount: number` - Deduction amount (rounded to 2 decimals)
- `ledgerAccountCode: string | null` - Ledger account code for liability (e.g., "2210" for PAYE)
- `isTaxDeductible: boolean` - Whether this deduction reduces taxable income

**EmployerContribution Interface** (lines 104-139):
- `code: string` - Contribution code (e.g., "SSNIT_EMPLOYER", "NSSF_EMPLOYER", "AHL_EMPLOYER")
- `name: string` - Human-readable name
- `rate: number` - Rate as decimal
- `base: number` - Base amount on which contribution is calculated
- `amount: number` - Contribution amount (rounded to 2 decimals)
- `ledgerExpenseAccountCode: string | null` - Ledger account code for expense
- `ledgerLiabilityAccountCode: string | null` - Ledger account code for liability

**Rounding**: All numeric values are rounded to 2 decimal places using `roundPayroll()` from `lib/payrollEngine/versioning.ts`

**Net Salary Constraint**: `netSalary` is never negative (enforced via `Math.max(0, ...)`)

---

### 2.3 PayrollEngine Interface

**File**: `lib/payrollEngine/types.ts` (lines 208-216)

**Required Implementation**:
```typescript
interface PayrollEngine {
  calculate(config: PayrollEngineConfig): PayrollCalculationResult
}
```

**Contract Requirements**:
- MUST accept `PayrollEngineConfig` and return `PayrollCalculationResult`
- MUST NOT throw errors (errors are caught at registry level)
- MUST return valid result structure matching interface exactly
- MUST round all amounts to 2 decimal places
- MUST ensure `netSalary >= 0`

---

### 2.4 Error Handling

**File**: `lib/payrollEngine/errors.ts`

**Error Types**:

1. **MissingCountryError**:
   - Thrown when: `businessCountry` is null, undefined, or empty
   - Message: "Country is required for payroll calculation. Business country must be set in Business Profile settings."
   - Handled at: Registry level (`normalizeJurisdiction()`)

2. **UnsupportedCountryError**:
   - Thrown when:
     - Country is not in `SUPPORTED_COUNTRIES` list (from `lib/payments/eligibility.ts`)
     - Country is in `SUPPORTED_COUNTRIES` but no engine is registered
   - Contains: `countryCode: string` property
   - Message: `No payroll engine implemented for country "${countryCode}".`
   - Handled at: Registry level (`normalizeJurisdiction()` or `getPayrollEngine()`)

**Error Propagation**:
- Errors from `calculatePayroll()` are caught in API route (`app/api/payroll/runs/route.ts`)
- `MissingCountryError` and `UnsupportedCountryError` return 400 status with error message
- Other errors are re-thrown (result in 500 status)

---

## 3. Registry Behavior

### 3.1 Engine Resolution Flow

**File**: `lib/payrollEngine/index.ts`

**Resolution Steps**:

1. **Country Normalization**:
   - Function: `normalizeJurisdiction(country: string | null | undefined): string`
   - Uses: `normalizeCountry()` from `lib/payments/eligibility.ts`
   - Converts country name/code to normalized ISO alpha-2 code (e.g., "Ghana" → "GH")
   - Throws `MissingCountryError` if country is null/undefined/empty
   - Throws `UnsupportedCountryError` if country is not in `SUPPORTED_COUNTRIES`

2. **Engine Lookup**:
   - Function: `getPayrollEngine(jurisdiction: string): PayrollEngine`
   - Registry: `PAYROLL_ENGINES: Record<string, PayrollEngine>`
   - Current registry entries:
     - `'GH'`: `ghanaPayrollEngine`
     - `'KE'`: `kenyaPayrollEngine`
   - Throws `UnsupportedCountryError` if jurisdiction not found in registry

3. **Calculation Execution**:
   - Function: `calculatePayroll(config: PayrollEngineConfig, businessCountry: string | null | undefined): PayrollCalculationResult`
   - Merges normalized jurisdiction into config
   - Calls `engine.calculate(finalConfig)`
   - Returns result directly (no transformation)

---

### 3.2 Effective Date Handling

**How `effectiveDate` is Determined**:
- Source: `payroll_month` from API request body (`app/api/payroll/runs/route.ts` line 124)
- Usage: `effectiveDate = payroll_month` (direct assignment)
- Format: ISO date string (YYYY-MM-DD), typically first day of month (e.g., "2024-06-01")

**Version Selection Logic** (within each country plugin):

1. **Ghana**: 
   - Function: `getPayeRatesForDate(effectiveDate: string)`
   - Filters versions where `versionDate <= effectiveDate`
   - Sorts descending, selects most recent
   - Currently: Always returns `'1970-01-01'` version (only one exists)

2. **Kenya**:
   - Regime selection: `isShifRegime(effectiveDate)` checks if `effectiveDate >= '2024-07-01'`
   - Version selection: Same as Ghana (filters, sorts, selects most recent)
   - Currently: 
     - Before `2024-07-01`: Uses NHIF versions (`'1970-01-01'`)
     - On/after `2024-07-01`: Uses SHIF (`'2024-07-01'`) and AHL (`'2024-07-01'`) versions

**Behavior When No Matching Version**:
- Falls back to earliest version (`'1970-01-01'`)
- No error thrown (uses default/earliest version)
- Example: `effectiveDate = '1960-01-01'` → uses `'1970-01-01'` version

---

### 3.3 Error Scenarios

**Scenario A: Country is Missing**
- Input: `businessCountry = null` or `undefined` or `""`
- Error: `MissingCountryError`
- Location: `normalizeJurisdiction()` (line 52-56)
- HTTP Response: 400 Bad Request
- Message: "Country is required for payroll calculation. Business country must be set in Business Profile settings."

**Scenario B: Country Exists But No Engine Implemented**
- Example: `businessCountry = "TZ"` (Tanzania is in SUPPORTED_COUNTRIES but no engine)
- Error: `UnsupportedCountryError`
- Location: `getPayrollEngine()` (line 73-79)
- HTTP Response: 400 Bad Request
- Message: "No payroll engine implemented for country \"TZ\"."

**Scenario C: Country Not in SUPPORTED_COUNTRIES**
- Example: `businessCountry = "US"`
- Error: `UnsupportedCountryError` (thrown by `normalizeJurisdiction()`)
- Location: `normalizeJurisdiction()` (line 58-60)
- HTTP Response: 400 Bad Request
- Message: "No payroll engine implemented for country \"US\"."

**Scenario D: Engine Throws Unexpected Error**
- If country plugin's `calculate()` method throws non-contract error:
- Error: Re-thrown (not caught in registry)
- HTTP Response: 500 Internal Server Error
- Location: `app/api/payroll/runs/route.ts` (line 206)
- Note: Currently, no country plugins throw errors (they only return results)

**Scenario E: Engine Returns Result**
- Normal case: Engine returns `PayrollCalculationResult`
- No error thrown
- Result is used directly by API route

---

## 4. Ledger Integration

### 4.1 Database Schema

**File**: `supabase/migrations/047_payroll_system.sql`

#### `payroll_runs` Table (lines 76-96):

**Required Fields (NOT NULL)**:
- `id`: UUID (primary key)
- `business_id`: UUID (foreign key to businesses)
- `payroll_month`: DATE (unique per business)
- `total_gross_salary`: NUMERIC (default 0)
- `total_net_salary`: NUMERIC (default 0)

**Optional Fields (NULL allowed, have defaults)**:
- `status`: TEXT (default 'draft', CHECK: 'draft', 'approved', 'locked')
- `total_allowances`: NUMERIC (default 0)
- `total_deductions`: NUMERIC (default 0)
- `total_ssnit_employee`: NUMERIC (default 0)
- `total_ssnit_employer`: NUMERIC (default 0)
- `total_paye`: NUMERIC (default 0)
- `approved_by`: UUID (nullable)
- `approved_at`: TIMESTAMP (nullable)
- `journal_entry_id`: UUID (nullable, foreign key to journal_entries)
- `notes`: TEXT (nullable)

**Constraints**:
- `UNIQUE(business_id, payroll_month)` - One payroll run per month per business
- Status CHECK constraint: Only 'draft', 'approved', 'locked' allowed

**IMPORTANT NOTE**: 
- Schema contains Ghana-specific field names: `total_ssnit_employee`, `total_ssnit_employer`
- These fields are used regardless of country (Kenya uses NSSF, not SSNIT, but data is stored in same fields)
- This is a schema limitation that affects all countries

---

#### `payroll_entries` Table (lines 107-122):

**Required Fields (NOT NULL)**:
- `id`: UUID (primary key)
- `payroll_run_id`: UUID (foreign key to payroll_runs)
- `staff_id`: UUID (foreign key to staff)
- `basic_salary`: NUMERIC (default 0)
- `gross_salary`: NUMERIC (default 0)
- `net_salary`: NUMERIC (default 0)

**Optional Fields (NULL allowed, have defaults)**:
- `allowances_total`: NUMERIC (default 0)
- `deductions_total`: NUMERIC (default 0)
- `ssnit_employee`: NUMERIC (default 0)
- `ssnit_employer`: NUMERIC (default 0)
- `taxable_income`: NUMERIC (default 0)
- `paye`: NUMERIC (default 0)

**IMPORTANT NOTE**:
- Schema contains Ghana-specific field names: `ssnit_employee`, `ssnit_employer`
- These fields are used for ALL countries (Kenya stores NSSF amounts in `ssnit_employee`/`ssnit_employer`)
- This is a schema limitation that affects all countries
- Schema does NOT have fields for: SHIF, AHL, NHIF, NSSF (must reuse SSNIT fields)

---

### 4.2 Ledger Posting Function

**File**: `supabase/migrations/047_payroll_system.sql` (lines 208-342)

**Function**: `post_payroll_to_ledger(p_payroll_run_id UUID) RETURNS UUID`

**What It Does**:
- Reads pre-calculated totals from `payroll_runs` table
- Creates journal entry with payroll expense and liability accounts
- Posts to ledger using account codes:
  - Expense: 6000 (Payroll Expense), 6010 (Employer SSNIT Contribution)
  - Liability: 2210 (PAYE Liability), 2220 (SSNIT Employee Contribution Payable), 2230 (SSNIT Employer Contribution Payable), 2240 (Net Salaries Payable)

**Fields Read from `payroll_runs`**:
- `total_gross_salary` (used for Payroll Expense)
- `total_allowances` (added to Payroll Expense)
- `total_ssnit_employee` (used for SSNIT Employee Liability)
- `total_ssnit_employer` (used for SSNIT Employer Expense and Liability)
- `total_paye` (used for PAYE Liability)
- `total_net_salary` (used for Net Salaries Payable)

**Implicit Expectations**:
- All totals must be >= 0 (no negative values expected)
- `total_net_salary` must equal sum of net salaries from all entries
- Function assumes Ghana-specific structure (SSNIT naming)
- Does NOT handle multi-country differences (e.g., NSSF vs SSNIT, SHIF, AHL)

**Journal Entry Structure**:
```
DEBIT:
  - Payroll Expense (6000): total_gross_salary + total_allowances
  - Employer SSNIT Contribution (6010): total_ssnit_employer

CREDIT:
  - PAYE Liability (2210): total_paye
  - SSNIT Employee Contribution Payable (2220): total_ssnit_employee
  - SSNIT Employer Contribution Payable (2230): total_ssnit_employer
  - Net Salaries Payable (2240): total_net_salary
```

**Error Handling**:
- Raises exception if `payroll_run` not found
- Creates accounts if they don't exist (auto-creates system accounts)
- Updates `payroll_runs.journal_entry_id` on success

---

### 4.3 API Route Data Mapping

**File**: `app/api/payroll/runs/route.ts` (lines 157-198)

**Current Mapping** (Ghana-specific, hardcoded):

```typescript
// Extracts deductions by code (hardcoded for Ghana)
const ssnitEmployeeDeduction = payrollResult.statutoryDeductions.find(d => d.code === 'SSNIT_EMPLOYEE')
const payeDeduction = payrollResult.statutoryDeductions.find(d => d.code === 'PAYE')
const ssnitEmployerContribution = payrollResult.employerContributions.find(c => c.code === 'SSNIT_EMPLOYER')

// Stores in database fields (Ghana-specific names)
payrollEntries.push({
  staff_id: staff.id,
  basic_salary: payrollResult.earnings.basicSalary,
  allowances_total: payrollResult.earnings.allowances,
  deductions_total: payrollResult.totals.totalOtherDeductions,
  gross_salary: payrollResult.earnings.grossSalary,
  ssnit_employee: ssnitEmployee,  // ← Ghana field name
  ssnit_employer: ssnitEmployer,  // ← Ghana field name
  taxable_income: payrollResult.totals.taxableIncome,
  paye: paye,
  net_salary: payrollResult.totals.netSalary,
})
```

**IMPORTANT LIMITATION**:
- API route is hardcoded to look for `'SSNIT_EMPLOYEE'` and `'SSNIT_EMPLOYER'` codes
- Kenya plugin returns `'NSSF_EMPLOYEE'`, `'NSSF_EMPLOYER'`, `'SHIF'`, `'AHL_EMPLOYEE'`, `'AHL_EMPLOYER'`
- **This means Kenya payroll data is currently not correctly extracted** (would get 0 for these fields)
- This is a known bug that needs fixing for multi-country support

**Totals Aggregation**:
- Aggregates across all staff members
- Stores in `payroll_runs` table:
  - `total_gross_salary`: Sum of `grossSalary`
  - `total_allowances`: Sum of `allowances`
  - `total_deductions`: Sum of `totalOtherDeductions`
  - `total_ssnit_employee`: Sum of `ssnitEmployee` (hardcoded extraction)
  - `total_ssnit_employer`: Sum of `ssnitEmployer` (hardcoded extraction)
  - `total_paye`: Sum of `paye`
  - `total_net_salary`: Sum of `netSalary`

---

### 4.4 Non-Null Assumptions

**From Database Schema**:
- `payroll_runs.total_gross_salary`: NOT NULL (default 0)
- `payroll_runs.total_net_salary`: NOT NULL (default 0)
- `payroll_entries.basic_salary`: NOT NULL (default 0)
- `payroll_entries.gross_salary`: NOT NULL (default 0)
- `payroll_entries.net_salary`: NOT NULL (default 0)

**From Ledger Posting Function**:
- Assumes all totals are non-null (reads directly without null checks)
- Assumes `total_gross_salary >= 0`, `total_net_salary >= 0`, etc.

**From Payroll Engine Contract**:
- `totals.netSalary` must be >= 0 (enforced via `Math.max(0, ...)`)
- All amounts are numbers (never null/undefined after rounding)

---

## 5. Existing Tests

### 5.1 Test Files

**Ghana Tests**: `lib/__tests__/payrollEngine.test.ts`
- 444 lines
- Tests Ghana payroll calculations
- Tests country resolution
- Tests effective date versioning

**Kenya Tests**: `lib/__tests__/payrollEngine.kenya.test.ts`
- 1075+ lines
- Tests Kenya payroll calculations (legacy and current regimes)
- Tests effective date versioning (NHIF vs SHIF+AHL)
- Tests Personal Relief
- Tests country resolution

---

### 5.2 Test Coverage by Country

**Ghana (GH)**:
- ✅ Basic payroll calculation (basic salary only)
- ✅ Payroll with allowances
- ✅ Payroll with other deductions
- ✅ All PAYE tax bands (0-490, 491-650, 651-3850, 3851-20000, 20001-50000, 50000+)
- ✅ SSNIT employee calculation (5.5%)
- ✅ SSNIT employer calculation (13%)
- ✅ Effective date versioning
- ✅ Net salary calculation (non-negative check)
- ✅ Country resolution (GH, Ghana name, missing, unsupported)
- ✅ Historical determinism (same payroll_month = same results)

**Kenya (KE)**:
- ✅ Legacy regime calculations (NHIF-based, before 2024-07-01)
- ✅ Current regime calculations (SHIF + AHL, on/after 2024-07-01)
- ✅ All PAYE tax bands (with Personal Relief)
- ✅ NSSF employee and employer calculations (Tier I + Tier II)
- ✅ NHIF flat amounts (all bands, legacy only)
- ✅ SHIF calculation (2.75%, current only)
- ✅ AHL employee and employer calculations (1.5% each, current only)
- ✅ Personal Relief application (KES 2,400)
- ✅ Effective date versioning (regime switching)
- ✅ Taxable income calculation (both regimes)
- ✅ Net salary calculation
- ✅ Structure validation (matches Ghana plugin)
- ✅ Country resolution
- ✅ Deterministic calculations
- ✅ Known output validation (50,000 KES examples)

---

### 5.3 Test Patterns

**Common Test Structure**:
1. Call `kenyaPayrollEngine.calculate()` or `ghanaPayrollEngine.calculate()` directly
2. OR call `calculatePayroll()` from registry (tests country resolution)
3. Assert on `result.earnings.*`, `result.statutoryDeductions[]`, `result.employerContributions[]`, `result.totals.*`
4. Use `.toBeCloseTo()` for numeric comparisons (2 decimal precision)
5. Use `.find()` to locate specific deductions by `code`

**Snapshot Tests**: None found

**Schema Validation Tests**: None found (no tests validate database schema compatibility)

---

## 6. Output Stability Constraints

### 6.1 Backward-Compatible Fields (MUST NOT CHANGE)

**Core Structure** (from `PayrollCalculationResult`):
- `earnings.basicSalary` - MUST exist
- `earnings.allowances` - MUST exist
- `earnings.grossSalary` - MUST exist
- `statutoryDeductions` - MUST be array
- `otherDeductions` - MUST be number
- `employerContributions` - MUST be array
- `totals.grossSalary` - MUST exist
- `totals.totalStatutoryDeductions` - MUST exist
- `totals.totalOtherDeductions` - MUST exist
- `totals.taxableIncome` - MUST exist
- `totals.netSalary` - MUST exist (and be >= 0)
- `totals.totalEmployerContributions` - MUST exist

**StatutoryDeduction Fields** (MUST exist in all deduction objects):
- `code` - MUST be string (used for lookup in API route)
- `name` - MUST be string
- `rate` - MUST be number (can be 0 if not rate-based)
- `base` - MUST be number
- `amount` - MUST be number (>= 0)
- `ledgerAccountCode` - MUST be string | null
- `isTaxDeductible` - MUST be boolean

**EmployerContribution Fields** (MUST exist in all contribution objects):
- `code` - MUST be string
- `name` - MUST be string
- `rate` - MUST be number
- `base` - MUST be number
- `amount` - MUST be number (>= 0)
- `ledgerExpenseAccountCode` - MUST be string | null
- `ledgerLiabilityAccountCode` - MUST be string | null

---

### 6.2 API Route Dependencies

**File**: `app/api/payroll/runs/route.ts`

**Fields Extracted by Code**:
- Line 171: `statutoryDeductions.find(d => d.code === 'SSNIT_EMPLOYEE')`
- Line 172: `statutoryDeductions.find(d => d.code === 'PAYE')`
- Line 173: `employerContributions.find(c => c.code === 'SSNIT_EMPLOYER')`

**Fields Mapped to Database**:
- `payrollResult.earnings.basicSalary` → `basic_salary`
- `payrollResult.earnings.allowances` → `allowances_total`
- `payrollResult.totals.totalOtherDeductions` → `deductions_total`
- `payrollResult.earnings.grossSalary` → `gross_salary`
- `ssnitEmployee` (extracted) → `ssnit_employee`
- `ssnitEmployer` (extracted) → `ssnit_employer`
- `payrollResult.totals.taxableIncome` → `taxable_income`
- `paye` (extracted) → `paye`
- `payrollResult.totals.netSalary` → `net_salary`

**IMPORTANT**: API route is hardcoded for Ghana codes. Kenya codes are NOT extracted, resulting in 0 values for NSSF/SHIF/AHL.

---

### 6.3 UI Dependencies

**File**: `app/payroll/[id]/page.tsx`

**Fields Displayed**:
- `entry.basic_salary` (line 244)
- `entry.allowances_total` (line 247)
- `entry.deductions_total` (line 250)
- `entry.gross_salary` (line 253)
- `entry.paye` (line 256)
- `entry.net_salary` (line 259)

**Summary Cards Displayed**:
- `payrollRun.total_gross_salary` (line 180)
- `payrollRun.total_paye` (line 186)
- `payrollRun.total_ssnit_employee + total_ssnit_employer` (line 192)
- `payrollRun.total_net_salary` (line 198)

**File**: `app/payroll/page.tsx`

**Fields Displayed in List**:
- `run.payroll_month` (line 114)
- `run.total_gross_salary` (line 117)
- `run.total_paye` (line 120)
- `run.total_net_salary` (line 123)

**Currency Display**:
- UI hardcodes "₵" (Ghana Cedi symbol) - line 117, 120, 123, 180, 186, 192, 198, 244, 247, 250, 253, 256, 259
- This is country-agnostic (same symbol for all countries)
- May need to be dynamic in future

**No Multi-Country Handling**: UI does not differentiate between countries or display country-specific deductions (e.g., SHIF, AHL, NHIF)

---

### 6.4 Database Schema Constraints

**Field Names** (from `payroll_entries` schema):
- `ssnit_employee` - Used for ALL countries (Ghana: SSNIT, Kenya: NSSF)
- `ssnit_employer` - Used for ALL countries (Ghana: SSNIT, Kenya: NSSF)
- No fields for: SHIF, AHL, NHIF, NSSF (must reuse existing fields)

**Constraint**: Schema cannot distinguish between country-specific deduction types. All employee statutory deductions must map to `ssnit_employee`, all employer contributions must map to `ssnit_employer`.

**Workaround**: Current implementation stores only one deduction type per country:
- Ghana: Stores SSNIT in `ssnit_employee`
- Kenya: Would store NSSF in `ssnit_employee` (but API route doesn't extract it correctly)

**Missing Fields**: Schema does not support multi-component payrolls (e.g., Kenya's SHIF + AHL + NSSF all together)

---

## 7. Known Limitations & Issues

### 7.1 Multi-Country API Route Limitation

**Issue**: `app/api/payroll/runs/route.ts` hardcodes Ghana-specific deduction codes

**Impact**:
- Kenya payroll entries will have `ssnit_employee = 0` and `ssnit_employer = 0` (NSSF not extracted)
- SHIF, AHL, NHIF are not extracted at all
- Totals in `payroll_runs` will be incorrect for Kenya

**Location**: Lines 171-177 in `app/api/payroll/runs/route.ts`

**Fix Required**: Extract deductions/contributions dynamically by code, not hardcoded names

---

### 7.2 Database Schema Limitations

**Issue**: Schema uses Ghana-specific field names (`ssnit_employee`, `ssnit_employer`)

**Impact**:
- Cannot store multi-component payrolls (e.g., Kenya's NSSF + SHIF + AHL all together)
- Field names are misleading for non-Ghana countries
- No way to distinguish between deduction types in database

**Location**: `supabase/migrations/047_payroll_system.sql` (lines 115-116)

**Fix Required**: Either:
- Add country-specific fields to schema, OR
- Store deduction breakdown in JSON/text field, OR
- Accept that schema is Ghana-centric and map all countries to same fields

---

### 7.3 Ledger Posting Limitations

**Issue**: `post_payroll_to_ledger()` assumes Ghana structure (SSNIT naming, single employer contribution)

**Impact**:
- Does not account for Kenya's NSSF, SHIF, AHL separately
- Does not create separate ledger accounts for country-specific deductions
- Journal entries will be incomplete for Kenya payroll

**Location**: `supabase/migrations/047_payroll_system.sql` (lines 208-342)

**Fix Required**: Either:
- Make ledger posting country-aware, OR
- Accept that ledger uses aggregate totals only (no breakdown by deduction type)

---

### 7.4 UI Limitations

**Issue**: UI hardcodes "₵" currency symbol and does not display country-specific deductions

**Impact**:
- Currency symbol wrong for non-Ghana countries
- Cannot see SHIF, AHL, NHIF breakdowns in UI
- Summary cards show aggregated SSNIT total (doesn't distinguish NSSF vs SSNIT)

**Location**: `app/payroll/[id]/page.tsx`, `app/payroll/page.tsx`

**Fix Required**: Make UI country-aware for currency and deduction display

---

## 8. Summary

### 8.1 What Works

✅ **Payroll Engine Architecture**: Clean, plugin-based, versioned structure  
✅ **Ghana Plugin**: Fully implemented, tested, working  
✅ **Kenya Plugin**: Fully implemented, tested, with effective-date versioning  
✅ **Registry Pattern**: Country resolution works correctly  
✅ **Error Handling**: Proper error types and propagation  
✅ **Type Safety**: Full TypeScript interfaces and contracts  
✅ **Rounding**: Consistent 2-decimal precision via `roundPayroll()`  
✅ **Net Salary Protection**: Enforced non-negative constraint  

### 8.2 What Needs Attention

⚠️ **API Route**: Hardcoded for Ghana deduction codes (doesn't extract Kenya's NSSF/SHIF/AHL)  
⚠️ **Database Schema**: Ghana-centric field names (ssnit_employee/ssnit_employer)  
⚠️ **Ledger Posting**: Assumes Ghana structure (single SSNIT, no multi-component support)  
⚠️ **UI Display**: Hardcoded currency symbol, no country-specific deduction breakdown  

### 8.3 Recommendations for New Country Plugins

1. **Follow Existing Pattern**:
   - Create plugin in `lib/payrollEngine/jurisdictions/{country}.ts`
   - Implement `PayrollEngine` interface
   - Use effective-date versioning if rates change over time
   - Return `PayrollCalculationResult` matching exact structure

2. **Register in Registry**:
   - Add entry to `PAYROLL_ENGINES` in `lib/payrollEngine/index.ts`
   - Ensure country code is in `SUPPORTED_COUNTRIES` (already includes: GH, NG, KE, UG, TZ, RW, ZM)

3. **Deduction Code Naming**:
   - Use descriptive codes (e.g., "NSSF_EMPLOYEE", not "SSNIT_EMPLOYEE" for Kenya)
   - Codes should be unique across all countries
   - Note: API route will need update to extract by code dynamically

4. **Test Coverage**:
   - Add comprehensive tests in `lib/__tests__/payrollEngine.{country}.test.ts`
   - Test all calculation components
   - Test effective-date versioning if applicable
   - Test known output examples

5. **Be Aware of Schema Limitations**:
   - Database fields are Ghana-centric (`ssnit_employee`, `ssnit_employer`)
   - May need to aggregate multi-component deductions into single field
   - Or accept that schema needs migration for multi-country support

---

## 9. File Inventory

**Core Engine Files**:
- `lib/payrollEngine/index.ts` - Registry and resolver (130 lines)
- `lib/payrollEngine/types.ts` - Type definitions (217 lines)
- `lib/payrollEngine/errors.ts` - Error types (30 lines)
- `lib/payrollEngine/versioning.ts` - Versioning helpers (44 lines)

**Country Plugins**:
- `lib/payrollEngine/jurisdictions/ghana.ts` - Ghana plugin (251 lines)
- `lib/payrollEngine/jurisdictions/kenya.ts` - Kenya plugin (681 lines)

**Tests**:
- `lib/__tests__/payrollEngine.test.ts` - Ghana tests (444 lines)
- `lib/__tests__/payrollEngine.kenya.test.ts` - Kenya tests (1075+ lines)

**API Routes**:
- `app/api/payroll/runs/route.ts` - Create/list payroll runs (267 lines)
- `app/api/payroll/runs/[id]/route.ts` - Get/update payroll run (208 lines)

**UI Pages**:
- `app/payroll/page.tsx` - List payroll runs
- `app/payroll/run/page.tsx` - Create payroll run
- `app/payroll/[id]/page.tsx` - View payroll run details

**Database Migrations**:
- `supabase/migrations/047_payroll_system.sql` - Initial payroll schema
- `supabase/migrations/049_combined_reconciliation_assets_payroll_vat.sql` - Combined migration
- `supabase/migrations/100_remove_duplicate_payroll_functions.sql` - Removed duplicate SQL functions

---

**END OF AUDIT REPORT**
