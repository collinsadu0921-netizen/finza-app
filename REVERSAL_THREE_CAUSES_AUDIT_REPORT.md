# Audit: Three causes for status stuck at partially_paid after reversal

**Scope:** Trigger definition, reversal API transaction flow, SECURITY DEFINER/INVOKER, and diagnostic NOTICE.  
**Rule:** Report only; no fixes (except adding a temporary diagnostic migration).

---

## CAUSE 1 — Trigger not firing

### Trigger definition (129_fix_invoice_status_sync.sql)

**Trigger:**

```sql
DROP TRIGGER IF EXISTS trigger_update_invoice_status_on_delete ON payments;
CREATE TRIGGER trigger_update_invoice_status_on_delete
  AFTER UPDATE OF deleted_at ON payments
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION update_invoice_status_on_payment_delete();
```

- **Event:** `AFTER UPDATE OF deleted_at ON payments` — confirmed.
- **WHEN:** `OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL` — exact match.
- **Granularity:** `FOR EACH ROW` — confirmed.
- **Trigger function:** `update_invoice_status_on_payment_delete()` (lines 100–108) calls **`recalculate_invoice_status(OLD.invoice_id)`** — it uses **OLD.invoice_id**, not NEW.invoice_id.

The reversal route only sets `deleted_at` and `updated_at` on `payments`; `invoice_id` is not updated. So `OLD.invoice_id` and `NEW.invoice_id` are the same. Using OLD is correct and does not change behavior.

### Migrations after 129

Searched all migrations for:

- `DROP TRIGGER trigger_update_invoice_status_on_delete`
- Any replacement of this trigger or `ALTER TABLE payments` that would remove it.

**Result:** Only **129** defines and creates `trigger_update_invoice_status_on_delete`. No later migration drops or replaces it. Later migrations (035, 036, 040, 043, 044, 080, 081, 159, 157, etc.) either touch other triggers on `payments` (e.g. `trigger_update_invoice_status`, `trigger_auto_post_payment`, RLS policies) or indexes; none drop `trigger_update_invoice_status_on_delete`.

**Verdict:** **RULED OUT** — Trigger is correctly defined, uses OLD.invoice_id (same as NEW here), and is not dropped or replaced after 129.

---

## CAUSE 2 — Same-transaction visibility

### How the reversal route calls the two operations

**File:** `app/api/accounting/reversal/route.ts`

Relevant flow:

1. **Reversal JE** (lines 154–171):  
   `await supabase.rpc("post_journal_entry", { ... })`  
   One round trip; RPC runs in its own transaction on the server and commits.

2. **Audit** (lines 188–201):  
   `await logAudit({ ... })`  
   Separate operation.

3. **Payment soft-delete** (lines 211–219):  
   `await supabase.from("payments").update({ deleted_at: ..., updated_at: ... }).eq("id", refId).eq("business_id", businessId).is("deleted_at", null)`  
   Second round trip; a separate transaction from the RPC.

So the reversal JE and the payment update are **separate sequential awaits** — two separate client round trips and two separate server transactions. They are **not** inside a single Postgres transaction.

When the `.update()` runs:

- Its transaction performs `UPDATE payments SET deleted_at = ..., updated_at = ...` on the row.
- The row is updated in that transaction; then the AFTER trigger runs in the same transaction.
- Inside the trigger, `recalculate_invoice_status(OLD.invoice_id)` runs and does `SELECT SUM(amount) FROM payments WHERE invoice_id = ... AND deleted_at IS NULL`. In standard PostgreSQL, the row just updated already has `deleted_at` set, so it is excluded and `total_paid` should be 0.

So under normal Postgres semantics, same-transaction visibility would not make the SELECT see the payment as still non-deleted. Cause 2 could only apply if something non-standard were happening (e.g. trigger or isolation behavior in the Supabase/PostgREST path).

**Verdict:** **RULED OUT** — Reversal JE and payment update are separate awaits and separate transactions; in the payment-update transaction the trigger runs after the row is updated, so the SELECT should see `deleted_at` set. (If logs show `total_paid > 0` when it should be 0, then visibility would need to be re-investigated.)

---

## CAUSE 3 — RLS blocking the UPDATE

### recalculate_invoice_status

**Definition (129_fix_invoice_status_sync.sql, lines 10–80):**

