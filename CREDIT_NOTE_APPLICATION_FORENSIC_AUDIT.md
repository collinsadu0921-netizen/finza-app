# Credit Note Application — Full Root Cause Forensic Audit

**Date:** 2026-02-12  
**Scope:** Read-only trace of why the system can return "Credit note amount exceeds invoice balance" when the credit note equals the outstanding invoice amount.  
**No code changes; identification and documentation only.**

---

## 1. Validation Source (exact location)

| Item | Detail |
|------|--------|
| **File** | `app/api/credit-notes/[id]/route.ts` |
| **Handler** | `PUT` export (lines 109–306) |
| **Logic block** | Lines 172–243: `if (status === "applied" && existingCreditNote.status !== "applied") { ... }` |
| **Rejection line** | Lines 218–234: `if (creditNote && creditRounded > outstanding + TOLERANCE)` → `return NextResponse.json({ error: "Credit note amount exceeds invoice balance" }, { status: 400 })` |

Validation runs **only in the API**. There is no balance check in DB triggers or in `post_credit_note_to_ledger`. The trigger (see §5) runs **after** the API allows the update and only performs ledger posting.

---

## 2. Outstanding Balance Formula Used (actual implementation)

The route computes outstanding as follows (lines 174–214):

1. **Invoice gross**
   - `rawTotal = Number(invoice?.total || 0)`
   - `derivedGross = Math.round((Number(invoice?.subtotal || 0) + Number(invoice?.total_tax || 0)) * 100) / 100`
   - `invoiceGross = rawTotal > 0 ? rawTotal : derivedGross`

2. **Aggregates**
   - **Payments:** `existingPayments` from `payments` where `invoice_id = existingCreditNote.invoice_id` and `deleted_at IS NULL`. No status filter (table has no status column).
   - **Other applied credits:** `existingCredits` from `credit_notes` where `invoice_id = existingCreditNote.invoice_id`, `status = 'applied'`, `deleted_at IS NULL`, then **filtered in JS** with `.filter((c) => c.id !== creditNoteId)` so the current credit note is excluded.

3. **Sums**
   - `totalPaid = (existingPayments ?? []).reduce((sum, p) => sum + Number(p.amount), 0)`
   - `totalCredits = (existingCredits ?? []).filter(...).reduce((sum, c) => sum + Number(c.total), 0)`

4. **Outstanding (cents then back to currency)**
   - `invoiceCents = Math.round(invoiceGross * 100)`
   - `paidCents = Math.round(totalPaid * 100)`
   - `creditsCents = Math.round(totalCredits * 100)`
   - `outstandingCents = Math.max(0, invoiceCents - paidCents - creditsCents)`
   - `outstanding = outstandingCents / 100`

5. **Credit amount**
   - `creditAmount = Number(creditNote?.total ?? 0)`
   - `creditRounded = Math.round(creditAmount * 100) / 100`

6. **Reject condition**
   - `TOLERANCE = 0.01`
   - Reject when `creditNote && creditRounded > outstanding + TOLERANCE`.

So the **actual formula** is:

- **Outstanding** = (invoice gross in cents − sum of payments in cents − sum of other applied credits in cents) / 100, with floor at 0.
- **Reject** when credit (2 dp) > outstanding + 0.01.

---

## 3. Expected vs Actual Formula Comparison

| Aspect | Expected (canonical) | Actual (implemented) |
|--------|----------------------|----------------------|
| **Outstanding** | `invoice.total − SUM(payments) − SUM(applied credit notes excluding this one)` | Same; uses `invoice.total` or `subtotal + total_tax` when total not set; payments and credits from DB; current CN excluded. |
| **Payments** | Only confirmed/successful; exclude reversed/failed | All non-deleted payments; no status (table has no status). Reversed = soft-delete only. |
| **Credits** | Only `status = 'applied'`; exclude current CN | Same: `status = 'applied'`, `deleted_at IS NULL`, and `c.id !== creditNoteId`. |
| **Rounding** | Tolerance so equal balance is not rejected | Tolerance 0.01; cents-based outstanding. |
| **Stored balance** | Must not use `invoice.balance` / `invoice.remaining` | Correct: no such columns used; all derived. |

