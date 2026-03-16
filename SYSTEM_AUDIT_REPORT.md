# SYSTEM AUDIT REPORT: Finza Accounting System
**Date:** 2025-01-17  
**Auditor Role:** Principal Software Engineer + Systems Auditor  
**Scope:** Complete system boundary mapping, invariant verification, and violation classification  
**Mode:** READ-ONLY ANALYSIS (no code modifications)

---

## EXECUTIVE DIAGNOSIS

### Core Finding
The Finza system is a **three-workspace architecture** (Retail/POS, Service/Professional, Accounting) with a **unified ledger** serving as the single source of financial truth. However, **boundary violations**, **incomplete posting coverage**, and **legacy artifacts** create interconnected failure modes that manifest as "random bugs."

### Critical Issues Identified

1. **Refunds Do Not Post to Ledger** - Creates reconciliation gaps
2. **Sales Posting Lacks Duplicate Prevention** - Risk of orphaned sales
3. **Report Bypass Paths Exist** - Some reports read from operational tables
4. **External Client/Engagement Period Validation** - UI/backend mismatch
5. **Legacy Table References** - `opening_balance_imports` exists but may be orphaned
6. **Cross-Workspace Writes** - Accounting workspace can create operational data

### System Health Status
- **Ledger Integrity:** ✅ ENFORCED (double-entry, period locking, immutability)
- **Posting Completeness:** ⚠️ PARTIALLY ENFORCED (refunds missing, sales at risk)
- **Report Canonicalization:** ⚠️ PARTIALLY ENFORCED (legacy routes bypass trial balance)
- **Workspace Isolation:** ❌ VIOLATED (accounting creates operational data)
- **Period Safety:** ✅ ENFORCED (multi-layer guards)

---

## 1. SYSTEM MAP

### 1.1 Workspace Definitions

| Workspace | Route Prefix | Purpose | Industry Modes |
|-----------|-------------|---------|----------------|
| **Retail** | `/pos`, `/inventory`, `/sales`, `/reports`, `/retail` | Point-of-sale transactions, inventory management | `retail` |
| **Service** | `/invoices`, `/clients`, `/estimates`, `/payments` | Professional service billing, invoicing | `service`, `professional` |
| **Accounting** | `/accounting/*` | Financial oversight, period management, reports | All (read-only layer) |

**Source:** `lib/accessControl.ts:23-60`

### 1.2 Entry Routes Per Workspace

#### Retail Workspace
- **Entry:** `/pos` (cashier), `/retail/dashboard` (admin/manager)
- **Key Routes:**
  - `/api/sales/create` - Creates sale, posts to ledger
  - `/api/override/refund-sale` - Refunds sale (NO ledger posting)
  - `/reports/vat` - VAT report (reads from `sales` table)
  - `/reports/cash-office` - Cash office report (reads from `sales` table)

#### Service Workspace
- **Entry:** `/dashboard` (default), `/invoices`, `/clients`
- **Key Routes:**
  - `/api/invoices/create` - Creates invoice, auto-posts via trigger
  - `/api/payments/create` - Creates payment, auto-posts via trigger
  - `/api/expenses/create` - Creates expense, auto-posts via trigger
  - `/api/credit-notes/create` - Creates credit note, auto-posts via trigger

#### Accounting Workspace
- **Entry:** `/accounting` (read-only reports)
- **Key Routes:**
  - `/api/accounting/reports/trial-balance` - Canonical trial balance (from snapshot)
  - `/api/accounting/reports/profit-and-loss` - Canonical P&L (from trial balance)
  - `/api/accounting/reports/balance-sheet` - Canonical balance sheet (from trial balance)
  - `/api/accounting/adjustments/apply` - Creates adjustment journals
  - `/api/accounting/firm/clients` - Lists external clients (firm engagements)
  - `/api/accounting/firm/engagements` - Creates firm-client engagements

