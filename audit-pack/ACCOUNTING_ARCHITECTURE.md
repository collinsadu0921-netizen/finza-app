# System Accounting Architecture Overview

**Document Version:** 1.0  
**Date:** 2025-01-17  
**Classification:** Auditor-facing technical documentation  
**Audience:** External accountants, auditors, compliance reviewers

---

## EXECUTIVE SUMMARY

The Finza accounting system implements a double-entry, ledger-based accounting model with strict period locking, immutability controls, and canonical reporting functions. All financial statements are derived exclusively from the ledger (journal entries and ledger lines), with no direct calculation from operational source data.

**Key Architecture Principles:**
- **Double-entry enforced:** Every journal entry must balance (debits = credits)
- **Period locking enforced:** Locked periods are immutable; soft-closed periods allow adjustments only
- **Ledger-only reporting:** All financial statements are derived from `journal_entries` and `journal_entry_lines` tables
- **Immutability enforced:** Journal entries and ledger lines cannot be updated or deleted once created
- **Canonical functions:** Trial Balance is the single source of truth for all downstream statements

---

## SYSTEM FLOW DIAGRAM

```
OPERATIONAL EVENTS
    │
    ├─ Sales (Retail)
    ├─ Invoices (Service)
    ├─ Expenses
    └─ Payments
    │
    ▼
POSTING FUNCTIONS
    │
    ├─ post_sale_to_ledger()
    ├─ post_invoice_to_ledger()
    ├─ post_expense_to_ledger()
    └─ post_invoice_payment_to_ledger()
    │
    ▼
JOURNAL ENTRIES (journal_entries)
    │
    ▼
JOURNAL ENTRY LINES (journal_entry_lines)
    │
    ├─ Double-entry validation (trigger: enforce_double_entry_balance)
    ├─ Period status validation (trigger: validate_period_open_for_entry)
    └─ Immutability enforcement (triggers: prevent_journal_entry_modification, prevent_journal_entry_line_modification)
    │
    ▼
PERIOD OPENING BALANCES (period_opening_balances)
    │
    ├─ Rollforward from prior period closing balance
    └─ Immutability after generation (trigger: enforce_opening_balance_immutability)
    │
    ▼
TRIAL BALANCE (trial_balance_snapshots)
    │
    ├─ Function: generate_trial_balance()
    ├─ Source: period_opening_balances + journal_entry_lines
    ├─ Validation: SUM(debits) MUST equal SUM(credits)
    └─ Persisted snapshot for downstream consumption
    │
    ▼
FINANCIAL STATEMENTS
    │
    ├─ Profit & Loss: get_profit_and_loss_from_trial_balance()
    ├─ Balance Sheet: get_balance_sheet_from_trial_balance()
    └─ Both consume trial_balance_snapshots only (no direct ledger queries)
```

---

## DATABASE SCHEMA CORE TABLES

### 1. journal_entries
**Purpose:** Header record for each accounting transaction  
**Key Columns:**
- `id` (UUID, primary key)
- `business_id` (UUID, foreign key to businesses)
- `date` (DATE, transaction date)
- `description` (TEXT, human-readable description)
- `reference_type` (TEXT, e.g., 'sale', 'invoice', 'expense', 'payment', 'adjustment')
- `reference_id` (UUID, link to source operational record, NULL for adjustments)
- `is_adjustment` (BOOLEAN, TRUE for adjusting entries)
- `adjustment_reason` (TEXT, required if is_adjustment = TRUE)
- `entry_type` (TEXT, 'backfill' for Phase 12 backfilled entries)
- `backfill_reason` (TEXT, reason for backfill)
- `backfill_actor` (TEXT, who performed backfill)

**Constraints:**
- Immutable after creation (trigger prevents UPDATE/DELETE)
- Period status validated before INSERT (trigger: `validate_period_open_for_entry`)

### 2. journal_entry_lines
**Purpose:** Individual debit/credit lines for each journal entry  
**Key Columns:**
- `id` (UUID, primary key)
- `journal_entry_id` (UUID, foreign key to journal_entries)
- `account_id` (UUID, foreign key to accounts)
- `debit` (NUMERIC, debit amount, default 0)
- `credit` (NUMERIC, credit amount, default 0)
- `description` (TEXT, line description)

**Constraints:**
- Immutable after creation (trigger prevents UPDATE/DELETE)
- Double-entry balance validated on INSERT (trigger: `enforce_double_entry_balance`)
- Exactly one of `debit` or `credit` must be > 0 (not both)

