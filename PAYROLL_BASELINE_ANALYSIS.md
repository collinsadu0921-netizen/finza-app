# Payroll System - Current State Baseline Analysis

## Executive Summary

**Status**: Payroll system is **PARTIALLY IMPLEMENTED** with core calculation logic and database structure in place, but limited to Ghana (PAYE + SSNIT) only.

**Implementation Level**: ~70% complete
- ✅ Core calculation engine (Ghana PAYE + SSNIT)
- ✅ Database schema (staff, allowances, deductions, payroll runs, entries, payslips)
- ✅ Basic API routes for payroll runs
- ✅ Basic UI pages for payroll management
- ✅ Ledger posting functionality (PostgreSQL function)
- ❌ Multi-country support (only Ghana)
- ❌ No NSSF/NHIF (Kenya/Tanzania payroll schemes)
- ❌ No tax engine integration
- ❌ No versioning/effective dates

---

## 1. Payroll Calculation Logic

### Location: `lib/ghanaPayeEngine.ts`

**Status**: ✅ **FULLY IMPLEMENTED** for Ghana only

**Functions:**
1. **`calculateGhanaPaye(taxableIncome)`**
   - Calculates PAYE tax using Ghana GRA tax bands (monthly)
   - Returns: `{ taxableIncome, paye, netIncome }`
   - Tax bands:
     - 0 – 490: 0%
     - 491 – 650: 5%
     - 651 – 3,850: 10%
     - 3,851 – 20,000: 17.5%
     - 20,001 – 50,000: 25%
     - 50,000+: 30%

2. **`calculateSsnitEmployee(grossSalary)`**
   - Returns 5.5% of gross salary
   - Formula: `grossSalary * 0.055`

3. **`calculateSsnitEmployer(grossSalary)`**
   - Returns 13% of gross salary
   - Formula: `grossSalary * 0.13`

4. **`calculatePayroll(basicSalary, allowances, deductions)`**
   - Main payroll calculation function
   - Calculation flow:
     1. `grossSalary = basicSalary + allowances`
     2. `ssnitEmployee = calculateSsnitEmployee(grossSalary)`
     3. `taxableIncome = grossSalary - ssnitEmployee` (SSNIT is deductible)
     4. `payeResult = calculateGhanaPaye(taxableIncome)`
     5. `netSalary = payeResult.netIncome - deductions`
   - Returns:
     ```typescript
     {
       basicSalary,
       allowances,
       deductions,
       grossSalary,
       ssnitEmployee,
       ssnitEmployer,
       taxableIncome,
       paye,
       netSalary
     }
     ```

**Limitations:**
- ❌ No effective date versioning (rates are hardcoded)
- ❌ No integration with tax engine architecture
- ❌ Ghana-only (no multi-country support)
- ❌ No NSSF/NHIF (Kenya/Tanzania schemes not implemented)
- ❌ Rates not stored in database (hardcoded in TypeScript)

---

## 2. Database Schema

### Tables Created: ✅ **FULLY IMPLEMENTED**

#### 2.1. `staff` Table
**Location**: `supabase/migrations/047_payroll_system.sql`

**Fields:**
- `id` (UUID, PK)
- `business_id` (UUID, FK → businesses)
- `name` (TEXT, required)
- `position` (TEXT)
- `phone` (TEXT)
- `whatsapp_phone` (TEXT)
- `email` (TEXT)
- `basic_salary` (NUMERIC, required, default 0)
- `start_date` (DATE, default CURRENT_DATE)
- `employment_type` (TEXT, enum: 'full_time', 'part_time', 'casual')
- `bank_name` (TEXT)
- `bank_account` (TEXT)
- `ssnit_number` (TEXT)
- `tin_number` (TEXT)
- `status` (TEXT, enum: 'active', 'inactive', 'terminated', default 'active')
- `created_at`, `updated_at`, `deleted_at` (timestamps)

**Indexes:**
- `idx_staff_business_id`
- `idx_staff_status`
- `idx_staff_deleted_at`

**Assumptions:**
- ✅ Employee data is **business-scoped** (business_id required)
- ✅ Soft deletes supported (deleted_at)
- ✅ Status-based filtering (active/inactive/terminated)

---

