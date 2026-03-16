# Accounting Workspace Architectural Audit

**Date:** 2025-01-27  
**Type:** Read-Only Architectural Assessment  
**Purpose:** Identify existing infrastructure supporting an authoritative Accounting Workspace and separate it from Service workspace accounting mode

---

## Executive Summary

This audit examines the Finza codebase to identify:
1. Existing ledger/journal infrastructure
2. Service workspace accounting boundaries
3. Period/date handling mechanisms
4. Tax engine authority and posting logic
5. Reporting foundations
6. Role-based permissions
7. Hardcoded values and mapping risks
8. Audit trail coverage
9. Accounting Workspace readiness

**Critical Finding:** The system has a well-established dual-entry ledger system (`journal_entries`, `journal_entry_lines`) with hard database constraints enforcing immutability. However, Service workspace posting functions are tightly coupled to specific account codes, and some hardcoded account mappings exist.

---

## 1. Ledger & Journals (System of Record)

### 1.1 Tables / Models

**Primary Ledger Tables:**

1. **`journal_entries`** (Canonical source)
   - **File:** `supabase/migrations/043_accounting_core.sql` (lines 30-39)
   - **Schema:**
     - `id` UUID PRIMARY KEY
     - `business_id` UUID (references businesses)
     - `date` DATE NOT NULL
     - `description` TEXT NOT NULL
     - `reference_type` TEXT (e.g., 'invoice', 'payment', 'expense', 'manual', 'adjustment')
     - `reference_id` UUID (ID of related record)
     - `created_at` TIMESTAMP WITH TIME ZONE
     - `created_by` UUID (references auth.users)
   - **Indexes:** business_id, date, (reference_type, reference_id)

2. **`journal_entry_lines`** (Canonical source)
   - **File:** `supabase/migrations/043_accounting_core.sql` (lines 49-57)
   - **Schema:**
     - `id` UUID PRIMARY KEY
     - `journal_entry_id` UUID (references journal_entries, CASCADE DELETE)
     - `account_id` UUID (references accounts, RESTRICT DELETE)
     - `debit` NUMERIC DEFAULT 0
     - `credit` NUMERIC DEFAULT 0
     - `description` TEXT
     - `created_at` TIMESTAMP WITH TIME ZONE
   - **Indexes:** journal_entry_id, account_id

3. **`accounts`** (Chart of Accounts)
   - **File:** `supabase/migrations/043_accounting_core.sql` (lines 7-19)
   - **Schema:**
     - `id` UUID PRIMARY KEY
     - `business_id` UUID
     - `name` TEXT NOT NULL
     - `code` TEXT NOT NULL (e.g., '1000', '2100')
     - `type` TEXT CHECK (IN ('asset', 'liability', 'equity', 'income', 'expense'))
     - `description` TEXT
     - `is_system` BOOLEAN DEFAULT FALSE
     - `is_reconcilable` BOOLEAN DEFAULT FALSE
     - `created_at`, `updated_at` TIMESTAMP WITH TIME ZONE
     - `deleted_at` TIMESTAMP WITH TIME ZONE (soft delete)
   - **Constraint:** UNIQUE(business_id, code)

4. **`ledger_entries`** (Legacy table - appears unused)
   - **File:** `supabase/migrations/034_service_invoice_system_complete.sql` (lines 442-451)
   - **Status:** ⚠️ **LEGACY - appears to be superseded by journal_entries system**
   - **Note:** Migration 043 introduced `journal_entries`/`journal_entry_lines` structure

### 1.2 Ledger Mutability

**Status:** ✅ **APPEND-ONLY (Immutable)**

**Enforcement:**
- **File:** `supabase/migrations/088_hard_db_constraints_ledger.sql` (lines 21-58)
- **Constraints:**
  - `journal_entries`: UPDATE/DELETE blocked via database trigger
  - `journal_entry_lines`: UPDATE/DELETE blocked via database trigger
  - **Trigger Functions:**
    - `prevent_journal_entry_modification()` (lines 21-31)
    - `prevent_journal_entry_line_modification()` (lines 42-52)
  - **Exception Message:** "Journal entries are immutable (append-only). Cannot UPDATE/DELETE journal entry. Use adjustment journals for corrections."

**Soft Delete:** ❌ **NOT USED** - No `deleted_at` column on `journal_entries` or `journal_entry_lines`

**Safe to Reuse:** ✅ **YES** - This is the canonical ledger structure

### 1.3 Constraints Enforcing Double-Entry

**Status:** ✅ **HARD ENFORCED**

1. **Debit = Credit Validation**
   - **Function:** `post_journal_entry()` in `supabase/migrations/043_accounting_core.sql` (lines 141-189)
   - **Validation:** Tolerance 0.01
   - **Code:** Lines 157-166 (validates before insert)
   
