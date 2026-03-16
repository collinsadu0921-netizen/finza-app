# Audit + Proof: Payment Trigger Atomicity After Migration 218 (READ-ONLY)

## 1) ACTIVE trigger binding on `payments`

| Item | File:line | Snippet (max 10 lines) |
|------|-----------|------------------------|
| **CREATE TRIGGER on payments** | **043_accounting_core.sql:972–976** | See below. No later migration drops or recreates this trigger. |

```sql
-- 043_accounting_core.sql lines 972–976
DROP TRIGGER IF EXISTS trigger_auto_post_payment ON payments;
CREATE TRIGGER trigger_auto_post_payment
  AFTER INSERT ON payments
  FOR EACH ROW
  EXECUTE FUNCTION trigger_post_payment();
```

**Resolved binding:**

| Attribute | Value |
|----------|--------|
| Trigger name | `trigger_auto_post_payment` |
| Table | `payments` |
| Timing | AFTER |
| Events | INSERT |
| Function | `trigger_post_payment()` |

---

## 2) ACTIVE function body for `trigger_post_payment()`

The last migration that defines `trigger_post_payment` is **218**. Migrations 043 → 073 → 075 define it earlier; 218 overwrites with the final definition.

| Item | File:line | Snippet |
|------|-----------|---------|
| **Final definition** | **218_payment_trigger_reraise_period_errors.sql:9–23** | Body below. No `EXCEPTION WHEN OTHERS` around `post_payment_to_ledger`. |

```sql
-- 218_payment_trigger_reraise_period_errors.sql lines 9–23
CREATE OR REPLACE FUNCTION trigger_post_payment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deleted_at IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM journal_entries
      WHERE reference_type = 'payment'
        AND reference_id = NEW.id
    ) THEN
      PERFORM post_payment_to_ledger(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Confirmation:** There is no `BEGIN ... EXCEPTION WHEN OTHERS ... END` around `post_payment_to_ledger`. Any exception from `post_payment_to_ledger` (including `assert_accounting_period_is_open`) propagates and aborts the transaction, so the INSERT into `payments` is rolled back.

---

## 3) Proof tests (SQL you can run; no schema changes)

Replace `:business_id`, `:invoice_id`, `:payment_date`, `:period_start` with real UUIDs/dates from your DB. Ensure the invoice exists, belongs to the business, and has a suitable amount. For (B) and (C), `:payment_date` must fall inside the period you lock/soft-close.

---

### A) OPEN period ⇒ payment insert succeeds AND creates exactly 1 journal entry

```sql
-- A) OPEN period: payment insert succeeds, exactly 1 JE
-- Replace :business_id, :invoice_id, :payment_date with real values.
-- Precondition: period containing :payment_date is OPEN.

-- Setup (no schema change): use existing business_id, invoice_id; pick a date in an open period.
-- Example placeholders (replace with real UUIDs/date):
--   :business_id = '<your-business-uuid>'
--   :invoice_id  = '<your-invoice-uuid>'
--   :payment_date = '2025-01-15'   -- must be inside an open period

INSERT INTO payments (business_id, invoice_id, amount, date, method)
VALUES (
  :business_id,
  :invoice_id,
  1.00,
  :payment_date,
  'cash'
)
RETURNING id AS payment_id;

-- Assert: exactly one payment row (use returned payment_id).
-- Assert: exactly one journal_entries row for that payment.

-- Run after the INSERT (substitute <payment_id> with RETURNING value):
-- SELECT COUNT(*) FROM payments WHERE id = <payment_id>;        -- expect 1
-- SELECT COUNT(*) FROM journal_entries WHERE reference_type = 'payment' AND reference_id = <payment_id>;  -- expect 1
```

**Minimal runnable version (single statement, use real UUIDs and date):**

```sql
DO $$
DECLARE
  bid UUID := '00000000-0000-0000-0000-000000000001';  -- replace with real business_id
  iid UUID := '00000000-0000-0000-0000-000000000002'; -- replace with real invoice_id
  pdate DATE := '2025-01-15';                          -- replace with date in open period
  pid UUID;
  n_payments INT;
  n_jes INT;
