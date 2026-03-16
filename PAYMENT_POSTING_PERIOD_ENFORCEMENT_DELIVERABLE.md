# Payment Posting Period Enforcement — Deliverable

## Step 1 — Evidence: current payment posting path

| Location | File:line | Snippet (3–8 lines) |
|----------|-----------|---------------------|
| Trigger that fires on payment insert | `supabase/migrations/043_accounting_core.sql` **955–976** | `CREATE OR REPLACE FUNCTION trigger_post_payment() ... IF NEW.deleted_at IS NULL THEN ... PERFORM post_payment_to_ledger(NEW.id); ... EXECUTE FUNCTION trigger_post_payment();` |
| Alias / wrapper | Migration 190 defines **post_payment_to_ledger** (4-arg) and **post_invoice_payment_to_ledger** (1-arg) as separate implementations. Trigger calls `post_payment_to_ledger(NEW.id)` → 1-arg invocation of the 4-arg function. No wrapper calls post_invoice_payment_to_ledger from the trigger. | **190:855–856** `DROP FUNCTION IF EXISTS post_payment_to_ledger(UUID, ...) CASCADE;` **190:858–986** body of post_payment_to_ledger. |
| post_invoice_payment_to_ledger | `supabase/migrations/190_fix_posting_source_default_bug.sql` **998–1122** | `CREATE OR REPLACE FUNCTION post_invoice_payment_to_ledger(p_payment_id UUID) ... SELECT ... INTO payment_record FROM payments ... business_id_val := payment_record.business_id; ... -- COA GUARD ... SELECT post_journal_entry(...) INTO journal_id;` — **no** `assert_accounting_period_is_open`. |
| post_journal_entry (canonical) | `supabase/migrations/190_fix_posting_source_default_bug.sql` **98–236** | Validates posting_source, balance, etc.; INSERT journal_entries and journal_entry_lines. **No** `assert_accounting_period_is_open` in the 190 canonical body. |

**Conclusion:** Payment posting has **no** `assert_accounting_period_is_open`. The trigger uses `post_payment_to_ledger(NEW.id)`; both `post_payment_to_ledger` and `post_invoice_payment_to_ledger` call `post_journal_entry` and neither asserts period before that.

---

## Step 2 — Enforcement date

**Use `payment_record.date`** as the date for the period check. That is the date already used as `p_date` in `post_journal_entry(business_id_val, payment_record.date, ...)` and is the journal entry date for the payment. Using it keeps the period guard aligned with the posting date and avoids coupling to the invoice’s `issue_date`.

---

## Step 3 — Migration

See `supabase/migrations/217_payment_posting_period_guard.sql`.

---

## Step 4 — Verification SQL snippet

```sql
-- Expected: payment insert when period is LOCKED → trigger runs → post_payment_to_ledger → assert_accounting_period_is_open raises.
-- Example (replace UUIDs/dates with real fixtures):
-- 1. Set period to locked: UPDATE accounting_periods SET status = 'locked' WHERE business_id = :bid AND period_start = :pstart;
-- 2. INSERT INTO payments (business_id, invoice_id, amount, method, date, ...) VALUES (:bid, :inv_id, 100, 'cash', :pdate, ...);
-- 3. Expect: ERROR from assert_accounting_period_is_open (period is locked).

-- Expected: payment insert when period is SOFT_CLOSED → raise (regular posting blocked).
-- 1. UPDATE accounting_periods SET status = 'soft_closed' WHERE ...;
-- 2. INSERT INTO payments (...);
-- 3. Expect: ERROR (regular postings are blocked in soft-closed periods).

-- Expected: payment insert when period is OPEN → succeeds.
-- 1. UPDATE accounting_periods SET status = 'open' WHERE ...;
-- 2. INSERT INTO payments (...);
-- 3. Expect: no error; journal_entries has one new row with reference_type = 'payment'.
```

---

## Step 5 — Regression checklist

- **Open periods:** Unchanged. `assert_accounting_period_is_open` returns when status is `open`.
- **Missing period:** The assert calls `ensure_accounting_period(p_business_id, p_date)`, which creates the period for that month if it does not exist (**094:86–88**). So **missing period will auto-create via assert** (same as invoice/expense posting).
- **Invoice posting path:** Not modified. Only `post_invoice_payment_to_ledger` and `post_payment_to_ledger` are changed.
- **Report snapshots:** Not modified. No changes to trial balance, P&L, or balance sheet logic.
