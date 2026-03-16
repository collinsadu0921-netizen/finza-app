# Audit Walkthrough Evidence (Step-by-Step)

**Document Version:** 1.0  
**Date:** 2025-01-17  
**Classification:** Auditor-facing procedural documentation  
**Audience:** External accountants, auditors, compliance reviewers

---

## EXECUTIVE SUMMARY

This document provides step-by-step walkthrough evidence for key accounting transactions and workflows. Each walkthrough includes the specific functions executed, tables touched, guards enforced, and expected outcomes.

**Walkthroughs Covered:**
1. Sale creation → journal entry → ledger lines
2. Period close → soft_close → lock
3. Adjustment entry in soft-closed period
4. Opening balance rollforward
5. Trial Balance generation
6. P&L and Balance Sheet reconciliation

**Each walkthrough is deterministic and reproducible** - given the same inputs, the same outputs will be produced.

---

## WALKTHROUGH 1: SALE CREATION → JOURNAL ENTRY → LEDGER LINES

### Objective
Demonstrate how a retail sale transaction flows from operational event to ledger posting, including double-entry validation and period locking enforcement.

### Steps

#### Step 1.1: Create Sale (Operational Event)
- **Action:** Application creates `sales` record
- **Tables Touched:** `sales`, `sale_items`
- **No Ledger Impact:** At this point, no journal entry exists

#### Step 1.2: Post Sale to Ledger
- **Function Executed:** `post_sale_to_ledger(p_sale_id UUID)`
- **Location:** Migration 162_complete_sale_ledger_postings.sql
- **Guard Enforced:** `assert_accounting_period_is_open(p_business_id, sale.date, FALSE)`
  - Validates period status is `'open'`
  - Blocks if period is `'soft_closed'` or `'locked'`
- **Expected Outcome:** If period is not `'open'`, exception raised:
  - `"Accounting period is soft-closed (period_start: X). Regular postings are blocked."`
  - OR `"Accounting period is locked (period_start: X). Posting is blocked."`

#### Step 1.3: Build Journal Entry Lines
- **Function Executed:** `post_sale_to_ledger()` builds `journal_lines` JSONB array
- **Lines Created:**
  - **Always:** Debit Cash/AR (1000-1099), Credit Revenue (4000)
  - **If inventory sale:** Debit COGS (5000), Credit Inventory (1200)
  - **If tax applied:** Credit Tax Payable accounts (2100-2130, 2200+)
- **Expected Outcome:** Balanced entry (total debits = total credits)

#### Step 1.4: Create Journal Entry
- **Function Executed:** `post_journal_entry(p_business_id, date, description, 'sale', sale_id, journal_lines, ...)`
- **Location:** Migration 171_phase12_backfill_legacy_data.sql (13-parameter version)
- **Tables Touched:**
  - `journal_entries` (INSERT)
  - `journal_entry_lines` (INSERT for each line)
- **Guards Enforced:**
  - **Period Status:** `assert_accounting_period_is_open()` validates period is `'open'`
  - **Double-Entry Balance:** `post_journal_entry()` validates `ABS(total_debit - total_credit) <= 0.01`
  - **Database Trigger:** `validate_period_open_for_entry()` validates period status on INSERT
  - **Database Trigger:** `enforce_double_entry_balance()` validates balance after INSERT
- **Expected Outcome:** Journal entry created with ID returned; ledger lines inserted; all guards pass

#### Step 1.5: Verify Ledger Posting
- **Function Executed:** `run_accounting_invariant_audit(period_id)` (optional verification)
- **Invariants Checked:**
  - `sale_journal_entry_completeness`: Every sale has exactly one journal entry
  - `sale_ledger_line_completeness`: Sale journal entry has required ledger lines (Cash/AR, Revenue, COGS if inventory, Inventory if inventory)
- **Expected Outcome:** `overall_status: 'PASS'` if posting successful

### Summary

