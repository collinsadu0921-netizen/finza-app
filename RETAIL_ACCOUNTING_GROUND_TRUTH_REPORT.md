# Retail × Accounting Reality Check — Ground Truth Report

**Date:** 2025-01-27  
**Type:** Read-Only Intelligence Gathering  
**Purpose:** Extract what exists in codebase and data model before architectural decisions

---

## 1. Retail Capabilities (Current State)

### 1.1 Retail UI Features

**POS Terminal** (`app/(dashboard)/pos/page.tsx`)
- Cart management with real-time tax calculation
- Multiple payment methods (Cash, MoMo, Card, Split)
- Receipt printing (thermal & browser)
- Barcode scanning
- Parked sales
- Sale voiding (with supervisor approval)
- Refunds (with supervisor approval)
- Cashier PIN authentication
- Multi-register support

**Retail Dashboard** (`app/retail/dashboard/page.tsx`)
- Analytics dashboard (revenue, COGS, profit)
- Sales history with filtering
- Store switching

**Retail Admin Pages**
- `/admin/retail/stores` - Store management
- `/admin/retail/analytics` - Analytics dashboard
- `/admin/retail/inventory-dashboard` - Inventory dashboard
- `/admin/retail/low-stock` - Low stock alerts
- `/admin/retail/bulk-import` - Bulk product import
- `/admin/retail/receipt-settings` - Receipt settings

**Retail Onboarding** (`app/onboarding/retail/page.tsx`)
- Multi-step onboarding flow
- Store creation
- Register setup
- Product setup

**VAT Reporting** (`app/reports/vat/page.tsx`)
- Store-specific VAT reports
- Ghana-specific VAT structure (NHIL, GETFund, COVID, VAT)
- Date range filtering (today, week, month)
- Reads from `sales.tax_lines` JSONB (canonical source)

### 1.2 Retail Database Tables

**Core Retail Tables:**
- `stores` - Store locations (migration `027_multi_store_support.sql`)
- `registers` - Cash registers (migration `013_multi_register.sql`)
- `cashier_sessions` - Register sessions (migration `013_multi_register.sql`)
- `sales` - Sales transactions (migration `006_sale_items_table.sql`)
- `sale_items` - Sale line items (migration `006_sale_items_table.sql`)
- `products_stock` - Per-store inventory tracking
- `stock_movements` - Stock movement history
- `parked_sales` - Parked sales (migration `017_parked_sales.sql`)

**Retail-Specific Columns:**
- `sales.store_id` - Links sales to stores (migration `028_ensure_store_id_columns.sql`)
- `sales.register_id` - Links sales to registers
- `sales.cashier_session_id` - Links sales to cashier sessions
- `sales.tax_lines` - JSONB canonical tax data
- `sales.tax_engine_code` - Tax engine identifier
- `sales.tax_engine_effective_from` - Tax engine effective date
- `sales.tax_jurisdiction` - Tax jurisdiction code

### 1.3 Retail Config Flags

**Business Table:**
- `businesses.industry` - Must be `"retail"` for retail features
- `businesses.retail_vat_inclusive` - VAT-inclusive pricing flag

**Store Session:**
- Active store ID stored in session storage (`lib/storeSession.ts`)
- Store switching via `getActiveStoreId()` / `setActiveStoreId()`

### 1.4 Retail-Specific Reports

**VAT Report** (`app/reports/vat/page.tsx`)
- **Location:** `/vat-returns` route
- **Scope:** Store-specific (requires active store selection)
- **Data Source:** `sales` table filtered by `store_id` and `payment_status = 'paid'`
- **Tax Calculation:** Reads from `sales.tax_lines` JSONB
- **Ghana-Specific:** Only available for Ghana businesses (`address_country = 'GH'`)
- **Date Filters:** Today, week, month

**Analytics Dashboard** (`app/admin/retail/analytics/page.tsx`)
- Revenue, COGS, profit calculations
- Register reports
- Cash office reports
- Date range filtering

---

## 2. Accounting Workspace Capabilities (Current State)

### 2.1 Accounting UI Features