Conclusion: The **intended** formula matches the **implemented** one. The only historical mismatch that could have caused false rejections was **precision/rounding** (see §6): before cents-based math and tolerance, floating-point and strict `creditRounded > remainingRounded` could reject when credit equalled outstanding.

---

## 4. Query Evidence

All via Supabase client (PostgREST); no raw SQL in the route.

**Invoice (validation block):**

```ts
supabase.from("invoices").select("total, subtotal, total_tax").eq("id", existingCreditNote.invoice_id).single()
```

**Payments:**

```ts
supabase.from("payments").select("amount").eq("invoice_id", existingCreditNote.invoice_id).is("deleted_at", null)
```

**Applied credit notes (other than current):**

```ts
supabase.from("credit_notes").select("id, total").eq("invoice_id", existingCreditNote.invoice_id).eq("status", "applied").is("deleted_at", null)
```

Then in JS: exclude row where `c.id === creditNoteId`.

**Current credit note total:**

```ts
supabase.from("credit_notes").select("total").eq("id", creditNoteId).single()
```

Equivalent SQL for outstanding (for verification only):

```sql
SELECT
  i.total AS invoice_total,
  COALESCE(SUM(p.amount), 0) AS total_payments,
  COALESCE(SUM(cn.total), 0) AS total_other_applied_credits
FROM invoices i
LEFT JOIN payments p ON p.invoice_id = i.id AND p.deleted_at IS NULL
LEFT JOIN credit_notes cn ON cn.invoice_id = i.id AND cn.status = 'applied' AND cn.deleted_at IS NULL AND cn.id != :credit_note_id
WHERE i.id = :invoice_id
GROUP BY i.id, i.total;
```

---

## 5. Execution Timeline (request flow)

1. **UI** — `app/credit-notes/[id]/view/page.tsx`
   - User clicks "Apply Credit Note" → `handleApply()` (lines 78–87) → `openConfirm(..., onConfirm: () => runApply())`.
   - On confirm: `runApply()` (lines 91–109) → `fetch(\`/api/credit-notes/${id}\`, { method: "PUT", body: JSON.stringify({ status: "applied" }) })`.
   - No client-side balance validation; no pre-load of invoice/payments/credits for validation.

2. **API** — `PUT /api/credit-notes/[id]`
   - Parse body `{ status, reason, notes }`.
   - Load `existingCreditNote` (id, invoice_id, status, business_id); 404 if missing.
   - Optional business access check (owner or business_users).
   - **If** `status === "applied"` **and** current status ≠ applied:
     - Load invoice (total, subtotal, total_tax).
     - Load payments (amount) for `invoice_id`, `deleted_at` null.
     - Load credit_notes (id, total) for `invoice_id`, status applied, `deleted_at` null.
     - Load current credit note (total).
     - Compute invoiceGross, totalPaid, totalCredits (excluding current CN), outstanding in cents, creditRounded.
     - **Reject 400** if `creditRounded > outstanding + 0.01` with message "Credit note amount exceeds invoice balance".
   - If not rejected: reconciliation check (VALIDATE, non-blocking).
   - Build `updateData` (status, reason, notes, updated_at).
   - `supabase.from("credit_notes").update(updateData).eq("id", creditNoteId)`.

3. **DB (same transaction as update)**
   - Trigger `trigger_auto_post_credit_note` (AFTER UPDATE on `credit_notes`) → `trigger_post_credit_note()` (migration 219): if `NEW.status = 'applied'` and no existing journal for this credit note, calls `post_credit_note_to_ledger(NEW.id)`.
   - Trigger `trigger_update_invoice_on_credit_note` (129): on status change to/from applied, calls `recalculate_invoice_status(NEW.invoice_id)`.

