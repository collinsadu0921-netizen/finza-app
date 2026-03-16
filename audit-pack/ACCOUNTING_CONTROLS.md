# Accounting Policies & Controls Document

**Document Version:** 1.0  
**Date:** 2025-01-17  
**Classification:** Auditor-facing control documentation  
**Audience:** External accountants, auditors, compliance reviewers

---

## EXECUTIVE SUMMARY

This document describes the accounting policies and automated controls enforced in the Finza accounting system. All controls are implemented at the database level (triggers, functions, constraints) or application level (function guards), with hard errors on violations (no silent fallbacks).

**Control Categories:**
1. Revenue recognition policy
2. Inventory & COGS policy
3. Period close & lock policy
4. Adjustment policy (soft-closed periods only)
5. Opening balance rollforward policy
6. Trial Balance canonicalization policy
7. CI / regression prevention policy

Each control includes:
- **Control objective:** What business requirement is met
- **Control description:** How the control works
- **Enforcement mechanism:** Database / application / CI level
- **Failure behavior:** What happens when control fails (hard error)

---

## 1. REVENUE RECOGNITION POLICY

### Control Objective
Revenue is recognized when a sale or invoice transaction is created and posted to the ledger, following accrual basis accounting principles.

### Control Description
- **Sales (Retail):** Revenue is recognized when `post_sale_to_ledger()` is called for a sale transaction
  - Debit: Cash/AR account (1000-1099)
  - Credit: Revenue account (4000)
- **Invoices (Service):** Revenue is recognized when `post_invoice_to_ledger()` is called for an invoice
  - Debit: AR account (1100)
  - Credit: Revenue account (4000)

**Revenue is always posted at transaction value (subtotal excluding taxes). Taxes are posted separately to Tax Payable accounts (2100-2130, 2200+).**

### Enforcement Mechanism
- **Application Level:** Posting functions (`post_sale_to_ledger`, `post_invoice_to_ledger`) are the only paths to create revenue journal entries
- **Database Level:** Journal entries are immutable after creation (trigger: `prevent_journal_entry_modification`)
- **Validation:** Double-entry balance enforced (trigger: `enforce_double_entry_balance`)

### Failure Behavior
- **Unbalanced entry:** Transaction rejected with exception: `"Journal entry must balance. Debit: X, Credit: Y"`
- **Immutable violation:** Exception raised: `"Journal entry lines are immutable (append-only). Cannot UPDATE/DELETE journal entry line. Use adjustment journals for corrections."`

**Database Function:** `post_sale_to_ledger()`, `post_invoice_to_ledger()`  
**Migration:** 043_accounting_core.sql, 162_complete_sale_ledger_postings.sql

---

## 2. INVENTORY & COGS POLICY

### Control Objective
Cost of Goods Sold (COGS) is recognized simultaneously with revenue for inventory sales, using a perpetual inventory system.

### Control Description
- **Inventory Sales:** When a sale includes inventory items (products with `product_id` in `sale_items`), the following entries are created:
  - Debit: Cash/AR account (1000-1099)
  - Credit: Revenue account (4000)
  - **Debit: COGS account (5000)** [for inventory sales]
  - **Credit: Inventory account (1200)** [for inventory sales]
- **Non-Inventory Sales:** Sales without inventory items post only Cash/AR and Revenue (no COGS/Inventory entries)

**COGS and Inventory entries are created automatically when `post_sale_to_ledger()` detects inventory items in the sale.**

### Enforcement Mechanism
- **Application Level:** `post_sale_to_ledger()` checks `sale_items` for inventory products and creates COGS/Inventory lines automatically
- **Database Level:** Journal entry completeness validated by `run_accounting_invariant_audit()` (checks for required accounts)
- **Validation:** Sale ledger completeness checked in `detect_legacy_issues()` function

### Failure Behavior
- **Missing COGS for inventory sale:** Detected by invariant audit as `sale_jes_missing_cogs`
- **Missing Inventory for inventory sale:** Detected by invariant audit as `sale_jes_missing_inventory`
- **Audit failure:** `run_accounting_invariant_audit()` returns `FAIL` status for `sale_ledger_line_completeness` invariant

**Database Function:** `post_sale_to_ledger()`  
**Migration:** 162_complete_sale_ledger_postings.sql

---

## 3. PERIOD CLOSE & LOCK POLICY

### Control Objective
Accounting periods follow a strict state machine: `open` → `soft_closed` → `locked`. Locked periods are immutable and cannot accept any postings.

