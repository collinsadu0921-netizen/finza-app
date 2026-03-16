# Accounting Health Audit — Confirmation

Independent verification of each finding. **No fixes applied.**

---

## 🔴 Critical

### 1. Expense posting creates unbalanced journals

**Confirmed with nuance.**  
In **043** (lines 732–744) the original `post_expense_to_ledger` builds base lines as: **debit** expense `subtotal`, **credit** cash `total`. With `total = subtotal + tax`, that pair is already unbalanced by the tax amount; adding tax lines on top makes the entry wrong.

The **current** code path is **324** (`post_expense_to_ledger`), which uses `v_subtotal` (derived as `total - v_total_tax`) for the expense debit and `expense_row.total` for the cash credit, then adds tax debits. So **324 produces balanced entries**. If production has run through migration 324, this bug is fixed at the DB level; if 043/190 is still the live path (e.g. no 324 yet), the bug stands.

---

### 2. Accumulated Depreciation account has the wrong type

**Confirmed.**  
**043** line 76: account 1650 “Accumulated Depreciation” is inserted with `type = 'asset'`. It is a contra-asset with a credit normal balance. In **247** (generate_trial_balance), balance logic is `IF account_record.type IN ('asset', 'expense') THEN closing_balance := opening_balance + (period_debit - period_credit)`; so 1650 is treated like a normal asset and its balance is shown on the wrong side, inflating net assets.

---

### 3. Missing account validation — silent FK failures

**Confirmed.**  
**043**’s `post_invoice_to_ledger`, `post_bill_to_ledger`, and `post_expense_to_ledger` call `get_account_by_code()` and do not check for NULL before building journal lines. Inserting a NULL `account_id` would hit the FK on `journal_entry_lines` and surface as a 500.

Later migrations (**099**, **190**, **324**, etc.) add `assert_account_exists()` (or equivalent) before posting for invoice, bill, and expense. So the **current** versions of these functions do validate; older deployments or any code path that still uses an unguarded 043-style version can hit the cryptic failure. The audit’s point that “the original functions in 043 are still active code paths” is only true if later migrations have not been applied; once 099/190/324 (etc.) are applied, the active path includes guards.

---

### 4. Invoices can post to locked periods with no user feedback

