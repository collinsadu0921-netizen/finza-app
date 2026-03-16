# Payment Posting — Verify, Fix, Harden

## 1. VERIFY

### All runtime payment posting paths

| Path | Entry point | Function called | Location |
|-----|-------------|-----------------|----------|
| **Trigger (INSERT payments)** | `trigger_auto_post_payment` → `trigger_post_payment()` | `post_payment_to_ledger(NEW.id)` | 043:973–976; 073:26; 075:21 |
| **Direct call (backfill/scripts)** | RPC or SQL | `post_invoice_payment_to_ledger(payment_id)` or `post_payment_to_ledger(payment_id,...)` | 172:811 `backfill_missing_invoice_journals` calls `post_invoice_payment_to_ledger` |

- **Conclusion:** All runtime payment posting goes through either `post_payment_to_ledger` or `post_invoice_payment_to_ledger`. The trigger uses the function **name** `post_payment_to_ledger`; the live definition is the one from migration 217 (last replacement).

### Triggers reference updated functions

- **043:** `EXECUTE FUNCTION trigger_post_payment()`; body calls `post_payment_to_ledger(NEW.id)`.
- **073, 075:** Replace `trigger_post_payment()` and still call `post_payment_to_ledger(NEW.id)`.
- No trigger calls `post_invoice_payment_to_ledger` by name. The trigger path is always `post_payment_to_ledger(NEW.id)`.
- After migration 217, `post_payment_to_ledger` and `post_invoice_payment_to_ledger` are both defined in 217 and include the period guard. There are no “legacy shadow” definitions at runtime; 217 overwrites 190.

### Duplicate or obsolete payment-posting functions

- **Obsolete (superseded by later migrations, never run at runtime as final definition):**  
  `post_payment_to_ledger` / `post_invoice_payment_to_ledger` in 043, 072, 075, 091, 100, 101, 172, 190.  
  They are historical; the current definitions are in **217**.
- **Other “payment” poster (different domain):**  
  `post_bill_payment_to_ledger`, `post_supplier_payment_to_ledger`, `post_layaway_payment_to_ledger` — not invoice payments; no change.
- **Duplicate logic between the two 217 functions:**  
  Both have `PERFORM assert_accounting_period_is_open(business_id_val, payment_record.date);` in the same place (after `business_id_val` set, before COA). Applied identically; no drift.

---

## 2. FIX (MINIMAL)

- Period guard is already identical in both functions; no change.
- No refactor into shared helpers; no change to posting semantics, metadata, or line ordering.

---

## 3. HARDEN — Exact diffs

**File:** `supabase/migrations/217_payment_posting_period_guard.sql`

**Change 1 — `post_invoice_payment_to_ledger`:**  
- SELECT: use `invoice_number, id` and defensive description.

```diff
-  SELECT invoice_number INTO invoice_record FROM invoices WHERE id = payment_record.invoice_id;
+  SELECT invoice_number, id INTO invoice_record FROM invoices WHERE id = payment_record.invoice_id;
  ...
-    'Payment for Invoice #' || invoice_record.invoice_number, 'payment', p_payment_id,
+    'Payment for Invoice #' || COALESCE(invoice_record.invoice_number, invoice_record.id::text), 'payment', p_payment_id,
```

**Change 2 — `post_payment_to_ledger`:**  
- Same SELECT and description change.

```diff
-  SELECT invoice_number INTO invoice_record FROM invoices WHERE id = payment_record.invoice_id;
+  SELECT invoice_number, id INTO invoice_record FROM invoices WHERE id = payment_record.invoice_id;
  ...
-    'Payment for Invoice #' || invoice_record.invoice_number, 'payment', p_payment_id,
+    'Payment for Invoice #' || COALESCE(invoice_record.invoice_number, invoice_record.id::text), 'payment', p_payment_id,
```

- For valid invoices, `invoice_number` is set → behavior unchanged.
- If `invoice_number` is ever NULL, description becomes `"Payment for Invoice #<uuid>"` instead of `"Payment for Invoice #"`.

---

## 4. Remaining risks (comments only, no implementation)

- **Trigger swallows errors (073/075):** `trigger_post_payment` uses `EXCEPTION WHEN OTHERS` and `RAISE WARNING` without re-raise. If `assert_accounting_period_is_open` raises (LOCKED/SOFT_CLOSED), the trigger catches it, logs a warning, and the payment row is still committed. Period enforcement is visible only as a missing journal entry, not as a failed insert. Mitigation would require trigger to re-raise on period assert (or a different error-handling strategy); out of scope for this task.
- **Backfill (172):** `backfill_missing_invoice_journals` calls `post_invoice_payment_to_ledger`. If a backfill runs for a period that is later LOCKED/SOFT_CLOSED, or for dates in such a period, the 217 period guard will raise and the backfill will fail for that payment; acceptable.
- **invoice_number NULL:** Schema/constraints may allow NULL `invoice_number` in edge cases; the COALESCE ensures the JE description never becomes a bare `"Payment for Invoice #"`.

---

## 5. Invariant confirmation

**Payments cannot post into LOCKED or SOFT_CLOSED periods.**

- Both `post_invoice_payment_to_ledger` and `post_payment_to_ledger` (217) call  
  `PERFORM assert_accounting_period_is_open(business_id_val, payment_record.date);`  
  before any COA resolution or `post_journal_entry`.
- `assert_accounting_period_is_open` uses the 2-arg form, so `p_is_adjustment` defaults to FALSE; regular postings are rejected for SOFT_CLOSED and LOCKED.
- The only runtime path that writes payment JEs is: INSERT → trigger → `post_payment_to_ledger` (217) → assert → post_journal_entry. Direct backfill/scripts use `post_invoice_payment_to_ledger` (217), which also asserts. So the invariant holds at the DB layer for both entry points.
