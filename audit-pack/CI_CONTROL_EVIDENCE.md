# CI Control Evidence

**Document Version:** 1.0  
**Date:** 2025-01-17  
**Classification:** Auditor-facing CI documentation  
**Audience:** External accountants, auditors, compliance reviewers

---

## EXECUTIVE SUMMARY

This document describes the continuous integration (CI) checks that prevent accounting logic regressions. All checks are automated and run on every pull request and push to production branches. Failed checks block code deployment.

**CI Checks:**
1. **Accounting Invariant Audit:** Tests 8 invariants per period (most recent 3 periods)
2. **Report Bypass Detection:** Detects if reporting functions bypass Trial Balance canonical source

**Enforcement:** CI workflow fails if any invariant check fails. Failed checks block pull request merge and deployment.

---

## CI WORKFLOW

### Workflow File
**Path:** `.github/workflows/accounting-invariants.yml`

**Triggers:**
- Pull requests to `main` or `develop` branches
- Pushes to `main` or `develop` branches
- Manual workflow dispatch (with optional `business_id` input)

**Steps:**
1. Checkout code
2. Setup Node.js (v20.x)
3. Install dependencies (`npm ci`)
4. Install ts-node (TypeScript execution)
5. Run accounting invariant audit (`scripts/accounting-ci-audit.ts`)
6. Report bypass detection (`scripts/detect-report-bypass.ts`)
7. Summary step (reports pass/fail status)

**Exit Codes:**
- Exit code 0: All checks pass (deployment allowed)
- Exit code 1: One or more checks fail (deployment blocked)

---

## ACCOUNTING INVARIANT AUDIT

### Audit Script
**Path:** `scripts/accounting-ci-audit.ts`

**Function:** Calls `run_business_accounting_audit(p_business_id, p_limit_periods)` database function

**Parameters:**
- `BUSINESS_ID`: Business ID to audit (from environment variable `CI_TEST_BUSINESS_ID` or manual input)
- `LIMIT_PERIODS`: Number of periods to audit (default: 3, most recent periods)

**Invariants Tested (8 per period):**

1. **sale_journal_entry_completeness**
   - **Objective:** Every sale has exactly one journal entry
   - **Check:** Count sales in period vs sales with journal entries
   - **Failure:** If `unposted_sales > 0`, status = `'FAIL'`

2. **sale_ledger_line_completeness**
   - **Objective:** Every sale journal entry has required ledger lines (Cash/AR, Revenue, COGS if inventory, Inventory if inventory)
   - **Check:** For each sale journal entry, verify required accounts exist
   - **Failure:** If `sale_with_incomplete_lines > 0`, status = `'FAIL'`

3. **period_guard_enforcement**
   - **Objective:** All postings respect period state rules (no postings in locked periods, no regular postings in soft-closed periods)
   - **Check:** Count postings in locked periods or non-adjustment postings in soft-closed periods
   - **Failure:** If `invalid_period_postings > 0`, status = `'FAIL'`

4. **period_state_machine**
   - **Objective:** Period status is valid (one of: 'open', 'soft_closed', 'locked')
   - **Check:** Verify period status is valid state
   - **Failure:** If `invalid_state_transitions > 0`, status = `'FAIL'`

5. **opening_balance_rollforward**
   - **Objective:** Opening balances match prior period closing balances
   - **Check:** Call `verify_rollforward_integrity(p_period_id)` function
   - **Failure:** If function raises exception, status = `'FAIL'`

6. **trial_balance_balance**
   - **Objective:** Trial Balance balances (debits = credits)
   - **Check:** Verify `trial_balance_snapshots.is_balanced = TRUE` and `balance_difference = 0`
   - **Failure:** If `is_balanced = FALSE` or `balance_difference != 0`, status = `'FAIL'`

7. **statement_reconciliation**
   - **Objective:** P&L and Balance Sheet reconcile to Trial Balance
   - **Check:** Call `validate_statement_reconciliation(p_period_id)` function
   - **Failure:** If function raises exception, status = `'FAIL'`

8. **reporting_canonical_functions**
   - **Objective:** Canonical reporting functions exist (no bypass paths)
   - **Check:** Verify canonical functions exist: `get_trial_balance_from_snapshot()`, `get_profit_and_loss_from_trial_balance()`, `get_balance_sheet_from_trial_balance()`
   - **Failure:** If any canonical function is missing, status = `'FAIL'`

**Overall Status:**
- `'PASS'`: All invariants pass for all audited periods
- `'FAIL'`: One or more invariants fail for one or more periods

