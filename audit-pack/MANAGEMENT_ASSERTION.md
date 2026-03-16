# Management Assertion Letter (Draft)

**Document Version:** 1.0  
**Date:** 2025-01-17  
**Classification:** Management assertion (draft)  
**Audience:** External accountants, auditors, compliance reviewers

---

## MANAGEMENT ASSERTION REGARDING ACCOUNTING RECORDS AND CONTROLS

To Whom It May Concern:

Management of [Company Name] (the "Company") hereby provides the following assertions regarding the accounting records and internal controls over financial reporting for the accounting system implemented in the Finza platform (the "System").

---

## ASSERTION 1: COMPLETENESS AND ACCURACY OF ACCOUNTING RECORDS

We assert that:

1. **All sales transactions are posted to the ledger:** Every sale transaction recorded in the `sales` table has a corresponding journal entry in the `journal_entries` table with `reference_type = 'sale'` and `reference_id = <sale_id>`. This is enforced by database triggers and validated by the `run_accounting_invariant_audit()` function.

2. **All invoice transactions are posted to the ledger:** Every invoice transaction recorded in the `invoices` table with `status IN ('sent', 'paid', 'partially_paid')` has a corresponding journal entry in the `journal_entries` table with `reference_type = 'invoice'` and `reference_id = <invoice_id>`. This is enforced by database triggers and validated by the `run_accounting_invariant_audit()` function.

3. **All expense transactions are posted to the ledger:** Every expense transaction recorded in the `expenses` table (where `deleted_at IS NULL`) has a corresponding journal entry in the `journal_entries` table with `reference_type = 'expense'` and `reference_id = <expense_id>`. This is enforced by database triggers and validated by the `run_accounting_invariant_audit()` function.

4. **All payment transactions are posted to the ledger:** Every payment transaction recorded in the `payments` table (where `deleted_at IS NULL`) has a corresponding journal entry in the `journal_entries` table with `reference_type = 'payment'` and `reference_id = <payment_id>`. This is enforced by database triggers and validated by the `run_accounting_invariant_audit()` function.

5. **All journal entries are balanced:** Every journal entry in the `journal_entries` table has balanced debits and credits (total debits = total credits, tolerance: 0.01). This is enforced by the `enforce_double_entry_balance()` database trigger and validated by the `run_accounting_invariant_audit()` function.

6. **All financial statements are derived from the ledger:** All Profit & Loss and Balance Sheet statements are generated exclusively from the `journal_entries` and `journal_entry_lines` tables via the Trial Balance snapshot. No financial statements are calculated directly from operational source data (sales, invoices, expenses). This is enforced by canonical reporting functions (`get_profit_and_loss_from_trial_balance()`, `get_balance_sheet_from_trial_balance()`) and validated by the `validate_statement_reconciliation()` function.

---

## ASSERTION 2: DESIGN AND OPERATING EFFECTIVENESS OF CONTROLS

We assert that:

1. **Double-entry accounting is enforced:** The System enforces double-entry accounting at multiple layers (application level, database function level, database trigger level). Every journal entry must have balanced debits and credits (tolerance: 0.01). Imbalanced entries are rejected with exceptions. This is enforced by:
   - Application level: `post_journal_entry()` function validates balance before INSERT
   - Database trigger: `enforce_double_entry_balance()` validates balance after INSERT
   - Validation: `run_accounting_invariant_audit()` verifies all journal entries are balanced

2. **Period locking is enforced:** The System prevents postings into locked periods at multiple layers (application level, database function level, database trigger level). Locked periods are immutable and cannot accept any postings (regular or adjustment). This is enforced by:
   - Application level: `assert_accounting_period_is_open()` function validates period status in all posting functions
   - Database function level: `post_journal_entry()` validates period status before INSERT
   - Database trigger: `validate_period_open_for_entry()` validates period status on INSERT
   - Validation: `run_accounting_invariant_audit()` verifies no postings exist in locked periods

3. **Immutability is enforced:** The System prevents modification or deletion of journal entries and journal entry lines after creation. Journal entries and lines are append-only (immutable). Corrections require adjustment entries. This is enforced by:
   - Database trigger: `prevent_journal_entry_modification()` blocks UPDATE/DELETE on `journal_entries`
   - Database trigger: `prevent_journal_entry_line_modification()` blocks UPDATE/DELETE on `journal_entry_lines`
   - Database trigger: `enforce_opening_balance_immutability()` blocks UPDATE/DELETE on `period_opening_balances`
   - Validation: `run_accounting_invariant_audit()` verifies immutability (historical records unchanged)