### 3. accounting_periods
**Purpose:** Monthly accounting periods with status workflow  
**Key Columns:**
- `id` (UUID, primary key)
- `business_id` (UUID, foreign key to businesses)
- `period_start` (DATE, first day of month, must be YYYY-MM-01)
- `period_end` (DATE, last day of same month)
- `status` (TEXT, one of: 'open', 'soft_closed', 'locked')

**Status Workflow:**
- `open` → `soft_closed` (via soft_close action)
- `soft_closed` → `locked` (via lock action)
- No reverse transitions (locked periods cannot be reopened)

**Constraints:**
- No overlapping periods per business (exclusion constraint: `exclude_overlapping_periods`)
- Month boundaries validated (trigger: `trigger_validate_accounting_period_month_boundaries`)

### 4. period_opening_balances
**Purpose:** Opening balance snapshot for each period per account  
**Key Columns:**
- `period_id` (UUID, foreign key to accounting_periods)
- `account_id` (UUID, foreign key to accounts)
- `opening_balance` (NUMERIC, opening balance for period)
- `source` (TEXT, 'rollforward' or 'manual_bootstrap')
- `rollforward_from_period_id` (UUID, prior period if source = 'rollforward')

**Constraints:**
- Immutable after creation (trigger: `enforce_opening_balance_immutability`)
- Opening balance must equal prior period closing balance (verified by `verify_rollforward_integrity`)

### 5. trial_balance_snapshots
**Purpose:** Canonical trial balance snapshot per period  
**Key Columns:**
- `period_id` (UUID, foreign key to accounting_periods, UNIQUE)
- `business_id` (UUID, foreign key to businesses)
- `total_debits` (NUMERIC, sum of all debit totals)
- `total_credits` (NUMERIC, sum of all credit totals)
- `is_balanced` (BOOLEAN, MUST be TRUE, enforced by `generate_trial_balance`)
- `balance_difference` (NUMERIC, MUST be 0, enforced by `generate_trial_balance`)
- `snapshot_data` (JSONB, array of account balances)

**Constraints:**
- Hard invariant: `total_debits` MUST equal `total_credits` (enforced with RAISE EXCEPTION in `generate_trial_balance`)
- Single source of truth for all downstream financial statements

---

## CANONICAL DATABASE FUNCTIONS

### Posting Functions

**1. `post_journal_entry()`**
- **Purpose:** Creates journal entry with validation
- **Parameters:** 13 parameters (supports adjustment and backfill metadata)
- **Validations:**
  - Period status check (via `assert_accounting_period_is_open`)
  - Double-entry balance (debits must equal credits, tolerance: 0.01)
  - Adjustment metadata (if `is_adjustment = TRUE`, requires `adjustment_reason`, `reference_type = 'adjustment'`)
  - Backfill metadata (if `entry_type = 'backfill'`, requires `backfill_reason` and `backfill_actor`)
- **Returns:** UUID (journal_entry_id)
- **Migration:** 043_accounting_core.sql (base), 166_controlled_adjustments_soft_closed.sql (adjustments), 171_phase12_backfill_legacy_data.sql (backfill)

**2. `post_sale_to_ledger(p_sale_id UUID, ...)`**
- **Purpose:** Posts retail sale transaction to ledger
- **Ledger Lines Created:**
  - Debit: Cash/AR account (asset account 1000-1099)
  - Credit: Revenue account (4000)
  - Debit: COGS account (5000) [if inventory sale]
  - Credit: Inventory account (1200) [if inventory sale]
  - Credit: Tax Payable accounts (2100-2130, 2200+) [if tax applied]
- **Migration:** 162_complete_sale_ledger_postings.sql

**3. `post_invoice_to_ledger(p_invoice_id UUID, ...)`**
- **Purpose:** Posts service invoice transaction to ledger
- **Ledger Lines Created:**
  - Debit: AR account (1100)
  - Credit: Revenue account (4000)
  - Credit: Tax Payable accounts (2100-2130, 2200+) [if tax applied]
- **Migration:** 043_accounting_core.sql (base), 172_phase12b_backfill_completion_compatibility.sql (backfill support)

**4. `post_expense_to_ledger(p_expense_id UUID, ...)`**
- **Purpose:** Posts expense transaction to ledger
- **Ledger Lines Created:**
  - Debit: Expense account (5100)
  - Credit: Cash account (1000)
  - Debit: Tax accounts (if input tax recoverable)
- **Migration:** 043_accounting_core.sql (base), 172_phase12b_backfill_completion_compatibility.sql (backfill support)