**Exit Code:**
- Exit code 0: `overall_status = 'PASS'`
- Exit code 1: `overall_status = 'FAIL'` (deployment blocked)

---

## REPORT BYPASS DETECTION

### Bypass Detection Script
**Path:** `scripts/detect-report-bypass.ts` (referenced in workflow, implementation may vary)

**Purpose:** Detects if reporting functions bypass Trial Balance canonical source

**Detection Logic:**
- Checks if legacy functions (`get_trial_balance_legacy()`, `get_profit_and_loss_legacy()`, `get_balance_sheet_legacy()`) are being called
- Verifies canonical functions are used instead of legacy functions
- Flags any code paths that query `journal_entry_lines` directly in reporting functions

**Failure:** If bypass paths detected, script exits with code 1 (deployment blocked)

---

## FAILING EXAMPLE (MOCKED)

### Scenario: Unposted Sale
**Problem:** Sale exists without journal entry (invariant violation)

**CI Output:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 13: Accounting Invariant CI Audit
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Business ID: abc123...
Limit periods: 3
Supabase URL: https://...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AUDIT SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Overall Status:  FAIL
Periods audited: 3
Periods passed:  2
Periods failed:  1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FAILED PERIODS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Period: 2024-12-01 → 2024-12-31 (open)
  Period ID: xyz789...
  Overall Status: FAIL
  
    sale_journal_entry_completeness: FAIL - 5 sales do not have journal entries. Total sales: 200, Posted: 195
```

**Exit Code:** 1 (deployment blocked)

**Action Required:** Fix unposted sales before deployment (create journal entries via backfill or fix posting function bug)

---

## PASSING EXAMPLE (MOCKED)

### Scenario: All Invariants Pass
**Problem:** None (all invariants satisfied)

**CI Output:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 13: Accounting Invariant CI Audit
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Business ID: abc123...
Limit periods: 3
Supabase URL: https://...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AUDIT SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Overall Status:  PASS
Periods audited: 3
Periods passed:  3
Periods failed:  0

✅ All accounting invariants passed for audited periods
```

**Exit Code:** 0 (deployment allowed)

**Action Required:** None (checks passed, merge/deployment proceeds)

---

## BYPASS DETECTION LOGIC

### Detection Mechanism
**Path:** `scripts/detect-report-bypass.ts` (referenced in workflow)

**Logic:**
1. **Function Existence Check:** Verify canonical functions exist in database
   - `get_trial_balance_from_snapshot()`
   - `get_profit_and_loss_from_trial_balance()`
   - `get_balance_sheet_from_trial_balance()`

2. **Legacy Function Detection:** Check if legacy functions are still being called
   - `get_trial_balance_legacy()` (deprecated)
   - `get_profit_and_loss_legacy()` (deprecated)
   - `get_balance_sheet_legacy()` (deprecated)

3. **Application Code Scan:** Verify application code uses canonical functions only
   - Scan API routes for legacy function calls
   - Flag any direct queries to `journal_entry_lines` in reporting endpoints

**Failure:** If bypass paths detected, script exits with code 1 (deployment blocked)

---

## ENFORCEMENT SUMMARY

| Check | Script | Database Function | Exit Code on Failure | Blocks Deployment |
|-------|--------|-------------------|---------------------|-------------------|
| Accounting Invariant Audit | `scripts/accounting-ci-audit.ts` | `run_business_accounting_audit()` | 1 | ✅ Yes |
| Report Bypass Detection | `scripts/detect-report-bypass.ts` | N/A (code scan) | 1 | ✅ Yes |

**Result:** All CI checks must pass before code can be merged to production branches. Failed checks block deployment automatically.

---

## VERIFICATION

All CI checks can be verified via:

1. **GitHub Actions:** Review workflow run results in `.github/workflows/accounting-invariants.yml`
2. **Audit Script:** Execute `scripts/accounting-ci-audit.ts` manually with `BUSINESS_ID` and `LIMIT_PERIODS` environment variables
3. **Database Function:** Execute `run_business_accounting_audit(p_business_id, p_limit_periods)` directly in database
4. **Workflow History:** Review past workflow runs in GitHub Actions UI to verify checks ran successfully

---

## REFERENCES

- **Workflow File:** `.github/workflows/accounting-invariants.yml`
- **Audit Script:** `scripts/accounting-ci-audit.ts`
- **Database Function:** `run_business_accounting_audit()` (Migration 170_accounting_invariant_audit.sql)
- **Invariant Audit Function:** `run_accounting_invariant_audit()` (Migration 170_accounting_invariant_audit.sql)

---

**END OF DOCUMENT**