#### 2.2. `allowances` Table
**Location**: `supabase/migrations/047_payroll_system.sql`

**Fields:**
- `id` (UUID, PK)
- `staff_id` (UUID, FK → staff, CASCADE delete)
- `type` (TEXT, enum: 'transport', 'housing', 'utility', 'medical', 'bonus', 'other')
- `amount` (NUMERIC, required, default 0)
- `recurring` (BOOLEAN, default TRUE)
- `description` (TEXT)
- `created_at`, `updated_at`, `deleted_at` (timestamps)

**Indexes:**
- `idx_allowances_staff_id`
- `idx_allowances_recurring`
- `idx_allowances_deleted_at`

**Assumptions:**
- ✅ Allowances are **employee-level** (staff_id required)
- ✅ Recurring flag distinguishes monthly vs one-time allowances
- ✅ Only recurring allowances are included in payroll calculation (see API route)

---

#### 2.3. `deductions` Table
**Location**: `supabase/migrations/047_payroll_system.sql`

**Fields:**
- `id` (UUID, PK)
- `staff_id` (UUID, FK → staff, CASCADE delete)
- `type` (TEXT, enum: 'loan', 'advance', 'penalty', 'other')
- `amount` (NUMERIC, required, default 0)
- `recurring` (BOOLEAN, default TRUE)
- `description` (TEXT)
- `created_at`, `updated_at`, `deleted_at` (timestamps)

**Indexes:**
- `idx_deductions_staff_id`
- `idx_deductions_recurring`
- `idx_deductions_deleted_at`

**Assumptions:**
- ✅ Deductions are **employee-level** (staff_id required)
- ✅ Recurring flag distinguishes monthly vs one-time deductions
- ✅ Only recurring deductions are included in payroll calculation (see API route)

---

#### 2.4. `payroll_runs` Table
**Location**: `supabase/migrations/047_payroll_system.sql`

**Fields:**
- `id` (UUID, PK)
- `business_id` (UUID, FK → businesses, CASCADE delete)
- `payroll_month` (DATE, required) - First day of the month
- `status` (TEXT, enum: 'draft', 'approved', 'locked', default 'draft')
- `total_gross_salary` (NUMERIC, default 0)
- `total_allowances` (NUMERIC, default 0)
- `total_deductions` (NUMERIC, default 0)
- `total_ssnit_employee` (NUMERIC, default 0)
- `total_ssnit_employer` (NUMERIC, default 0)
- `total_paye` (NUMERIC, default 0)
- `total_net_salary` (NUMERIC, default 0)
- `approved_by` (UUID, FK → auth.users)
- `approved_at` (TIMESTAMP)
- `journal_entry_id` (UUID, FK → journal_entries, nullable)
- `notes` (TEXT)
- `created_at`, `updated_at`, `deleted_at` (timestamps)
- **UNIQUE**(business_id, payroll_month) - One payroll run per month per business

**Indexes:**
- `idx_payroll_runs_business_id`
- `idx_payroll_runs_payroll_month`
- `idx_payroll_runs_status`
- `idx_payroll_runs_deleted_at`

**Assumptions:**
- ✅ Payroll runs are **business-scoped** (business_id required)
- ✅ One payroll run per month per business (unique constraint)
- ✅ Status workflow: draft → approved → locked
- ✅ Journal entry ID links payroll to accounting ledger
- ✅ Totals are aggregated at run level (not per employee)

---

#### 2.5. `payroll_entries` Table
**Location**: `supabase/migrations/047_payroll_system.sql`

**Fields:**
- `id` (UUID, PK)
- `payroll_run_id` (UUID, FK → payroll_runs, CASCADE delete)
- `staff_id` (UUID, FK → staff, CASCADE delete)
- `basic_salary` (NUMERIC, required, default 0)
- `allowances_total` (NUMERIC, default 0)
- `deductions_total` (NUMERIC, default 0)
- `gross_salary` (NUMERIC, required, default 0)
- `ssnit_employee` (NUMERIC, default 0)
- `ssnit_employer` (NUMERIC, default 0)
- `taxable_income` (NUMERIC, default 0)
- `paye` (NUMERIC, default 0)
- `net_salary` (NUMERIC, required, default 0)
- `created_at`, `updated_at` (timestamps)