| Step | Function | Tables | Guards | Expected Outcome |
|------|----------|--------|--------|------------------|
| 1.1 | Application code | `sales`, `sale_items` | None | Sale record created |
| 1.2 | `post_sale_to_ledger()` | None (validation only) | Period status check | Period validation pass/fail |
| 1.3 | `post_sale_to_ledger()` | None (JSONB building) | None | Balanced journal_lines array |
| 1.4 | `post_journal_entry()` | `journal_entries`, `journal_entry_lines` | Period status, double-entry balance, triggers | Journal entry created |
| 1.5 | `run_accounting_invariant_audit()` | Read-only queries | Invariant checks | All invariants pass |

**Verification:** Execute `SELECT * FROM journal_entries WHERE reference_type = 'sale' AND reference_id = <sale_id>` to verify journal entry exists.

---

## WALKTHROUGH 2: PERIOD CLOSE → SOFT_CLOSE → LOCK

### Objective
Demonstrate how accounting periods transition through the state machine: `open` → `soft_closed` → `locked`, and how postings are blocked at each stage.

### Steps

#### Step 2.1: Period Status: `'open'`
- **Action:** Period is in `'open'` status
- **Table:** `accounting_periods` (status = `'open'`)
- **Allowed Postings:** All regular postings (sales, invoices, expenses, payments) and adjustments
- **Guards:** `assert_accounting_period_is_open()` allows all postings

#### Step 2.2: Soft Close Period
- **Action:** User initiates soft close action
- **Function Executed:** Application calls soft close API endpoint
- **Tables Touched:**
  - `accounting_periods` (UPDATE status = `'soft_closed'`)
  - `accounting_period_actions` (INSERT action = `'soft_close'`)
- **Guards Enforced:**
  - Period must be `'open'` before soft close
  - Period status validation (no overlapping periods, month boundaries)
- **Expected Outcome:** Period status updated to `'soft_closed'`; action logged to `accounting_period_actions`

#### Step 2.3: Verify Soft-Closed Period Blocks Regular Postings
- **Function Executed:** Attempt regular posting (e.g., `post_sale_to_ledger()`)
- **Guard Enforced:** `assert_accounting_period_is_open(p_business_id, date, FALSE)`
- **Expected Outcome:** Exception raised:
  - `"Accounting period is soft-closed (period_start: X). Regular postings are blocked. Only adjustments are allowed in soft-closed periods."`
- **Database Trigger:** `validate_period_open_for_entry()` blocks INSERT to `journal_entries` for regular postings
- **Expected Outcome:** Exception raised:
  - `"Cannot insert journal entry into soft-closed period (period_start: X). Regular postings are blocked. Only adjustments are allowed in soft-closed periods."`

#### Step 2.4: Lock Period
- **Action:** User initiates lock action
- **Function Executed:** Application calls lock API endpoint
- **Tables Touched:**
  - `accounting_periods` (UPDATE status = `'locked'`)
  - `accounting_period_actions` (INSERT action = `'lock'`)
- **Guards Enforced:**
  - Period must be `'soft_closed'` before lock
  - Period status validation (no overlapping periods, month boundaries)
- **Expected Outcome:** Period status updated to `'locked'`; action logged to `accounting_period_actions`

#### Step 2.5: Verify Locked Period Blocks All Postings
- **Function Executed:** Attempt any posting (regular or adjustment)
- **Guard Enforced:** `assert_accounting_period_is_open(p_business_id, date, TRUE/FALSE)`
- **Expected Outcome:** Exception raised:
  - `"Accounting period is locked (period_start: X). Posting is blocked. Post an adjustment in a later open period."`
- **Database Trigger:** `validate_period_open_for_entry()` blocks INSERT to `journal_entries` for all postings
- **Expected Outcome:** Exception raised:
  - `"Cannot insert journal entry into locked period (period_start: X). Journal entries are blocked for locked periods."`

### Summary

