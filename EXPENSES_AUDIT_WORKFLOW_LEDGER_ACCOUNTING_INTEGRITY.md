# Expenses Audit — Workflow, Ledger Impact, and Accounting Integrity

**Audit type:** Principal Accounting Systems Auditor — evidence-based, no code changes.  
**Scope:** Expenses feature end-to-end (UI, API, database, ledger).  
**References:** File paths and migration numbers only.

---

## 1. Workflow Trace

### Lifecycle (evidence-based)

| Stage | Evidence | Behavior |
|-------|----------|----------|
| **Create expense** | `app/api/expenses/create/route.ts` | POST inserts into `expenses` (business_id, supplier, category_id, amount, nhil, getfund, covid, vat, total, date, notes, receipt_path). No `status`, no `subtotal`/`total_tax`/`description`/`tax_lines` sent. No API-level call to post to ledger. |
| **DB trigger on INSERT** | `supabase/migrations/043_accounting_core.sql` (lines 1080–1111) | `trigger_auto_post_expense` fires **AFTER INSERT** only. `trigger_post_expense()`: if `NEW.deleted_at IS NULL` and no JE exists with `reference_type = 'expense'` and `reference_id = NEW.id`, calls `post_expense_to_ledger(NEW.id)`. |
| **Ledger posting** | `supabase/migrations/190_fix_posting_source_default_bug.sql` (lines 691–843), `094`, `099`, `100`, `172` | `post_expense_to_ledger(p_expense_id)` reads from `expenses`: `e.business_id`, `e.total`, **e.subtotal**, **e.total_tax**, `e.date`, **e.description**, **e.tax_lines**. Calls `assert_accounting_period_is_open(business_id_val, expense_record.date)` then builds JE and calls `post_journal_entry(..., 'expense', p_expense_id, ...)`. |
| **Edit expense** | `app/api/expenses/[id]/route.ts` (PUT) | Updates `expenses` row (supplier, category_id, amount, tax fields, total, date, notes, receipt_path). **No trigger on UPDATE** (trigger is INSERT-only). No repost; no mutation of existing JE. |
| **Delete expense** | `app/api/expenses/[id]/route.ts` (DELETE) | Deletes row from `expenses`. No trigger on DELETE. No cascade to `journal_entries`; JEs reference expense by `reference_id` (UUID). Ledger rows remain. |

### Status / draft vs posted

- **Evidence:** The `expenses` table (migrations `033`, `034`, `051`) has **no** `status` or `posted_at` column.
- **Implication:** There is no draft vs posted lifecycle for expenses. Every INSERT is intended to post immediately via the trigger. The UI does not expose “save as draft” vs “post”; creation is a single step.

### Period restrictions in UI

- **Evidence:** `app/expenses/create/page.tsx` and `app/expenses/[id]/edit/page.tsx` — no checks for accounting period open/closed, no `periodId` or period validation in the UI.
- **Implication:** Period enforcement is **only** at DB: `post_expense_to_ledger` calls `assert_accounting_period_is_open`. If the period for `expense_record.date` is closed or locked, the trigger raises and the whole transaction (including the INSERT) rolls back. User sees a 500 from the API (trigger error). No explicit “period closed” message in API response.

---

## 2. Ledger Impact Table

| Event | Journal Entry Created? | Accounts | Debit | Credit | Notes |
|-------|-------------------------|----------|-------|--------|-------|
| **Expense INSERT** (trigger) | **Yes, if trigger succeeds** | Expense (5100), Cash (control), optional tax accounts | Expense: subtotal; tax (if ledger_side=debit) | Cash: total; tax (if ledger_side=credit) | Single JE per expense; reference_type=`expense`, reference_id=expense.id. **If DB schema lacks subtotal/total_tax/description/tax_lines, trigger fails and no JE.** |
| Expense UPDATE | No | — | — | — | Trigger is INSERT-only; no repost. |
| Expense DELETE | No | — | — | — | No cascade; JE remains. |

**Source:** `190_fix_posting_source_default_bug.sql` (lines 773–827): Expense account 5100 (Operating Expenses), Cash from control key CASH, tax lines from `expense_record.tax_lines` with `ledger_account_code` and `ledger_side`.

---

## 3. Ledger Posting Analysis