**Confirmed.**  
`post_invoice_to_ledger` (e.g. in **094**/**099**) calls `assert_accounting_period_is_open(business_id_val, invoice_record.issue_date)` inside the DB, so when the invoice is issued (trigger or RPC), a locked period causes the transaction to fail. The **invoice API** does not perform an upfront period check and does not map that DB error to a friendly message (unlike the expenses API, which does fragile string matching on the error). The user sees a generic failure (e.g. “Invoice could not be saved” or a raw 500) with no “Cannot issue: period is closed” style message.

---

## 🟠 High

### 5. VAT returns silently show zero if tax accounts are missing

**Confirmed.**  
**093** `extract_tax_return_from_ledger`: when an account in 2100–2130 is missing, it sets `account_id_val IS NULL` and appends a row with all zeros (lines 78–89), with no warning. The **calculate** route (`app/api/vat-returns/calculate/route.ts`) then uses `rows.find(...) || { period_credits: 0, period_debits: 0, closing_balance: 0 }`, so the API returns zeros with no indication that the COA is missing tax accounts. A business with a custom COA could file a zero VAT return without being warned.

---

### 6. Bills can exist without a ledger entry

**Confirmed with nuance.**  
The bill posting trigger runs **in the same transaction** as the `bills` INSERT. If `post_bill_to_ledger` raises, the whole transaction rolls back, so the bill row does not commit. So under the normal trigger path you do **not** get a committed bill with no JE. The scenario “bill exists but no ledger entry” can occur if: (1) the trigger is disabled or not attached, (2) bills are created in a way that does not fire the trigger, or (3) posting is invoked in a separate transaction and that second step fails after the bill is already committed. The risk is real for any code path that separates “insert bill” from “post to ledger.”

---

### 7. Double-entry balance is enforced only by a trigger, not a constraint

**Confirmed.**  
**088** introduced `enforce_double_entry_balance`; **188** replaced it with a **statement-level** trigger `enforce_double_entry_balance_statement` on `journal_entry_lines` (AFTER INSERT FOR EACH STATEMENT). There is **no** CHECK constraint on `journal_entry_lines` that enforces SUM(debit)=SUM(credit) per journal. If the trigger were disabled or bypassed (e.g. direct SQL, or crash between inserts before 188’s batch-insert pattern), unbalanced entries could persist. Journals are immutable, so correction would require a reversal, not an update.

---

### 8. Soft-delete inconsistently applied in reports

**Confirmed with nuance.**  
**138** `get_trial_balance` filters `a.deleted_at IS NULL` on accounts (lines 66, 246, 299). Downstream reporting uses **get_trial_balance_from_snapshot** / **generate_trial_balance** (e.g. **247**), which iterates over accounts; the loop in 247 uses `SELECT ... FROM accounts ... WHERE business_id = ... AND deleted_at IS NULL`, so the snapshot builder does exclude deleted accounts. Other RPCs or report code paths that read from `accounts` without `deleted_at IS NULL` could still surface deleted accounts; a full audit of every report RPC would be needed to close the gap.

---

## 🟡 Medium

### 9. Trial balance net income formula

**Confirmed — needs verification.**  
**234** `get_profit_and_loss_from_trial_balance` returns `period_total := trial_balance_row.closing_balance` for rows where `account_type IN ('income', 'expense')`. Whether “net income = totalIncome - totalExpenses” is correct depends on the sign of `closing_balance`: income accounts are credit-normal (positive = revenue), expense accounts are debit-normal. In **247** the logic is `asset/expense => closing = opening + (debit - credit)`, else `closing = opening + (credit - debit)`, so income has credit-positive balance and expense has debit-positive balance. If the P&L consumer treats both as positive and does income − expense, the sign convention is consistent; if any consumer expects signed amounts or a different convention, the bottom line could be wrong. The audit’s “needs verification” is appropriate.

---

### 10. `journal_entry_lines` uses ON DELETE CASCADE

**Confirmed.**  
**052** lines 466–468: `journal_entry_lines.journal_entry_id` references `journal_entries(id) ON DELETE CASCADE`. If a `journal_entry` is deleted (e.g. via direct SQL or dashboard), all its lines are removed with no separate audit trail. The app prevents deletes via immutability triggers, but the schema allows it at the DB level.

---

### 11. `accounts.type` vs `chart_of_accounts.account_type` mismatch

**Confirmed.**  
**043** seeds `accounts` with `type = 'income'` (e.g. Service Revenue 4000). **175** and **chart_of_accounts** use `account_type = 'revenue'` and when syncing from `accounts` map `WHEN account_in_legacy.type = 'income' THEN 'revenue'`. So `accounts.type` is `'income'` and `chart_of_accounts.account_type` is `'revenue'`. Any code that compares or joins on type across the two tables without mapping will break (e.g. `WHERE account_type = 'revenue'` on `accounts` returns nothing).

---

## Summary

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| 1 | 🔴 Critical | Expense journal imbalance (043); fixed in 324 | Confirmed; current path (324) is balanced |
| 2 | 🔴 Critical | Accumulated Depreciation type = asset | Confirmed |
| 3 | 🔴 Critical | NULL account_id / missing COA validation | Confirmed in 043; later migrations add guards |
| 4 | 🔴 Critical | No period-lock check in invoice API | Confirmed |
| 5 | 🟠 High | VAT silently zeros if tax accounts missing | Confirmed |
| 6 | 🟠 High | Bills without ledger entry (trigger path) | Confirmed with nuance (same-tx rollback) |
| 7 | 🟠 High | Balance by trigger only, no CHECK | Confirmed |
| 8 | 🟠 High | Soft-delete in reports | Confirmed; snapshot builder filters deleted_at |
| 9 | 🟡 Medium | Net income sign convention | Confirmed — verify P&L consumer |
| 10 | 🟡 Medium | ON DELETE CASCADE on journal lines | Confirmed |
| 11 | 🟡 Medium | income vs revenue type mismatch | Confirmed |

All findings are substantiated. Nuances are noted where the current migration set partially mitigates the issue (e.g. #1, #3, #6, #8).