**Accounting Routes** (`app/accounting/`)
- `/accounting` - Landing page (read-only)
- `/accounting/ledger` - General Ledger view
- `/accounting/trial-balance` - Trial Balance view
- `/accounting/periods` - Accounting Periods management
- `/accounting/adjustments` - Adjusting journals
- `/accounting/adjustments/review` - Adjustment review
- `/accounting/exceptions` - Exception handling
- `/accounting/afs` - Annual Financial Statements
- `/accounting/opening-balances-imports` - Opening balance imports
- `/accounting/journals` - Manual journal entries
- `/accounting/journals/drafts` - Draft journal management

**Accounting Firm Routes** (`app/accounting/firm/`)
- `/accounting/firm` - Firm dashboard
- `/accounting/firm/setup` - Firm setup
- `/accounting/firm/onboarding` - Firm onboarding
- `/accounting/firm/clients` - Client management
- `/accounting/firm/clients/add` - Add client
- `/accounting/firm/authority` - Authority management
- `/accounting/firm/ops` - Operations dashboard

**Shared Accounting Routes** (Available in all modes)
- `/accounts` - Chart of Accounts management
- `/ledger` - General Ledger view
- `/trial-balance` - Trial Balance view
- `/reconciliation` - Bank reconciliation
- `/reports/profit-loss` - Profit & Loss reports
- `/reports/balance-sheet` - Balance Sheet reports

### 2.2 Accounting Database Tables

**Core Accounting Tables:**
- `accounting_periods` - Accounting periods (migration `094_accounting_periods.sql`)
  - Schema: `id`, `business_id`, `period_start`, `period_end`, `status` ('open'/'soft_closed'/'locked'), `closed_at`, `closed_by`
  - Status values: `'open'`, `'soft_closed'`, `'locked'`
  - Unique constraint: `(business_id, period_start)`
  - Period boundaries: `period_start` must be first day of month, `period_end` must be last day of same month

- `chart_of_accounts` - Chart of accounts (migration `097_chart_of_accounts_tables.sql`)
  - Schema: `id`, `business_id`, `account_code`, `account_name`, `account_type`, `is_active`
  - Account types: `'asset'`, `'liability'`, `'equity'`, `'revenue'`, `'expense'`

- `chart_of_accounts_control_map` - Control account mappings (migration `097_chart_of_accounts_tables.sql`)
  - Schema: `id`, `business_id`, `control_key`, `account_code`
  - Maps control keys (e.g., `'CASH'`, `'VAT_PAYABLE'`) to account codes
  - Unique constraint: `(business_id, control_key)`

- `journal_entries` - Journal entries (migration `043_accounting_core.sql`)
  - Schema: `id`, `business_id`, `date`, `description`, `reference_type`, `reference_id`, `created_at`, `created_by`, `posted_by_accountant_id`
  - Reference types: `'invoice'`, `'payment'`, `'credit_note'`, `'bill'`, `'expense'`, `'sale'`, `'manual'`, `'adjustment'`

- `journal_entry_lines` - Journal entry lines (migration `043_accounting_core.sql`)
  - Schema: `id`, `journal_entry_id`, `account_id`, `debit`, `credit`, `description`, `created_at`
  - Links to `accounts.id` (legacy) or resolved from `chart_of_accounts`

- `accounts` - Legacy accounts table (migration `043_accounting_core.sql`)
  - Schema: `id`, `business_id`, `name`, `code`, `type`, `description`, `is_system`, `deleted_at`
  - **Note:** Still exists but `chart_of_accounts` is preferred for new code

- `general_ledger` - General ledger view (computed from `journal_entry_lines`)

**Accounting Period Management:**
- `accounting_period_actions` - Audit trail for period actions (migration `102_accounting_period_actions_audit.sql`)

**Adjusting Journals:**
- `adjustment_journals` - Adjusting journal entries (migration `137_adjusting_journals_phase2e.sql`)

**Opening Balances:**
- Opening balance imports system (migration `134_opening_balances_phase2c.sql`)

### 2.3 Accounting Functions

**Period Management:**
- `assert_accounting_period_is_open(business_id, date, is_adjustment)` - Validates period is open/soft_closed (blocks locked)
- `initialize_business_accounting_period(business_id, start_date)` - One-time bootstrap for retail (migration `177_retail_accounting_period_initialization.sql`)