2. **Database-Level Balance Enforcement**
   - **File:** `supabase/migrations/088_hard_db_constraints_ledger.sql` (lines 115-151)
   - **Trigger:** `enforce_double_entry_balance()` 
   - **Enforcement:** AFTER INSERT trigger on `journal_entry_lines`
   - **Tolerance:** 0.01

3. **Required Source Typing**
   - **Field:** `reference_type` in `journal_entries` table
   - **Values observed:** 'invoice', 'payment', 'expense', 'credit_note', 'bill', 'bill_payment', 'manual', 'adjustment', 'sale'
   - **Constraint:** TEXT (no CHECK constraint - values are application-level)

**Safe to Reuse:** ✅ **YES** - Hard constraints are database-enforced

### 1.4 Journal Types and Creation Sources

**Journal Types by `reference_type`:**

1. **'invoice'**
   - **Function:** `post_invoice_to_ledger(p_invoice_id UUID)`
   - **File:** `supabase/migrations/043_accounting_core.sql` (lines 194-316)
   - **Trigger:** `trigger_auto_post_invoice` (lines 929-950)
   - **Trigger Condition:** Invoice status changes to 'sent', 'paid', or 'partially_paid'
   - **Created from:** Service workspace invoice creation/update

2. **'payment'** (Invoice payment settlement)
   - **Function:** `post_invoice_payment_to_ledger(p_payment_id UUID)`
   - **Files:** Multiple migrations (091, 100, etc.)
   - **Created from:** Service workspace payment creation

3. **'expense'**
   - **Function:** `post_expense_to_ledger(p_expense_id UUID)`
   - **File:** `supabase/migrations/094_accounting_periods.sql` (lines 378-500)
   - **Created from:** Service workspace expense creation

4. **'sale'** (POS/Retail)
   - **Function:** `post_sale_to_ledger(p_sale_id UUID)`
   - **File:** `supabase/migrations/043_accounting_core.sql` (lines 798-922)
   - **Created from:** Retail/POS workspace

5. **'adjustment'**
   - **Function:** `apply_adjusting_journal()` (Manual)
   - **File:** `supabase/migrations/137_adjusting_journals_phase2e.sql` (lines 26-150)
   - **Created from:** Accounting workspace (manual adjusting journals)
   - **Restriction:** Only 'open' periods allowed

6. **'bill'** / **'bill_payment'**
   - **Functions:** `post_bill_to_ledger()`, `post_bill_payment_to_ledger()`
   - **Status:** Referenced in codebase but implementation not fully audited

7. **Payroll**
   - **Function:** `post_payroll_run_to_ledger()`
   - **File:** `supabase/migrations/047_payroll_system.sql` (referenced)
   - **Created from:** Payroll runs

**Manual Entries:** ✅ **EXISTS** - Via `apply_adjusting_journal()` function (Accounting workspace only)

**What is Safe to Reuse:**
- ✅ `journal_entries` / `journal_entry_lines` table structure
- ✅ `post_journal_entry()` core function
- ✅ Double-entry validation logic

**What Must NOT be Touched:**
- ❌ Service workspace posting functions (`post_invoice_to_ledger`, `post_payment_to_ledger`, etc.) - These are tightly coupled to Service workspace flow

---

## 2. Service Workspace "Accounting Mode" Boundary

### 2.1 Service Workspace Accounting Responsibilities

**Service workspace calculates tax:**
- **Location:** `app/api/invoices/create/route.ts` (referenced in `CURRENT_TAX_ARCHITECTURE_ANALYSIS.md`)
- **Engine:** `lib/taxEngine/index.ts` (canonical tax engine)
- **Storage:** `tax_lines` JSONB column on invoices table
- **Format:** Canonical `tax_lines` JSONB with `ledger_account_code` and `ledger_side` metadata

**Service workspace posts accounting entries:**
- **Functions:**
  1. `post_invoice_to_ledger()` - Auto-triggered on invoice status change
  2. `post_invoice_payment_to_ledger()` - On payment creation
  3. `post_expense_to_ledger()` - On expense creation
- **All posting functions read from Service workspace tables (invoices, payments, expenses)**
- **Posting uses tax_lines JSONB metadata for tax account mapping**

**Service workspace displays balances/reports:**
- **Location:** `/app/reports/` routes (legacy reports)
- **Files:**
  - `app/reports/profit-loss/route.ts`
  - `app/reports/balance-sheet/route.ts`
  - `app/reports/trial-balance/route.ts`
- **Status:** ⚠️ **LEGACY** - Separate from Accounting workspace reports

### 2.2 Boundary Risks

