# Ledger Health Report — Service Workspace Financial Integrity Audit

**Scope:** Service workspace “data loss” in reports. Diagnostics only; no fixes applied.

---

## 1. Orphaned Documents

**Definition:** Invoices or expenses that are in a “final” state (e.g. `status = 'paid'` or `'sent'`) but have **no matching row** in `journal_entries` (via `reference_type` + `reference_id`).

**How to run:**

- **Invoices:** Run in Supabase SQL Editor:
  ```sql
  SELECT id, business_id, invoice_number, status, sent_at, total
  FROM invoices i
  WHERE i.status IN ('sent', 'paid', 'partially_paid')
    AND i.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.reference_type = 'invoice' AND je.reference_id = i.id
    );
  ```
- **Expenses:** Run:
  ```sql
  SELECT id, business_id, amount, total, date, created_at
  FROM expenses e
  WHERE e.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.reference_type = 'expense' AND je.reference_id = e.id
    );
  ```

**Full script:** `scripts/financial-integrity-audit.sql` (run entire file for all diagnostics).

**Interpretation:**

- Any rows returned = “orphaned” documents (operational record exists, no ledger entry). These will not appear in Trial Balance / P&L / Balance Sheet because reports are ledger-derived.
- Zero rows = no orphaned documents for that type.

---

## 2. Unbalanced Journals

**Definition:** Any `journal_entry_id` for which `SUM(debit) != SUM(credit)` in `journal_entry_lines` (within a small tolerance, e.g. 0.001).

**How to run:**

```sql
SELECT jel.journal_entry_id,
  SUM(jel.debit) AS total_debit,
  SUM(jel.credit) AS total_credit,
  SUM(jel.debit) - SUM(jel.credit) AS imbalance
FROM journal_entry_lines jel
GROUP BY jel.journal_entry_id
HAVING ABS(COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)) > 0.001;
```

**Interpretation:**

- Rows returned = journal entries that violate the balance invariant. Snapshot generation can enforce balance and fail or skip; reports may exclude or misrepresent these.
- Zero rows = all journal entries are balanced.

---

## 3. Report Fragmentation (P&L data source)

**Question:** Is the P&L route reading from `journal_entry_lines` or incorrectly from the `invoices` table?

**Finding:** **It does not read from `invoices`.** The P&L is ledger-derived only.

**Evidence:**

| Layer | Source |
|-------|--------|
| Route | `app/api/accounting/reports/profit-and-loss/route.ts` |
| Implementation | Calls `getProfitAndLossReport(supabase, { businessId, ... })` |
| Lib | `lib/accounting/reports/getProfitAndLossReport.ts` |
| Data source | `supabase.rpc("get_profit_and_loss_from_trial_balance", { p_period_id })` |
| DB function | `get_profit_and_loss_from_trial_balance(p_period_id)` (migration 234) |
| DB behaviour | Reads from `get_trial_balance_from_snapshot(p_period_id)` and filters `account_type IN ('income','expense')` |
| Snapshot source | Trial balance snapshot is built from **ledger** (`period_opening_balances` + `journal_entry_lines`) via `generate_trial_balance` |

**Conclusion:** P&L is **not** reading from `invoices` (or any operational table). It reads only from the Trial Balance snapshot, which is built from the ledger. If invoices/expenses were never posted to the ledger, they will not appear in P&L regardless of status — that is by design; the “missing” data is due to missing ledger entries, not report fragmentation.

---

## 4. The Missing Link — Are posting functions actually called?

**Question:** Are `post_invoice_to_ledger` and `post_expense_to_ledger` actually invoked?

**Finding:** They are **not** called explicitly from API routes. They are invoked **only by database triggers**.

### Invoices

| Invocation | Where |
|------------|--------|
| Trigger | `trigger_auto_post_invoice` on `invoices` (AFTER INSERT OR UPDATE OF status) |
| Definition | `supabase/migrations/043_accounting_core.sql` (lines 929–952) |
| Condition | `NEW.status IN ('sent','paid','partially_paid')` and `(OLD.status IS NULL OR OLD.status = 'draft')`; and no existing JE with `reference_type = 'invoice'` and `reference_id = NEW.id` |
| API | `app/api/invoices/[id]/send/route.ts` updates `invoices` with `status: 'sent'` — trigger runs on that UPDATE. **No explicit RPC call** to `post_invoice_to_ledger`. |