**Chart of Accounts:**
- `get_account_by_code(business_id, account_code)` - Gets account ID by code
- `get_account_by_control_key(business_id, control_key)` - Gets account ID via control mapping
- `get_control_account_code(business_id, control_key)` - Gets account code from control mapping
- `assert_account_exists(business_id, account_code)` - Validates account exists and is active

**Journal Posting:**
- `post_journal_entry(...)` - Core journal entry posting function (14 parameters, migration `179_retail_system_accountant_posting.sql`)
- `post_invoice_to_ledger(invoice_id)` - Posts invoices to ledger
- `post_bill_to_ledger(bill_id)` - Posts bills to ledger
- `post_expense_to_ledger(expense_id)` - Posts expenses to ledger
- `post_sale_to_ledger(sale_id, ...)` - Posts sales to ledger (migration `179_retail_system_accountant_posting.sql`)
- `post_credit_note_to_ledger(credit_note_id)` - Posts credit notes to ledger
- `post_payment_to_ledger(payment_id)` - Posts payments to ledger

**Control Account Mapping:**
- `ensure_retail_control_account_mapping(business_id, control_key, account_code)` - Ensures mapping exists (migration `175_retail_control_account_mapping.sql`)

### 2.4 Accounting Features

**Period Control:**
- Period status lifecycle: `open` → `soft_closed` → `locked` (forward-only)
- `open`: Allows new ledger entries, payments, proposals
- `soft_closed`: Still allows posting (soft close)
- `locked`: Blocks all posting (immutable forever)
- Period boundaries enforced: `period_start` = first day of month, `period_end` = last day of same month

**Chart of Accounts:**
- Control account mappings for posting governance
- Control keys: `'CASH'`, `'VAT_PAYABLE'`, `'NHIL_PAYABLE'`, `'GETFUND_PAYABLE'`, `'COVID_PAYABLE'`, etc.
- Account validation before posting

**Adjusting Journals:**
- Can only be posted to `open` periods (not `soft_closed` or `locked`)
- Require `adjustment_reason`
- Must have at least 2 lines
- Entry date must fall within period boundaries

**Opening Balances:**
- One-time per business
- Import system with approval workflow
- Posts to first period

**Financial Reports:**
- Profit & Loss (`/reports/profit-loss`)
- Balance Sheet (`/reports/balance-sheet`)
- Trial Balance (`/trial-balance`)
- General Ledger (`/ledger`)

**Accountant Firm Features:**
- External accountant access to client businesses
- Engagement management
- Client onboarding
- Authority management

---

## 3. Explicit Retail → Accounting Dependencies

### 3.1 Sale Creation → Ledger Posting Path

**Location:** `app/api/sales/create/route.ts` lines 1066-1123

**Flow:**
1. Sale created in `sales` table
2. Sale items created in `sale_items` table
3. Stock deducted from `products_stock`
4. **CRITICAL:** Calls `post_sale_to_ledger(sale_id)` via `supabase.rpc()` (line 1071-1077)
5. If ledger posting fails, sale is **rolled back** (deleted)
6. Reconciliation validation via `validate_sale_reconciliation(sale_id)`

**Dependencies:**
- **Requires:** `business.owner_id` exists (used as system accountant, line 1075)
- **Requires:** Accounting period exists and is `open` or `soft_closed` (not `locked`)
- **Requires:** Chart of accounts accounts exist (CASH, Revenue 4000, COGS 5000, Inventory 1200, tax accounts)
- **Requires:** Control account mappings exist (CASH control key → account code)

### 3.2 Period Dependency

**Location:** `supabase/migrations/179_retail_system_accountant_posting.sql` line 412

**Function:** `post_sale_to_ledger()` calls `assert_accounting_period_is_open(business_id, sale_date)`

**Behavior:**
- **Blocks posting** if period is `locked`
- **Allows posting** if period is `open` or `soft_closed`
- **Raises exception** if no period exists for sale date

**Retail Bootstrap:**
- Migration `177_retail_accounting_period_initialization.sql` provides `initialize_business_accounting_period()`
- Called during retail onboarding finalization
- Creates ONE period for current month if none exists
- **Idempotent:** Safe to call multiple times