| Step | Action | Tables | Guards | Expected Outcome |
|------|--------|--------|--------|------------------|
| 2.1 | Period `'open'` | `accounting_periods` | None | All postings allowed |
| 2.2 | Soft close | `accounting_periods`, `accounting_period_actions` | Status validation | Status = `'soft_closed'` |
| 2.3 | Verify soft-closed blocks regular postings | `journal_entries` (attempted INSERT) | Period status check, trigger | Exception raised |
| 2.4 | Lock period | `accounting_periods`, `accounting_period_actions` | Status validation | Status = `'locked'` |
| 2.5 | Verify locked blocks all postings | `journal_entries` (attempted INSERT) | Period status check, trigger | Exception raised |

**Verification:** Execute `SELECT * FROM accounting_periods WHERE id = <period_id>` to verify status transitions.

---

## WALKTHROUGH 3: ADJUSTMENT ENTRY IN SOFT-CLOSED PERIOD

### Objective
Demonstrate how adjusting journal entries are allowed in soft-closed periods with mandatory metadata and audit trail logging.

### Steps

#### Step 3.1: Period Status: `'soft_closed'`
- **Action:** Period is in `'soft_closed'` status
- **Table:** `accounting_periods` (status = `'soft_closed'`)
- **Regular Postings:** Blocked (see Walkthrough 2, Step 2.3)
- **Adjustments:** Allowed (with proper metadata)

#### Step 3.2: Create Adjusting Journal Entry
- **Function Executed:** `apply_adjusting_journal(p_business_id, p_period_start, p_entry_date, p_description, p_lines, p_created_by, p_adjustment_reason, p_adjustment_ref)`
- **Location:** Migration 166_controlled_adjustments_soft_closed.sql
- **Guard Enforced:** Period status check
  - Validates period status is `'open'` or `'soft_closed'` (not `'locked'`)
  - Blocks if period is `'locked'`
- **Expected Outcome:** If period is `'locked'`, exception raised:
  - `"Adjusting journals cannot be posted into locked periods. Period status: locked."`

#### Step 3.3: Validate Adjustment Metadata
- **Function Executed:** `apply_adjusting_journal()` validates metadata
- **Validation Rules:**
  - `p_adjustment_reason` must be non-empty TEXT
  - Minimum 2 lines required (balanced entry)
  - Accounts must exist and belong to business
  - Entry must balance (debits = credits, tolerance: 0.01)
- **Expected Outcome:** If validation fails, exception raised:
  - `"Adjustment reason is required and cannot be empty"`
  - OR `"Adjusting journal entry must balance. Debit: X, Credit: Y, Difference: Z"`

#### Step 3.4: Post Adjustment to Ledger
- **Function Executed:** `post_journal_entry(p_business_id, date, description, 'adjustment', NULL, journal_lines, TRUE, p_adjustment_reason, p_adjustment_ref, p_created_by, ...)`
- **Tables Touched:**
  - `journal_entries` (INSERT with `is_adjustment = TRUE`, `reference_type = 'adjustment'`, `reference_id = NULL`)
  - `journal_entry_lines` (INSERT for each line)
- **Guards Enforced:**
  - **Period Status:** `assert_accounting_period_is_open(p_business_id, date, TRUE)` allows `'soft_closed'` for adjustments
  - **Database Trigger:** `validate_period_open_for_entry()` allows adjustments in `'soft_closed'` periods if `is_adjustment = TRUE`
- **Expected Outcome:** Journal entry created; adjustment metadata stored

#### Step 3.5: Log Adjustment to Audit Trail
- **Function Executed:** `apply_adjusting_journal()` inserts audit log
- **Table Touched:** `accounting_adjustment_audit` (INSERT)
- **Audit Data Logged:**
  - `actor_user_id` (who created the adjustment)
  - `affected_accounts` (JSONB array of account codes, names, debits, credits)
  - `total_debit`, `total_credit` (for reconciliation)
  - `adjustment_reason`, `adjustment_ref`
- **Expected Outcome:** Audit log entry created with complete adjustment metadata

### Summary