**Code paths where Service edits ledger data:**
- ❌ **NONE FOUND** - Ledger is append-only (hard constraints block UPDATE/DELETE)

**Code paths where Service backdates entries:**
- ⚠️ **POTENTIAL RISK** - Invoice `issue_date` is used as journal entry date
  - **File:** `supabase/migrations/043_accounting_core.sql` (line 307)
  - **Code:** `invoice_record.issue_date` used in `post_journal_entry()` call
  - **Risk:** Service workspace can create invoices with past dates, which will post to ledger with those dates
  - **Mitigation:** Period enforcement triggers (migration 088) block posting to locked periods

**Code paths bypassing validation:**
- ❌ **NONE FOUND** - All posting goes through `post_journal_entry()` which enforces balance

**Service Accounting Responsibilities Summary:**
- ✅ Calculates tax (via tax engine)
- ✅ Stores tax in canonical `tax_lines` format
- ✅ Posts to ledger via database functions
- ✅ Uses account codes resolved via `get_account_by_code()` function
- ⚠️ **Boundary Risk:** Service controls invoice dates, which become journal entry dates

**What Must NOT be Touched:**
- ❌ Service workspace posting functions (`post_invoice_to_ledger`, `post_payment_to_ledger`, `post_expense_to_ledger`)
- ❌ Service workspace tax calculation (in `app/api/invoices/create/route.ts`)
- ❌ Service workspace invoice/expense/payment tables (these are source of truth for Service)

---

## 3. Period / Date Handling

### 3.1 Accounting Periods

**Table:** `accounting_periods`
- **File:** `supabase/migrations/094_accounting_periods.sql` (lines 25-35)
- **Schema:**
  - `id` UUID PRIMARY KEY
  - `business_id` UUID
  - `period_start` DATE NOT NULL (first day of month)
  - `period_end` DATE NOT NULL (last day of month)
  - `status` TEXT CHECK (IN ('open', 'soft_closed', 'locked'))
  - `closed_at` TIMESTAMP WITH TIME ZONE
  - `closed_by` UUID (references auth.users)
  - `created_at` TIMESTAMP WITH TIME ZONE
  - **Constraint:** UNIQUE(business_id, period_start)

**Period States (Canonical):**
- **🟢 Open:** New ledger entries allowed, payments can be posted, adjustments allowed
- **🟡 Soft Closed:** Ledger entries still allowed (soft close allows posting)
- **🔴 Locked:** Immutable forever, ledger posting BLOCKED

**Lifecycle Documentation:**
- **File:** `lib/accountingPeriods/types.ts` (lines 1-34)
- **File:** `lib/accountingPeriods/lifecycle.ts` (lines 1-138)

### 3.2 Date Locks & Closing Flags

**Enforcement:**
- **File:** `supabase/migrations/088_hard_db_constraints_ledger.sql` (lines 196-251)
- **Function:** `validate_period_open_for_entry(p_business_id UUID, p_date DATE)`
- **Trigger:** `enforce_period_state_on_entry()` (BEFORE INSERT on `journal_entries`)
- **Logic:**
  - Finds period for journal entry date
  - Blocks posting if period status = 'locked'
  - Allows posting if period status = 'open' or 'soft_closed'
  - If no period exists, allows entry (backwards compatibility)

### 3.3 Backdating Prevention

**Status:** ⚠️ **PARTIALLY ENFORCED**

**Enforcement Level:**
- **Database Level:** ✅ Blocks posting to locked periods (hard constraint)
- **Application Level:** ⚠️ No explicit prevention of backdating to open periods
- **Period Status:** ✅ Locked periods block all new entries (hard constraint)

**Retroactive Changes:**
- ✅ **Allowed via adjusting journals** (`apply_adjusting_journal()`)
- ✅ **Restriction:** Adjusting journals can ONLY be posted to 'open' periods
- ✅ **File:** `supabase/migrations/137_adjusting_journals_phase2e.sql` (line 61)

**Summary:**
- ✅ Period logic exists and is database-enforced
- ✅ Locked periods block posting (hard constraint)
- ⚠️ Backdating to open periods is not prevented (may be by design)
- ✅ Retroactive corrections via adjusting journals (open periods only)

**What is Safe to Reuse:**
- ✅ `accounting_periods` table structure
- ✅ Period validation functions
- ✅ Period state enforcement triggers

---

## 4. Tax Engine & Posting Authority

### 4.1 Tax Calculation

**Tax Engine Location:**
- **File:** `lib/taxEngine/index.ts` (referenced in documentation)
- **Jurisdiction Plugins:** `lib/taxEngine/jurisdictions/` (ghana.ts, kenya.ts, etc.)
- **Status:** ✅ **Centralized tax engine**

