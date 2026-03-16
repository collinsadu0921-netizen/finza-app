# Posting Functions and Triggers — Period Guard Matrix Audit

**Scope:** `post_invoice_to_ledger`, `post_invoice_payment_to_ledger`, `post_bill_to_ledger`, `post_expense_to_ledger`, `post_adjustment_to_ledger`.  
**Goal:** For each function: (1) Does it call `assert_accounting_period_is_open`? (2) Which date does it use? (3) What happens if the period does not exist? Then: would adding a period guard to payment posting change any behavior beyond blocking invalid postings?  
**Read-only.** No fixes.

Canonical definitions are in `supabase/migrations/190_fix_posting_source_default_bug.sql` (invoice, bill, expense, payment) and `supabase/migrations/189_fix_ledger_posting_authorization.sql` (adjustment). Triggers are in `supabase/migrations/043_accounting_core.sql`.

---

## 1. Matrix: Posting Functions vs Period Guard

| Posting function | Calls assert_accounting_period_is_open? | Date used | If period does not exist |
|------------------|------------------------------------------|-----------|---------------------------|
| **post_invoice_to_ledger** | **Yes** | `invoice_record.issue_date` | `assert_accounting_period_is_open` calls `ensure_accounting_period(p_business_id, p_date)` (**166:112–114**). `ensure_accounting_period` (**094:59–93**) creates a period for that month if none exists (**094:86–88**), then returns it. Assert then checks status (open/soft_closed/locked). So: **period is created on the fly**; posting proceeds if status is open (or soft_closed with adjustment; invoice uses regular posting ⇒ blocked in soft_closed). |
| **post_invoice_payment_to_ledger** | **No** | `payment_record.date` (passed to post_journal_entry as `p_date`) | **No guard runs.** `post_invoice_payment_to_ledger` (**190:998–1122**) does not call `assert_accounting_period_is_open`. It calls `post_journal_entry(business_id_val, payment_record.date, ...)` (**190:1092–1118**). The **canonical** `post_journal_entry` (**190:98–236**) does **not** call `assert_accounting_period_is_open`; it goes from validation (posting_source, balance, etc.) straight to INSERT. So payment posting **can post into a non-existent, locked, or soft_closed period** with no period check. |
| **post_bill_to_ledger** | **Yes** | `bill_record.issue_date` | Same as invoice: `ensure_accounting_period` creates period for that month if missing; assert checks status; posting proceeds only if open (or soft_closed + adjustment; bill is regular ⇒ blocked in soft_closed). |
| **post_expense_to_ledger** | **Yes** | `expense_record.date` | Same as invoice/bill: ensure creates period if missing; assert checks status. |
| **post_adjustment_to_ledger** | **Yes** | `p_adjustment_date` | Same pattern. Calls `assert_accounting_period_is_open(p_business_id, p_adjustment_date)` (**189:809**). Assert uses 2 args ⇒ `p_is_adjustment` defaults to FALSE in the 3-arg implementation (**166:103–137**), so soft_closed blocks unless caller used 3-arg. **189** calls 2-arg only. Period created by ensure if missing; then status enforced. |

**Evidence — post_invoice_payment_to_ledger has no assert:**  
`supabase/migrations/190_fix_posting_source_default_bug.sql` **998–1122**: after loading payment_record and invoice_record, it does COA resolution and then `SELECT post_journal_entry(business_id_val, payment_record.date, ...)`. No `PERFORM assert_accounting_period_is_open(...)` in that function body.

**Evidence — post_journal_entry (190 canonical) has no assert:**  
`supabase/migrations/190_fix_posting_source_default_bug.sql` **98–236**: body validates posting_source, adjustment metadata, backfill, balance, and system_accountant_id; then INSERTs journal_entries and journal_entry_lines. No call to `assert_accounting_period_is_open`. (Migration **179** had that assert at **94**; the **190** canonical replacement does not include it.)

---

## 2. Triggers That Invoke These Functions

| Trigger | Table | When | Invokes |
|---------|--------|------|---------|
| **trigger_auto_post_invoice** | `invoices` | AFTER INSERT OR UPDATE OF status | `trigger_post_invoice()` → **post_invoice_to_ledger(NEW.id)** (**043:949–952**). Condition: `NEW.status IN ('sent','paid','partially_paid')` and not already posted. |
| **trigger_auto_post_payment** | `payments` | AFTER INSERT | `trigger_post_payment()` → **post_payment_to_ledger(NEW.id)** (**043:972–976**). Alias: `post_payment_to_ledger` → `post_invoice_payment_to_ledger`. Condition: `NEW.deleted_at IS NULL` and not already posted. |
| **trigger_auto_post_bill** | `bills` | AFTER INSERT OR UPDATE OF status | `trigger_post_bill()` → **post_bill_to_ledger(NEW.id)** (**043:1038–1042**). Condition: `NEW.status = 'open'` and (OLD was NULL or 'draft'). |
| **trigger_auto_post_expense** | `expenses` | AFTER INSERT | `trigger_post_expense()` → **post_expense_to_ledger(NEW.id)** (**043:1106–1110**). |
| **post_adjustment_to_ledger** | — | No table trigger | Called from app/API (e.g. accounting adjustments apply route). |