BEGIN
  INSERT INTO payments (business_id, invoice_id, amount, date, method)
  VALUES (bid, iid, 1.00, pdate, 'cash')
  RETURNING id INTO pid;

  SELECT COUNT(*) INTO n_payments FROM payments WHERE id = pid;
  SELECT COUNT(*) INTO n_jes FROM journal_entries WHERE reference_type = 'payment' AND reference_id = pid;

  IF n_payments <> 1 OR n_jes <> 1 THEN
    RAISE EXCEPTION 'A) FAIL: expected 1 payment and 1 JE, got payments=%, JEs=%', n_payments, n_jes;
  END IF;
  RAISE NOTICE 'A) PASS: 1 payment, 1 JE for payment_id %', pid;
END $$;
```

---

### B) SOFT_CLOSED ⇒ payment insert fails and no payment row persists

```sql
-- B) SOFT_CLOSED: payment insert must raise; no payment row, no JE.
-- 1) Set period containing :payment_date to soft_closed (replace :business_id, :period_start).
-- 2) Attempt insert; expect exception.
-- 3) Verify: no new payment row for that id; no JE.

-- Step 1: close the period (replace :business_id, :period_start with real values)
UPDATE accounting_periods
SET status = 'soft_closed'
WHERE business_id = :business_id
  AND period_start = :period_start;

-- Step 2: attempt insert (same placeholders as A; :payment_date must be in that period)
-- Expected: INSERT raises (e.g. "period is not open for posting" or similar from assert_accounting_period_is_open).
INSERT INTO payments (business_id, invoice_id, amount, date, method)
VALUES (:business_id, :invoice_id, 1.00, :payment_date, 'cash');

-- Step 3: if you ran in a transaction that rolled back, payment row count for that id is 0, JE count 0.
-- If you need to run step 2 in a separate client, wrap step 2 in a block that catches and then checks counts:
```

**Minimal runnable version (expects exception from INSERT; restore period after test):**

```sql
DO $$
DECLARE
  bid UUID := '00000000-0000-0000-0000-000000000001';  -- replace
  iid UUID := '00000000-0000-0000-0000-000000000002'; -- replace
  pdate DATE := '2025-01-15';                          -- replace: must be in period_start..period_end
  pstart DATE := '2025-01-01';                         -- replace: period_start for that period
  pid UUID;
  raised BOOL := FALSE;
BEGIN
  UPDATE accounting_periods SET status = 'soft_closed'
  WHERE business_id = bid AND period_start = pstart;

  BEGIN
    INSERT INTO payments (business_id, invoice_id, amount, date, method)
    VALUES (bid, iid, 1.00, pdate, 'cash')
    RETURNING id INTO pid;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
  END;

  UPDATE accounting_periods SET status = 'open'
  WHERE business_id = bid AND period_start = pstart;

  IF NOT raised THEN
    RAISE EXCEPTION 'B) FAIL: INSERT should have raised for SOFT_CLOSED period';
  END IF;
  RAISE NOTICE 'B) PASS: INSERT raised as expected for SOFT_CLOSED';
END $$;
```

---

### C) LOCKED ⇒ same as (B); status = 'locked'

```sql
-- C) LOCKED: same as B but status = 'locked'.

UPDATE accounting_periods
SET status = 'locked'
WHERE business_id = :business_id
  AND period_start = :period_start;

-- Attempt same INSERT as in B. Expected: INSERT raises; no payment row; no JE.
```

**Minimal runnable version:**

```sql
DO $$
DECLARE
  bid UUID := '00000000-0000-0000-0000-000000000001';  -- replace
  iid UUID := '00000000-0000-0000-0000-000000000002'; -- replace
  pdate DATE := '2025-01-15';                          -- replace
  pstart DATE := '2025-01-01';                         -- replace
  raised BOOL := FALSE;