**Service Workspace Tax Calculation:**
- **Entry Point:** `app/api/invoices/create/route.ts`
- **Function:** `calculateTaxes()` from tax engine
- **Storage Format:** `tax_lines` JSONB column
- **Metadata:** Includes `ledger_account_code` and `ledger_side` for posting

### 4.2 Tax Storage

**Canonical Format:**
- **Column:** `tax_lines` JSONB on invoices/expenses/sales tables
- **Structure:** (from `SERVICE_MODE_FREEZE_CONFIRMATION.md` lines 23-44)
  ```json
  {
    "lines": [
      {
        "code": "VAT",
        "amount": 15.90,
        "rate": 0.15,
        "name": "VAT",
        "meta": {
          "ledger_account_code": "2100",
          "ledger_side": "credit"
        }
      }
    ],
    "meta": {
      "jurisdiction": "GH",
      "effective_date_used": "2025-12-31",
      "engine_version": "GH-2025-A"
    },
    "pricing_mode": "inclusive"
  }
  ```

### 4.3 Tax Posting to Ledger

**Posting Functions Read Tax Metadata:**
- **File:** `supabase/migrations/043_accounting_core.sql`
- **Function:** `post_invoice_to_ledger()` (lines 234-302)
- **Logic:**
  - Reads `tax_lines` JSONB from invoice
  - Extracts `ledger_account_code` and `ledger_side` from each tax line
  - Posts each tax line to its control account
  - Uses `get_account_by_code()` to resolve account ID

**Tax Posting Authority:**
- ✅ **System-generated only** - Tax postings are automatic via database functions
- ✅ **Not manually adjustable** - Tax lines are read from source documents (invoices/expenses)
- ❌ **Editable after posting:** NO - Ledger is immutable (adjustments create new entries)

**Tax Logic Centralization:**
- ✅ **Centralized:** Tax calculation via `lib/taxEngine/`
- ✅ **Canonical format:** `tax_lines` JSONB with metadata
- ✅ **Posting abstraction:** Posting functions read metadata, not hardcoded rates

**Control Accounts Used:**
- **2100:** VAT Payable (system account)
- **2110:** NHIL Payable (system account)
- **2120:** GETFund Payable (system account)
- **2130:** COVID Levy Payable (system account)
- **2200:** Other Tax Liabilities (system account)

**File References:**
- Tax posting logic: `supabase/migrations/043_accounting_core.sql` (lines 271-302)
- Tax account creation: `supabase/migrations/043_accounting_core.sql` (lines 80-86)
- Tax engine: `lib/taxEngine/` directory

**What is Safe to Reuse:**
- ✅ Tax engine (`lib/taxEngine/`)
- ✅ `tax_lines` JSONB format
- ✅ Tax posting logic (reads metadata, not hardcoded)

**What Must NOT be Touched:**
- ❌ Service workspace tax calculation flow
- ❌ Tax posting functions (tightly coupled to Service workspace)

---

## 5. Reporting & AFS Foundations

### 5.1 Financial Reports

**Accounting Workspace Reports (New):**
- **Location:** `app/api/accounting/reports/`
- **Reports:**
  1. **Trial Balance:** `app/api/accounting/reports/trial-balance/route.ts`
  2. **General Ledger:** `app/api/accounting/reports/general-ledger/route.ts`
  3. **Profit & Loss:** `app/api/accounting/reports/profit-and-loss/route.ts`
  4. **Balance Sheet:** `app/api/accounting/reports/balance-sheet/route.ts`
- **Database Functions:**
  - `get_trial_balance()` - Migration 138
  - `get_general_ledger()` - Migration 138
  - `get_profit_and_loss()` - Migration 138
  - `get_balance_sheet()` - Migration 138
- **File:** `supabase/migrations/138_financial_reports_phase3.sql`

**Legacy Service Reports:**
- **Location:** `app/api/reports/`
- **Reports:**
  - `app/api/reports/trial-balance/route.ts`
  - `app/api/reports/profit-loss/route.ts`
  - `app/api/reports/balance-sheet/route.ts`
- **Status:** ⚠️ **LEGACY** - Separate from Accounting workspace

### 5.2 Report Data Source

**Accounting Workspace Reports:**
- ✅ **Ledger-derived:** All reports query `journal_entries` + `journal_entry_lines` + `accounts`
- ✅ **Period-aware:** Reports accept `period_start` or date ranges
- ✅ **Functions:** Database functions in migration 138

**Legacy Reports:**
- ⚠️ **Not fully audited** - May query different sources

### 5.3 Export Capabilities

**CSV/PDF Exports:**
- **Location:** `app/api/accounting/reports/*/export/csv/route.ts` and `/export/pdf/route.ts`
- **Reports:** Trial Balance, General Ledger, Profit & Loss, Balance Sheet
- **File Reference:** `ACCOUNTING_MODE_PHASE3_2_EXPORT_REPORT.md`
- **Status:** ✅ **EXISTS**