| Question | Answer (evidence) |
|----------|-------------------|
| **Which function posts expense JE?** | `post_expense_to_ledger(p_expense_id [, p_entry_type, p_backfill_reason, p_backfill_actor])`. Canonical version in `190_fix_posting_source_default_bug.sql` (lines 691–843); earlier versions in `094_accounting_periods.sql`, `099_coa_validation_guards.sql`, `100_control_account_resolution.sql`, `172_phase12b_backfill_completion_compatibility.sql`. |
| **Which migration introduced it?** | Initial trigger and posting logic: `043_accounting_core.sql` (trigger), `094_accounting_periods.sql` (period guard + expense SELECT). Current canonical: `190_fix_posting_source_default_bug.sql`. |
| **Accounts used** | Expense: code `5100` (Operating Expenses). Cash: control key `CASH`. Tax: from `tax_lines` JSONB (`ledger_account_code`, `ledger_side`). |
| **Idempotent?** | **At trigger level:** yes — trigger checks `NOT EXISTS (SELECT 1 FROM journal_entries WHERE reference_type = 'expense' AND reference_id = NEW.id)` before calling `post_expense_to_ledger`. **Inside `post_expense_to_ledger`:** no idempotency check; if called twice (e.g. backfill script), would create two JEs. Normal path: one INSERT → one trigger → one JE. |
| **Protected by immutability?** | Yes. `156_enforce_journal_immutability.sql` and `088_hard_db_constraints_ledger.sql`: triggers block UPDATE/DELETE on `journal_entries` and `journal_entry_lines`. `222_ledger_immutability_enforcement.sql`: REVOKE UPDATE, DELETE on these tables. |

---

## 4. Invariants — Explicit YES/NO

| # | Invariant | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | **Draft expenses do NOT touch the ledger** | **N/A** | No draft concept: no `status` on `expenses`; trigger runs on every INSERT. If “draft” were added later, current code does not enforce “draft = no post”. |
| 2 | **Posted expenses create exactly one immutable journal entry** | **Conditional** | One JE per expense when trigger succeeds. **If** schema mismatch (see Risk 1) causes trigger to fail, zero JEs. JE is immutable (triggers + REVOKE). |
| 3 | **Expenses never UPDATE or DELETE ledger rows** | **YES** | API only INSERT/UPDATE/DELETE on `expenses`. Ledger: `journal_entries` and `journal_entry_lines` are protected from UPDATE/DELETE by triggers and REVOKE. |
| 4 | **Expenses cannot post into closed or locked periods** | **YES** | `post_expense_to_ledger` calls `assert_accounting_period_is_open(business_id_val, expense_record.date)` (`094`, `165`). Trigger runs in same transaction as INSERT; failure rolls back INSERT. |
| 5 | **Expense edits after posting do NOT mutate the original JE** | **YES** | Trigger is AFTER INSERT only; UPDATE on `expenses` does not fire trigger. No code path updates existing JEs for that expense. |
| 6 | **Expense deletion does not delete ledger data** | **YES** | DELETE on `expenses` only; no FK from `journal_entries` to `expenses`; trigger does not run on DELETE. JEs remain. |
| 7 | **Expenses are excluded from reconciliation unless designed otherwise** | **YES** | Reconciliation engine (`lib/accounting/reconciliation/`) has no expense reference; reconciliation is invoice/customer AR. Expenses are excluded. |
| 8 | **Expenses do not affect AR** | **YES** | Posting is Dr Expense, Cr Cash (+ tax); no AR account. AR is invoice/payment scope. |
| 9 | **Expenses do not recognize revenue** | **YES** | Revenue account (4000) is not used in `post_expense_to_ledger`; only 5100, CASH, and tax accounts. |
| 10 | **Expense tax (if any) is posted to correct tax accounts** | **Conditional** | Tax comes from `expense_record.tax_lines` (JSONB) with `ledger_account_code` and `ledger_side`. **If** `expenses` has no `tax_lines` column (see schema mismatch), no tax lines are posted. API/UI send nhil/getfund/covid/vat but do not persist `tax_lines` JSONB for ledger. |
| 11 | **Every expense JE is attributable (reference_type, reference_id, user, timestamp)** | **YES** | `post_journal_entry(..., 'expense', p_expense_id, ...)` sets reference_type and reference_id. `journal_entries` has created_at; posting_source = 'system' (`190`). |

---

## 5. Risk Assessment

### CRITICAL (accounting correctness)

1. **Schema mismatch: posting function vs `expenses` table**  
   - **Evidence:** `post_expense_to_ledger` (e.g. `190` lines 716–726) SELECTs `e.subtotal`, `e.total_tax`, `e.description`, `e.tax_lines` from `expenses`. The `expenses` table in `051_fix_all_table_structures.sql` and `034_service_invoice_system_complete.sql` has: `amount`, `nhil`, `getfund`, `covid`, `vat`, `total`, `date`, `notes`, `receipt_path` — **no** `subtotal`, `total_tax`, `description`, or `tax_lines`. No migration in the repo adds these columns to `expenses`.  
   - **Impact:** On INSERT, trigger calls `post_expense_to_ledger`; the SELECT fails (column does not exist). Transaction rolls back; expense row is not inserted; user gets 500. So either (a) deployed DB has these columns from another source, or (b) expense creation and thus expense posting is broken in production.  
   - **Classification:** CRITICAL.

### MAJOR (audit/compliance)