So invoice posting is **trigger-driven** when status moves to sent/paid/partially_paid. If status was set by a path that doesn’t fire the trigger (e.g. direct DB update that doesn’t fire UPDATE OF status, or RLS/trigger disabled), no JE is created.

### Expenses

| Invocation | Where |
|------------|--------|
| Trigger | `trigger_auto_post_expense` on `expenses` (**AFTER INSERT** only) |
| Definition | `supabase/migrations/043_accounting_core.sql` (lines 1081–1112) |
| Condition | `NEW.deleted_at IS NULL` and no existing JE with `reference_type = 'expense'` and `reference_id = NEW.id` |
| API | `app/api/expenses/create/route.ts` inserts into `expenses` — trigger runs on INSERT. **No explicit RPC call** to `post_expense_to_ledger`. |

So expense posting is **trigger-driven on INSERT only**. If expenses were created before this trigger existed, or via a path that didn’t fire the trigger (e.g. direct SQL insert, or table/trigger not present), they would have no JE.

**Summary:**

- **Invoices:** Posting happens when status is updated to sent/paid/partially_paid (trigger). API send route does not call `post_invoice_to_ledger`; it relies on the trigger.
- **Expenses:** Posting happens on INSERT only. API create route does not call `post_expense_to_ledger`; it relies on the trigger.
- **Risk:** Any invoice or expense that reached “sent”/“paid” or was inserted without the trigger firing will be an orphan (no JE) and will not show in reports.

---

## 5. Re-sync plan for missing data

**Goal:** Create journal entries for documents that should be in the ledger but currently have none (orphans), without duplicating existing JEs.

### 5.1 Invoices (orphans with status sent/paid/partially_paid)

1. **Identify:** Run the “Orphaned Documents — Invoices” query above (or `scripts/financial-integrity-audit.sql` section 1a).
2. **Backfill:** For each orphan invoice ID, call the canonical posting function once:
   - From app or SQL: `SELECT post_invoice_to_ledger('<invoice_id>');`
   - Or via Supabase RPC: `post_invoice_to_ledger(p_invoice_id := '<invoice_id>')`.
3. **Checks:** `post_invoice_to_ledger` is idempotent (checks for existing JE with `reference_type = 'invoice'` and `reference_id`). Safe to call once per invoice.
4. **Period:** Ensure the invoice’s posting date falls in an **open** (or allowed) accounting period; otherwise the function may raise (period locked/closed). Resolve period/date issues before re-posting.

### 5.2 Expenses (orphans)

1. **Identify:** Run the “Orphaned Documents — Expenses” query (or script section 1b).
2. **Backfill:** For each orphan expense ID:
   - `SELECT post_expense_to_ledger('<expense_id>');` (or equivalent RPC).
3. **Checks:** `post_expense_to_ledger` is idempotent (checks for existing JE with `reference_type = 'expense'` and `reference_id`). Safe to call once per expense.
4. **Period:** Same as invoices — expense date must be in an open (or allowed) period.

### 5.3 Unbalanced journals

1. **Identify:** Run the “Unbalanced Journals” query (script section 2).
2. **Fix:** Not automatable without business rules. Each unbalanced JE must be corrected by:
   - Adjusting journal lines (debit/credit) so the entry balances, or
   - Creating a balancing adjustment entry,
   - In line with your accounting policy and audit trail requirements.
3. **Snapshot:** After fixing, mark trial balance snapshots stale for affected business/period so reports rebuild from corrected ledger.

### 5.4 Optional hardening (future)

- **Explicit RPC after send:** In `app/api/invoices/[id]/send/route.ts`, after a successful `performSendTransition`, optionally call `supabase.rpc('post_invoice_to_ledger', { p_invoice_id: invoiceId })` as a safety net (idempotent).
- **Expense trigger on UPDATE:** If your product allows “approving” or “finalising” expenses with an UPDATE (e.g. status change), consider adding an `UPDATE OF status` (or relevant column) to the expense trigger so that when an expense moves to “approved”/“paid”, the trigger runs and calls `post_expense_to_ledger` if no JE exists. Today the trigger runs only on INSERT.

---

## 6. Quick reference — diagnostic script

Run the full set of diagnostics (orphans + unbalanced JEs + summary counts):

```bash
# In Supabase SQL Editor: paste and run contents of
scripts/financial-integrity-audit.sql
```

No data is modified; the script is read-only.

---

**Report generated from codebase audit. Run the SQL diagnostics against your database to get actual counts and IDs for orphaned documents and unbalanced journals.**