**Indexes:**
- `idx_payroll_entries_payroll_run_id`
- `idx_payroll_entries_staff_id`

**Assumptions:**
- ✅ Each entry represents one employee's payroll for one month
- ✅ All calculated values are **stored** (not recalculated on read)
- ✅ Entries are immutable after creation (no update logic)
- ✅ CASCADE delete when payroll run is deleted

---

#### 2.6. `payslips` Table
**Location**: `supabase/migrations/047_payroll_system.sql`

**Fields:**
- `id` (UUID, PK)
- `payroll_entry_id` (UUID, FK → payroll_entries, CASCADE delete)
- `staff_id` (UUID, FK → staff, CASCADE delete)
- `payroll_run_id` (UUID, FK → payroll_runs, CASCADE delete)
- `public_token` (TEXT, unique, nullable) - For public payslip viewing
- `sent_via_whatsapp` (BOOLEAN, default FALSE)
- `sent_at` (TIMESTAMP, nullable)
- `created_at`, `updated_at` (timestamps)

**Indexes:**
- `idx_payslips_payroll_entry_id`
- `idx_payslips_staff_id`
- `idx_payslips_payroll_run_id`
- `idx_payslips_public_token`

**Assumptions:**
- ✅ Payslips are generated **after** payroll run creation (separate API call)
- ✅ Public token allows unauthenticated payslip viewing
- ✅ WhatsApp integration supported (sent_via_whatsapp flag)
- ✅ Multiple payslips can reference same payroll_run (one per entry)

---

## 3. Database Functions (PostgreSQL)

### 3.1. `calculate_ghana_paye(taxable_income NUMERIC)`
**Location**: `supabase/migrations/047_payroll_system.sql` (lines 152-181)

**Status**: ✅ **IMPLEMENTED** (duplicate of TypeScript function)

**Purpose**: Calculate PAYE tax using GRA tax bands

**Limitations:**
- ❌ Duplicated logic (exists in TypeScript and PostgreSQL)
- ❌ Hardcoded tax bands (no versioning)
- ❌ No effective date parameter

---

### 3.2. `calculate_ssnit_employee(gross_salary NUMERIC)`
**Location**: `supabase/migrations/047_payroll_system.sql` (lines 186-192)

**Status**: ✅ **IMPLEMENTED**

**Purpose**: Calculate SSNIT employee contribution (5.5%)

**Limitations:**
- ❌ Hardcoded rate (0.055)
- ❌ No versioning

---

### 3.3. `calculate_ssnit_employer(gross_salary NUMERIC)`
**Location**: `supabase/migrations/047_payroll_system.sql` (lines 197-203)

**Status**: ✅ **IMPLEMENTED**

**Purpose**: Calculate SSNIT employer contribution (13%)

**Limitations:**
- ❌ Hardcoded rate (0.13)
- ❌ No versioning

---

### 3.4. `post_payroll_to_ledger(p_payroll_run_id UUID)`
**Location**: `supabase/migrations/047_payroll_system.sql` (lines 208-342)

**Status**: ✅ **IMPLEMENTED**

**Purpose**: Post payroll run to accounting ledger as double-entry journal entry

**Journal Entry Structure:**
- **Debits:**
  - Payroll Expense (6000): `total_gross_salary + total_allowances`
  - Employer SSNIT Expense (6010): `total_ssnit_employer`
- **Credits:**
  - PAYE Liability (2210): `total_paye`
  - SSNIT Employee Liability (2220): `total_ssnit_employee`
  - SSNIT Employer Liability (2230): `total_ssnit_employer`
  - Net Salaries Payable (2240): `total_net_salary`

**Account Codes (System Accounts):**
- `6000`: Payroll Expense
- `6010`: Employer SSNIT Contribution
- `2210`: PAYE Liability
- `2220`: SSNIT Employee Contribution Payable
- `2230`: SSNIT Employer Contribution Payable
- `2240`: Net Salaries Payable

**Behavior:**
- Creates accounts if they don't exist (auto-creation)
- Creates journal entry with reference_type='payroll'
- Updates `payroll_runs.journal_entry_id` with created journal entry ID
- Returns journal entry ID