### 3.3 Chart of Accounts Dependency

**Location:** `supabase/migrations/175_retail_control_account_mapping.sql` lines 189-235

**Function:** `post_sale_to_ledger()` requires:
1. **CASH account** via control key `'CASH'` → account code (default: `'1000'`)
2. **Revenue account** via hardcoded code `'4000'`
3. **COGS account** via hardcoded code `'5000'`
4. **Inventory account** via hardcoded code `'1200'`
5. **Tax accounts** via `tax_lines[].ledger_account_code` from tax calculation

**Validation:**
- `assert_account_exists(business_id, account_code)` called for all accounts
- `get_control_account_code(business_id, 'CASH')` called to resolve CASH account
- `ensure_retail_control_account_mapping()` called to create mapping if account exists

**Error Handling:**
- If account doesn't exist, posting **fails** with clear error
- Does NOT auto-create accounts (only creates mapping if account exists)

### 3.4 Tax Account Dependency

**Location:** `supabase/migrations/179_retail_system_accountant_posting.sql` lines 208-215

**Function:** `post_sale_to_ledger()` reads tax account codes from `tax_lines` JSONB:
- Each tax line has `ledger_account_code` (e.g., `'2100'` for VAT)
- Each tax line has `ledger_side` (`'credit'` for sales output taxes)
- Validates account exists via `assert_account_exists()`
- Posts tax line to account if `ledger_account_code` is not null and amount > 0

**Source:** Tax account codes come from frontend tax calculation (`lib/taxEngine/`)

### 3.5 System Accountant Dependency

**Location:** `app/api/sales/create/route.ts` line 1075

**Function:** `post_sale_to_ledger()` requires `p_posted_by_accountant_id` parameter

**Retail Behavior:**
- Business owner (`business.owner_id`) is used as system accountant
- If `business.owner_id` is NULL, sale creation **fails** (line 112-117)

**Accounting Workspace Behavior:**
- External accountants can post via their own user ID
- `is_user_accountant()` function determines if user is accountant

### 3.6 Implicit Assumptions Retail Makes About Accounting

**Assumption 1: Accounting Periods Exist**
- Retail sales **assume** at least one accounting period exists for the sale date
- **Bootstrap:** `initialize_business_accounting_period()` called during onboarding
- **Failure:** If no period exists, sale creation fails with period validation error

**Assumption 2: Chart of Accounts Is Set Up**
- Retail sales **assume** default accounts exist (1000, 4000, 5000, 1200)
- **Bootstrap:** Accounts should be created during business setup
- **Failure:** If accounts don't exist, sale creation fails with account validation error

**Assumption 3: Control Account Mappings Exist**
- Retail sales **assume** CASH control mapping exists
- **Bootstrap:** `ensure_retail_control_account_mapping()` creates mapping if account exists
- **Failure:** If account doesn't exist, sale creation fails

**Assumption 4: Business Owner Is Accountant**
- Retail sales **assume** `business.owner_id` exists and can act as system accountant
- **Failure:** If `business.owner_id` is NULL, sale creation fails

**Assumption 5: Period Is Not Locked**
- Retail sales **assume** period for sale date is `open` or `soft_closed`
- **Failure:** If period is `locked`, sale creation fails with period locked error

**Assumption 6: Tax Accounts Match Tax Calculation**
- Retail sales **assume** tax account codes from `tax_lines` exist in chart of accounts
- **Source:** Tax account codes come from frontend tax engine
- **Failure:** If tax account doesn't exist, sale creation fails

---

## 4. VAT Logic Ownership

### 4.1 VAT Calculation in Retail

**Location:** `lib/vat.ts` and `lib/taxEngine/`

**Retail POS Calculation:**
- **File:** `app/(dashboard)/pos/page.tsx` lines 1105-1211
- **Function:** `calculateCartTaxes()` from `lib/vat.ts`
- **Mode:** VAT-inclusive (prices already include tax)
- **Tax Extraction:** Reverse calculates tax from VAT-inclusive prices
- **Multiplier:** Uses `getGhanaTaxMultiplier(rates)` for dynamic calculation