4. **Trial Balance canonicalization is enforced:** The System ensures Trial Balance is the single canonical truth source for all financial statements. All statements (P&L, Balance Sheet) consume Trial Balance snapshot only (no direct ledger queries). Trial Balance must balance (debits = credits). This is enforced by:
   - Generation: `generate_trial_balance()` enforces balance invariant (raises exception if imbalance)
   - Consumption: `get_profit_and_loss_from_trial_balance()` and `get_balance_sheet_from_trial_balance()` consume `trial_balance_snapshots` only
   - Validation: `validate_statement_reconciliation()` verifies statements reconcile to Trial Balance

5. **Opening balance rollforward is enforced:** The System ensures opening balances for each period equal the closing balances of the prior period (ledger-derived rollforward). Opening balances are immutable after generation. This is enforced by:
   - Generation: `generate_opening_balances()` validates prior period is locked before generating
   - Calculation: `calculate_period_closing_balance_from_ledger()` calculates closing balance from ledger only
   - Validation: `verify_rollforward_integrity()` verifies opening balances match prior closing balances
   - Immutability: `enforce_opening_balance_immutability()` trigger blocks UPDATE/DELETE on `period_opening_balances`

6. **Adjustment controls are enforced:** The System allows adjustments in soft-closed periods only (not in locked periods). Adjustments require mandatory metadata (reason, reference, actor) and audit trail logging. This is enforced by:
   - Application level: `apply_adjusting_journal()` validates adjustment metadata and period status
   - Database function level: `post_journal_entry()` validates adjustment metadata
   - Database trigger: `validate_period_open_for_entry()` allows adjustments in soft-closed periods if `is_adjustment = TRUE`
   - Audit logging: All adjustments are logged to `accounting_adjustment_audit` table

7. **CI regression prevention is enforced:** The System prevents accounting logic regressions via automated continuous integration (CI) checks. All accounting invariants are tested on every pull request and push to production branches. Failed checks block deployment. This is enforced by:
   - CI workflow: `.github/workflows/accounting-invariants.yml` runs `run_business_accounting_audit()` on every PR/push
   - Audit script: `scripts/accounting-ci-audit.ts` validates all invariants and exits with code 1 on failure
   - Bypass detection: `scripts/detect-report-bypass.ts` detects if reporting functions bypass Trial Balance
   - Enforcement: CI workflow fails if any invariant check fails (deployment blocked)

---

## ASSERTION 3: IMMUTABILITY OF LOCKED PERIODS

We assert that:

1. **Locked periods are immutable:** Once an accounting period is locked (status = `'locked'`), no journal entries can be posted to that period. This is enforced at multiple layers:
   - Application level: `assert_accounting_period_is_open()` raises exception if period is `'locked'`
   - Database function level: `post_journal_entry()` validates period is not `'locked'`
   - Database trigger: `validate_period_open_for_entry()` blocks INSERT if period is `'locked'`
   - Validation: `run_accounting_invariant_audit()` verifies no postings exist in locked periods

2. **Period state machine is enforced:** Accounting periods follow a strict state machine: `open` → `soft_closed` → `locked`. No reverse transitions are allowed (locked periods cannot be reopened). This is enforced by:
   - Application level: Period close/lock actions validate current status before transition
   - Validation: `run_accounting_invariant_audit()` verifies period status is valid (one of: 'open', 'soft_closed', 'locked')

3. **Adjustments for locked periods must be posted in later open periods:** If corrections are needed for locked periods, adjustments must be posted in later open periods (not in the locked period itself). This is enforced by:
   - Application level: `apply_adjusting_journal()` raises exception if period is `'locked'`
   - Database trigger: `validate_period_open_for_entry()` blocks adjustments in locked periods
   - Validation: `run_accounting_invariant_audit()` verifies no adjustments exist in locked periods

---

## SUPPORTING DOCUMENTATION

The following documentation supports these assertions:

1. **System Accounting Architecture Overview:** `ACCOUNTING_ARCHITECTURE.md` - Describes system flow, database schema, and canonical functions
2. **Accounting Policies & Controls Document:** `ACCOUNTING_CONTROLS.md` - Describes all controls with objectives, mechanisms, and failure behaviors
3. **Audit Walkthrough Evidence:** `AUDIT_WALKTHROUGH.md` - Provides step-by-step walkthroughs of key transactions and workflows
4. **Control Test Results:** `CONTROL_TEST_RESULTS.json` - Contains sample output from `run_business_accounting_audit()` function
5. **CI Control Evidence:** `CI_CONTROL_EVIDENCE.md` - Describes CI checks and regression prevention mechanisms
6. **Legacy Data Conformance Statement:** `LEGACY_DATA_CONFORMANCE.md` - Describes Phase 12 backfill approach for legacy data

All controls are implemented via versioned database migrations in `supabase/migrations/` and can be verified via database functions and triggers.

---

## MANAGEMENT SIGNATURE

This assertion is based on management's knowledge and understanding of the System and its controls as of the date of this letter.

**Signed by:**

_________________________  
[Management Name]  
[Title]  
[Company Name]  
Date: _______________

---

**END OF DOCUMENT**