4. **Ledger**
   - `post_credit_note_to_ledger` runs only after the UPDATE; it does **not** run before validation. Validation does **not** read ledger balances.

Order: load invoice → load payments → load credits → validate outstanding → if pass → update credit_notes → triggers (ledger + invoice status). Validation does not use cached/stale balance columns; it uses fresh reads. No validation occurs inside DB triggers for this flow.

---

## 6. Root Cause Classification

**Primary (historical / if tolerance or cents not applied):**

- **Precision / rounding**  
  If outstanding was computed as `invoiceGross - totalPaid - totalCredits` in floats and then rounded to 2 dp, the result could be slightly low (e.g. 99.99 instead of 100.00). With a strict check `creditRounded > remainingRounded`, a credit equal to true outstanding (100.00) would then be rejected. The current code uses cents-based math and a 0.01 tolerance specifically to avoid this.

**Other possible contributors (if rejection persists):**

- **Wrong balance field** — Ruled out: validation uses only derived totals (invoice total/subtotal+tax, payments sum, credits sum). No `invoice.balance` or `invoice.remaining` (such columns are not used in this path).
- **Missing payment aggregation** — Unlikely: all non-deleted payments for the invoice are summed. Payments table has no status; reversed payments would need to be soft-deleted to be excluded.
- **Missing credit aggregation** — Unlikely: applied credits are summed and current CN is explicitly excluded by id.
- **Trigger conflict** — Ruled out: no validation in triggers; trigger runs after API validation and only posts to ledger.
- **RLS data filtering** — Possible: API uses `createSupabaseServerClient()` with **anon key** (user JWT). If RLS on `payments` or `credit_notes` restricts rows (e.g. by user or role), the server might see a **subset** of payments/credits. That could **overstate** outstanding (e.g. fewer payments seen → higher outstanding) and thus **allow** more credit, not reject. It could cause a **false reject** only if the server saw **more** payments or **more** applied credits than actually apply to that invoice (e.g. policy bug or wrong scope). Not confirmed; worth checking RLS policies for `payments` and `credit_notes` for the request context.
- **Multiple validation layers conflict** — None found: only this PUT handler performs the balance check for apply. Create flow has its own check and different message.
- **Invoice total source** — If `invoice.total` is 0 or null, code uses `subtotal + total_tax`. If that derived value is wrong (e.g. tax not saved), `invoiceGross` could be too low and outstanding understated, leading to reject when credit equals the true (higher) outstanding.

**Chosen classification:** **Precision / rounding** (with the note that the codebase already includes a cents-based outstanding and 0.01 tolerance in this route; if the error still appears, either an older build is running, or one of the secondary factors above applies).

---

## 7. Float / Rounding Audit

- **Current behaviour:** Outstanding is computed in integer cents then converted back; rejection uses `creditRounded > outstanding + 0.01`. This is intended to prevent floating-point and strict comparison from causing a false "exceeds invoice balance" when credit equals outstanding.
- **Historical risk:** Without cents math, `invoiceGross - totalPaid - totalCredits` can be a float (e.g. 2999.9999999999995). Rounding that to 2 dp can give 2999.99 or 3000.00 depending on implementation. A strict `creditRounded > remainingRounded` could then reject 3000.00 vs 2999.99.
- **Stored scale:** `invoices.total`, `payments.amount`, `credit_notes.total` are NUMERIC; no explicit scale in schema. Application uses 2 decimal places for comparison.

---

## 8. Multi Credit Note Interaction

- **Multiple applied credit notes:** Correctly included in `existingCredits`; all are summed and reduce outstanding.
- **Current credit note:** Correctly excluded by `c.id !== creditNoteId` so it is not counted until after it is applied.
- **Partial credit note usage:** Not supported: credit notes have a single `total` and are applied in full when status is set to `applied`. No `applied_amount` / `remaining_amount` tracking; validation compares full `credit_note.total` to outstanding.

---

## 9. RLS / Access Side Effects