| Step | Function | Tables | Guards | Expected Outcome |
|------|----------|--------|--------|------------------|
| 3.1 | Period `'soft_closed'` | `accounting_periods` | None | Regular postings blocked, adjustments allowed |
| 3.2 | `apply_adjusting_journal()` | None (validation) | Period status check | Period validation pass/fail |
| 3.3 | `apply_adjusting_journal()` | None (validation) | Metadata validation | Metadata validation pass/fail |
| 3.4 | `post_journal_entry()` | `journal_entries`, `journal_entry_lines` | Period status (adjustment), trigger | Adjustment entry created |
| 3.5 | `apply_adjusting_journal()` | `accounting_adjustment_audit` | None | Audit log entry created |

**Verification:** Execute `SELECT * FROM journal_entries WHERE is_adjustment = TRUE AND date IN (SELECT period_start FROM accounting_periods WHERE status = 'soft_closed')` to verify adjustments in soft-closed periods.

---

## WALKTHROUGH 4: OPENING BALANCE ROLLFORWARD

### Objective
Demonstrate how opening balances are generated for a new period from prior period closing balances (ledger-derived rollforward).

### Steps

#### Step 4.1: Prior Period Status: `'locked'`
- **Action:** Prior period must be `'locked'` before generating opening balances
- **Table:** `accounting_periods` (prior period status = `'locked'`)
- **Guard Enforced:** `generate_opening_balances()` validates prior period is `'locked'`
- **Expected Outcome:** If prior period is not `'locked'`, exception raised:
  - `"Prior period must be locked before generating opening balances. Prior period status: X."`

#### Step 4.2: New Period Status: `'open'`
- **Action:** New period must be `'open'` before generating opening balances
- **Table:** `accounting_periods` (new period status = `'open'`)
- **Guard Enforced:** `generate_opening_balances()` validates new period is `'open'`
- **Expected Outcome:** Opening balances can be generated for `'open'` periods only

#### Step 4.3: Calculate Prior Period Closing Balances
- **Function Executed:** `calculate_period_closing_balance_from_ledger(p_business_id, p_account_id, p_prior_period_id)`
- **Location:** Migration 168_opening_balances_rollforward_invariants.sql
- **Source Data:**
  - Opening balance: `period_opening_balances` (prior period)
  - Period activity: `journal_entry_lines` (prior period date range)
- **Calculation:** `closing_balance = opening_balance + (period_debit - period_credit)` for asset/expense accounts
  - OR `closing_balance = opening_balance + (period_credit - period_debit)` for liability/equity/income accounts
- **Expected Outcome:** Closing balance calculated for each balance sheet account (asset, liability, equity)

#### Step 4.4: Generate Opening Balances
- **Function Executed:** `generate_opening_balances(p_new_period_id, p_created_by)`
- **Location:** Migration 168_opening_balances_rollforward_invariants.sql
- **Tables Touched:**
  - `period_opening_balances` (INSERT for each account)
  - `accounting_period_actions` (INSERT action = `'generate_opening_balances'`)
- **Process:**
  - For each account: If balance sheet account (asset, liability, equity), use prior closing balance; otherwise, use 0 (income/expense reset)
  - Set `source = 'rollforward'` (or `'manual_bootstrap'` for first period)
  - Set `rollforward_from_period_id = prior_period_id`
- **Expected Outcome:** Opening balances inserted for all accounts; source and prior period ID recorded

#### Step 4.5: Verify Rollforward Integrity
- **Function Executed:** `verify_rollforward_integrity(p_new_period_id)`
- **Location:** Migration 168_opening_balances_rollforward_invariants.sql
- **Validation:**
  - For each balance sheet account, compare opening balance with prior period closing balance
  - Tolerance: 0.01 (for floating-point precision)
- **Expected Outcome:** If mismatch detected, exception raised:
  - `"Rollforward integrity violation: X account(s) have opening balances that do not match prior period closing balances. Mismatches: [account details]"`

### Summary

