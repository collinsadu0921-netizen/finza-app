# Invoice Credit Note APPLY — Root Cause Audit

## 1) PUT /api/credit-notes/[id] — Inspection

**File:** `app/api/credit-notes/[id]/route.ts`

### Validation rules

| Rule | Lines | Logic |
|------|--------|--------|
| Credit note exists | 121–134 | `existingCreditNote` from `credit_notes` by id; 404 if not found. |
| Apply balance check | 136–173 | When `status === "applied"` and current status ≠ applied: `currentBalance = invoice.total - totalPaid - totalCredits` (other applied credits only). Reject with 400 if `creditNote.total > currentBalance`. |
| Status allowed | 178–184 | `status` must be in `["draft", "issued", "applied"]`; else 400 "Invalid status". |

### Allowed status transitions

- Any of draft → draft, issued → issued, applied → applied (no-op).
- draft/issued → applied (apply).
- applied → draft/issued (un-apply; not typical).

### Permission checks

- **Lines 106–115:** Auth and business checks are commented out ("AUTH DISABLED FOR DEVELOPMENT"). No owner vs accountant distinction; any logged-in (or unauthenticated, if commented) caller can hit the route.

---

## 2) Exact error when APPLY fails

### API response body

| Outcome | Status | Body |
|--------|--------|------|
| Credit note not found | 404 | `{ error: "Credit note not found" }` |
| Credit note amount exceeds invoice balance | 400 | `{ error: "Credit note amount exceeds invoice balance" }` |
| Invalid status | 400 | `{ error: "Invalid status" }` |
| DB/trigger error (e.g. period closed, missing account) | 500 | `{ error: error.message }` — from Supabase (Postgres/PostgREST). |
| Other exception | 500 | `{ error: error.message || "Internal server error" }` |

### DB exception path

When the trigger runs, `post_credit_note_to_ledger` can raise, for example:

- `assert_accounting_period_is_open` → "accounting period is not open for posting" (or similar from migration 166).
- Missing AR/revenue/tax account → "AR account not found" / "Revenue account (4000) not found" / "account ... not found".
- Applied credit note not found → "Applied credit note not found: %" (should not occur if trigger runs after UPDATE).

The Supabase client receives the Postgres error; the route returns `NextResponse.json({ error: error.message }, { status: 500 })` (line 201–204). So the **exact failing “line” for a DB failure is the `.update(...)` call (route line 191)** — the error is produced by the DB/trigger, not by earlier validation.

---

## 3) post_credit_note_to_ledger prerequisites

| Prerequisite | Where checked | Possible failure |
|--------------|----------------|------------------|
| Period open for `cn_record.date` | `assert_accounting_period_is_open(business_id_val, cn_record.date)` — **190:1320** | LOCKED/SOFT_CLOSED → exception, transaction rolled back. |
| Revenue account 4000 | `assert_account_exists(business_id_val, '4000')` — **190:1346** | Missing → exception. |
| AR (control) | `assert_account_exists(business_id_val, ar_account_code)` — **190:1345** | Missing → exception. |
| Tax accounts from `tax_lines` | Loop in 190:1349–1365 | Missing code → exception. |
| AR balance | Not enforced in `post_credit_note_to_ledger` | N/A. |

Balance is enforced only in the **API** (route lines 136–173), not in the DB function.

---

## 4) UI state after success

- **Credit note view:** On success, `handleApply` calls `loadCreditNote()` (view line 100), which refetches `GET /api/credit-notes/[id]`. The user sees updated credit note (e.g. status applied).
- **Invoice balance recompute:**  
  - **DB:** Trigger `trigger_update_invoice_on_credit_note` (129:166–170) runs `AFTER UPDATE OF status ON credit_notes` and calls `recalculate_invoice_status(NEW.invoice_id)`. So invoice status (and derived fields in DB) are updated in the same transaction as the apply.  
  - **UI:** The credit note view does **not** refetch the invoice. If the user then opens the invoice view, `GET /api/invoices/[id]` recomputes outstanding from payments + credit notes and may call `recalculate_invoice_status` when outstanding ≤ 0 (invoices route 136–140). So invoice view is consistent on next load.  
- **Stale invoice totals:** Staleness is only possible if the user stays on a page that caches the invoice and never refetches (e.g. invoice view left open while applying from another tab). The apply flow itself does not show invoice balance; it only refreshes the credit note.

---

## 5) Exact failing line and failure type

### Most likely: API — balance check rounding (false 400)

**File:line:** `app/api/credit-notes/[id]/route.ts` **165**

**Code:**  
`if (creditNote && Number(creditNote.total) > currentBalance)`

**Issue:**  
`currentBalance` is `Number(invoice?.total || 0) - totalPaid - totalCredits` with no rounding. Floating-point can make `currentBalance` slightly less than the true balance (e.g. 99.999999 when it should be 100). If the credit note total is 100.00, the check becomes `100 > 99.999...` → true → 400 "Credit note amount exceeds invoice balance". So the failure is **API validation** (false positive), not DB rule or UI state.

**Evidence:**  
Payments create uses `remainingRounded = Math.round(remainingBalance * 100) / 100` and `amountNum > remainingRounded` (payments/create route 158–162). Credit-notes apply uses raw `currentBalance` and `Number(creditNote.total) > currentBalance`, so it is stricter than payments and prone to the same rounding issue.

---

## 6) Minimal fix

**Constraint:** No refactors; minimal, localized change.

**Change:** In `app/api/credit-notes/[id]/route.ts`, make the apply balance check use the same 2-decimal rounding as payments/create so it does not reject when the credit total is within rounding of the true balance.

- Compute `currentBalanceRounded = Math.round((Number(invoice?.total || 0) - totalPaid - totalCredits) * 100) / 100`.
- Compute `creditTotalRounded = Math.round(Number(creditNote?.total ?? 0) * 100) / 100`.
- Reject only when `creditTotalRounded > currentBalanceRounded` (and keep the same 400 body).

**Placement:** Replace the block that sets `currentBalance` and does the `if (creditNote && Number(creditNote.total) > currentBalance)` check (lines 165–172) with the rounded comparison above; leave all other validation and DB/trigger behaviour unchanged.

**Applied fix (diff):**

```diff
       const currentBalance = Number(invoice?.total || 0) - totalPaid - totalCredits
+      const currentBalanceRounded = Math.round(currentBalance * 100) / 100
+      const creditTotalRounded = Math.round(Number(creditNote?.total ?? 0) * 100) / 100

-      if (creditNote && Number(creditNote.total) > currentBalance) {
+      if (creditNote && creditTotalRounded > currentBalanceRounded) {
```

---

## 7) Summary

| Item | Value |
|------|--------|
| **Exact failing line** | `app/api/credit-notes/[id]/route.ts` **165** — `if (creditNote && Number(creditNote.total) > currentBalance)` |
| **Failure type** | **API** — balance validation can falsely reject when the credit equals the true balance but float rounding makes `currentBalance` slightly smaller. |
| **DB rule** | Not the cause; trigger and period/COA checks behave as designed. |
| **UI state** | Not the cause; invoice is recalculated by DB trigger and by invoice API on next load. |
| **Minimal fix** | Use 2-decimal rounding for `currentBalance` and credit total before comparing, matching payments/create. |