**Tax Engine:**
- **File:** `lib/taxEngine/jurisdictions/ghana.ts`
- **Canonical Engine:** `ghanaTaxEngineCanonical.reverseCalculate()`
- **Versioning:** `getGhanaEngineVersion(date)` determines tax rates by date
- **Regimes:** Pre-2026 (compound), Post-2026 (simplified)

**Tax Storage:**
- **Canonical:** `sales.tax_lines` JSONB array
- **Format:** `[{ code, name, rate, base, amount, ledger_account_code, ledger_side }, ...]`
- **Metadata:** `sales.tax_engine_code`, `sales.tax_engine_effective_from`, `sales.tax_jurisdiction`
- **Legacy:** Legacy columns (`nhil`, `getfund`, `covid`, `vat`) **NOT written** for retail (canonical-only mode)

### 4.2 VAT Reporting in Retail

**Location:** `app/reports/vat/page.tsx`

**Data Source:**
- Reads from `sales.tax_lines` JSONB (canonical source)
- Filters by `store_id` (store-specific reports)
- Filters by `payment_status = 'paid'` (excludes refunded sales)
- Date range filtering (today, week, month)

**Calculation:**
- Sums tax amounts from `tax_lines` array
- Groups by VAT type (standard, zero, exempt)
- Calculates taxable base from stored amounts (no recomputation)

**Ghana-Specific:**
- Only available for Ghana businesses (`address_country = 'GH'`)
- Shows NHIL, GETFund, COVID, VAT breakdown
- Validates: `standard_rated_sales = taxable_base + total_tax`

### 4.3 VAT Logic in Accounting Workspace

**Location:** Accounting workspace does NOT have separate VAT calculation

**VAT in Ledger:**
- Tax accounts posted from `tax_lines[].ledger_account_code`
- Tax amounts from `tax_lines[].amount`
- Tax side from `tax_lines[].ledger_side` (`'credit'` for sales output taxes)

**VAT Reports:**
- Accounting workspace uses same `/reports/vat` route (shared)
- Same data source (`sales.tax_lines`)
- No separate VAT calculation logic in accounting workspace

### 4.4 VAT Logic Sharing

**Shared Components:**
- `lib/vat.ts` - Used by retail POS for tax calculation
- `lib/taxEngine/` - Canonical tax engine used by retail
- `app/reports/vat/page.tsx` - Shared VAT report (used by both retail and accounting)

**Retail-Specific:**
- VAT-inclusive pricing mode (`businesses.retail_vat_inclusive = true`)
- Store-specific VAT reports (filtered by `store_id`)
- Real-time tax calculation in POS

**Accounting-Specific:**
- None (accounting workspace reads from same `sales.tax_lines`)

**Duplication:**
- **NO duplication** - VAT calculation is centralized in `lib/taxEngine/`
- Retail POS uses canonical engine
- Accounting workspace reads stored tax data (no recalculation)

### 4.5 VAT Dependencies on Accounting Setup

**Tax Account Codes:**
- Tax account codes come from tax engine (`tax_lines[].ledger_account_code`)
- **Requires:** Tax accounts exist in `chart_of_accounts`
- **Validation:** `assert_account_exists()` called for each tax account code

**Control Account Mappings:**
- Tax control keys (VAT_PAYABLE, NHIL_PAYABLE, etc.) can be mapped
- **Current:** Not used in retail sales posting (uses direct account codes from `tax_lines`)
- **Potential:** Could use control mappings for tax accounts

**Period Dependency:**
- VAT posting requires period to be `open` or `soft_closed`
- **Failure:** If period is `locked`, VAT cannot be posted

---

## 5. Accountant Interaction With Retail Today

### 5.1 Accountant UI in Retail

**Finding:** **NO accountant-specific UI in retail mode**

**Evidence:**
- No routes under `/retail/accountant/` or `/pos/accountant/`
- No accountant-specific components in retail pages
- Retail POS (`/pos`) has no accountant features
- Retail dashboard (`/retail/dashboard`) has no accountant features

### 5.2 Accountant Access to Retail Data

