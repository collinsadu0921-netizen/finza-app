# Audit: Invoice outstanding balance and status not updating after payment reversal

**Scope:** Database, reversal API, DB triggers, General Ledger frontend, invoices list/view pages.  
**Rule:** No fixes — report only.

---

## STEP 1 — Confirm the database is actually updating

### Query adaptation

The codebase **does not** have `invoices.amount_paid` or `invoices.gross_amount`. The `invoices` table (e.g. `036_complete_invoice_system_setup.sql`) has:

- `total` (invoice gross amount)
- `status` (draft, sent, partially_paid, paid, overdue, cancelled)
- `paid_at`, `updated_at`, `deleted_at`

So “amount paid” is **derived** as `SUM(payments.amount)` where `payments.invoice_id = invoice.id` and `payments.deleted_at IS NULL`.

Use this version of the query:

```sql
SELECT 
  i.id,
  i.status,
  i.total AS invoice_total,
  COALESCE(SUM(p.amount), 0) AS sum_active_payments,
  i.total - COALESCE(SUM(p.amount), 0) AS outstanding,
  COUNT(p.id) AS active_payments_count
FROM invoices i
LEFT JOIN payments p ON p.invoice_id = i.id AND p.deleted_at IS NULL
WHERE i.business_id = '[your business id]'
  AND i.deleted_at IS NULL
GROUP BY i.id, i.status, i.total
ORDER BY i.updated_at DESC
LIMIT 20;
```

### What to report after running it

- **Does `i.status` match the correct state?**  
  Correct means: `outstanding <= 0` → `paid`; `sum_active_payments > 0` and `outstanding > 0` → `partially_paid`; no payments and not paid → `sent` (or `overdue` if past due).
- **Are there invoices where `sum_active_payments` is 0 but `status` is still `partially_paid` or `paid`?**  
  If yes → **ISSUE**: DB trigger or recalculation is not updating status when payments are soft-deleted (e.g. after reversal).  
  If no → **CLEAN**: DB is consistent; problem is likely frontend/cache or no refetch after reversal.

### Verdict (schema only)

**UNCLEAR** until the query is run in your environment. Schema is consistent: no `amount_paid` column; status is updated by `recalculate_invoice_status` (see Step 3); “amount paid” is always computed from non-deleted payments.

---

## STEP 2 — Reversal API route

**File:** `app/api/accounting/reversal/route.ts`

### 1. Does the code soft-delete the payment after posting the reversal JE?

**CLEAN — Yes.** After the reversal JE is posted and audit is logged, when the original JE is a payment JE the route soft-deletes that payment:

```typescript
// BUG 1 FIX: When reversing a payment JE, sync invoice status by soft-deleting
// the payment. Ledger already reflects reversal (reversal JE); payments table
// must be updated so recalculate_invoice_status (triggered on payment delete)
// reverts invoice status/amount_paid.
const refType = originalJe.reference_type as string | null
const refId = originalJe.reference_id as string | null
if (refType === "payment" && refId) {
  const { error: updatePaymentError } = await supabase
    .from("payments")
    .update({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", refId)
    .eq("business_id", businessId)
    .is("deleted_at", null)

  if (updatePaymentError) {
    console.error("Reversal: soft-delete payment after reversal JE failed", updatePaymentError)
    return NextResponse.json(
      {
        error:
          "Reversal journal entry was posted but invoice status could not be updated. Please contact support.",
        reversal_journal_entry_id: journalEntryId,
        original_journal_entry_id: original_je_id,
      },
      { status: 500 }
    )
  }
}
```

So the database **is** updated (payment gets `deleted_at` set) when reversing a payment JE.

### 2. What does the API return?

**Success (after soft-delete when applicable):**

```typescript
return NextResponse.json({
  reversal_journal_entry_id: journalEntryId,
  original_journal_entry_id: original_je_id,
})
```

No invoice id, no `revalidatePath`/tags, no instruction to refetch invoices.

### 3. Invoice status recalculation in this route?

**CLEAN — No direct recalculation.** The route does **not** call `recalculate_invoice_status` or any invoice API. It relies entirely on the DB trigger on `payments`: when `deleted_at` is set, `trigger_update_invoice_status_on_delete` runs and calls `recalculate_invoice_status(OLD.invoice_id)` (see Step 3). So invoice status is updated in the DB by the trigger, not in the API route.