### Control Description
- **Open Period:** Accepts all regular postings (sales, invoices, expenses, payments)
- **Soft-Closed Period:** Accepts adjustment entries only (via `apply_adjusting_journal()`); regular postings blocked
- **Locked Period:** Accepts no postings (immutable forever); adjustments must be posted in later open periods

**Period transitions:**
- `open` → `soft_closed`: Via `soft_close` action (creates `accounting_period_actions` record)
- `soft_closed` → `locked`: Via `lock` action (creates `accounting_period_actions` record)
- **No reverse transitions:** Locked periods cannot be reopened

### Enforcement Mechanism
- **Application Level:** `assert_accounting_period_is_open()` called in all posting functions
  - Regular postings (`p_is_adjustment = FALSE`): Only allowed in `'open'` periods
  - Adjustments (`p_is_adjustment = TRUE`): Allowed in `'open'` or `'soft_closed'` periods
  - All postings: Blocked in `'locked'` periods
- **Database Function Level:** `post_journal_entry()` validates period status before INSERT
- **Database Trigger Level:** `validate_period_open_for_entry()` on `journal_entries` INSERT
  - Checks period status via `accounting_periods` table
  - Blocks INSERT if period is `'locked'` or `'soft_closed'` (for regular postings)

### Failure Behavior
- **Posting into locked period:** Exception raised: `"Accounting period is locked (period_start: X). Posting is blocked. Post an adjustment in a later open period."`
- **Regular posting into soft-closed period:** Exception raised: `"Accounting period is soft-closed (period_start: X). Regular postings are blocked. Only adjustments are allowed in soft-closed periods."`
- **Direct SQL bypass attempt:** Trigger still blocks INSERT (hard enforcement at database level)

**Database Function:** `assert_accounting_period_is_open()`, `validate_period_open_for_entry()`  
**Trigger:** `trigger_enforce_period_state_on_entry` on `journal_entries`  
**Migration:** 165_period_locking_posting_guards.sql, 166_controlled_adjustments_soft_closed.sql

---

## 4. ADJUSTMENT POLICY (SOFT-CLOSED PERIODS ONLY)

### Control Objective
Adjusting journal entries are allowed in soft-closed periods with mandatory metadata (reason, reference, actor) and audit trail logging.

### Control Description
- **Adjustments in Soft-Closed Periods:** Only entries with `is_adjustment = TRUE` are allowed
  - Requires `adjustment_reason` (non-empty TEXT)
  - Requires `reference_type = 'adjustment'`
  - Requires `reference_id = NULL` (adjustments are standalone entries)
  - Optional `adjustment_ref` (external ticket/audit reference)
- **Audit Trail:** All adjustments are logged to `accounting_adjustment_audit` table with:
  - `actor_user_id` (who created the adjustment)
  - `affected_accounts` (JSONB array of account codes, names, debits, credits)
  - `total_debit`, `total_credit` (for reconciliation)
  - `adjustment_reason`, `adjustment_ref`

**Adjustments in locked periods are blocked.** Adjustments for locked periods must be posted in later open periods.

### Enforcement Mechanism
- **Application Level:** `apply_adjusting_journal()` is the only function that creates adjustments
  - Validates period status (`'open'` or `'soft_closed'`, not `'locked'`)
  - Validates adjustment metadata (reason required, reference_type = 'adjustment')
  - Logs to `accounting_adjustment_audit` table
- **Database Function Level:** `post_journal_entry()` validates adjustment metadata
  - If `is_adjustment = TRUE`, requires `adjustment_reason`, `reference_type = 'adjustment'`, `reference_id = NULL`
- **Database Trigger Level:** `validate_period_open_for_entry()` allows adjustments in `'soft_closed'` periods if `is_adjustment = TRUE`

### Failure Behavior
- **Missing adjustment_reason:** Exception raised: `"Adjustment entries require a non-empty adjustment_reason"`
- **Invalid reference_type:** Exception raised: `"Adjustment entries must have reference_type = 'adjustment'. Found: X"`
- **Non-null reference_id:** Exception raised: `"Adjustment entries must have reference_id = NULL. Adjustments are standalone entries."`
- **Adjustment in locked period:** Exception raised: `"Adjusting journals cannot be posted into locked periods. Period status: locked."`

**Database Function:** `apply_adjusting_journal()`, `post_journal_entry()`  
**Audit Table:** `accounting_adjustment_audit`  
**Migration:** 166_controlled_adjustments_soft_closed.sql

---