**Read-Only Access:**
- Accountants can access accounting workspace routes (`/accounting/*`)
- Accounting workspace can view ledger entries from retail sales
- **Location:** `app/accounting/ledger/page.tsx` - Shows all journal entries (including `reference_type = 'sale'`)

**Data Visibility:**
- Accountants can see journal entries created by retail sales
- Journal entries have `reference_type = 'sale'` and `reference_id = sale.id`
- Can view general ledger, trial balance, P&L, balance sheet (includes retail sales data)

**No Direct Retail Access:**
- Accountants **cannot** access retail POS (`/pos`)
- Accountants **cannot** access retail dashboard (`/retail/dashboard`)
- Accountants **cannot** create or modify retail sales

### 5.3 Retail Data Reuse in Accounting

**Journal Entries:**
- Retail sales automatically create journal entries via `post_sale_to_ledger()`
- Journal entries are **reused** in accounting workspace (no re-derivation)
- **Location:** `journal_entries` table with `reference_type = 'sale'`

**Financial Reports:**
- P&L, Balance Sheet, Trial Balance **include** retail sales data
- Reports read from `journal_entry_lines` (posted from retail sales)
- **No re-derivation:** Reports use posted ledger data, not operational `sales` table

**VAT Reports:**
- VAT reports read from `sales.tax_lines` (operational data)
- **Not reused:** VAT reports read directly from `sales` table, not from ledger
- **Potential gap:** VAT report data may not match ledger tax accounts if accounts are changed

### 5.4 Accountant Workflow With Retail

**Current Workflow:**
1. Retail creates sale → `post_sale_to_ledger()` creates journal entry
2. Accountant views journal entry in accounting workspace (`/accounting/ledger`)
3. Accountant can view P&L, Balance Sheet, Trial Balance (includes retail sales)
4. Accountant can close/lock periods (blocks future retail sales to that period)
5. Accountant can create adjusting journals (for corrections)

**No Direct Interaction:**
- Accountants **cannot** approve retail sales
- Accountants **cannot** modify retail sales
- Accountants **cannot** view retail sales directly (only via journal entries)

### 5.5 System Accountant for Retail

**Location:** `app/api/sales/create/route.ts` line 1075

**Behavior:**
- Business owner (`business.owner_id`) acts as system accountant for retail sales
- `post_sale_to_ledger()` receives `p_posted_by_accountant_id = business.owner_id`
- Journal entries have `posted_by_accountant_id = business.owner_id`

**Implication:**
- Retail sales are **automatically authorized** by business owner
- No accountant approval required for retail sales
- External accountants cannot authorize retail sales (only business owner)

---

## 6. Gaps and Implicit Assumptions (Observed, Not Proposed)

### 6.1 Period Management Gap

**Observation:**
- Retail **assumes** accounting periods exist but has no UI to manage them
- Retail onboarding calls `initialize_business_accounting_period()` to create one period
- **Gap:** Retail users cannot create, close, or lock periods (accounting workspace only)

**Impact:**
- If all periods are locked, retail sales **fail**
- Retail users have no way to unlock periods or create new ones
- Must use accounting workspace to manage periods

### 6.2 Chart of Accounts Setup Gap

**Observation:**
- Retail **assumes** default accounts exist (1000, 4000, 5000, 1200, tax accounts)
- **Gap:** Retail onboarding does not create chart of accounts
- **Gap:** Retail users cannot view or manage chart of accounts

**Impact:**
- If accounts don't exist, retail sales **fail**
- Retail users have no way to create accounts
- Must use accounting workspace to create accounts

### 6.3 Control Account Mapping Gap

**Observation:**
- Retail **assumes** CASH control mapping exists
- `ensure_retail_control_account_mapping()` creates mapping if account exists
- **Gap:** Retail users cannot view or manage control mappings

**Impact:**
- If CASH account doesn't exist, mapping creation fails
- Retail users have no way to create control mappings
- Must use accounting workspace to create mappings

### 6.4 Tax Account Validation Gap

**Observation:**
- Retail sales validate tax accounts exist before posting
- Tax account codes come from frontend tax calculation
- **Gap:** If tax account codes change in chart of accounts, retail sales may fail
- **Gap:** No validation that tax account codes match between tax engine and chart of accounts