---

## STEP 3 — DB trigger and recalculate_invoice_status

**Migration:** `129_fix_invoice_status_sync.sql`

### 1. Does the trigger exist?

**CLEAN — Yes.** Two triggers on `payments`:

- `trigger_update_invoice_status` — INSERT or UPDATE on `payments`, when `NEW.deleted_at IS NULL`.
- `trigger_update_invoice_status_on_delete` — UPDATE of `deleted_at` on `payments`, when `OLD.deleted_at IS NULL` and `NEW.deleted_at IS NOT NULL`.

### 2. What exact event fires the “on delete” trigger?

**CLEAN.** The delete-path trigger is:

```sql
CREATE TRIGGER trigger_update_invoice_status_on_delete
  AFTER UPDATE OF deleted_at ON payments
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION update_invoice_status_on_payment_delete();
```

So it fires on **UPDATE OF deleted_at** when `deleted_at` goes from NULL to non-NULL (soft-delete). Reversal API does exactly that.

### 3. Does it fire when deleted_at goes from NULL to a timestamp?

**CLEAN — Yes.** The `WHEN` condition is `OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL`, so it fires when the row is soft-deleted (e.g. after reversal).

### 4. What does recalculate_invoice_status() UPDATE on invoices?

**CLEAN — Only these columns.** The function:

- Reads `invoices.total`, `status`, `due_date`, `paid_at`.
- Computes `total_paid` from `payments` where `deleted_at IS NULL`.
- Computes `total_credits` from applied `credit_notes`.
- Sets `new_status` from outstanding (paid / partially_paid / sent / overdue).
- **Only if** `invoice_record.status != new_status` it runs:

```sql
UPDATE invoices
SET 
  status = new_status,
  paid_at = CASE 
    WHEN new_status = 'paid' AND invoice_record.paid_at IS NULL THEN NOW()
    ELSE invoice_record.paid_at
  END,
  updated_at = NOW()
WHERE id = p_invoice_id;
```

So it updates **only** `status`, `paid_at`, and `updated_at`. It does **not** set `amount_paid` or `amount_outstanding` (and the schema has no such columns; “amount paid” is always derived from payments).

**Summary:** Trigger exists, fires on payment soft-delete, and recalculate_invoice_status updates only status/paid_at/updated_at. If the query in Step 1 still shows wrong status after a reversal, the next place to check is RLS or whether the trigger is actually running (e.g. in a different schema or disabled).

---

## STEP 4 — Frontend reversal handler (General Ledger)

**File:** `components/accounting/screens/LedgerScreen.tsx`

### What happens after the reversal API succeeds?

1. **ReversalModal** calls `onSuccess?.(result.reversal_journal_entry_id)` (`ReversalModal.tsx` line 77).
2. **LedgerScreen** defines `handleReversalSuccess` as:

```typescript
const handleReversalSuccess = (reversalJeId: string) => {
  setSuccessBanner({
    message: "Reversal created successfully.",
    reversalJeId,
  })
  loadLedger(pagination.page)
}
```

So after success it:

- Sets a success banner (message + link to reversal entry).
- Calls **`loadLedger(pagination.page)`** to refetch the **ledger** data only.

It does **not**:

- Call `router.refresh()`.
- Invalidate any React Query / SWR cache.
- Refetch invoices or trigger any invoice-related revalidation.

### Verdict

**ISSUE** — After a successful reversal, only the ledger is refetched. The invoices list (and any open invoice detail) is **not** refetched or invalidated. So:

- If the user is on the Ledger and then navigates to the Invoices page, the **next** load of the Invoices page will fetch fresh data from the API (which reads from DB), so they **should** see updated status and outstanding **once that page loads**.
- If the Invoices page is already open (same tab or another tab), it keeps its previous state until something triggers a refetch (e.g. filter change, window focus on the service invoices page which has a focus handler that calls `loadInvoices()`). So the “chain” is broken at: **no refetch or revalidation of invoice data after reversal**.

---

## STEP 5 — Invoices page data source and display

### 1. How is invoice data fetched?