**Limitations:**
- ❌ Auto-creates accounts if missing (may conflict with COA management)
- ❌ No error handling for account creation failures
- ❌ No validation that payroll run is in 'approved' status

---

### 3.5. `generate_payslip_token()`
**Location**: `supabase/migrations/047_payroll_system.sql` (lines 347-354)

**Status**: ✅ **IMPLEMENTED**

**Purpose**: Generate unique public token for payslip viewing

**Returns**: Random UUID string

---

## 4. API Routes

### 4.1. `GET /api/payroll/runs`
**Location**: `app/api/payroll/runs/route.ts`

**Status**: ✅ **IMPLEMENTED**

**Purpose**: List all payroll runs for current business

**Returns**: Array of payroll runs (sorted by payroll_month descending)

**Authorization**: Requires authenticated user and business

---

### 4.2. `POST /api/payroll/runs`
**Location**: `app/api/payroll/runs/route.ts`

**Status**: ✅ **IMPLEMENTED**

**Purpose**: Create new payroll run for a month

**Request Body:**
```typescript
{
  payroll_month: string // ISO date string (YYYY-MM-DD)
}
```

**Process:**
1. Validates `payroll_month` is provided
2. Checks if payroll run already exists for that month (unique constraint)
3. Fetches all active staff for business
4. For each staff:
   - Sums recurring allowances
   - Sums recurring deductions
   - Calculates payroll using `calculatePayroll()`
   - Adds to payroll entries array
5. Aggregates totals across all staff
6. Creates `payroll_runs` record (status='draft')
7. Creates `payroll_entries` records for each staff
8. Returns created payroll run

**Limitations:**
- ❌ Only includes staff with `status='active'`
- ❌ Only includes recurring allowances/deductions
- ❌ No validation of payroll_month format
- ❌ No check if staff has `basic_salary > 0`
- ❌ Calculates on current rates (no effective date support)

---

### 4.3. `GET /api/payroll/runs/[id]`
**Location**: `app/api/payroll/runs/[id]/route.ts`

**Status**: ✅ **IMPLEMENTED**

**Purpose**: Get single payroll run with entries

**Returns**: Payroll run with nested payroll entries

---

### 4.4. `PUT /api/payroll/runs/[id]`
**Location**: `app/api/payroll/runs/[id]/route.ts`

**Status**: ✅ **IMPLEMENTED**

**Purpose**: Update payroll run (status, notes)

**Request Body:**
```typescript
{
  status?: 'draft' | 'approved' | 'locked',
  notes?: string
}
```

**Special Behavior:**
- When status changes to 'approved', calls `post_payroll_to_ledger()` PostgreSQL function
- Updates `approved_by` and `approved_at` if approving
- Ledger posting errors are logged but don't fail the request (commented out error handling)

**Limitations:**
- ❌ No validation that status transitions are valid (draft → approved → locked)
- ❌ Ledger posting errors are silently ignored
- ❌ No check if payroll run is already locked before updating

---

### 4.5. `POST /api/payroll/runs/[id]/generate-payslips`
**Location**: `app/api/payroll/runs/[id]/generate-payslips/route.ts`

**Status**: ✅ **IMPLEMENTED**

**Purpose**: Generate payslips for all payroll entries in a run

**Process:**
1. Verifies payroll run belongs to business
2. Fetches all payroll entries for run
3. For each entry:
   - Checks if payslip already exists (skips if exists)
   - Generates public token
   - Creates `payslips` record
4. Returns count and array of created payslips

**Limitations:**
- ❌ Skips entries that already have payslips (no error, just skips)
- ❌ No validation that payroll run is approved before generating payslips

---

### 4.6. `GET /api/payslips/[id]`
**Location**: `app/api/payslips/[id]/route.ts`

**Status**: ✅ **IMPLEMENTED**

**Purpose**: Get payslip with related data (for authenticated users)

**Returns**: Payslip with nested payroll_entry, staff, payroll_run data

---

### 4.7. `GET /api/payslips/public/[token]`
**Location**: `app/api/payslips/public/[token]/route.ts`

**Status**: ✅ **IMPLEMENTED**

**Purpose**: Get payslip by public token (unauthenticated access)

**Returns**: Payslip with nested payroll_entry, staff, payroll_run data