### 1.3 Table Read/Write Matrix

#### Retail Workspace Tables

| Table | Read | Write | Notes |
|-------|------|-------|-------|
| `sales` | ✅ | ✅ | Creates sales, updates payment_status |
| `sale_items` | ✅ | ✅ | Line items for sales |
| `products_stock` | ✅ | ✅ | Inventory tracking (per store) |
| `stock_movements` | ✅ | ✅ | Audit trail for stock changes |
| `registers` | ✅ | ✅ | POS register management |
| `cashier_sessions` | ✅ | ✅ | Cashier session tracking |
| `overrides` | ✅ | ✅ | Supervisor override audit trail |
| `journal_entries` | ✅ | ✅ | Via `post_sale_to_ledger()` RPC |
| `journal_entry_lines` | ✅ | ✅ | Via `post_sale_to_ledger()` RPC |

#### Service Workspace Tables

| Table | Read | Write | Notes |
|-------|------|-------|-------|
| `invoices` | ✅ | ✅ | Creates invoices, triggers auto-post |
| `invoice_items` | ✅ | ✅ | Invoice line items |
| `payments` | ✅ | ✅ | Creates payments, triggers auto-post |
| `expenses` | ✅ | ✅ | Creates expenses, triggers auto-post |
| `credit_notes` | ✅ | ✅ | Creates credit notes, triggers auto-post |
| `customers` | ✅ | ✅ | Client management |
| `journal_entries` | ✅ | ✅ | Via database triggers |
| `journal_entry_lines` | ✅ | ✅ | Via database triggers |

#### Accounting Workspace Tables

| Table | Read | Write | Notes |
|-------|------|-------|-------|
| `journal_entries` | ✅ | ✅ | Via adjustment journals only |
| `journal_entry_lines` | ✅ | ✅ | Via adjustment journals only |
| `trial_balance_snapshots` | ✅ | ❌ | Read-only (generated by function) |
| `accounting_periods` | ✅ | ✅ | Period management (soft close, lock) |
| `period_opening_balances` | ✅ | ✅ | Opening balance generation |
| `accounts` | ✅ | ✅ | Chart of accounts management |
| `firm_client_engagements` | ✅ | ✅ | External client engagement management |
| `accounting_firms` | ✅ | ✅ | Firm profile management |
| `opening_balance_imports` | ✅ | ✅ | **BOUNDARY VIOLATION** (operational data) |

**Source:** API route analysis, migration files

### 1.4 Cross-Workspace Writes (VIOLATIONS)

#### Accounting → Operational Data

1. **`opening_balance_imports` table**
   - **Location:** `app/api/accounting/opening-balances/route.ts`
   - **Violation:** Accounting workspace creates operational import records
   - **Impact:** Accounting workspace should only create ledger entries, not operational data
   - **Severity:** MEDIUM (creates data dependency)

2. **`firm_client_engagements` table**
   - **Location:** `app/api/accounting/firm/engagements/route.ts`
   - **Violation:** Accounting workspace creates engagement records (operational)
   - **Impact:** Creates operational relationship data outside ledger
   - **Severity:** LOW (necessary for firm workflow, but breaks isolation)

#### Retail → Accounting Data

1. **`journal_entries` via `post_sale_to_ledger()`**
   - **Location:** `app/api/sales/create/route.ts:1070`
   - **Status:** ✅ INTENDED (sales must post to ledger)
   - **Mechanism:** Explicit RPC call (not trigger)

#### Service → Accounting Data

1. **`journal_entries` via triggers**
   - **Location:** `supabase/migrations/043_accounting_core.sql`
   - **Status:** ✅ INTENDED (invoices/payments must post to ledger)
   - **Mechanism:** Database triggers (`trigger_auto_post_invoice`, `trigger_auto_post_payment`)

---

## 2. ACCOUNTING TRUTH SOURCE

### 2.1 Authoritative Source