### 5.4 AFS-like Exports

**Tax Return Exports:**
- **Location:** `app/api/accounting/exports/`
- **Files:**
  - `app/api/accounting/exports/vat/route.ts`
  - `app/api/accounting/exports/levies/route.ts`
  - `app/api/accounting/exports/transactions/route.ts`
- **Status:** ✅ **EXISTS** (referenced in codebase)

### 5.5 COA → Report Mapping Logic

**Account Type Mapping:**
- **File:** `supabase/migrations/138_financial_reports_phase3.sql`
- **Trial Balance:** All account types (asset, liability, equity, income, expense)
- **Profit & Loss:** Income and expense accounts only
- **Balance Sheet:** Asset, liability, equity accounts
- **Mapping:** Account `type` column determines report inclusion

**COA Visibility:**
- **File:** `app/api/accounting/coa/route.ts`
- **Status:** ✅ **EXISTS** - Read-only COA API endpoint

**What is Safe to Reuse:**
- ✅ Accounting workspace report functions (migration 138)
- ✅ Export infrastructure (CSV/PDF)
- ✅ COA API endpoint

**What is Missing for Auto AFS:**
- ⚠️ **Not fully audited** - AFS export format requirements not assessed in detail

---

## 6. Permissions & Roles

### 6.1 Roles

**Role System:**
- **File:** `lib/userRoles.ts`
- **File:** `lib/accessControl.ts`
- **Roles:**
  - `owner` - Business owner (highest authority)
  - `admin` - Admin user
  - `manager` - Manager (limited admin access)
  - `cashier` - POS-only access
  - `employee` - Employee access
  - `accountant` - Accountant role (for period management)
  - `accountant_readonly` - Read-only accountant access (flag on business_users table)

**Role Storage:**
- **Table:** `business_users` (role column)
- **Special Case:** `owner` role derived from `businesses.owner_id` (not in business_users)

### 6.2 Role Capabilities

**Owner:**
- ✅ Full access (all workspaces)
- ✅ Can create entries
- ✅ Can edit entries (where allowed)
- ✅ Can approve entries
- ✅ Can lock/close periods (via `isUserAccountant()` check)
- ✅ Can override system behavior

**Admin:**
- ✅ Full access (all workspaces)
- ✅ Can create entries
- ✅ Can edit entries (where allowed)
- ✅ Can approve entries
- ✅ Can lock/close periods (if also has accountant role)
- ✅ Limited override authority

**Accountant:**
- ✅ Can access accounting workspace
- ✅ Can create adjusting journals
- ✅ Can lock/close periods (via `isUserAccountant()` function)
- ⚠️ **Read-only access:** `accountant_readonly` flag restricts to read-only accounting routes

**Manager:**
- ✅ Can access service/retail workspaces
- ❌ Cannot access admin-only settings
- ❌ Cannot lock/close periods

**Cashier:**
- ✅ POS-only access
- ❌ Cannot access accounting workspace

### 6.3 Accounting Workspace Access Control

**File:** `lib/accessControl.ts` (lines 144-169)
- **Accounting Workspace:** `/accounting/*` routes
- **Accountant Readonly:** Restricts to specific accounting routes only
- **Allowed Routes for Readonly:** `/accounting`, `/accounting/ledger`, `/accounting/trial-balance`, `/accounting/periods`

**Period Management:**
- **File:** `lib/userRoles.ts` (lines 54-66)
- **Function:** `isUserAccountant()`
- **Logic:** Returns true for `owner` or `accountant` role
- **Usage:** Period closing/locking operations

**Adjusting Journals:**
- **Access Control:** Admin/owner/accountant write access
- **File:** `app/api/accounting/adjustments/route.ts` (referenced)

**What is Safe to Reuse:**
- ✅ Role system (`lib/userRoles.ts`, `lib/accessControl.ts`)
- ✅ `isUserAccountant()` function for period management
- ✅ `accountant_readonly` flag system

**Gaps vs Accounting Workspace Needs:**
- ⚠️ **Period approval workflow:** Not fully audited (may need additional roles)
- ⚠️ **Entry approval workflow:** Not fully audited (adjusting journals may need approval)

---

## 7. Hardcoded Values & Mapping Risk Check (CRITICAL)

### 7.1 Hardcoded Account Codes in Service Workspace

**Posting Functions Use Hardcoded Account Codes:**
- **File:** `supabase/migrations/043_accounting_core.sql`
- **Function:** `post_invoice_to_ledger()` (lines 254-255)
  - `get_account_by_code(business_id_val, '1100')` - AR
  - `get_account_by_code(business_id_val, '4000')` - Revenue