**Impact:**
- If tax account is deleted or code changes, retail sales **fail**
- Retail users have no way to fix tax account mismatches
- Must use accounting workspace to fix accounts

### 6.5 VAT Report Data Source Mismatch

**Observation:**
- VAT reports read from `sales.tax_lines` (operational data)
- Ledger posts tax to accounts from `tax_lines[].ledger_account_code`
- **Gap:** If tax accounts are changed in chart of accounts, VAT report may not match ledger

**Impact:**
- VAT report shows tax amounts from `sales.tax_lines`
- Ledger shows tax posted to accounts (may be different if accounts changed)
- **Potential inconsistency:** VAT report data may not match ledger tax accounts

### 6.6 System Accountant Assumption

**Observation:**
- Retail sales use `business.owner_id` as system accountant
- **Assumption:** Business owner is always an accountant
- **Gap:** No validation that business owner has accountant permissions

**Impact:**
- If `business.owner_id` is NULL, retail sales **fail**
- Business owner may not have accountant role in `accounting_firm_users` table
- **Implication:** Retail sales are authorized by business owner, not external accountants

### 6.7 Period Locking Impact

**Observation:**
- Retail sales **fail** if period is `locked`
- **Gap:** Retail users have no visibility into period status
- **Gap:** Retail users cannot see why sales are failing (period locked)

**Impact:**
- If accountant locks a period, retail sales to that period **fail silently**
- Retail users have no way to know period is locked
- Must use accounting workspace to check period status

### 6.8 Account Validation Failure Messages

**Observation:**
- Retail sales **fail** if accounts don't exist
- Error messages mention account codes but not how to fix
- **Gap:** Retail users have no way to create missing accounts

**Impact:**
- Retail users see cryptic error messages about missing accounts
- No guidance on how to create accounts
- Must use accounting workspace to create accounts

### 6.9 No Retail-Specific Accounting UI

**Observation:**
- Retail has no accounting UI (periods, chart of accounts, control mappings)
- All accounting features are in accounting workspace
- **Gap:** Retail users must switch to accounting workspace to manage accounting setup

**Impact:**
- Retail users cannot manage accounting setup from retail interface
- Must use accounting workspace for all accounting management
- **Implication:** Retail and accounting are **tightly coupled** but **UI-separated**

### 6.10 Reconciliation Validation

**Observation:**
- Retail sales call `validate_sale_reconciliation(sale_id)` after posting
- **Gap:** Retail users have no visibility into reconciliation status
- **Gap:** Reconciliation failures roll back sales but error messages may not be clear

**Impact:**
- If reconciliation fails, sale is rolled back
- Retail users may not understand why sale failed
- Must check accounting workspace for reconciliation details

---

## Summary

### Retail Has:
- POS terminal, register sessions, multi-store support
- Sales creation with automatic ledger posting
- VAT calculation and reporting (Ghana-specific)
- Store-specific inventory and stock tracking
- Analytics dashboard and sales history

### Accounting Workspace Has:
- Period management (open, soft_closed, locked)
- Chart of accounts and control account mappings
- Manual journal entries and adjusting journals
- Financial reports (P&L, Balance Sheet, Trial Balance)
- Accountant firm features (external accountant access)

### Retail Depends On Accounting:
- **Periods:** Retail sales require at least one open/soft_closed period
- **Chart of Accounts:** Retail sales require default accounts (1000, 4000, 5000, 1200, tax accounts)
- **Control Mappings:** Retail sales require CASH control mapping
- **System Accountant:** Retail sales require `business.owner_id` as system accountant

### Gaps:
- Retail has no UI for period management
- Retail has no UI for chart of accounts
- Retail has no UI for control account mappings
- Retail users cannot see why sales fail (period locked, missing accounts)
- VAT reports read from operational data, not ledger (potential mismatch)

### Implicit Assumptions:
- Accounting periods exist (bootstrap during onboarding)
- Chart of accounts is set up (no retail UI to create)
- Business owner is accountant (no validation)
- Period is not locked (no retail visibility)
- Tax accounts match tax calculation (no validation)

---

**End of Report**