**Single Source of Truth:** `journal_entries` + `journal_entry_lines` tables

**Derived Sources:**
- `trial_balance_snapshots` - Canonical snapshot per period (generated from ledger)
- `period_opening_balances` - Opening balances (derived from prior period closing)

**Source:** `supabase/migrations/169_trial_balance_canonicalization.sql`

### 2.2 Ledger Write Paths

#### Automatic Posting (Triggers)

| Business Event | Trigger | Function | Migration |
|----------------|---------|----------|-----------|
| Invoice sent | `trigger_auto_post_invoice` | `post_invoice_to_ledger()` | 043_accounting_core.sql |
| Payment created | `trigger_auto_post_payment` | `post_invoice_payment_to_ledger()` | 043_accounting_core.sql |
| Credit note applied | `trigger_auto_post_credit_note` | `post_credit_note_to_ledger()` | 092_step6_credit_note_recognition_reversal.sql |
| Expense created | `trigger_auto_post_expense` | `post_expense_to_ledger()` | 094_accounting_periods.sql |
| Bill created | `trigger_auto_post_bill` | `post_bill_to_ledger()` | 043_accounting_core.sql |

#### Explicit Posting (RPC Calls)

| Business Event | API Route | Function | Migration |
|----------------|-----------|----------|-----------|
| Sale created | `/api/sales/create` | `post_sale_to_ledger()` | 162_complete_sale_ledger_postings.sql |
| Adjustment journal | `/api/accounting/adjustments/apply` | `post_journal_entry()` | 166_controlled_adjustments_soft_closed.sql |
| Opening balance | `/api/accounting/opening-balances/[id]/post` | `post_journal_entry()` | 151_opening_balance_posting_step9_1_batch_c.sql |

### 2.3 Ledger Bypass Violations

#### Reports Reading from Operational Tables

| Report Route | Source Tables | Status | Issue |
|--------------|---------------|--------|-------|
| `/api/reports/vat` | `sales` (with `tax_lines` JSONB) | ⚠️ BYPASS | Reads from operational table, not ledger |
| `/api/reports/tax-summary` | `invoices` (nhil, getfund, covid, vat columns) | ⚠️ BYPASS | Reads from operational table, not ledger |
| `/api/reports/aging` | `invoices`, `payments` | ⚠️ BYPASS | Reads from operational tables for outstanding calculation |
| `/api/reports/cash-office` | `sales` | ⚠️ BYPASS | Reads from operational table |
| `/api/reports/registers` | `sales` | ⚠️ BYPASS | Reads from operational table |
| `/api/accounting/reports/trial-balance` | `trial_balance_snapshots` (ledger-derived) | ✅ CANONICAL | Correct |
| `/api/accounting/reports/profit-and-loss` | `trial_balance_snapshots` (ledger-derived) | ✅ CANONICAL | Correct |
| `/api/accounting/reports/balance-sheet` | `trial_balance_snapshots` (ledger-derived) | ✅ CANONICAL | Correct |

**Source:** API route analysis

### 2.4 Missing Ledger Posting

| Business Event | Should Post? | Current Status | File |
|----------------|--------------|----------------|------|
| **Refund** | ✅ YES | ❌ NO | `app/api/override/refund-sale/route.ts` |
| Asset depreciation | ✅ YES | ✅ YES | `app/api/assets/[id]/depreciation/route.ts` |
| Bill payment | ✅ YES | ✅ YES | `supabase/migrations/043_accounting_core.sql` |

**Critical Gap:** Refunds update `sales.payment_status = 'refunded'` and restore inventory, but **do not create reversal journal entries**. This creates reconciliation issues where:
- Revenue remains in ledger (from original sale)
- Inventory is restored (operational data)
- COGS remains in ledger (from original sale)
- Cash is not reduced (manual process)

**Source:** `REFUND_INVESTIGATION.md`, `ARCHITECTURE_CRITICAL_Q_AND_A.md:Q3`