## 5. OPENING BALANCE ROLLFORWARD POLICY

### Control Objective
Opening balances for each period must equal the closing balances of the prior period (ledger-derived rollforward). Opening balances are immutable after generation.

### Control Description
- **Rollforward Source:** Opening balances are calculated from prior period closing balances using `calculate_period_closing_balance_from_ledger()`
  - Source: `period_opening_balances` (prior period) + `journal_entry_lines` (prior period activity)
  - Ledger-only: No operational tables used
- **Balance Sheet Accounts Only:** Only asset, liability, and equity accounts carry forward (income and expense accounts reset to 0)
- **First Period:** First-ever period uses `'manual_bootstrap'` source (all opening balances = 0)
- **Subsequent Periods:** Require prior period to be `'locked'` before generating opening balances

**Opening balances are generated once per period and cannot be modified or deleted after creation.**

### Enforcement Mechanism
- **Application Level:** `generate_opening_balances()` validates prior period is `'locked'` before generating
  - Checks prior period status before rollforward calculation
  - Blocks generation if prior period is not `'locked'`
- **Database Function Level:** `calculate_period_closing_balance_from_ledger()` calculates closing balance from ledger only
  - Uses `period_opening_balances` + `journal_entry_lines` (no operational tables)
- **Database Trigger Level:** `enforce_opening_balance_immutability()` blocks UPDATE/DELETE on `period_opening_balances`
- **Validation Function:** `verify_rollforward_integrity()` verifies opening balances match prior closing balances
  - Raises exception if mismatch detected

### Failure Behavior
- **Prior period not locked:** Exception raised: `"Prior period must be locked before generating opening balances. Prior period status: X."`
- **Opening balance modification:** Exception raised: `"Opening balances are immutable once created. Period ID: X, period_start: Y. Use generate_opening_balances() to recreate if needed."`
- **Rollforward mismatch:** Exception raised by `verify_rollforward_integrity()`: `"Rollforward integrity violation: X account(s) have opening balances that do not match prior period closing balances."`

**Database Function:** `generate_opening_balances()`, `calculate_period_closing_balance_from_ledger()`, `verify_rollforward_integrity()`  
**Trigger:** `trigger_enforce_opening_balance_immutability` on `period_opening_balances`  
**Migration:** 168_opening_balances_rollforward_invariants.sql

---

## 6. TRIAL BALANCE CANONICALIZATION POLICY

### Control Objective
Trial Balance is the single canonical truth source for all downstream financial statements. Trial Balance must balance (debits = credits) and all statements must reconcile to it.

### Control Description
- **Canonical Source:** Trial Balance is generated from `period_opening_balances` + `journal_entry_lines` only (ledger-derived)
  - Function: `generate_trial_balance(p_period_id)`
  - Persisted to `trial_balance_snapshots` table
- **Hard Invariant:** Total debits MUST equal total credits (tolerance: 0.01)
  - Enforced with RAISE EXCEPTION if imbalance detected
- **Downstream Consumption:** P&L and Balance Sheet consume Trial Balance snapshot only
  - P&L: `get_profit_and_loss_from_trial_balance()` filters income/expense accounts from snapshot
  - Balance Sheet: `get_balance_sheet_from_trial_balance()` filters asset/liability/equity accounts from snapshot
  - **No direct ledger queries:** Statements do not query `journal_entry_lines` directly

**Financial statements are derived from Trial Balance, not calculated independently from ledger data.**

### Enforcement Mechanism
- **Generation:** `generate_trial_balance()` enforces balance invariant
  - Calculates `total_debits` and `total_credits` from `journal_entry_lines`
  - Raises exception if `ABS(total_debits - total_credits) > 0.01`
  - Persists snapshot with `is_balanced = TRUE` only if balanced
- **Consumption:** P&L and Balance Sheet functions query `trial_balance_snapshots` only
  - `get_profit_and_loss_from_trial_balance()` calls `get_trial_balance_from_snapshot()` first
  - `get_balance_sheet_from_trial_balance()` calls `get_trial_balance_from_snapshot()` first
- **Validation:** `validate_statement_reconciliation()` verifies statements reconcile to Trial Balance
  - Checks Balance Sheet equation: Assets = Liabilities + Equity
  - Raises exception if reconciliation fails

### Failure Behavior
- **Trial Balance imbalance:** Exception raised: `"PHASE 9 VIOLATION: Trial Balance does not balance. Total Debits: X, Total Credits: Y, Difference: Z. All journal entries must be balanced before generating trial balance."`
- **Statement reconciliation failure:** Exception raised: `"PHASE 9 VIOLATION: Balance Sheet does not balance. Assets: X, Liabilities: Y, Equity: Z, Difference: W"`