- **Function:** `post_payment_to_ledger()` (lines 357-360)
  - `get_account_by_code(business_id_val, '1100')` - AR
  - `get_account_by_code(business_id_val, '1000')` - Cash
  - `get_account_by_code(business_id_val, '1010')` - Bank
  - `get_account_by_code(business_id_val, '1020')` - Mobile Money
- **Function:** `post_expense_to_ledger()` (lines 439-440)
  - `get_account_by_code(business_id_val, '5100')` - Operating Expenses
  - `get_account_by_code(business_id_val, '1000')` - Cash

**Tax Account Codes:**
- ✅ **NOT HARDCODED** - Tax accounts resolved via `ledger_account_code` metadata from `tax_lines` JSONB
- **File:** `supabase/migrations/043_accounting_core.sql` (lines 276-281)
- **Logic:** Reads `tax_line_item->>'ledger_account_code'` and resolves via `get_account_by_code()`

**Control Account Resolution:**
- **File:** `supabase/migrations/100_control_account_resolution.sql`
- **Status:** ⚠️ **PARTIAL ABSTRACTION** - Some accounts use control keys (e.g., 'AP', 'CASH', 'BANK'), but account codes still referenced

### 7.2 Hardcoded Tax Rates

**Status:** ✅ **NOT HARDCODED** - Tax rates come from tax engine (`lib/taxEngine/`)
- **Service workspace uses:** `calculateTaxes()` function from tax engine
- **Tax rates:** Jurisdiction-specific plugins (ghana.ts, kenya.ts, etc.)

### 7.3 Risk Rating

**Account Code Mapping:**
- **🟡 YELLOW - Partially Abstracted**
  - Tax accounts: ✅ Abstracted (via tax_lines metadata)
  - Core accounts (AR, Revenue, Cash, Expenses): ❌ Hardcoded account codes
  - **Files:** `supabase/migrations/043_accounting_core.sql` (posting functions)
  - **Risk:** Service workspace posting functions assume specific account code structure

**Tax Rates:**
- **🟢 GREEN - Fully Abstracted**
  - Tax engine provides rates
  - No hardcoded rates in Service workspace

**Recommendation:**
- ⚠️ **CRITICAL:** Service workspace posting functions must NOT be modified
- ⚠️ **If Accounting Workspace needs different account mappings:** Create new posting functions or abstraction layer
- ✅ **Tax mapping is safe:** Uses metadata-driven approach

**Files with Hardcoded Account Codes:**
- `supabase/migrations/043_accounting_core.sql` (lines 254-255, 357-360, 439-440, 859-860)
- `supabase/migrations/094_accounting_periods.sql` (lines 439-440)
- `supabase/migrations/100_control_account_resolution.sql` (some account codes still hardcoded)

---

## 8. Audit Trail & Source Traceability Check (CRITICAL)

### 8.1 Journal Entries Audit Metadata

**`journal_entries` table:**
- ✅ `created_at` TIMESTAMP WITH TIME ZONE
- ✅ `created_by` UUID (references auth.users)
- ✅ `reference_type` TEXT (source type: 'invoice', 'payment', etc.)
- ✅ `reference_id` UUID (source record ID)
- ❌ `updated_at` - NOT PRESENT (table is immutable)
- ❌ `updated_by` - NOT PRESENT (table is immutable)

**Status:** ✅ **COMPLETE** for creation (immutable table, no updates)

### 8.2 Journal Entry Lines Audit Metadata

**`journal_entry_lines` table:**
- ✅ `created_at` TIMESTAMP WITH TIME ZONE
- ❌ `created_by` - NOT PRESENT (inherited from journal entry)
- ❌ `reference_type` / `reference_id` - NOT PRESENT (inherited from journal entry)
- ❌ `updated_at` / `updated_by` - NOT PRESENT (immutable)

**Status:** ✅ **COMPLETE** (inherits from parent journal entry)

### 8.3 Source Tables Audit Metadata

**Invoices:**
- **File:** Referenced in migrations
- **Metadata:** Standard audit fields expected (not fully audited in this review)

**Payments:**
- **Metadata:** Standard audit fields expected (not fully audited in this review)

**Expenses:**
- **Metadata:** Standard audit fields expected (not fully audited in this review)

### 8.4 Audit Log System

**Table:** `audit_logs`
- **File:** `supabase/migrations/044_audit_logging.sql` (lines 7-20)
- **Schema:**
  - `id` UUID PRIMARY KEY
  - `business_id` UUID
  - `user_id` UUID (references auth.users)
  - `action_type` TEXT (e.g., 'account.created', 'journal_entry.created')
  - `entity_type` TEXT (e.g., 'account', 'journal_entry')
  - `entity_id` UUID
  - `old_values` JSONB
  - `new_values` JSONB
  - `ip_address` TEXT
  - `user_agent` TEXT
  - `description` TEXT
  - `created_at` TIMESTAMP WITH TIME ZONE