---

## 3. POSTING MODEL ANALYSIS

### 3.1 Posting Mechanisms

| Mechanism | Type | Enforcement Level | Examples |
|-----------|------|-------------------|----------|
| **Database Triggers** | Automatic | Hard (cannot bypass) | Invoice, payment, credit note, expense, bill |
| **Explicit RPC Calls** | Manual | Application-level | Sales, adjustments, opening balances |
| **Application Logic** | Manual | Application-level | Manual journal entries (if UI existed) |

### 3.2 Business Event → Journal Entry Mapping

| Business Event | Journal Entry Created? | How | Where | Reference Type |
|----------------|------------------------|-----|-------|----------------|
| **Sale (Retail)** | ✅ YES | Explicit RPC call | `app/api/sales/create/route.ts:1070` | `'sale'` |
| **Invoice Sent** | ✅ YES | Database trigger | `trigger_auto_post_invoice` | `'invoice'` |
| **Payment Received** | ✅ YES | Database trigger | `trigger_auto_post_payment` | `'payment'` |
| **Credit Note Applied** | ✅ YES | Database trigger | `trigger_auto_post_credit_note` | `'credit_note'` |
| **Expense Created** | ✅ YES | Database trigger | `trigger_auto_post_expense` | `'expense'` |
| **Bill Created** | ✅ YES | Database trigger | `trigger_auto_post_bill` | `'bill'` |
| **Bill Payment** | ✅ YES | Database trigger | `trigger_auto_post_bill_payment` | `'bill_payment'` |
| **Refund** | ❌ NO | **MISSING** | `app/api/override/refund-sale/route.ts` | N/A |
| **Adjustment Journal** | ✅ YES | Explicit RPC call | `app/api/accounting/adjustments/apply/route.ts` | `'adjustment'` |
| **Opening Balance** | ✅ YES | Explicit RPC call | `app/api/accounting/opening-balances/[id]/post/route.ts` | `'opening_balance'` |
| **Asset Depreciation** | ✅ YES | Explicit RPC call | `app/api/assets/[id]/depreciation/route.ts` | `'depreciation'` |

### 3.3 Duplicate Prevention

| Event Type | Duplicate Prevention | Enforcement | Status |
|------------|----------------------|--------------|--------|
| Invoice | ✅ EXISTS check in trigger | Database trigger | ✅ ENFORCED |
| Payment | ✅ EXISTS check in trigger | Database trigger | ✅ ENFORCED |
| Credit Note | ✅ EXISTS check in trigger | Database trigger | ✅ ENFORCED |
| **Sale** | ❌ **MISSING** | Application logic only | ⚠️ **AT RISK** |

**Source:** `ARCHITECTURE_CRITICAL_Q_AND_A.md:Q1`

**Risk:** Sales can be orphaned if network failure occurs after sale INSERT but before `post_sale_to_ledger()` RPC completes. Manual rollback exists but may fail if connection drops.

---

## 4. INVARIANT CHECK

### 4.1 Completeness: Every Posted Event → Exactly One Journal Entry

| Invariant | Status | Evidence |
|----------|--------|----------|
| **Invoices** | ✅ ENFORCED | Trigger checks `EXISTS` before posting |
| **Payments** | ✅ ENFORCED | Trigger checks `EXISTS` before posting |
| **Credit Notes** | ✅ ENFORCED | Trigger checks `EXISTS` before posting |
| **Sales** | ⚠️ PARTIALLY ENFORCED | No existence check in `post_sale_to_ledger()` |
| **Refunds** | ❌ VIOLATED | No journal entry created at all |

**Source:** `ARCHITECTURE_CRITICAL_Q_AND_A.md:Q1`, `REFUND_INVESTIGATION.md`

### 4.2 Balance: Every Journal Entry Balances

