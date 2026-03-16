# Accounting Period Control - Phase 1 Audit Report

**Date:** 2025-01-27  
**Audit Type:** Read-Only Assessment  
**Purpose:** Determine existing implementation before building Accounting Mode - Phase 1 (Period Control)

---

## A. Existing Tables / Migrations Found

### 1. `accounting_periods` Table

**Location:** `supabase/migrations/094_accounting_periods.sql`  
**Status:** ✅ ACTIVE (but schema mismatch with application code)

**Schema (Current Database):**
```sql
CREATE TABLE accounting_periods (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id),
  period_start DATE NOT NULL,  -- First day of month (enforced)
  period_end DATE NOT NULL,    -- Last day of same month (enforced)
  status TEXT NOT NULL CHECK (status IN ('open','soft_closed','locked')),
  closed_at TIMESTAMP WITH TIME ZONE,
  closed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (business_id, period_start)
)
```

**Key Constraints:**
- `period_start` must be first day of month (YYYY-MM-01)
- `period_end` must be last day of same month
- Status values: `'open'`, `'soft_closed'`, `'locked'` only
- **NO `period_id` column** (removed from earlier version)
- **NO `locked_at` or `locked_by` columns** (status change tracked via `closed_at`)

**Purpose:** Controls ledger posting by month. Blocks posting to locked periods.

**Migration History:**
- Migration 084 (`084_create_accounting_periods.sql`): Initial implementation with `period_id`, status `'open'/'closing'/'closed'/'locked'`
- Migration 094 (`094_accounting_periods.sql`): **DROPS and RECREATES** table with simplified schema
  - Removed: `period_id`, `locked_at`, `locked_by`, `closing`/`closed` statuses
  - Simplified to: `'open'/'soft_closed'/'locked'`
  - Uses `period_start` as unique key (first day of month)

---

### 2. `accounting_period_actions` Table (Audit Trail)

**Location:** `supabase/migrations/102_accounting_period_actions_audit.sql`  
**Status:** ✅ ACTIVE

**Schema:**
```sql
CREATE TABLE accounting_period_actions (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL,
  period_start DATE NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('soft_close', 'lock')),
  performed_by UUID NOT NULL,
  performed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
```

**Purpose:** Audit trail for period close/lock actions by accountants.

---

### 3. `reconciliation_periods` Table (Separate Concern)

**Location:** `supabase/migrations/045_reconciliation.sql`, `049_combined_reconciliation_assets_payroll_vat.sql`  
**Status:** ✅ ACTIVE (but different purpose)

**Schema:**
```sql
CREATE TABLE reconciliation_periods (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id),  -- Account-specific
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  opening_balance NUMERIC,
  bank_ending_balance NUMERIC,
  system_ending_balance NUMERIC,
  difference NUMERIC,
  reconciled_by UUID,
  reconciled_at TIMESTAMP WITH TIME ZONE,
  notes TEXT
)
```

**Purpose:** Bank account reconciliation periods (account-specific, not business-wide accounting periods).  
**Conflicts:** ✅ NONE - Separate domain (bank reconciliation vs. accounting period control)

---

### 4. Dropped/Removed Tables (From Migration 094)

**Migration 094 explicitly DROPS these tables from earlier implementation:**
- `period_summary` (was from migration 084)
- `period_opening_balances` (was from migration 086)
- `period_closing_balances` (was from migration 086)
- `period_account_snapshot` (was from migration 086)
- `adjustment_journals` (was from migration 087)

**Status:** ❌ REMOVED - Do not exist in current schema

---

## B. Existing Triggers / Constraints Found

### 1. Period State Enforcement Trigger

**Location:** `supabase/migrations/088_hard_db_constraints_ledger.sql`  
**Status:** ✅ ACTIVE (but checks for wrong status values)

**Trigger:** `trigger_enforce_period_state_on_entry`  
**Function:** `enforce_period_state_on_entry()`  
**Affected Table:** `journal_entries`  
**What it blocks:**
- Checks period status on INSERT to `journal_entries`
- **ISSUE:** Function `validate_period_open_for_entry()` checks `status != 'open'`, but database has `'soft_closed'` not `'closed'`
- **ISSUE:** If no period exists, allows entry (backwards compatibility mode)

**Code:**
```sql
IF period_record.status != 'open' THEN
  RAISE EXCEPTION 'Cannot insert journal entry into period with status %...', period_record.status;
END IF;
```

**Enforcement:** Blocks journal entries into non-open periods.

---

### 2. Application-Level Period Guards

**Location:** `supabase/migrations/094_accounting_periods.sql`  
**Status:** ✅ ACTIVE

**Function:** `assert_accounting_period_is_open(business_id, date)`  
**What it blocks:**
- Called in all posting functions: `post_invoice_to_ledger()`, `post_bill_to_ledger()`, `post_expense_to_ledger()`, `post_sale_to_ledger()`, `post_credit_note_to_ledger()`
- Raises exception if `status = 'locked'`
- Allows `'open'` and `'soft_closed'` (soft_closed allows posting)