**Journal Entry Audit Triggers:**
- **File:** `supabase/migrations/044_audit_logging.sql` (lines 645-653)
- **Function:** `audit_journal_entry_changes()`
- **Status:** ✅ **EXISTS** (referenced in migration)

### 8.5 Traceability Status

**Journal Entries:**
- ✅ **Complete:** `created_at`, `created_by`, `reference_type`, `reference_id`
- ✅ **Source traceability:** `reference_type` + `reference_id` link to source documents

**Journal Entry Lines:**
- ✅ **Complete:** Inherits from parent journal entry
- ✅ **Account traceability:** `account_id` links to accounts table

**Adjusting Journals:**
- ✅ **Complete:** `reference_type = 'adjustment'`, `created_by` set explicitly
- **File:** `supabase/migrations/137_adjusting_journals_phase2e.sql` (lines 143-145)

**Overall Status:**
- ✅ **COMPLETE** - Full audit trail exists
- ✅ **Source traceability:** `reference_type` + `reference_id` provide source links
- ✅ **User traceability:** `created_by` tracks who created entries

**Gaps vs Accounting Workspace Requirements:**
- ✅ **No gaps identified** - System has comprehensive audit metadata

---

## 9. Accounting Workspace Readiness Summary

### 9.1 What Already Exists Supporting Accounting Workspace

**Core Ledger Infrastructure:**
- ✅ `journal_entries` / `journal_entry_lines` tables (append-only, immutable)
- ✅ Hard database constraints enforcing double-entry integrity
- ✅ `post_journal_entry()` core function with balance validation
- ✅ Period control system (`accounting_periods` table)
- ✅ Period enforcement triggers (blocks posting to locked periods)

**Manual Entry Capabilities:**
- ✅ `apply_adjusting_journal()` function for manual adjusting entries
- ✅ Adjusting journals respect period controls (open periods only)

**Reporting Infrastructure:**
- ✅ Accounting workspace report functions (Trial Balance, P&L, Balance Sheet, General Ledger)
- ✅ CSV/PDF export capabilities
- ✅ COA API endpoint (`/api/accounting/coa`)
- ✅ Report functions are ledger-derived (query journal_entries/journal_entry_lines)

**Tax Engine:**
- ✅ Centralized tax engine (`lib/taxEngine/`)
- ✅ Canonical `tax_lines` JSONB format with ledger mapping metadata
- ✅ Tax posting uses metadata-driven account resolution

**Permissions:**
- ✅ Role system with `accountant` role
- ✅ `accountant_readonly` flag for read-only access
- ✅ `isUserAccountant()` function for period management
- ✅ Access control system (`lib/accessControl.ts`)

**Audit Trail:**
- ✅ Comprehensive audit metadata (`created_at`, `created_by`, `reference_type`, `reference_id`)
- ✅ Audit log system (`audit_logs` table)
- ✅ Source traceability via `reference_type` + `reference_id`

### 9.2 What Can be Safely Extended

**Safe to Extend:**
- ✅ `journal_entries` / `journal_entry_lines` structure (add new `reference_type` values)
- ✅ Accounting workspace report functions (add new reports)
- ✅ Period management functions (extend lifecycle)
- ✅ Adjusting journal workflow (add validation/approval)
- ✅ COA management (add custom accounts, maintain system accounts)
- ✅ Export formats (extend CSV/PDF, add new formats)
- ✅ Role system (add new roles, extend permissions)

**Extension Guidelines:**
- ✅ Always use `post_journal_entry()` for new posting functions
- ✅ Respect period controls (check period status)
- ✅ Use `tax_lines` metadata for tax account mapping
- ✅ Follow audit trail patterns (set `created_by`, `reference_type`)

### 9.3 What Must be Isolated (Do NOT Touch Service Code)

**Service Workspace Posting Functions (CRITICAL - DO NOT MODIFY):**
- ❌ `post_invoice_to_ledger()` - Service workspace function
- ❌ `post_invoice_payment_to_ledger()` - Service workspace function
- ❌ `post_expense_to_ledger()` - Service workspace function
- ❌ `post_sale_to_ledger()` - Retail workspace function
- **Reason:** These functions are tightly coupled to Service/Retail workspace flows and use hardcoded account codes

**Service Workspace Tax Calculation:**
- ❌ Tax calculation in `app/api/invoices/create/route.ts`
- **Reason:** Service workspace controls tax calculation flow