| Step | Function | Tables | Guards | Expected Outcome |
|------|----------|--------|--------|------------------|
| 4.1 | Prior period `'locked'` | `accounting_periods` | Status check | Prior period locked |
| 4.2 | New period `'open'` | `accounting_periods` | Status check | New period open |
| 4.3 | `calculate_period_closing_balance_from_ledger()` | Read-only queries | None | Closing balance calculated |
| 4.4 | `generate_opening_balances()` | `period_opening_balances`, `accounting_period_actions` | Prior period locked, new period open | Opening balances generated |
| 4.5 | `verify_rollforward_integrity()` | Read-only queries | None | Rollforward integrity verified |

**Verification:** Execute `SELECT * FROM period_opening_balances WHERE period_id = <new_period_id> AND source = 'rollforward'` to verify opening balances generated.

---

## WALKTHROUGH 5: TRIAL BALANCE GENERATION

### Objective
Demonstrate how Trial Balance is generated from ledger-only source (period_opening_balances + journal_entry_lines) and enforces hard invariant (debits = credits).

### Steps

#### Step 5.1: Generate Trial Balance
- **Function Executed:** `generate_trial_balance(p_period_id, p_generated_by)`
- **Location:** Migration 169_trial_balance_canonicalization.sql
- **Source Data:**
  - Opening balances: `period_opening_balances` (for period)
  - Period activity: `journal_entry_lines` (for period date range)
- **Process:**
  - For each account: Get opening balance, calculate period debits/credits, compute closing balance
  - Accumulate totals: `total_debits = SUM(period_debit)`, `total_credits = SUM(period_credit)`

#### Step 5.2: Enforce Balance Invariant
- **Function Executed:** `generate_trial_balance()` validates balance
- **Validation:** `ABS(total_debits - total_credits) <= 0.01`
- **Expected Outcome:** If imbalance detected, exception raised:
  - `"PHASE 9 VIOLATION: Trial Balance does not balance. Total Debits: X, Total Credits: Y, Difference: Z. All journal entries must be balanced before generating trial balance."`

#### Step 5.3: Persist Trial Balance Snapshot
- **Function Executed:** `generate_trial_balance()` persists snapshot
- **Table Touched:** `trial_balance_snapshots` (INSERT or UPDATE via ON CONFLICT)
- **Snapshot Data:**
  - `total_debits`, `total_credits` (aggregated totals)
  - `is_balanced = TRUE`, `balance_difference = 0` (enforced by generation)
  - `snapshot_data` (JSONB array of account balances)
- **Expected Outcome:** Snapshot persisted with `is_balanced = TRUE`

#### Step 5.4: Retrieve Trial Balance from Snapshot
- **Function Executed:** `get_trial_balance_from_snapshot(p_period_id)`
- **Location:** Migration 169_trial_balance_canonicalization.sql
- **Source:** `trial_balance_snapshots.snapshot_data` (JSONB array)
- **Auto-generation:** If snapshot doesn't exist, calls `generate_trial_balance()` first
- **Expected Outcome:** Returns account balances from canonical snapshot (no direct ledger queries)

### Summary

| Step | Function | Tables | Guards | Expected Outcome |
|------|----------|--------|--------|------------------|
| 5.1 | `generate_trial_balance()` | Read-only queries | None | Trial balance calculated |
| 5.2 | `generate_trial_balance()` | None (validation) | Balance invariant | Balance validated |
| 5.3 | `generate_trial_balance()` | `trial_balance_snapshots` | Balance invariant | Snapshot persisted |
| 5.4 | `get_trial_balance_from_snapshot()` | `trial_balance_snapshots` | None | Trial balance retrieved from snapshot |

**Verification:** Execute `SELECT * FROM trial_balance_snapshots WHERE period_id = <period_id> AND is_balanced = TRUE` to verify Trial Balance is balanced.

---

## WALKTHROUGH 6: P&L AND BALANCE SHEET RECONCILIATION

### Objective
Demonstrate how Profit & Loss and Balance Sheet statements are derived from Trial Balance snapshot and reconciled to verify accuracy.

### Steps