```sql
CREATE OR REPLACE FUNCTION recalculate_invoice_status(p_invoice_id UUID)
RETURNS void AS $$
  ...
END;
$$ LANGUAGE plpgsql;
```

There is **no** `SECURITY DEFINER` (and no `SECURITY INVOKER`). In PostgreSQL, the default is **SECURITY INVOKER**. So the function runs with the **privileges of the caller**.

The caller is the trigger function `update_invoice_status_on_payment_delete()`, which runs in the context of the transaction that performed the `UPDATE` on `payments`. That transaction is started by the Supabase client (typically the **authenticated** user’s JWT). So `recalculate_invoice_status` runs as the **authenticated user**. Any RLS policies on `invoices` therefore **apply** to the `UPDATE invoices` inside the function. If no row passes the RLS policy for that user, the UPDATE will affect **0 rows** and the invoice status will not change.

### update_invoice_status_on_payment_delete

**Definition (129, lines 100–108):**

```sql
CREATE OR REPLACE FUNCTION update_invoice_status_on_payment_delete()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM recalculate_invoice_status(OLD.invoice_id);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
```

Again, **no** `SECURITY DEFINER`. So it runs as **SECURITY INVOKER** (default), i.e. as the role that did the UPDATE on `payments` (the authenticated user).

**Verdict:** **CONFIRMED (possible cause)** — Both functions use the default **SECURITY INVOKER**. The UPDATE in `recalculate_invoice_status` is therefore subject to RLS on `invoices`. If the RLS policy for UPDATE does not allow the current user to update that invoice row (e.g. by business_id or tenant), the UPDATE will match 0 rows and status will remain `partially_paid`. This is a plausible and likely cause of the bug.

---

## RAISE NOTICE — diagnostic migration

A **new migration** was added for temporary diagnostics:

**File:** `supabase/migrations/329_recalculate_invoice_status_diagnostic_notice.sql`

It recreates `recalculate_invoice_status` with this NOTICE inserted after `new_status` is set and before the UPDATE:

```sql
RAISE NOTICE 'recalculate_invoice_status: invoice=% old_status=% new_status=% total_paid=% total_credits=%',
  p_invoice_id,
  invoice_record.status,
  new_status,
  total_paid,
  total_credits;
```

**What to do:**

1. Apply the migration (e.g. `supabase db push` or run the migration in the Supabase SQL editor).
2. Trigger a payment reversal (soft-delete a payment that had made an invoice partially_paid).
3. In **Supabase Dashboard → Logs → Postgres**, look for the NOTICE line.

**How to interpret:**

- **No NOTICE** → Function did not run (trigger not firing or not called for that invoice).
- **NOTICE with total_paid > 0** → Function ran but still saw the payment (visibility or timing issue).
- **NOTICE with total_paid = 0, new_status = 'sent' or 'overdue', old_status = 'partially_paid'** → Logic is correct; if DB status is still partially_paid, the UPDATE likely affected 0 rows (e.g. RLS blocking).

Remove or revert the NOTICE once debugging is done.

---

## Summary

| Cause | Verdict | Reason |
|-------|--------|--------|
| **1. Trigger not firing** | RULED OUT | Trigger is correctly defined (AFTER UPDATE OF deleted_at, WHEN OLD/NEW as specified, FOR EACH ROW, uses OLD.invoice_id). Not dropped or replaced after 129. |
| **2. Same-transaction visibility** | RULED OUT | Reversal JE and payment update are separate awaits and separate transactions. In the update transaction the trigger runs after the row change, so SELECT should see deleted_at set. |
| **3. RLS blocking UPDATE** | CONFIRMED (possible) | `recalculate_invoice_status` and `update_invoice_status_on_payment_delete` are SECURITY INVOKER. UPDATE on `invoices` is subject to RLS; if the policy blocks the row, 0 rows are updated and status stays partially_paid. |

**Recommended next step:** Run with migration 329 applied, trigger a reversal, and check Postgres logs. If the NOTICE shows `total_paid=0` and `new_status='sent'` (or `'overdue'`) but the invoice row in the DB still has `status = 'partially_paid'`, then RLS (or another permission) is the cause and the fix is to make the recalculation run with elevated privileges (e.g. SECURITY DEFINER on `recalculate_invoice_status` and a safe `search_path`) or to adjust RLS so the invoking role can update that invoice.