**Service Workspace Tables:**
- ❌ `invoices`, `payments`, `expenses`, `sales` tables
- **Reason:** These are source of truth for Service/Retail workspaces

**Service Workspace Reports (Legacy):**
- ⚠️ `app/api/reports/*` routes (legacy, separate from Accounting workspace)

### 9.4 What is Completely Missing and Must be Built New

**Missing for Accounting Workspace:**
- ⚠️ **Manual Journal Entry UI/API** - Adjusting journals exist, but general manual entry workflow may need extension
- ⚠️ **Entry Approval Workflow** - Adjusting journals may need approval before posting
- ⚠️ **Period Workflow UI** - Period creation/closing/locking UI exists, but workflow may need extension
- ⚠️ **Account Mapping Configuration** - If Accounting Workspace needs different account mappings than Service workspace
- ⚠️ **AFS Auto-Generation** - Export functions exist, but auto AFS generation may need additional logic
- ⚠️ **Multi-Period Reporting** - Reports support single period, multi-period comparisons may need extension

**Note:** Many "missing" items may already exist but were not fully audited. This list represents items that require further investigation.

### 9.5 Highest Risk Assumptions

**🔴 CRITICAL RISKS:**

1. **Service Workspace Account Code Dependencies**
   - **Risk:** Service workspace posting functions use hardcoded account codes ('1100', '4000', '5100', etc.)
   - **Impact:** Accounting Workspace cannot change account structure without breaking Service workspace
   - **Mitigation:** Accounting Workspace must use existing account codes OR create new posting abstraction layer

2. **Period Enforcement Gaps**
   - **Risk:** Backdating to open periods is not prevented (may be by design)
   - **Impact:** Accounting Workspace may need additional date validation
   - **Mitigation:** Period enforcement triggers block locked periods (hard constraint)

3. **Service Workspace Date Control**
   - **Risk:** Service workspace controls invoice dates, which become journal entry dates
   - **Impact:** Service workspace can create entries with past dates (in open periods)
   - **Mitigation:** Period enforcement prevents posting to locked periods

4. **Ledger Immutability Assumptions**
   - **Risk:** System assumes ledger is append-only (hard constraints enforce this)
   - **Impact:** Any changes require new entries (adjusting journals)
   - **Mitigation:** ✅ Well-enforced via database triggers

**🟡 MEDIUM RISKS:**

5. **Tax Account Mapping**
   - **Risk:** Tax accounts resolved via metadata (lower risk, but still dependent on tax engine metadata structure)
   - **Impact:** Changes to tax engine metadata format could break posting
   - **Mitigation:** ✅ Metadata-driven approach is well-abstracted

6. **Role System Extensibility**
   - **Risk:** Role system may need extension for Accounting Workspace-specific permissions
   - **Impact:** New roles/permissions may be needed
   - **Mitigation:** ✅ Role system is extensible

### 9.6 Final Recommendations

**For Accounting Workspace Development:**

1. ✅ **Use existing ledger infrastructure** (`journal_entries`, `journal_entry_lines`)
2. ✅ **Respect period controls** (use existing period system)
3. ✅ **Use adjusting journals** for corrections (do not modify Service workspace posting functions)
4. ✅ **Leverage tax engine metadata** for tax account mapping
5. ⚠️ **Create new posting functions** if different account mappings are needed (do not modify Service workspace functions)
6. ✅ **Use existing report functions** (Accounting workspace reports are ledger-derived)
7. ✅ **Extend role system** as needed (system is extensible)

**Critical Constraints:**
- ❌ **DO NOT modify Service workspace posting functions**
- ❌ **DO NOT change account code structure** without migration plan
- ✅ **DO use period controls** for date/period management
- ✅ **DO use audit trail patterns** (set `created_by`, `reference_type`)

---

## Appendix: Key File References

### Core Ledger Files
- `supabase/migrations/043_accounting_core.sql` - Core ledger tables and posting functions
- `supabase/migrations/088_hard_db_constraints_ledger.sql` - Immutability and period enforcement
- `supabase/migrations/094_accounting_periods.sql` - Period system
- `supabase/migrations/137_adjusting_journals_phase2e.sql` - Adjusting journals

### Tax Engine Files
- `lib/taxEngine/` - Tax engine directory
- `supabase/migrations/130_refactor_ledger_posting_to_use_tax_lines_canonical.sql` - Tax posting refactor

### Reporting Files
- `supabase/migrations/138_financial_reports_phase3.sql` - Report functions
- `app/api/accounting/reports/` - Accounting workspace report APIs

### Permissions Files
- `lib/userRoles.ts` - Role management
- `lib/accessControl.ts` - Access control logic

### Audit Files
- `supabase/migrations/044_audit_logging.sql` - Audit log system

---

**End of Audit Report**
