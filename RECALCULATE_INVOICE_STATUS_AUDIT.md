# Audit: recalculate_invoice_status() — status stuck at partially_paid after reversal

**Scope:** `supabase/migrations/` (129 and any overrides).  
**Symptom:** After payment reversal, `sum_active_payments = 0` but `invoices.status` remains `partially_paid` instead of `sent` or `overdue`.  
**Rule:** Report only; no fixes applied.

---

## 1. Exact IF/CASE logic for new_status when total_paid = 0

**Source:** `129_fix_invoice_status_sync.sql`, lines 46–64.

```sql
  -- Calculate outstanding amount (ledger reality)
  outstanding_amount := invoice_record.total - total_paid - total_credits;

  -- Determine status based on ledger reality
  IF outstanding_amount <= 0 THEN
    new_status := 'paid';
  ELSIF total_paid > 0 OR total_credits > 0 THEN
    new_status := 'partially_paid';
  ELSE
    new_status := 'sent';
  END IF;

  -- Check if overdue (only for unpaid/partial invoices)
  invoice_due_date := invoice_record.due_date;
  IF new_status != 'paid' AND invoice_due_date IS NOT NULL THEN
    IF CURRENT_DATE > invoice_due_date THEN
      new_status := 'overdue';
    END IF;
  END IF;
```

When **total_paid = 0** and **total_credits = 0** (typical after reversing the only payment):

- `outstanding_amount = invoice_record.total - 0 - 0 > 0` → not paid.
- `outstanding_amount <= 0` → false.
- `total_paid > 0 OR total_credits > 0` → false.
- So the **ELSE** branch runs → **`new_status := 'sent'`**.
- Then overdue check: if `due_date IS NOT NULL` and `CURRENT_DATE > invoice_due_date` → **`new_status := 'overdue'`**.

So when total_paid = 0, **`new_status` is never `partially_paid`**; it is either `'sent'` or `'overdue'`. The logic is correct.

---

## 2. Exact UPDATE and when it runs

**Source:** `129_fix_invoice_status_sync.sql`, lines 66–78.

```sql
  -- Update invoice status ONLY if it changed
  IF invoice_record.status != new_status THEN
    UPDATE invoices
    SET 
      status = new_status,
      paid_at = CASE 
        WHEN new_status = 'paid' AND invoice_record.paid_at IS NULL THEN NOW()
        ELSE invoice_record.paid_at
      END,
      updated_at = NOW()
    WHERE id = p_invoice_id;
  END IF;
```

- The UPDATE runs only when **`invoice_record.status != new_status`**.
- For reversal: `invoice_record.status` = `'partially_paid'`, `new_status` = `'sent'` or `'overdue'` → they **are** different, so the condition is **true** and the UPDATE **should** execute.
- The UPDATE sets **`status`**, **`paid_at`**, and **`updated_at`** on the row with `id = p_invoice_id`.

So the condition is satisfied for (partially_paid → sent/overdue), and the statement that would fix the status is the one above. If status is still partially_paid in the DB, either this block is not running or something else overwrites the row afterward.

---

## 3. Status when total_paid = 0 (due vs overdue)

| total_paid | total_credits | outstanding | First assignment | After overdue check |
|------------|----------------|------------|-------------------|----------------------|
| 0          | 0              | > 0        | `'sent'`          | `'overdue'` if `CURRENT_DATE > due_date`, else stays `'sent'` |
| 0          | 0              | ≤ 0        | `'paid'`          | (unchanged)          |

So when total_paid = 0 and the invoice is not fully covered by credits:

- Past due → **`new_status = 'overdue'`**.
- Not past due → **`new_status = 'sent'`**.

Neither path sets **`partially_paid`**. So if the function runs with total_paid = 0, it will not assign `partially_paid`.

---

## 4. Confirming the function runs (RAISE NOTICE)

To verify that the function is called and what it sees, you can add a notice at the end of the logic, just before the UPDATE block (e.g. after the overdue block, around line 65):

```sql
  RAISE NOTICE 'recalculate_invoice_status called for % old_status: % new_status: % total_paid: %',
    p_invoice_id, invoice_record.status, new_status, total_paid;
```

Then:

1. Trigger a payment reversal (soft-delete the payment).
2. Check Supabase logs (e.g. Postgres logs or Dashboard → Logs) for this NOTICE.

Interpretation:

- **No NOTICE** → `recalculate_invoice_status()` is not being run for that invoice (e.g. delete trigger not firing or wrong invoice_id).
- **NOTICE with total_paid > 0** → the trigger ran but the payment row was still counted (e.g. visibility/timing/transaction issue).
- **NOTICE with total_paid = 0 and new_status = 'sent' or 'overdue'** → logic ran correctly; if status in DB is still partially_paid, something else is updating the invoice after this (see section 5).

The audit does **not** add this NOTICE; add it temporarily when debugging.

---

## 5. Other code that sets status = 'partially_paid'

Search results for places that set or imply `partially_paid`:

### In migrations (definitions / logic that can write status)

| File | Location | What does it do |
|------|----------|------------------|
| **129_fix_invoice_status_sync.sql** | Lines 50–52, 222 | **recalculate_invoice_status**: sets `new_status := 'partially_paid'` only when `total_paid > 0 OR total_credits > 0`. One-time repair block uses same logic. |
| **040_credit_notes.sql** | Lines 162–164, 216–224 | **update_invoice_status_with_credits** (old version): sets `invoice_status := 'partially_paid'` when `total_paid > 0 OR total_credits > 0`. **update_invoice_status_on_credit_note**: `UPDATE invoices SET status = 'partially_paid'` when a credit note is applied and `new_balance < invoice_record.total`. |
| **036_complete_invoice_system_setup.sql** | ~220 | Old **update_invoice_status** (pre-129): assigns `'partially_paid'` from payment sums. |
| **035_enhance_invoice_system_ghana.sql** | ~184 | Same idea: status from payment totals. |

Migration order: 040 and 036/035 are **replaced** by **129** for payment-driven status:

- **129** replaces the **payment** trigger and the shared logic with `recalculate_invoice_status` and the two payment triggers (`trigger_update_invoice_status` and `trigger_update_invoice_status_on_delete`).
- So when a **payment** is updated (e.g. soft-deleted), the only trigger that runs is 129’s `trigger_update_invoice_status_on_delete` → `update_invoice_status_on_payment_delete()` → **recalculate_invoice_status(OLD.invoice_id)**.

The **credit_note** trigger in 040 is **replaced** by 129’s credit note trigger, which calls **recalculate_invoice_status** instead of doing its own UPDATE. So 129’s credit note path also goes through `recalculate_invoice_status` and does not set `partially_paid` when total_paid = 0.

### Application / API code

- **app/api/payments/webhooks/mobile-money/route.ts** (e.g. ~123): sets `newStatus = "partially_paid"` when `totalPaid > 0` and `remaining > 0` (client-side status for response).
- **app/api/payments/momo/callback/route.ts** (~98): sets `newStatus = "partially_paid"` (again for response/display).

These do not directly UPDATE `invoices.status` in the DB; they compute a status for the API response. The DB state is driven by the trigger when payments are inserted/updated.

### Conclusion for “something resetting to partially_paid”

- No other **trigger on `payments`** (after 129) writes to invoices; only 129’s delete trigger runs on payment soft-delete and it calls `recalculate_invoice_status`.
- **Triggers on `invoices`** (e.g. 043 `trigger_auto_post_invoice`) fire when **invoices** are updated; they do not set status back to `partially_paid` when we change status from partially_paid to sent/overdue.
- So from the codebase, **nothing** should overwrite a correct `sent`/`overdue` back to `partially_paid` after `recalculate_invoice_status` runs.

If the DB still shows `partially_paid` after reversal:

1. **Trigger not firing** (e.g. WHEN clause, or trigger dropped/replaced in a later migration not found in this audit).
2. **recalculate_invoice_status not running** for that invoice (wrong id or not called).
3. **Visibility/timing**: inside the same transaction, the SELECT in `recalculate_invoice_status` might see the payment row before the UPDATE that set `deleted_at` is visible (e.g. isolation or trigger order). Then `total_paid` would still be > 0 and `new_status` would stay `partially_paid`.
4. **RLS or permissions**: the UPDATE in `recalculate_invoice_status` runs with the invoker’s role (no SECURITY DEFINER in 129); if that role cannot update the invoice row, the UPDATE could affect 0 rows and status would not change.

Recommended next step: add the RAISE NOTICE above, run a reversal, and check logs to see whether the function runs and the values of `old_status`, `new_status`, and `total_paid`. That will distinguish “function not run” from “function ran with wrong inputs” from “function ran correctly but update not persisted.”