**Authorization**: No authentication required (public endpoint)

---

### 4.8. Staff Management APIs
**Location**: `app/api/staff/`

**Status**: ✅ **IMPLEMENTED**

**Endpoints:**
- `GET /api/staff` - List all staff
- `POST /api/staff` - Create staff
- `GET /api/staff/[id]` - Get staff
- `PUT /api/staff/[id]` - Update staff

**Note**: Staff management is separate from payroll runs but required for payroll processing.

---

## 5. UI Pages

### 5.1. `/payroll` (List Payroll Runs)
**Location**: `app/payroll/page.tsx`

**Status**: ✅ **IMPLEMENTED**

**Features:**
- Lists all payroll runs (table view)
- Shows payroll_month, gross_salary, paye, net_salary, status
- Link to create new payroll run
- Link to view payroll run details

---

### 5.2. `/payroll/run` (Create Payroll Run)
**Location**: `app/payroll/run/page.tsx`

**Status**: ✅ **IMPLEMENTED**

**Features:**
- Form to select payroll month (date picker)
- Creates payroll run via API
- Redirects to payroll run details page

---

### 5.3. `/payroll/[id]` (View Payroll Run)
**Location**: `app/payroll/[id]/page.tsx`

**Status**: ✅ **IMPLEMENTED**

**Features:**
- Shows payroll run summary (totals)
- Lists all payroll entries (per employee)
- Shows status, approval info
- Actions: Approve, Lock, Generate Payslips

---

### 5.4. `/settings/staff` (Staff Management)
**Location**: `app/settings/staff/page.tsx`

**Status**: ✅ **IMPLEMENTED**

**Features:**
- List all staff (business-scoped)
- Create/edit staff
- Fields: name, position, phone, email, basic_salary, ssnit_number, tin_number, bank details
- Links to payroll staff detail pages

---

### 5.5. `/payroll/staff/[id]` and `/payroll/staff/[id]/edit`
**Location**: `app/payroll/staff/[id]/`

**Status**: ✅ **IMPLEMENTED** (likely similar to settings/staff)

---

## 6. Key Assumptions

### 6.1. Business-Level vs Employee-Level Data

**Business-Level:**
- ✅ Payroll runs are business-scoped (one run per business per month)
- ✅ Staff belong to a business (business_id required)
- ✅ Ledger accounts are business-scoped
- ✅ Payroll totals are aggregated at business level

**Employee-Level:**
- ✅ Basic salary stored per employee (staff.basic_salary)
- ✅ Allowances stored per employee (allowances.staff_id)
- ✅ Deductions stored per employee (deductions.staff_id)
- ✅ Payroll entries are per employee per run
- ✅ Payslips are per employee per run

**Implication**: Payroll is **not** centralized at business level. Each employee's compensation is stored individually, and payroll runs aggregate them.

---

### 6.2. Payroll Calculation Assumptions

**Current Implementation:**
- ✅ Gross Salary = Basic Salary + Allowances (recurring only)
- ✅ Taxable Income = Gross Salary - SSNIT Employee (SSNIT is deductible)
- ✅ Net Salary = Taxable Income - PAYE - Deductions (recurring only)
- ✅ Only recurring allowances/deductions are included in payroll

**Missing:**
- ❌ No support for one-time bonuses/allowances
- ❌ No support for one-time deductions
- ❌ No overtime calculations
- ❌ No pro-rata salary for partial months
- ❌ No leave deductions

---

### 6.3. Tax Calculation Assumptions

**Current Implementation:**
- ✅ PAYE calculated on taxable income (gross - SSNIT employee)
- ✅ SSNIT employee = 5.5% of gross (deductible)
- ✅ SSNIT employer = 13% of gross (expense, not deducted from employee)
- ✅ PAYE rates are hardcoded (Ghana GRA bands)