- **List:** `app/service/invoices/page.tsx` (client component).  
  - Fetches via **`fetch(\`/api/invoices/list?${params}\`)`** in `loadInvoices()`.  
  - Runs on mount, when `businessId` or filters (including debounced search) change, and when the window **regains focus** (if `businessId` is set and not initial load).  
  - No React Query/SWR; plain `useState` + `fetch`. No server component fetch for the list.

- **Detail:** `app/invoices/[id]/view/page.tsx` (client).  
  - Fetches via **`fetch(\`/api/invoices/${invoiceId}\`)`** in `loadInvoice()`.  
  - Runs when the page mounts or when `loadInvoice` is called (e.g. after sending).  
  - No automatic refetch when returning from another route (e.g. Ledger).

### 2. Outstanding balance and “amount paid”

- **List:** The table shows **Amount** (`invoice.total`) and **Status** (`invoice.status`) from the list API. It does **not** show an “outstanding” or “amount paid” column per row. The **summary card** “Outstanding” is computed in a `useEffect` that depends on `businessId` and `invoices`; it calls `fetchInvoicePaymentTotals(invoiceIds)` (Supabase: payments and credit_notes with `deleted_at IS NULL`) and then `total - totalPaid - totalCredits` per invoice. So list status comes from **invoices.status** in the list response; summary outstanding is computed from **current** payments/credits. Until the list is refetched, `invoices` (and thus status in the table) is stale; the summary uses the same `invoices` array but refetches payments, so after a reversal the summary could update only when `invoices` or `businessId` changes (e.g. after a refetch).

- **Detail:** Uses `data.payments` from the invoice API (payments with `deleted_at IS NULL`) and computes `totalPaid`, `remainingBalance`, etc. So on **next** fetch of that invoice, reversed payments are excluded and balance/status are correct. Until that refetch, the detail view is stale.

- There is **no** `invoices.amount_paid` column; “amount paid” is always derived from payments (and credit notes where relevant) in API or client logic.

### 3. Cache / revalidation

- **List:** No `revalidatePath` / `revalidateTag`; no React Query/SWR. Data is fresh only when `loadInvoices()` runs (navigate to page, change filters, or window focus on that page).
- **Detail:** Same idea: fresh only when `loadInvoice()` runs (open view or explicit reload).
- **Ledger:** After reversal success, only `loadLedger(pagination.page)` runs; no invoice-related revalidation or refetch.

### Verdict

**CLEAN** for data source (direct API fetch from DB). **ISSUE** for UX: no refetch or revalidation of invoices after a reversal, so any open invoices list or detail view can show stale status/outstanding until the user triggers a refetch (navigate, change filter, focus, or refresh). The “chain” is broken at Step 4 (no invoice refetch/invalidation after reversal), not at how the invoices page fetches or computes outstanding.

---

## Summary

| Step | Verdict | Summary |
|------|--------|--------|
| 1 | UNCLEAR | Run the adapted query (no `amount_paid`/`gross_amount`; use `total` and `SUM(payments)`). If status is wrong when `sum_active_payments = 0`, the bug is in the DB/trigger; otherwise likely frontend. |
| 2 | CLEAN | Reversal API soft-deletes the payment when reversing a payment JE; returns only reversal JE ids; relies on DB trigger for invoice status. |
| 3 | CLEAN | Trigger on payment `UPDATE OF deleted_at` exists and calls `recalculate_invoice_status`; that function updates only `status`, `paid_at`, `updated_at` on `invoices`. |
| 4 | ISSUE | After reversal success, only `loadLedger()` is called; no `router.refresh()`, no invoice cache invalidation, no refetch of invoices. |
| 5 | CLEAN / ISSUE | Invoices list/detail fetch from API (DB); outstanding/amount paid are derived from payments. No cache layer, but no refetch of invoices after reversal, so open invoice views stay stale. |

**Conclusion:** The database and trigger path are correct: reversal soft-deletes the payment and the trigger updates invoice status. The observable bug (“invoice outstanding and status don’t update on the invoices page”) is most likely because **the frontend does not refetch or revalidate invoice data after a successful reversal**. Run Step 1’s query to confirm the DB is updated; if it is, the fix belongs in the frontend (e.g. refetch or invalidate invoices after reversal success, or `router.refresh()` if appropriate).