| Invariant | Status | Enforcement |
|----------|--------|-------------|
| **Double-entry balance** | ✅ ENFORCED | Trigger `enforce_double_entry_balance()` on `journal_entry_lines` INSERT |
| **Function-level validation** | ✅ ENFORCED | `post_journal_entry()` validates `ABS(total_debit - total_credit) <= 0.01` |
| **Trial Balance balance** | ✅ ENFORCED | `generate_trial_balance()` raises exception if imbalance |

**Source:** `supabase/migrations/088_hard_db_constraints_ledger.sql`, `supabase/migrations/169_trial_balance_canonicalization.sql`

### 4.3 Period Safety: No Posting into Closed Periods

| Invariant | Status | Enforcement |
|----------|--------|-------------|
| **Application-level guards** | ✅ ENFORCED | `assert_accounting_period_is_open()` called in all posting functions |
| **Function-level guards** | ✅ ENFORCED | `post_journal_entry()` validates period status |
| **Trigger-level guards** | ✅ ENFORCED | `validate_period_open_for_entry()` on `journal_entries` INSERT |
| **Service role bypass** | ✅ ENFORCED | Triggers fire for all roles (cannot bypass) |

**Source:** `ARCHITECTURE_CRITICAL_Q_AND_A.md:Q4, Q5`

### 4.4 Non-Bypass: Reports Only Read Ledger Tables

| Invariant | Status | Evidence |
|----------|--------|----------|
| **Canonical Trial Balance** | ✅ ENFORCED | `/api/accounting/reports/trial-balance` reads from `trial_balance_snapshots` |
| **Canonical P&L** | ✅ ENFORCED | `/api/accounting/reports/profit-and-loss` reads from trial balance snapshot |
| **Canonical Balance Sheet** | ✅ ENFORCED | `/api/accounting/reports/balance-sheet` reads from trial balance snapshot |
| **Legacy VAT Report** | ❌ VIOLATED | `/api/reports/vat` reads from `sales` table |
| **Legacy Tax Summary** | ❌ VIOLATED | `/api/reports/tax-summary` reads from `invoices` table |
| **Legacy Aging Report** | ❌ VIOLATED | `/api/reports/aging` reads from `invoices`, `payments` tables |
| **Legacy Cash Office** | ❌ VIOLATED | `/api/reports/cash-office` reads from `sales` table |

**Source:** API route analysis

### 4.5 Workspace Isolation: Accounting Does Not Create Operational Data

| Invariant | Status | Evidence |
|----------|--------|----------|
| **Adjustment journals** | ✅ COMPLIANT | Creates ledger entries only |
| **Opening balance imports** | ❌ VIOLATED | Creates `opening_balance_imports` records (operational) |
| **Firm engagements** | ❌ VIOLATED | Creates `firm_client_engagements` records (operational) |

**Source:** API route analysis

---

## 5. CRITICAL BOUNDARY VIOLATIONS

### 5.1 Accounting → Operational Data Writes

#### Violation 1: `opening_balance_imports` Table
- **Location:** `app/api/accounting/opening-balances/route.ts`
- **Table:** `opening_balance_imports`
- **Issue:** Accounting workspace creates operational import records before posting to ledger
- **Impact:** Creates data dependency between accounting and operational layers
- **Severity:** MEDIUM
- **Recommendation:** Move import tracking to ledger metadata or separate operational service

#### Violation 2: `firm_client_engagements` Table
- **Location:** `app/api/accounting/firm/engagements/route.ts`
- **Table:** `firm_client_engagements`
- **Issue:** Accounting workspace creates engagement records (operational relationship data)
- **Impact:** Breaks workspace isolation principle
- **Severity:** LOW (necessary for firm workflow)
- **Recommendation:** Accept as necessary exception, document as intentional

### 5.2 Report Bypass Paths