**Code:**
```sql
IF period_record.status = 'locked' THEN
  RAISE EXCEPTION 'Accounting period is locked. Post an adjustment in a later open period.';
END IF;
```

**Enforcement:** Application-level check before posting to ledger.

---

### 3. Period Validation Trigger

**Location:** `supabase/migrations/084_create_accounting_periods.sql`  
**Status:** ❓ UNCLEAR (may be replaced by migration 094)

**Trigger:** `trigger_validate_accounting_period`  
**Function:** `trigger_validate_accounting_period()`  
**Affected Table:** `accounting_periods`  
**What it enforces:**
- Validates date ranges
- Checks for overlapping periods
- Validates status transitions (but uses OLD status values: `'open'/'closing'/'closed'/'locked'`)

**Conflicts:** 
- ⚠️ Migration 094 drops and recreates `accounting_periods` table but does NOT recreate this trigger
- ⚠️ Status transition validation in this trigger references `'closing'/'closed'` which don't exist in current schema

---

### 4. Period Auto-Creation Function

**Location:** `supabase/migrations/094_accounting_periods.sql`  
**Status:** ✅ ACTIVE

**Function:** `ensure_accounting_period(business_id, date)`  
**Purpose:** Auto-creates period if it doesn't exist (on-demand period creation)  
**Behavior:** 
- Resolves month from date
- Creates period with `status = 'open'` if not exists
- Returns existing period if found

**Usage:** Called by `assert_accounting_period_is_open()` before checking status.

---

## C. Existing API / UI Artifacts

### 1. API Routes

#### `/api/accounting/periods` (GET)

**File:** `app/api/accounting/periods/route.ts`  
**Status:** ✅ ACTIVE  
**Purpose:** List accounting periods for a business  
**Features:**
- Requires accountant access check (`can_accountant_access_business`)
- Returns periods with `closed_by_user` info
- Orders by `period_start` descending

**Issues:** ✅ None apparent

---

#### `/api/accounting/periods/close` (POST)

**File:** `app/api/accounting/periods/close/route.ts`  
**Status:** ✅ ACTIVE  
**Purpose:** Soft-close or lock a period  
**Features:**
- Validates `action IN ('soft_close', 'lock')`
- Validates `period_start` is first day of month
- Requires accountant write access (`is_user_accountant_write`)
- Validates status transitions: `'open' -> 'soft_closed'`, `'soft_closed' -> 'locked'`
- Creates audit record in `accounting_period_actions`
- Sets `closed_at` and `closed_by` on period

**Issues:** ✅ None apparent

---

#### `/api/accounts/year-end-close` (POST)

**File:** `app/api/accounts/year-end-close/route.ts`  
**Status:** ✅ ACTIVE (but different purpose)  
**Purpose:** Year-end closing journal entry (post net income to retained earnings)  
**Conflicts:** ✅ NONE - Different feature (closing entry, not period locking)

---

### 2. UI Pages

#### `/accounting/periods`

**File:** `app/accounting/periods/page.tsx`  
**Status:** ✅ ACTIVE (read-only view)  
**Purpose:** Display accounting periods with status badges  
**Features:**
- Lists all periods for business
- Shows status badges (Open, Soft Closed, Locked)
- Displays `closed_at` and `closed_by` info
- Read-only (no action buttons visible)

**Issues:** 
- ⚠️ **Read-only only** - No buttons to close/lock periods (UI incomplete)
- ⚠️ UI exists but lacks Phase-1 functionality (view-only)

---

### 3. Application Library Code

#### `lib/accountingPeriods/`

**Files:**
- `lib/accountingPeriods/types.ts` - TypeScript types
- `lib/accountingPeriods/lifecycle.ts` - Lifecycle management functions
- `lib/accountingPeriods/carryForward.ts` - Carry-forward logic
- `lib/accountingPeriods/index.ts` - Exports

**Status:** ⚠️ **SCHEMA MISMATCH WITH DATABASE**

**Issues Found:**

1. **Status Values Mismatch:**
   - Library defines: `'open' | 'closing' | 'closed' | 'locked'`
   - Database has: `'open' | 'soft_closed' | 'locked'`
   - Library has `'closing'` and `'closed'` which don't exist in database

2. **Column Mismatch:**
   - Library `types.ts` defines `period_id: string` field
   - Database schema (migration 094) has **NO `period_id` column** (uses `period_start` as key)

3. **Function References:**
   - `lifecycle.ts` references functions like `update_accounting_period_status()` from migration 084
   - Migration 094 does NOT recreate this function (uses direct UPDATE instead)

**Impact:** ⚠️ Application library code is **incompatible with current database schema**

---

## D. Conflicts or Risks

### 1. **CRITICAL: Schema Mismatch Between Application Code and Database**

**Risk Level:** 🔴 HIGH  
**Issue:**
- Database (migration 094): `status IN ('open','soft_closed','locked')`, no `period_id`, no `locked_at`/`locked_by`
- Application code (`lib/accountingPeriods/`): References `'closing'/'closed'` statuses, expects `period_id` column, expects `locked_at`/`locked_by`