**Database Function:** `generate_trial_balance()`, `get_trial_balance_from_snapshot()`, `get_profit_and_loss_from_trial_balance()`, `get_balance_sheet_from_trial_balance()`, `validate_statement_reconciliation()`  
**Table:** `trial_balance_snapshots`  
**Migration:** 169_trial_balance_canonicalization.sql

---

## 7. CI / REGRESSION PREVENTION POLICY

### Control Objective
Automated continuous integration (CI) checks prevent accounting logic regressions by running invariant audits before code is merged to production.

### Control Description
- **CI Workflow:** GitHub Actions workflow (`.github/workflows/accounting-invariants.yml`) runs on:
  - Pull requests to `main` or `develop` branches
  - Pushes to `main` or `develop` branches
  - Manual workflow dispatch
- **Audit Script:** `scripts/accounting-ci-audit.ts` calls `run_business_accounting_audit(p_business_id, p_limit_periods)`
  - Audits most recent N periods (default: 3)
  - Tests 8 invariants per period (see `run_accounting_invariant_audit()`)
- **Bypass Detection:** `scripts/detect-report-bypass.ts` detects if reporting functions bypass Trial Balance

**CI checks must pass before code can be merged. Failed audits block deployment.**

### Enforcement Mechanism
- **CI Level:** GitHub Actions workflow runs audit script on every pull request
  - Exit code 0: All invariants pass (merge allowed)
  - Exit code 1: One or more invariants fail (merge blocked)
- **Database Function Level:** `run_business_accounting_audit()` returns JSONB with `overall_status` ('PASS' or 'FAIL')
  - Checks 8 invariants per period (sale completeness, ledger completeness, period guards, state machine, rollforward, trial balance balance, statement reconciliation, canonical functions)
- **Application Level:** Audit script parses results and exits with appropriate code

### Failure Behavior
- **Invariant failure:** CI job fails with exit code 1
  - Console output shows failed periods and specific invariant violations
  - Pull request merge blocked until issues resolved
- **Audit script error:** CI job fails with error message
  - Database connection or function execution errors are reported
  - Pull request merge blocked until errors resolved

**CI Script:** `scripts/accounting-ci-audit.ts`  
**CI Workflow:** `.github/workflows/accounting-invariants.yml`  
**Database Function:** `run_business_accounting_audit()`, `run_accounting_invariant_audit()`  
**Migration:** 170_accounting_invariant_audit.sql

---

## CONTROL EFFECTIVENESS SUMMARY

All controls are enforced at multiple layers (application, database function, database trigger) to prevent bypass:

| Control | Application Level | Database Function | Database Trigger | Hard Error |
|---------|------------------|-------------------|------------------|------------|
| Double-entry | `post_journal_entry()` validates | `validate_journal_entry_balance()` | `enforce_double_entry_balance()` | ✅ |
| Period locking | `assert_accounting_period_is_open()` | `post_journal_entry()` validates | `validate_period_open_for_entry()` | ✅ |
| Immutability | N/A (enforced at DB) | N/A | `prevent_journal_entry_modification()`, `prevent_journal_entry_line_modification()`, `enforce_opening_balance_immutability()` | ✅ |
| Trial Balance balance | `generate_trial_balance()` validates | `generate_trial_balance()` enforces | N/A (function-level enforcement) | ✅ |
| Opening balance rollforward | `generate_opening_balances()` validates | `verify_rollforward_integrity()` | `enforce_opening_balance_immutability()` | ✅ |
| Adjustment metadata | `apply_adjusting_journal()` validates | `post_journal_entry()` validates | `validate_period_open_for_entry()` | ✅ |
| CI regression prevention | Audit script exits with code | `run_business_accounting_audit()` returns status | N/A (CI-level enforcement) | ✅ |

**Result:** Impossible to bypass controls via direct SQL, application code, or CI bypass. All violations raise exceptions with descriptive error messages.

---

## VERIFICATION

All controls can be verified via:

1. **Database functions:** Execute `run_accounting_invariant_audit(period_id)` to test all invariants
2. **CI checks:** Review CI workflow results in GitHub Actions
3. **Trigger existence:** Query `pg_trigger` system catalog to verify trigger definitions
4. **Migration history:** Review migration files in `supabase/migrations/` to trace control implementation

---

**END OF DOCUMENT**