#### Violation 3: Legacy Reports Read from Operational Tables
- **Routes:** `/api/reports/vat`, `/api/reports/tax-summary`, `/api/reports/aging`, `/api/reports/cash-office`
- **Issue:** Reports read directly from `sales`, `invoices`, `payments` tables instead of ledger
- **Impact:** Reports may show inconsistent data if operational tables and ledger diverge
- **Severity:** HIGH (data integrity risk)
- **Recommendation:** Migrate to canonical report functions or mark as deprecated

### 5.3 Missing Ledger Posting

#### Violation 4: Refunds Do Not Post to Ledger
- **Location:** `app/api/override/refund-sale/route.ts`
- **Issue:** Refunds update operational data but do not create reversal journal entries
- **Impact:** Ledger and operational data become inconsistent (revenue remains, inventory restored)
- **Severity:** CRITICAL (reconciliation gap)
- **Recommendation:** Implement `post_refund_to_ledger()` function and call from refund API

---

## 6. EXTERNAL CLIENT / ENGAGEMENT FLOW

### 6.1 End-to-End Flow

1. **Firm Onboarding**
   - Route: `/api/accounting/firm/onboarding/complete`
   - Creates: `accounting_firms` record
   - Status: `onboarding_status = 'completed'`

2. **Engagement Creation**
   - Route: `/api/accounting/firm/engagements` (POST)
   - Creates: `firm_client_engagements` record
   - Status: `status = 'pending'` → `'active'` (after acceptance)
   - Fields: `effective_from`, `effective_to`, `access_level`

3. **Client Business Access**
   - Route: `/api/accounting/firm/clients` (GET)
   - Reads: `firm_client_engagements`, `accounting_periods`, `journal_entries`
   - Returns: Client list with period status, pending adjustments count

### 6.2 Period Validation Issue

**Problem:** UI lacks period input, but backend expects `period_start` for canonical reports.

**Evidence:**
- `/api/accounting/reports/trial-balance` requires `period_start` parameter
- `/api/accounting/firm/clients` queries `accounting_periods` to get current period
- UI may not always pass `period_start` when calling report APIs

**Root Cause:** Canonical report functions require `period_id`, but UI may pass `start_date`/`end_date` instead.

**Source:** `app/api/accounting/reports/trial-balance/route.ts:64-70`

### 6.3 Period End Derivation

**Current Behavior:**
- `accounting_periods.period_end` is calculated from `period_start` (last day of month)
- Periods are monthly (YYYY-MM-01 to YYYY-MM-{last day})
- `period_end` is derived, not user-input

**Why Validation Fires:**
- `assert_accounting_period_is_open()` checks period status before posting
- Period resolution uses date range: `p_date >= period_start AND p_date <= period_end`
- If no period exists for date, exception is raised

**Source:** `supabase/migrations/165_period_locking_posting_guards.sql:65-78`

---

## 7. LEGACY / LINGERING ARTIFACTS

### 7.1 Missing Table References

| Table Name | Referenced In | Status | Risk |
|------------|---------------|--------|------|
| `opening_balance_imports` | Migration 150, API routes, tests | ✅ EXISTS | SAFE TO IGNORE (actively used) |
| `accounting_opening_balances` | Migration 096 | ⚠️ UNKNOWN | MUST VERIFY (may be deprecated) |
| `opening_balance_batches` | Migration 134 | ⚠️ UNKNOWN | MUST VERIFY (may be deprecated) |
| `opening_balance_lines` | Migration 134 | ⚠️ UNKNOWN | MUST VERIFY (may be deprecated) |

**Source:** Migration file analysis, grep results

### 7.2 Deprecated Migrations

| Migration | Purpose | Status | Recommendation |
|-----------|---------|--------|----------------|
| 096_opening_balances.sql | Creates `accounting_opening_balances` table | ⚠️ DEPRECATED? | Verify if still used |
| 134_opening_balances_phase2c.sql | Creates `opening_balance_batches`, `opening_balance_lines` | ⚠️ DEPRECATED? | Verify if still used |
| 150_opening_balance_imports_step9_1.sql | Creates `opening_balance_imports` | ✅ ACTIVE | Keep (actively used) |

