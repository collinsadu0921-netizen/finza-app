# Expense Posting Fix — Verification Note

**Date:** 2026-01-29  
**Scope:** Expenses feature posting to immutable ledger; schema-aligned; COVID-safe.

---

## Summary

Expense posting is now **schema-aligned**, **idempotent**, **period-guarded**, and **COVID-safe**.

---

## Evidence Table (STEP 0 — pre-fix)

| Expected by old `post_expense_to_ledger` | Actual `expenses` table |
|------------------------------------------|--------------------------|
| subtotal, total_tax, description, tax_lines | **Not present** (033, 034, 051) |
| business_id, total, date | ✅ Present |
| amount, nhil, getfund, vat, covid, notes, supplier, category_id, receipt_path | ✅ Present |

**Conclusion:** The canonical posting function (190, 172) selected non-existent columns; expense INSERT triggered the function and failed in the trigger, rolling back the transaction and returning 500.

---

## Changes Delivered

### 1. Migration `229_expense_posting_schema_aligned.sql`

- **Replaced** `post_expense_to_ledger(p_expense_id, p_entry_type, p_backfill_reason, p_backfill_actor)` to read only real columns: `business_id`, `category_id`, `supplier`, `amount`, `nhil`, `getfund`, `vat`, `covid`, `total`, `date`, `notes`.
- **Derivations:** `total_tax = nhil + getfund + vat + (covid only if covid > 0)`; `subtotal = total - total_tax` when taxes present, else `amount` (or `total`). Description from `supplier` and/or `notes`.
- **Tax posting:** Tax lines built from columns (not `tax_lines` JSON): VAT→2100, NHIL→2110, GETFund→2120, COVID→2130 (legacy only when `covid > 0`). All input tax = debit.
- **Idempotency:** At start of function, if a JE already exists with `reference_type = 'expense'` and `reference_id = p_expense_id`, return that JE id (no-op). Re-check after advisory lock.
- **Concurrency:** `pg_advisory_xact_lock(hashtext(business_id), hashtext(p_expense_id))` before posting.
- **Period guard:** `assert_accounting_period_is_open(business_id, expense.date)` before posting; clear error on violation.
- **Accounts:** CASH via control key; expense account 5100; tax accounts 2100, 2110, 2120, 2130 validated only when amount > 0. Missing account → explicit RAISE with clear message.
- **COVID:** Deprecated. Included in `total_tax` and ledger only when `expenses.covid > 0` on the row (legacy read-only). No new COVID generation.

### 2. Trigger

- No change. `trigger_post_expense()` (043) remains AFTER INSERT only; calls `post_expense_to_ledger(NEW.id)` when `deleted_at IS NULL` and no existing JE. Errors propagate (no EXCEPTION handler), so INSERT rolls back on posting failure.

### 3. API `app/api/expenses/create/route.ts`

- On create error, if message contains "Accounting period is locked" or "Accounting period is soft-closed" (or variants), return **400** with `{ error: message, code: "PERIOD_CLOSED" }` instead of 500.

### 4. Tests `app/api/expenses/__tests__/expense-posting.test.ts`

- **Expense insert posts one JE;** lines balance (sum debits ≈ sum credits).
- **Idempotency:** Call `post_expense_to_ledger(expense_id)` twice; still one JE.
- **Period guard:** Expense date in locked period → INSERT fails with period-related error (test skips if no locked period).
- **COVID 0:** Expense with `covid` 0 → no COVID tax line in JE.
- **Legacy COVID:** Expense with `covid > 0` → COVID tax line present (read-only compatibility).

Tests skip cleanly when `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, or `TEST_BUSINESS_ID` are missing.

---

## Invariants Preserved

- **Ledger append-only:** No UPDATE/DELETE on `journal_entries` or `journal_entry_lines`; existing immutability triggers and REVOKE unchanged.
- **Period guards:** Posting into closed/locked periods fails; API returns structured 400 for period-closed.
- **One expense → one JE:** Enforced by trigger (one INSERT → one trigger run) and idempotent function (second call returns existing id).
- **COVID:** Deprecated; legacy-only read path when `covid > 0` on existing row.

---

*End of verification note.*