**5. `post_invoice_payment_to_ledger(p_payment_id UUID, ...)`**
- **Purpose:** Posts invoice payment to ledger
- **Ledger Lines Created:**
  - Debit: Cash/Bank/MoMo account (based on payment method)
  - Credit: AR account (1100)
- **Migration:** 043_accounting_core.sql (base), 172_phase12b_backfill_completion_compatibility.sql (backfill support)

### Period Management Functions

**6. `assert_accounting_period_is_open(p_business_id UUID, p_date DATE, p_is_adjustment BOOLEAN)`**
- **Purpose:** Validates period status before posting
- **Rules:**
  - Regular postings (`p_is_adjustment = FALSE`): Only allowed in `'open'` periods
  - Adjustments (`p_is_adjustment = TRUE`): Allowed in `'open'` or `'soft_closed'` periods
  - All postings: Blocked in `'locked'` periods (hard error)
- **Migration:** 165_period_locking_posting_guards.sql (base), 166_controlled_adjustments_soft_closed.sql (adjustment support)

**7. `generate_opening_balances(p_new_period_id UUID, p_created_by UUID)`**
- **Purpose:** Generates opening balances for a new period
- **Source:** Prior period closing balance (calculated via `calculate_period_closing_balance_from_ledger`)
- **Requirements:**
  - Prior period must be `'locked'` (if prior period exists)
  - New period must be `'open'`
- **Returns:** JSONB summary with account count, totals, source
- **Migration:** 168_opening_balances_rollforward_invariants.sql

**8. `verify_rollforward_integrity(p_period_id UUID)`**
- **Purpose:** Validates opening balances match prior period closing balances
- **Returns:** JSONB with validation result (raises exception on mismatch)
- **Migration:** 168_opening_balances_rollforward_invariants.sql

### Trial Balance Functions

**9. `generate_trial_balance(p_period_id UUID, p_generated_by UUID)`**
- **Purpose:** Generates canonical trial balance snapshot
- **Source:** `period_opening_balances` + `journal_entry_lines` (ledger-only)
- **Output:** Persists to `trial_balance_snapshots` table
- **Hard Invariant:** Raises exception if `ABS(total_debits - total_credits) > 0.01`
- **Migration:** 169_trial_balance_canonicalization.sql

**10. `get_trial_balance_from_snapshot(p_period_id UUID)`**
- **Purpose:** Returns trial balance from canonical snapshot
- **Source:** `trial_balance_snapshots.snapshot_data`
- **Auto-generation:** If snapshot doesn't exist, calls `generate_trial_balance` first
- **Migration:** 169_trial_balance_canonicalization.sql

### Financial Statement Functions

**11. `get_profit_and_loss_from_trial_balance(p_period_id UUID)`**
- **Purpose:** Returns P&L statement (income and expense accounts only)
- **Source:** Trial balance snapshot only (no direct ledger queries)
- **Migration:** 169_trial_balance_canonicalization.sql

**12. `get_balance_sheet_from_trial_balance(p_period_id UUID)`**
- **Purpose:** Returns Balance Sheet (asset, liability, equity accounts only)
- **Source:** Trial balance snapshot only (no direct ledger queries)
- **Migration:** 169_trial_balance_canonicalization.sql

**13. `validate_statement_reconciliation(p_period_id UUID)`**
- **Purpose:** Validates P&L and Balance Sheet reconcile to Trial Balance
- **Validation:** Balance Sheet equation (Assets = Liabilities + Equity)
- **Returns:** JSONB with reconciliation result (raises exception on failure)
- **Migration:** 169_trial_balance_canonicalization.sql

### Audit Functions

**14. `run_accounting_invariant_audit(p_period_id UUID)`**
- **Purpose:** Runs comprehensive read-only invariant checks for a period
- **Checks:** 8 invariants (sale completeness, ledger completeness, period guards, state machine, rollforward, trial balance balance, statement reconciliation, canonical functions)
- **Returns:** JSONB with PASS/FAIL status for each invariant
- **Migration:** 170_accounting_invariant_audit.sql

**15. `run_business_accounting_audit(p_business_id UUID, p_limit_periods INTEGER)`**
- **Purpose:** Runs invariant audit for multiple periods (most recent N)
- **Returns:** JSONB with aggregate results across all audited periods
- **Migration:** 170_accounting_invariant_audit.sql

---

## ENFORCEMENT MECHANISMS