**Source:** Migration file analysis

### 7.3 Old Engines Still Partially Active

| Engine | Status | Evidence |
|--------|--------|----------|
| **POS/Retail** | ✅ ACTIVE | `/pos` routes, `post_sale_to_ledger()` function |
| **Service/Professional** | ✅ ACTIVE | Invoice/payment triggers, `/invoices` routes |
| **Accounting** | ✅ ACTIVE | Canonical report functions, period management |

**Finding:** All three engines are active. No deprecated engines found.

---

## 8. FAILURE CLASSIFICATION

### 8.1 Known Bugs Reclassified

#### Category 1: Invariant Violations

| Bug | Classification | Root Cause | Impact |
|-----|----------------|------------|--------|
| Refunds don't post to ledger | Invariant violation (completeness) | Missing `post_refund_to_ledger()` call | Ledger/operational data inconsistency |
| Sales can be orphaned | Invariant violation (completeness) | No duplicate prevention in `post_sale_to_ledger()` | Orphaned sales without journal entries |
| Reports show inconsistent data | Invariant violation (non-bypass) | Legacy reports read from operational tables | Data integrity risk |

#### Category 2: Boundary Leaks

| Bug | Classification | Root Cause | Impact |
|-----|----------------|------------|--------|
| Accounting creates `opening_balance_imports` | Boundary leak | Accounting workspace writes operational data | Data dependency between layers |
| Accounting creates `firm_client_engagements` | Boundary leak | Accounting workspace writes operational data | Breaks workspace isolation |

#### Category 3: Orphaned Legacy Code

| Bug | Classification | Root Cause | Impact |
|-----|----------------|------------|--------|
| Legacy report routes bypass trial balance | Orphaned legacy code | Old routes not migrated to canonical functions | Data integrity risk |
| Multiple opening balance table schemas | Orphaned legacy code | Migrations 096, 134 may be deprecated | Confusion, potential data loss |

#### Category 4: UX-Only Errors

| Bug | Classification | Root Cause | Impact |
|-----|----------------|------------|--------|
| Period input missing in UI | UX-only error | UI doesn't always pass `period_start` | User confusion, API errors |

### 8.2 Why Issues Feel "Connected"

**Root Cause Analysis:**

1. **Incomplete Posting Coverage** → Refunds don't post → Ledger/operational mismatch → Reports show wrong data
2. **Report Bypass Paths** → Legacy reports read operational tables → Inconsistent with canonical reports → User confusion
3. **Boundary Leaks** → Accounting creates operational data → Data dependencies → Changes in one workspace affect another
4. **Legacy Artifacts** → Multiple table schemas for same concept → Confusion → Bugs in migration paths

**Interconnection Pattern:**
```
Missing Posting → Data Inconsistency → Report Discrepancies → User Reports Bug
     ↓
Boundary Leaks → Data Dependencies → Changes Break Other Workspaces → User Reports Bug
     ↓
Legacy Code → Multiple Truth Sources → Inconsistent Behavior → User Reports Bug
```

---

## 9. FREEZE ZONES (What Must Not Be Touched)

### 9.1 Core Ledger Infrastructure

**DO NOT MODIFY:**
- `journal_entries` table structure
- `journal_entry_lines` table structure
- `post_journal_entry()` function signature
- Double-entry balance triggers
- Period locking triggers
- Immutability triggers

**Reason:** These are the foundation of accounting integrity. Changes risk breaking all financial statements.

### 9.2 Canonical Report Functions

**DO NOT MODIFY:**
- `generate_trial_balance()` function
- `get_trial_balance_from_snapshot()` function
- `get_profit_and_loss_from_trial_balance()` function
- `get_balance_sheet_from_trial_balance()` function
- `trial_balance_snapshots` table structure