#### Step 6.1: Generate Profit & Loss Statement
- **Function Executed:** `get_profit_and_loss_from_trial_balance(p_period_id)`
- **Location:** Migration 169_trial_balance_canonicalization.sql
- **Source:** Trial Balance snapshot only (`get_trial_balance_from_snapshot()`)
- **Filter:** Income and expense accounts only (account_type IN ('income', 'expense'))
- **No Direct Ledger Queries:** Statement does not query `journal_entry_lines` directly
- **Expected Outcome:** Returns P&L data filtered from Trial Balance snapshot

#### Step 6.2: Generate Balance Sheet Statement
- **Function Executed:** `get_balance_sheet_from_trial_balance(p_period_id)`
- **Location:** Migration 169_trial_balance_canonicalization.sql
- **Source:** Trial Balance snapshot only (`get_trial_balance_from_snapshot()`)
- **Filter:** Asset, liability, and equity accounts only (account_type IN ('asset', 'liability', 'equity'))
- **No Direct Ledger Queries:** Statement does not query `journal_entry_lines` directly
- **Expected Outcome:** Returns Balance Sheet data filtered from Trial Balance snapshot

#### Step 6.3: Validate Statement Reconciliation
- **Function Executed:** `validate_statement_reconciliation(p_period_id)`
- **Location:** Migration 169_trial_balance_canonicalization.sql
- **Validation:**
  - Calculate Balance Sheet totals: `total_assets`, `total_liabilities`, `total_equity`
  - Verify equation: `ABS(total_assets - (total_liabilities + total_equity)) <= 0.01`
- **Expected Outcome:** If reconciliation fails, exception raised:
  - `"PHASE 9 VIOLATION: Balance Sheet does not balance. Assets: X, Liabilities: Y, Equity: Z, Difference: W"`

#### Step 6.4: Verify Reconciliation Result
- **Function Executed:** `validate_statement_reconciliation()` returns JSONB result
- **Result Contains:**
  - `valid = TRUE` (if reconciliation passes)
  - `trial_balance_debits`, `trial_balance_credits` (from snapshot)
  - `pnl_net_income` (calculated from P&L accounts)
  - `balance_sheet_assets`, `balance_sheet_liabilities`, `balance_sheet_equity` (calculated from Balance Sheet accounts)
  - `balance_sheet_balanced = TRUE` (if equation holds)
- **Expected Outcome:** Reconciliation passes; all statements reconcile to Trial Balance

### Summary

| Step | Function | Tables | Guards | Expected Outcome |
|------|----------|--------|--------|------------------|
| 6.1 | `get_profit_and_loss_from_trial_balance()` | `trial_balance_snapshots` (read-only) | None | P&L derived from snapshot |
| 6.2 | `get_balance_sheet_from_trial_balance()` | `trial_balance_snapshots` (read-only) | None | Balance Sheet derived from snapshot |
| 6.3 | `validate_statement_reconciliation()` | `trial_balance_snapshots` (read-only) | Balance Sheet equation | Reconciliation validated |
| 6.4 | `validate_statement_reconciliation()` | None (returns JSONB) | None | Reconciliation result returned |

**Verification:** Execute `SELECT validate_statement_reconciliation(<period_id>)` to verify statements reconcile to Trial Balance.

---

## SUMMARY OF ALL WALKTHROUGHS

All walkthroughs demonstrate:

1. **Deterministic behavior:** Same inputs produce same outputs
2. **Hard error enforcement:** All violations raise exceptions (no silent fallbacks)
3. **Multi-layer guards:** Controls enforced at application, function, and trigger levels
4. **Ledger-only source:** All calculations use `journal_entries` and `journal_entry_lines` only
5. **Canonical functions:** Trial Balance is the single source for all financial statements
6. **Immutability:** Journal entries and opening balances cannot be modified after creation
7. **Period locking:** Locked periods are immutable; soft-closed periods allow adjustments only

**All walkthroughs are reproducible** - external accountants can execute the same functions and verify the same results.

---

**END OF DOCUMENT**