### 1. Double-Entry Enforcement
- **Trigger:** `enforce_double_entry_balance()` on `journal_entry_lines` INSERT
- **Function:** `validate_journal_entry_balance(p_journal_entry_id UUID)`
- **Tolerance:** 0.01 (for floating-point precision)
- **Failure:** Transaction rejected, exception raised

### 2. Period Locking Enforcement
- **Application Level:** `assert_accounting_period_is_open()` called in all posting functions
- **Database Function Level:** `post_journal_entry()` validates period status
- **Database Trigger Level:** `validate_period_open_for_entry()` on `journal_entries` INSERT
- **Failure:** Hard error, exception raised with period status and date

### 3. Immutability Enforcement
- **Journal Entries:** Trigger `prevent_journal_entry_modification()` blocks UPDATE/DELETE
- **Journal Entry Lines:** Trigger `prevent_journal_entry_line_modification()` blocks UPDATE/DELETE
- **Opening Balances:** Trigger `enforce_opening_balance_immutability()` blocks UPDATE/DELETE
- **Failure:** Exception raised with entity type and period information

### 4. Trial Balance Canonicalization
- **Generation:** `generate_trial_balance()` enforces `total_debits = total_credits` (hard invariant)
- **Consumption:** P&L and Balance Sheet functions consume `trial_balance_snapshots` only
- **Validation:** `validate_statement_reconciliation()` verifies statements reconcile to Trial Balance
- **Failure:** Exception raised with imbalance details

---

## ARCHITECTURAL GUARANTEES

1. **Double-entry enforced at all layers:**
   - Function level: `post_journal_entry()` validates balance before INSERT
   - Trigger level: `enforce_double_entry_balance()` validates after INSERT
   - Result: Impossible to create unbalanced journal entries

2. **Period locking enforced at all layers:**
   - Application level: `assert_accounting_period_is_open()` in posting functions
   - Function level: `post_journal_entry()` validates period status
   - Trigger level: `validate_period_open_for_entry()` on INSERT
   - Result: Impossible to post into locked periods, even via direct SQL

3. **Ledger-only reporting:**
   - Trial Balance: Generated from `period_opening_balances` + `journal_entry_lines`
   - P&L: Consumes Trial Balance snapshot only
   - Balance Sheet: Consumes Trial Balance snapshot only
   - Result: Financial statements are deterministic and reproducible from ledger data

4. **Immutability enforced:**
   - Journal entries and lines: Triggers prevent UPDATE/DELETE
   - Opening balances: Trigger prevents UPDATE/DELETE
   - Result: Historical records cannot be modified; corrections require adjustment entries

5. **Canonical functions:**
   - Trial Balance: `get_trial_balance_from_snapshot()` is the single source
   - P&L: `get_profit_and_loss_from_trial_balance()` consumes snapshot only
   - Balance Sheet: `get_balance_sheet_from_trial_balance()` consumes snapshot only
   - Result: No bypass paths; all statements derive from canonical Trial Balance

---

## MIGRATION REFERENCES

All accounting controls and invariants are implemented via database migrations in `supabase/migrations/`:

- **043_accounting_core.sql:** Base ledger structure and posting functions
- **088_hard_db_constraints_ledger.sql:** Double-entry and immutability triggers
- **094_accounting_periods.sql:** Period structure and guards
- **132_accounting_periods_phase1b_integrity.sql:** Period integrity constraints
- **162_complete_sale_ledger_postings.sql:** Complete sale posting with COGS/Inventory
- **165_period_locking_posting_guards.sql:** Hard period locking enforcement
- **166_controlled_adjustments_soft_closed.sql:** Adjustment entry support
- **167_period_close_workflow.sql:** Period close/lock workflow
- **168_opening_balances_rollforward_invariants.sql:** Opening balance rollforward
- **169_trial_balance_canonicalization.sql:** Trial Balance as canonical source
- **170_accounting_invariant_audit.sql:** System-wide invariant audit functions
- **171_phase12_backfill_legacy_data.sql:** Phase 12 data backfill
- **172_phase12b_backfill_completion_compatibility.sql:** Phase 12B backfill completion

---

## VERIFICATION

All architectural guarantees are verifiable via:

1. **Database functions:** Execute `run_accounting_invariant_audit(period_id)` to verify all invariants
2. **CI checks:** Automated invariant audits run on every pull request (see `CI_CONTROL_EVIDENCE.md`)
3. **Migration history:** All controls are implemented via versioned migrations
4. **Trigger existence:** Database triggers can be verified via `pg_trigger` system catalog

---

**END OF DOCUMENT**