**Reason:** These are the single source of truth for financial statements. Changes risk breaking all reports.

### 9.3 Period Management

**DO NOT MODIFY:**
- `accounting_periods` table structure
- `assert_accounting_period_is_open()` function
- Period status state machine (`open` → `soft_closed` → `locked`)
- Period locking enforcement (triggers, function guards)

**Reason:** Period locking is critical for audit compliance. Changes risk allowing backdating into closed periods.

### 9.4 Automatic Posting Triggers

**DO NOT MODIFY:**
- `trigger_auto_post_invoice`
- `trigger_auto_post_payment`
- `trigger_auto_post_credit_note`
- `trigger_auto_post_expense`
- `trigger_auto_post_bill`

**Reason:** These ensure every operational event posts to ledger. Changes risk breaking completeness invariant.

---

## 10. RECOMMENDED FIX ORDER (No Code)

### Phase 1: Critical Data Integrity (Immediate)

1. **Implement refund ledger posting**
   - Create `post_refund_to_ledger()` function
   - Call from `/api/override/refund-sale/route.ts`
   - Test with existing refunded sales

2. **Add duplicate prevention to sales posting**
   - Add existence check to `post_sale_to_ledger()` function
   - Test with network failure scenarios

3. **Audit orphaned sales**
   - Query for sales without journal entries
   - Create backfill script if needed

### Phase 2: Report Canonicalization (High Priority)

4. **Migrate legacy reports to canonical functions**
   - `/api/reports/vat` → Use ledger-derived tax data
   - `/api/reports/tax-summary` → Use ledger-derived tax data
   - `/api/reports/aging` → Use ledger-derived AR balances
   - `/api/reports/cash-office` → Use ledger-derived cash balances

5. **Deprecate legacy report routes**
   - Mark as deprecated in code
   - Add migration guide for frontend

### Phase 3: Boundary Cleanup (Medium Priority)

6. **Document boundary violations**
   - Accept `firm_client_engagements` as necessary exception
   - Consider moving `opening_balance_imports` to separate service

7. **Verify legacy table usage**
   - Check if `accounting_opening_balances`, `opening_balance_batches` are still used
   - Deprecate or remove if unused

### Phase 4: UX Improvements (Low Priority)

8. **Fix period input in UI**
   - Ensure all report calls pass `period_start`
   - Add period selector to report UIs

---

## APPENDIX: EVIDENCE SOURCES

### Architecture Documents
- `ARCHITECTURE_CRITICAL_Q_AND_A.md` - Invariant guarantees, failure handling
- `FINZA_ECOSYSTEM_ARCHITECTURE.md` - Three-pillar architecture
- `audit-pack/ACCOUNTING_ARCHITECTURE.md` - System flow, database schema
- `audit-pack/ACCOUNTING_CONTROLS.md` - Control policies

### Code Evidence
- `lib/accessControl.ts` - Workspace definitions
- `app/api/sales/create/route.ts` - Sale posting logic
- `app/api/override/refund-sale/route.ts` - Refund logic (missing posting)
- `app/api/accounting/reports/*/route.ts` - Canonical report routes
- `app/api/reports/*/route.ts` - Legacy report routes (bypass paths)

### Migration Evidence
- `supabase/migrations/043_accounting_core.sql` - Base ledger structure
- `supabase/migrations/162_complete_sale_ledger_postings.sql` - Sale posting
- `supabase/migrations/169_trial_balance_canonicalization.sql` - Trial balance canonicalization
- `supabase/migrations/165_period_locking_posting_guards.sql` - Period locking
- `supabase/migrations/150_opening_balance_imports_step9_1.sql` - Opening balance imports

### Investigation Documents
- `REFUND_INVESTIGATION.md` - Refund posting gap analysis
- `ACCOUNTANT_FIRST_MODE_INVESTIGATION.md` - External client flow analysis

---

**END OF AUDIT REPORT**