---

## 3. “If period does not exist” — Behavior of assert_accounting_period_is_open

`assert_accounting_period_is_open` (**166:103–137**) calls `ensure_accounting_period(p_business_id, p_date)` (**166:112–114**).  

**ensure_accounting_period** (**094:59–93**):

1. Computes `period_start` / `period_end` for the month of `p_date`.
2. Looks up `accounting_periods` for `(business_id, period_start)`.
3. **If no row:** `INSERT INTO accounting_periods (...)` (**094:86–88**), then returns that row.
4. If row exists, returns it.
5. Assert then checks `status`: locked → RAISE; soft_closed → RAISE unless `p_is_adjustment = TRUE`; open → success.

So for any poster that calls assert: **“period does not exist”** → ensure creates it → assert checks status → posting proceeds if open (or soft_closed + adjustment). For **post_invoice_payment_to_ledger**, no assert runs, so “period does not exist” is not checked; the journal entry is still dated `payment_record.date` and written regardless of period existence or status.

---

## 4. Adding a Period Guard to Payment Posting — Behavior Impact

**Current behavior:**  
`post_invoice_payment_to_ledger` does not call `assert_accounting_period_is_open`. Payments are posted via `post_journal_entry(business_id_val, payment_record.date, ...)`, and the canonical `post_journal_entry` (**190**) does not enforce period. So today:

- Payments can be posted when the period for `payment_record.date` **does not exist** (no row for that month).
- Payments can be posted when that period is **locked** or **soft_closed**.

**If we add** `PERFORM assert_accounting_period_is_open(business_id_val, payment_record.date);` at the start of `post_invoice_payment_to_ledger` (after loading payment_record, before COA resolution and post_journal_entry):

1. **Same date:** We would use `payment_record.date`, matching what the journal entry uses.
2. **Same logic:** ensure_accounting_period + status check. Missing period → create; locked → RAISE; soft_closed (regular posting) → RAISE.
3. **Newly blocked:** Postings that are **today** accepted would **start** failing:
   - Payment when period for `payment_record.date` is **locked**.
   - Payment when period for `payment_record.date` is **soft_closed** (regular posting, not adjustment).
   - Payment when period for `payment_record.date` does not exist is a special case: today we post anyway; with the guard, ensure would create the period and we’d proceed. So “missing period” would still end in success, just with an explicit create first.

**Conclusion:** Adding a period guard to payment posting **would change existing behavior**. It would **begin blocking** payments that are currently allowed whenever the period for `payment_record.date` is locked or soft_closed. It would **not** change behavior for:

- Payments in an **open** period (already allowed; still allowed).
- Payments when the period **does not exist** (today: allowed; with guard: ensure creates period, then we allow, so still allowed).

So the **only** behavioral change is **blocking invalid postings** (payments in locked or soft_closed periods). There is no other semantic change: we are not altering valid flows, only adding enforcement that today is absent. In that sense, the answer to “would it change any existing behavior **beyond** blocking invalid postings?” is **no** — the only new effect is blocking those invalid postings. The nuance is that today those invalid postings are **not** blocked, so introducing the guard is a **new** constraint, not a no-op.

**Summary:**

- **Would it change behavior?** Yes: payments in locked/soft_closed periods would start failing.
- **Would it change behavior *beyond* blocking invalid postings?** No: the only new effect is blocking payments that violate period rules (locked/soft_closed). All other behavior (open period, missing period → create-and-proceed) stays the same.

---

## 5. Compact Reference

| Function | assert? | Date | No period today |
|----------|---------|------|------------------|
| post_invoice_to_ledger | Yes (**190:399**) | invoice_record.issue_date | ensure creates ⇒ assert checks status ⇒ proceed if open. |
| post_invoice_payment_to_ledger | **No** | payment_record.date | No check; post_journal_entry runs anyway; can post into missing/locked/soft_closed. |
| post_bill_to_ledger | Yes (**190:568**) | bill_record.issue_date | ensure creates ⇒ assert checks ⇒ proceed if open. |
| post_expense_to_ledger | Yes (**190:735**) | expense_record.date | ensure creates ⇒ assert checks ⇒ proceed if open. |
| post_adjustment_to_ledger | Yes (**189:809**) | p_adjustment_date | ensure creates ⇒ assert checks ⇒ proceed if open (or soft_closed with 3-arg; 189 uses 2-arg). |

---

**Document:** `POSTING_PERIOD_GUARD_MATRIX_AUDIT.md`  
**Scope:** The five posting functions and their triggers. Read-only.