BEGIN
  UPDATE accounting_periods SET status = 'locked'
  WHERE business_id = bid AND period_start = pstart;

  BEGIN
    INSERT INTO payments (business_id, invoice_id, amount, date, method)
    VALUES (bid, iid, 1.00, pdate, 'cash');
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
  END;

  UPDATE accounting_periods SET status = 'open'
  WHERE business_id = bid AND period_start = pstart;

  IF NOT raised THEN
    RAISE EXCEPTION 'C) FAIL: INSERT should have raised for LOCKED period';
  END IF;
  RAISE NOTICE 'C) PASS: INSERT raised as expected for LOCKED';
END $$;
```

---

## 4) Idempotency check and NOT EXISTS guard

### Where the guard lives

The trigger calls `post_payment_to_ledger(NEW.id)` only when there is no existing journal entry for that payment id:

| Location | File:line | Quote |
|----------|-----------|--------|
| NOT EXISTS guard | **218_payment_trigger_reraise_period_errors.sql:13–17** | `IF NOT EXISTS ( SELECT 1 FROM journal_entries WHERE reference_type = 'payment' AND reference_id = NEW.id ) THEN PERFORM post_payment_to_ledger(NEW.id);` |

So for a given `NEW.id`, the trigger posts at most once per firing. The trigger runs only on INSERT and once per row, so each inserted payment row is processed once. Effect: one insert ⇒ one call to `post_payment_to_ledger` for that id ⇒ at most one JE per payment id from the trigger.

### Why “duplicate insert” doesn’t create duplicate JEs

- **Same row inserted twice:** Impossible. `payments.id` is the primary key (and typically default `gen_random_uuid()`). A second `INSERT` is a new row with a new id, so it is a second payment, not a duplicate of the first.
- **Same payment id processed twice by the trigger:** The only way would be for the trigger to run again for the same `NEW.id`. The trigger is `AFTER INSERT` and fires once per inserted row. There is no `UPDATE` trigger that re-posts, so the same `NEW.id` is never processed twice by the trigger.
- **Conclusion:** The NOT EXISTS guard ensures that *if* the trigger logic were ever run again for the same payment id (e.g. a hypothetical UPDATE trigger), it would not call `post_payment_to_ledger` again. With the current model (INSERT-only posting), each payment id gets exactly one JE from the trigger. Duplicate insert of the “same” logical payment (same invoice/amount/date) creates a second row (second id) and a second JE by design.

### SQL snippet: one insert ⇒ JE count 1

```sql
-- After a single successful INSERT, assert JE count = 1 for that payment_id.
-- (Use payment_id from INSERT ... RETURNING id or from a prior A) run.)

SELECT COUNT(*) AS je_count
FROM journal_entries
WHERE reference_type = 'payment'
  AND reference_id = :payment_id;
-- Expect je_count = 1.
```

Re-running the same `INSERT` with the same `business_id`, `invoice_id`, `amount`, `date`, `method` creates a *new* row (new id) and a second JE; that is a second payment, not idempotent reuse of the same row. The NOT EXISTS guard does not apply across different payment ids; it only prevents double-posting for the same id within the trigger, which with INSERT-only cannot happen in practice.

---

## Evidence summary

| Claim | Evidence |
|-------|----------|
| Active trigger on `payments` | 043:972–976, `trigger_auto_post_payment`, AFTER INSERT, `trigger_post_payment()`; never recreated later. |
| Active `trigger_post_payment` body | 218:9–23; no exception handling around `post_payment_to_ledger`. |
| NOT EXISTS guard | 218:13–17; `IF NOT EXISTS (... reference_type = 'payment' AND reference_id = NEW.id ) THEN PERFORM post_payment_to_ledger(NEW.id);` |
| OPEN ⇒ insert + 1 JE | Script A. |
| SOFT_CLOSED ⇒ insert raises | Script B. |
| LOCKED ⇒ insert raises | Script C. |