**Impact:**
- TypeScript compilation may pass (if types not strictly enforced)
- Runtime errors when code queries for `period_id` or `'closing'/'closed'` status
- Functions in `lifecycle.ts` may fail if they call missing database functions

**Evidence:**
- Migration 094 explicitly DROPS old table and recreates with different schema
- Library code not updated to match migration 094 schema

---

### 2. **Missing Trigger on Period Validation**

**Risk Level:** 🟡 MEDIUM  
**Issue:**
- Migration 084 created `trigger_validate_accounting_period` on `accounting_periods`
- Migration 094 DROPS the table but does NOT recreate the trigger
- Status transition validation may not be enforced at DB level

**Impact:**
- Invalid status transitions could be allowed if API bypasses checks
- Period overlap validation may not be enforced

---

### 3. **Application-Level Guards vs Database Triggers**

**Risk Level:** 🟡 MEDIUM  
**Issue:**
- Database trigger (`enforce_period_state_on_entry`) checks `status != 'open'`
- Application guard (`assert_accounting_period_is_open`) allows `'soft_closed'`
- **Inconsistency:** Database trigger blocks `'soft_closed'`, but application allows it

**Impact:**
- Direct SQL inserts may fail even if application logic allows
- Application may show "can post" but database rejects

**Evidence:**
```sql
-- Database trigger (088_hard_db_constraints_ledger.sql):
IF period_record.status != 'open' THEN RAISE EXCEPTION...

-- Application guard (094_accounting_periods.sql):
IF period_record.status = 'locked' THEN RAISE EXCEPTION...  -- Allows 'soft_closed'
```

---

### 4. **Auto-Creation vs Explicit Period Management**

**Risk Level:** 🟢 LOW  
**Issue:**
- `ensure_accounting_period()` auto-creates periods on-demand
- No explicit "create period" API endpoint
- Periods may be created implicitly when posting

**Impact:**
- Periods created automatically may not match intended business process
- No control over period creation timing

---

### 5. **Reconciliation Periods vs Accounting Periods**

**Risk Level:** 🟢 LOW (No conflict, different purposes)  
**Clarification:**
- `reconciliation_periods` = Bank account reconciliation (account-specific)
- `accounting_periods` = Accounting period control (business-wide)
- Separate domains, no conflict

---

### 6. **Legacy Year-End Close API**

**Risk Level:** 🟢 LOW (No conflict, different purpose)  
**Clarification:**
- `/api/accounts/year-end-close` = Creates closing journal entry (posting)
- Accounting periods = Period status control (locking)
- Different features, no conflict

---

## E. Clear Verdict

### 🟡 **PARTIAL EXISTS — EXTEND / FIX**

**Rationale:**

1. **✅ Core Infrastructure Exists:**
   - `accounting_periods` table exists with correct structure for Phase 1
   - Period guards exist (application-level)
   - API routes exist for listing and closing periods
   - UI page exists (read-only view)

2. **⚠️ Schema Mismatch Requires Fix:**
   - Application library code (`lib/accountingPeriods/`) does not match database schema
   - Status values differ: library has `'closing'/'closed'`, database has `'soft_closed'`
   - Missing columns: library expects `period_id`, `locked_at`, `locked_by` which don't exist

3. **⚠️ Incomplete Implementation:**
   - UI is read-only (no close/lock actions)
   - Database trigger may not be correctly enforcing status checks
   - Status transition validation trigger missing

4. **✅ Good Foundation:**
   - Migration 094 provides clean, simplified schema
   - Application guards in posting functions are active
   - Audit trail table exists

**Recommendations:**

1. **Before Building Phase 1:**
   - ✅ Update `lib/accountingPeriods/types.ts` to match migration 094 schema
   - ✅ Remove references to `period_id`, `locked_at`, `locked_by` columns
   - ✅ Change status types from `'closing'/'closed'` to `'soft_closed'`
   - ✅ Verify/recreate period validation trigger if needed
   - ✅ Fix database trigger to allow `'soft_closed'` if application logic allows it

2. **Phase 1 Implementation:**
   - ✅ Add UI buttons for close/lock actions (API already exists)
   - ✅ Complete period management UI
   - ✅ Ensure consistency between application guards and database triggers
   - ✅ Test period locking blocks posting correctly

3. **Risk Mitigation:**
   - ⚠️ Test that posting functions correctly block locked periods
   - ⚠️ Verify status transition validation works
   - ⚠️ Ensure period auto-creation doesn't conflict with explicit management

---

## Summary

**Database Schema:** ✅ Good foundation (migration 094)  
**API Routes:** ✅ Exist but need UI integration  
**UI Pages:** ⚠️ Incomplete (read-only)  
**Application Code:** ⚠️ Schema mismatch requires fix  
**Database Triggers:** ⚠️ Inconsistent with application logic  
**Overall:** 🟡 **EXTEND existing implementation after fixing schema mismatches**

---

**End of Audit Report**
