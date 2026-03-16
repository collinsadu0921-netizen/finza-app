# Invoice Posting Atomicity Audit (READ-ONLY)

## 1) ACTIVE trigger on `invoices`

| Item | File:line | Value |
|------|-----------|--------|
| **CREATE TRIGGER** | **043_accounting_core.sql:948–952** | Only definition; no later migration drops or recreates it. |
| Trigger name | 043:949 | `trigger_auto_post_invoice` |
| Table | 043:950 | `invoices` |
| Timing | 043:950 | AFTER |
| Events | 043:950 | INSERT OR UPDATE OF status |
| Function | 043:952 | `trigger_post_invoice()` |

```sql
-- 043_accounting_core.sql lines 948–952
DROP TRIGGER IF EXISTS trigger_auto_post_invoice ON invoices;
CREATE TRIGGER trigger_auto_post_invoice
  AFTER INSERT OR UPDATE OF status ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION trigger_post_invoice();
```

---

## 2) ACTIVE definition of `trigger_post_invoice`

**Single definition:** `043_accounting_core.sql:929–946`. No other migration defines or replaces it.

```sql
-- 043_accounting_core.sql lines 929–946
CREATE OR REPLACE FUNCTION trigger_post_invoice()
RETURNS TRIGGER AS $$
BEGIN
  -- Only post if invoice is being sent/paid and wasn't already posted
  IF (NEW.status IN ('sent', 'paid', 'partially_paid') AND 
      (OLD.status IS NULL OR OLD.status = 'draft')) THEN
    -- Check if already posted
    IF NOT EXISTS (
      SELECT 1 FROM journal_entries 
      WHERE reference_type = 'invoice' 
        AND reference_id = NEW.id
    ) THEN
      PERFORM post_invoice_to_ledger(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Exception handling:** The trigger does **not** wrap `post_invoice_to_ledger` in `EXCEPTION WHEN OTHERS` (or any other exception block). There is no `BEGIN ... EXCEPTION ... END` around the `PERFORM post_invoice_to_ledger(NEW.id)` call.

**Effect:** Any exception raised by `post_invoice_to_ledger` (including from `assert_accounting_period_is_open`) propagates out of the trigger and aborts the current transaction. Errors are **not** swallowed; they are **re-raised** by default.

---

## 3) Atomicity

**Q: Does a failure in `assert_accounting_period_is_open` prevent the invoice row from committing?**

**Yes.**  

- `assert_accounting_period_is_open` is called inside `post_invoice_to_ledger` (190:398–399).  
- The trigger calls `post_invoice_to_ledger` with no exception handler.  
- So a period-assert failure in the trigger path causes the trigger to raise, the surrounding transaction to roll back, and the invoicing statement (INSERT or UPDATE) **not** to commit.

**Q: Can an invoice row exist without a JE?**

- **When posting is attempted and fails:** No. The trigger does not swallow exceptions, so a failed posting attempt rolls back the whole transaction. You do **not** get “invoice row committed, no JE” when the trigger runs and posting fails.
- **When posting is not attempted:** Yes. Example: invoice stays in `draft`; the trigger condition `NEW.status IN ('sent', 'paid', 'partially_paid')` is false, so `post_invoice_to_ledger` is never called and no JE is created. The row exists without a JE by design.

So: **atomicity holds** — if the trigger runs and attempts to post, then either the invoice change and the JE are both committed, or both are rolled back.

---

## 4) Evidence table

| Trigger / function | File:line | Calls assert_accounting_period_is_open? | Swallows exceptions? | Can row exist without JE? |
|--------------------|-----------|----------------------------------------|---------------------|----------------------------|
| **trigger_post_invoice** | 043:929–946 | **N** (does not call it; calls `post_invoice_to_ledger` only) | **N** (no EXCEPTION block) | **N** (when trigger runs and posting fails, transaction rolls back) |
| **post_invoice_to_ledger** | 190:353–510 (canonical body); assert at 190:398–399 | **Y** (`PERFORM assert_accounting_period_is_open(business_id_val, invoice_record.issue_date)`) | **N** (no exception handler around posting logic) | **N** (caller is the trigger; on failure, transaction aborts and invoice change is not committed) |

**Notes for “Can row exist without JE?”:**

- **N** means: “If we attempt to post (trigger ran and called `post_invoice_to_ledger`) and posting fails, the invoice row is **not** committed.” So you do not get “row saved, JE missing” due to swallowed errors.
- Draft (or other statuses that skip posting) can still have rows without JEs; that is intentional and not a failure of atomicity.

---

## Evidence summary

| Claim | Evidence |
|-------|----------|
| Active trigger on `invoices` | 043:948–952, `trigger_auto_post_invoice`, AFTER INSERT OR UPDATE OF status, `trigger_post_invoice()`. |
| Active `trigger_post_invoice` body | 043:929–946; no `EXCEPTION WHEN OTHERS`; direct `PERFORM post_invoice_to_ledger(NEW.id)`. |
| Invoice posting calls period assert | 190:398–399 inside `post_invoice_to_ledger`. |
| Exceptions not swallowed | Trigger and `post_invoice_to_ledger` have no handler around the posting call; exceptions propagate. |
| Atomicity when posting fails | Trigger raises → transaction rolls back → invoice row not committed when posting fails. |
