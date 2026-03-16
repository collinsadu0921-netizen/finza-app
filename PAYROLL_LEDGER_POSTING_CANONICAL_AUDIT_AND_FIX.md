# FINZA — Payroll Ledger Posting Canonical Audit & Fix

## Root Cause

1. **Wrong column names in SQL**  
   Migration `190_fix_posting_source_default_bug.sql` (and any DB that applied it last) defined `post_payroll_to_ledger` to `SELECT total_gross, total_allowances, total_ssnit_employer, total_paye, total_ssnit_employee, total_net` from `payroll_runs`. The table actually has `total_gross_salary` and `total_net_salary` (see `047_payroll_system.sql`). That caused:
   - Runtime error: `column "total_gross" does not exist`, or
   - Variables for credits (e.g. `v_total_paye`, `v_total_net`) to be NULL, so credit lines were 0/NULL and the journal was unbalanced.

2. **Multiple INSERT statements for journal lines**  
   The function inserted journal entry lines with **five separate** `INSERT INTO journal_entry_lines ...` statements. The balance trigger on `journal_entry_lines` is **FOR EACH STATEMENT**. So after the first INSERT (one debit line), the trigger ran and saw only that line → "Journal entry is not balanced. Debit total: 5000, Credit total: 0".

3. **No period guard**  
   `post_payroll_to_ledger` did not call `assert_accounting_period_is_open`. Canonical rule: posting must only occur when the period is open.

4. **journal_entry_id not persisted**  
   The API called `post_payroll_to_ledger` and then updated `payroll_runs` with `status`, `approved_by`, `approved_at` but never set `journal_entry_id`. So the run was not linked to the ledger and a subsequent PATCH could post again (duplicate posting).

---

## Broken Field Reference

| Expected (canonical)        | Incorrect (migration 190) |
|----------------------------|---------------------------|
| `total_gross_salary`       | `total_gross`             |
| `total_net_salary`         | `total_net`               |

All other columns (`total_allowances`, `total_ssnit_employer`, `total_paye`, `total_ssnit_employee`) exist on `payroll_runs` and were correct.

---

## Broken Journal Construction

- **Debit lines (were created):**  
  Payroll Expense (gross + allowances), SSNIT Employer Expense.  
  Amounts came from variables that could be NULL when column names were wrong → first INSERT sometimes succeeded with a single debit, then trigger fired.

- **Credit lines (intended but failed in practice):**  
  PAYE Payable, SSNIT Payable, Net Salaries Payable.  
  When `total_gross`/`total_net` were wrong, the SELECT populated credit-side variables as NULL → credit lines inserted as 0 or NULL → sum(credit) = 0 → "Credit total: 0".

- **Balance trigger behaviour:**  
  Trigger runs **per statement**. Five separate INSERTs → trigger ran after the first INSERT only → saw one debit line → raised "Journal entry is not balanced".

---

## Fix Applied

1. **Migration `287_fix_post_payroll_to_ledger_column_names.sql`** (updated):
   - **Column names:** SELECT now uses `total_gross_salary` and `total_net_salary` from `payroll_runs` (no schema change).
   - **Period guard:** After validating payroll run exists, call `PERFORM assert_accounting_period_is_open(v_business_id, v_payroll_month)` so posting only happens when the period is open.
   - **Single-statement line insert:** All five journal entry lines are inserted in **one** `INSERT INTO journal_entry_lines (...) VALUES (...), (...), (...), (...), (...)` so the statement-level balance trigger sees the full entry and validates correctly. No change to debit/credit mapping or amounts.

2. **API `app/api/payroll/runs/[id]/route.ts`**:
   - After successful `post_payroll_to_ledger` RPC, the approval update now sets `journal_entry_id` on `payroll_runs` (using a variable in outer scope). This links the run to the ledger and prevents duplicate posting on re-approval.

---

## Files Modified

- `finza-web/supabase/migrations/287_fix_post_payroll_to_ledger_column_names.sql`  
  - Correct column names, add period guard, single INSERT for all lines, updated COMMENT.
- `finza-web/app/api/payroll/runs/[id]/route.ts`  
  - Declare `journalEntryId` in outer scope, set it from RPC result, include `journal_entry_id` in `updateData` when `status === "approved"`.

---

## Validation Tests (recommended)

1. **Simple salary only**  
   One employee, no tax/deductions. Approve payroll → one balanced journal entry; `payroll_runs.journal_entry_id` set.

2. **Salary + tax deductions**  
   Ghana PAYE/SSNIT. Approve → debits = (gross+allowances) + employer SSNIT; credits = PAYE + (employee+employer SSNIT) + net; sum(debit) = sum(credit).

3. **Multiple employees**  
   Batch run. Approve → single journal with aggregated totals; balanced.

4. **Period closed**  
   Close the accounting period for the payroll month; approve payroll → `assert_accounting_period_is_open` raises; no journal created.

5. **No duplicate posting**  
   Approve once; verify `journal_entry_id` is set. PATCH again to approved → API returns 400 "Payroll run has already been posted to ledger"; no second journal.

---

## Ledger Safety Confirmation

- **Immutable ledger:** No updates or deletes to `journal_entries` or `journal_entry_lines`; only INSERTs.
- **Balance:** All lines inserted in one statement; trigger validates SUM(debit) = SUM(credit) (with 0.01 tolerance).
- **Period:** Posting guarded by `assert_accounting_period_is_open(business_id, payroll_month)`.
- **Idempotency:** API checks `existingRun.journal_entry_id` before calling RPC and now persists `journal_entry_id` so the same run is never posted twice.
- **No bypass:** Balance trigger and period guard are not disabled; no schema or unrelated trigger changes.

---

## Ghana Payroll Default Mapping (existing, unchanged)

Posting already follows:

- DR Salary Expense (5600) — gross + allowances  
- DR Employer SSNIT (5610)  
- CR PAYE Payable (2230)  
- CR SSNIT Payable (2231) — employee + employer  
- CR Net Salaries Payable (2240)  

No change to account codes or mapping; only correctness of source columns, period check, single-statement insert, and API persistence of `journal_entry_id`.