- **Client:** `createSupabaseServerClient()` uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` and user cookies (SSR). So requests run as the authenticated user; RLS applies.
- **Tables involved:** `invoices`, `payments`, `credit_notes`, `businesses`, `business_users`. If RLS on `payments` or `credit_notes` limits rows by user/role/business, the apply handler might see a subset of rows. As noted in §6, that would usually **overstate** outstanding (fewer payments/credits seen) and allow more credit; a false **reject** would require seeing too many payments/credits (e.g. policy or scope bug). Policies were not fully traced; recommend checking any RLS on `payments` and `credit_notes` for the API request context.

---

## 10. Ledger Interaction

- **Validation** does **not** read ledger (journal_entries/journal_entry_lines). It uses only operational tables: invoices, payments, credit_notes.
- **Ledger posting** runs **after** validation: `post_credit_note_to_ledger` is invoked from `trigger_post_credit_note` on UPDATE of `credit_notes`, so it runs only if the API has already allowed the update. Validation is not based on ledger balances.
- **Integrity:** Over-crediting is prevented by the API check. Ledger posting then records the same economic event; no separate ledger-based balance check in the apply path.

---

## 11. Failure Reproduction Trace (Invoice 5000, Payments 0, Credit 5000)

- **Intended outcome:** Apply allowed (outstanding = 5000, credit = 5000).
- **Steps with current logic:**
  1. `invoiceGross = 5000`, `totalPaid = 0`, `totalCredits = 0` (current CN not in applied set).
  2. `outstandingCents = 500000`, `outstanding = 5000`, `creditRounded = 5000`.
  3. Reject if `5000 > 5000 + 0.01` → false → **allow**.
- **Where a reject could still occur:**
  - **Old code** (no tolerance, float math): e.g. `remainingRounded` becomes 4999.99 → reject.
  - **Wrong invoice total:** e.g. `invoice.total` 0 and `subtotal + total_tax` wrong → `invoiceGross` &lt; 5000 → outstanding &lt; 5000 → reject.
  - **RLS:** only if the server saw extra payments or credits (unexpected).

Exact rejection location: **`app/api/credit-notes/[id]/route.ts`** at the `if (creditNote && creditRounded > outstanding + TOLERANCE)` block (lines 218–234).

---

## 12. Risk Assessment (ledger integrity)

- **Over-crediting:** Prevented by the API check; credit cannot exceed outstanding + 0.01.
- **Under-crediting (blocking valid apply):** Historically possible due to rounding; current design (cents + tolerance) aims to prevent that. No ledger integrity risk from under-crediting; only UX/operational.
- **Ledger vs operational mismatch:** Reconciliation (VALIDATE) runs after validation and is non-blocking; it does not change when apply is allowed. Ledger integrity is not compromised by the validation logic itself.

---

## 13. Recommended Fix Surface (where only)

- **Primary:** Validation logic that compares credit to outstanding — **`app/api/credit-notes/[id]/route.ts`**, inside the `if (status === "applied" && existingCreditNote.status !== "applied")` block (lines 172–243). Ensure:
  - Outstanding is derived from invoice total (or subtotal+tax), payments sum, and other applied credits only (current CN excluded).
  - Comparison uses a rounding-safe method (e.g. cents) and a small tolerance so that credit equal to outstanding is not rejected.
- **Secondary (if needed):**  
  - RLS policies on `payments` and `credit_notes` so the apply handler sees all relevant rows for the invoice in the request context.  
  - Invoice total consistency (ensure `invoice.total` or `subtotal + total_tax` correctly reflects the amount that should be cleared by payments and credits).

No fix logic is proposed; only the locations above.

---

## 14. Accounting Rule (confirmation)

Credit notes must reduce receivables and must not exceed the invoice outstanding balance. Validation uses the canonical definition of outstanding (invoice total − payments − other applied credits) and rejects when credit exceeds that amount by more than a small tolerance. It must not reject when the credit equals the outstanding balance; the current implementation is intended to satisfy that by using cents-based outstanding and a 0.01 tolerance.

---

*End of forensic audit.*