**Missing:**
- ❌ No effective date versioning (rates can't change over time)
- ❌ No integration with tax engine architecture
- ❌ No support for other countries (Kenya NSSF, Tanzania NHIF, etc.)
- ❌ No tax reliefs/allowances beyond SSNIT deduction

---

### 6.4. Payroll Run Workflow Assumptions

**Current Implementation:**
- ✅ Status workflow: `draft` → `approved` → `locked`
- ✅ Payroll run created in `draft` status
- ✅ Ledger posting happens when status changes to `approved`
- ✅ One payroll run per month per business (unique constraint)

**Missing:**
- ❌ No validation of status transitions
- ❌ No ability to modify payroll run after approval
- ❌ No ability to reverse/undo payroll run
- ❌ No payroll run deletion logic (only soft delete via deleted_at)

---

### 6.5. Ledger Integration Assumptions

**Current Implementation:**
- ✅ Payroll posting creates double-entry journal entry
- ✅ Accounts auto-created if missing (system accounts)
- ✅ Journal entry linked to payroll run (journal_entry_id)
- ✅ Posting happens on approval (not on creation)

**Missing:**
- ❌ No validation that accounts exist before posting
- ❌ No check if payroll run is already posted
- ❌ Errors in ledger posting are silently ignored (commented out error handling)

---

## 7. What's Missing / Not Implemented

### 7.1. Multi-Country Support
- ❌ No NSSF (Kenya payroll scheme)
- ❌ No NHIF (Tanzania payroll scheme)
- ❌ No support for other countries' tax bands
- ❌ Ghana-only implementation

### 7.2. Tax Engine Integration
- ❌ Payroll calculation not using tax engine architecture
- ❌ No versioning/effective dates for tax rates
- ❌ Hardcoded tax bands (not in database)
- ❌ No shared versioning logic like tax engine has

### 7.3. Advanced Features
- ❌ No overtime calculations
- ❌ No pro-rata salary for partial months
- ❌ No leave deductions
- ❌ No bonus/commission calculations
- ❌ No salary advance tracking
- ❌ No loan amortization

### 7.4. Reporting
- ❌ No payroll reports (monthly summaries, annual summaries)
- ❌ No tax deduction certificates (P9 forms, etc.)
- ❌ No statutory returns (PAYE returns, SSNIT returns)

### 7.5. Data Integrity
- ❌ No validation of payroll month format
- ❌ No check if staff has basic_salary > 0 before calculating
- ❌ No validation of status transitions
- ❌ Ledger posting errors are silently ignored

---

## 8. Summary

### ✅ What Exists:
1. **Core Calculation Engine** - Ghana PAYE + SSNIT fully implemented
2. **Database Schema** - Complete tables for staff, allowances, deductions, runs, entries, payslips
3. **API Routes** - Basic CRUD for payroll runs and payslips
4. **UI Pages** - Basic payroll management interface
5. **Ledger Integration** - PostgreSQL function to post payroll to ledger

### ❌ What's Missing:
1. **Multi-Country Support** - Only Ghana implemented
2. **Tax Engine Integration** - Not using shared tax engine architecture
3. **Versioning** - No effective date support for rate changes
4. **Advanced Features** - Overtime, pro-rata, leaves, bonuses not supported
5. **Reporting** - No payroll reports or statutory returns

### 🔍 Key Assumptions for Future Development:
1. **Business-scoped payroll runs** - One run per business per month
2. **Employee-level compensation** - Basic salary, allowances, deductions per employee
3. **Recurring-only calculations** - Only recurring allowances/deductions included
4. **Status workflow** - draft → approved → locked
5. **Ledger posting on approval** - Journal entry created when approved

---

## 9. Recommendations for Payroll Engine

If introducing a payroll engine (similar to tax engine architecture):

1. **Create shared payroll calculation engine** (`lib/payrollEngine/`)
   - Country-specific engines (Ghana, Kenya, Tanzania)
   - Versioned rates with effective dates
   - Integration with tax engine for PAYE calculations

2. **Extend database schema**
   - Add `payroll_rates` table for versioned tax/contribution rates
   - Add `effective_date` columns to payroll runs
   - Add country code to staff table

3. **Refactor existing code**
   - Replace `lib/ghanaPayeEngine.ts` with engine architecture
   - Use shared versioning logic for rates
   - Integrate with tax engine for PAYE calculations

4. **Add multi-country support**
   - Implement NSSF for Kenya
   - Implement NHIF for Tanzania
   - Extend to other Tier 1/2 countries

---

**Analysis Date**: 2024-01-XX  
**Codebase Version**: Current state (post-tax-engine-implementation)