2. **No API-level period check**  
   - **Evidence:** `app/api/expenses/create/route.ts` does not load accounting period or validate that `date` falls in an open period.  
   - **Impact:** Period is enforced only when trigger runs; error is a generic 500. No structured “period closed” response for UX or integration.  
   - **Classification:** MAJOR.

3. **No draft vs post separation**  
   - **Evidence:** No `status` on `expenses`; trigger posts on every INSERT.  
   - **Impact:** Cannot “save as draft” without touching the ledger; design differs from invoices (draft vs sent). If draft expenses are required by policy, current design violates it.  
   - **Classification:** MAJOR (if draft is required); otherwise design clarification.

### MINOR (UX / clarity)

4. **Auth checks commented out in expense [id] route**  
   - **Evidence:** `app/api/expenses/[id]/route.ts`: business_id filter and user checks commented (“AUTH DISABLED FOR DEVELOPMENT”).  
   - **Impact:** Multi-tenant isolation and auth depend on RLS and other layers; comment indicates intentional weakening for dev.  
   - **Classification:** MINOR (if dev-only and re-enabled in prod).

---

## 6. Reconciliation & Reporting Impact

| Question | Answer |
|----------|--------|
| **Do expenses affect reconciliation?** | No. Reconciliation engine is invoice/customer AR only; no expense scope. |
| **Do they affect period close checks?** | Yes. `167_period_close_workflow.sql`: `validate_period_close_readiness` counts unposted expenses (expenses in period with no JE with reference_type='expense' and reference_id=e.id). Unposted expenses block close. |
| **Included in trial balance?** | Yes. Expense JEs hit account 5100 (and tax accounts); trial balance includes all ledger accounts. |
| **Included in P&L correctly?** | Yes. P&L is derived from trial balance / canonical functions (`get_profit_and_loss_from_trial_balance`); expense account 5100 is an expense in P&L. |

---

## 7. Executive Verdict

- **Is the expense system accounting-correct today?**  
  **NO** — under the documented schema. The canonical posting function expects columns (`subtotal`, `total_tax`, `description`, `tax_lines`) that are not present on `expenses` in the migrations reviewed. Unless the deployed database has those columns (e.g. from another migration or manual change), expense INSERT fails in the trigger and no JE is created. That is a critical correctness and operability issue.

- **Is it accrual-consistent with invoices?**  
  **Partially.** Expenses are posted by transaction date and period guard; they do not use AR or revenue. Accrual consistency is limited by: (1) no draft vs post (expense is “post on insert”), and (2) possible schema break above.

- **Is it safe under audit?**  
  **Conditional.** Ledger side: JEs are immutable, attributable, and period-guarded; expense JEs do not affect AR or revenue. Operational safety is compromised by the schema mismatch (posting path may fail or be unused) and lack of explicit period-closed messaging at API level.

- **What invariants are currently guaranteed vs assumed?**  
  **Guaranteed (by code):** 3, 4, 5, 6, 7, 8, 9, 11 (no ledger mutation, period guard, no repost on edit, no delete of JEs, excluded from AR reconciliation, no revenue, attributable JEs).  
  **Assumed / conditional:** 1 (N/A — no draft), 2 (one JE only if trigger succeeds; trigger fails if schema mismatch), 10 (tax correct only if `tax_lines` exists and is populated).  

**UNKNOWN — requires design clarification:** Whether `expenses` is intended to have `subtotal`, `total_tax`, `description`, `tax_lines`; if not, posting function must be aligned with actual columns (e.g. derive subtotal/total_tax from amount/nhil/getfund/covid/vat/total and use `notes` for description).

---

---

## 8. Evidence Table — Schema vs Posting (STEP 0)

| Source | Expected by `post_expense_to_ledger` (190, 172) | Actual `expenses` table (033, 034, 051) |
|--------|--------------------------------------------------|----------------------------------------|
| **business_id** | SELECT e.business_id | ✅ expenses.business_id |
| **total** | SELECT e.total | ✅ expenses.total |
| **subtotal** | SELECT e.subtotal | ❌ **No column** |
| **total_tax** | SELECT e.total_tax | ❌ **No column** |
| **date** | SELECT e.date | ✅ expenses.date |
| **description** | SELECT e.description | ❌ **No column** (only `notes`) |
| **tax_lines** | SELECT e.tax_lines | ❌ **No column** |
| — | — | ✅ amount, nhil, getfund, covid, vat, notes, supplier, category_id, receipt_path |

**Conclusion:** Current expense INSERT would fail in the trigger because the SELECT in `post_expense_to_ledger` references non-existent columns (`subtotal`, `total_tax`, `description`, `tax_lines`). Transaction rolls back; user gets 500.

**Trigger:** `043_accounting_core.sql` lines 1081–1111: `trigger_post_expense()` fires AFTER INSERT; calls `post_expense_to_ledger(NEW.id)` only if `deleted_at IS NULL` and no existing JE for this expense. No EXCEPTION handler — errors propagate and roll back the INSERT.

*End of audit. No code or schema changes were made.*
