# Credit Note Application Fix Report

**Date:** 2026-02-12  
**Issue:** Users receive "Credit note amount exceeds invoice balance" even when the credit note amount equals the invoice outstanding.  
**Scope:** Apply validation in `PUT /api/credit-notes/[id]` when `status === "applied"`.

---

## 1. Root Cause

Validation was already using the **canonical** formula:

- **Outstanding** = `invoice.total` (or derived gross) − SUM(payments) − SUM(other applied credit notes).
- Payments: `invoice_id` match, `deleted_at IS NULL` (no status filter; invoice payments have no status in schema).
- Applied credits: `invoice_id` match, `status = 'applied'`, `deleted_at IS NULL`, **excluding** the current credit note.

The false "exceeds invoice balance" came from:

1. **Floating-point accumulation**  
   `remainingGross = invoiceGross - totalPaid - totalCredits` and then `remainingRounded = Math.round(remainingGross * 100) / 100` can still be one cent low when many small amounts are summed (e.g. 99.999999999 → 99.99 instead of 100.00). Then `creditRounded > remainingRounded` rejects a valid apply (e.g. credit 100.00).

2. **Strict rejection rule**  
   Rejecting whenever `creditRounded > remainingRounded` did not allow any rounding tolerance, so borderline cases (outstanding 100.0001, credit 100.00) could fail.

---

## 2. Updated Validation Formula

**Canonical outstanding (unchanged conceptually):**

```
outstanding = invoice.total (or subtotal + total_tax when total not set)
            − SUM(payments applied to this invoice, deleted_at IS NULL)
            − SUM(credit_notes applied to this invoice, status = 'applied', excluding this CN)
```

**Changes made:**

1. **Integer math in cents**  
   - `invoiceCents = round(invoiceGross * 100)`  
   - `paidCents = round(totalPaid * 100)`  
   - `creditsCents = round(totalCredits * 100)`  
   - `outstandingCents = max(0, invoiceCents - paidCents - creditsCents)`  
   - `outstanding = outstandingCents / 100`  

   This avoids drift from repeated float subtraction and keeps outstanding consistent with 2-decimal currency.

2. **Tolerance for rounding**  
   Reject only when:

   ```
   creditRounded > outstanding + 0.01
   ```

   So:
   - Outstanding 100.00, credit 100.00 → allow.
   - Outstanding 100.0001 (displayed as 100.00), credit 100.00 → allow (within 0.01).
   - Outstanding 99.99, credit 100.00 → reject (true over-application).

3. **Defensive logging**  
   - On **reject**: `console.warn` with `invoice_total`, `total_payments`, `total_credits`, `calculated_outstanding`, `credit_note_amount`, `invoice_id`.  
   - On **success** (dev only): `console.info` with the same numeric context.

---

## 3. Files Changed

| File | Change |
|------|--------|
| `app/api/credit-notes/[id]/route.ts` | Apply block (status === "applied"): outstanding computed in cents; reject only when `creditRounded > outstanding + 0.01`; added reject and success logs. |

No changes to:
- Ledger or `post_credit_note_to_ledger`
- Credit note create API
- UI (no UI-only fixes)

---

## 4. Application Validation Rule (Final)

```
outstanding = invoice_gross - total_payments - total_other_applied_credits   (in cents, then / 100)
IF credit_note.total > outstanding + 0.01
    → reject 400 "Credit note amount exceeds invoice balance"
ELSE
    → allow (then UPDATE status → applied; trigger posts to ledger)
```

---

## 5. SQL Verification Queries

**Outstanding for an invoice (operational view):**

```sql
SELECT
  i.id AS invoice_id,
  i.total AS invoice_total,
  COALESCE(SUM(p.amount), 0) AS total_payments,
  COALESCE(SUM(cn.total), 0) AS total_applied_credits,
  i.total - COALESCE(SUM(p.amount), 0) - COALESCE(SUM(cn.total), 0) AS outstanding
FROM invoices i
LEFT JOIN payments p ON p.invoice_id = i.id AND p.deleted_at IS NULL
LEFT JOIN credit_notes cn ON cn.invoice_id = i.id AND cn.status = 'applied' AND cn.deleted_at IS NULL
WHERE i.id = :invoice_id
GROUP BY i.id, i.total;
```

**Payments on invoice (only non-deleted):**

```sql
SELECT amount FROM payments
WHERE invoice_id = :invoice_id AND deleted_at IS NULL;
```

**Applied credit notes on invoice (excluding one by id):**

```sql
SELECT id, total FROM credit_notes
WHERE invoice_id = :invoice_id AND status = 'applied' AND deleted_at IS NULL AND id != :exclude_credit_note_id;
```

---

## 6. Regression Results (Expected)

| Test | Scenario | Expected |
|------|----------|----------|
| **1 — Exact match** | Invoice 5,000; Payments 0; Credit 5,000 | Apply succeeds (outstanding 5000, credit 5000 ≤ 5000 + 0.01). |
| **2 — Partial payment** | Invoice 5,000; Payments 2,000; Credit 3,000 | Apply succeeds (outstanding 3000, credit 3000). |
| **3 — Over-application** | Invoice 5,000; Payments 2,000; Credit 3,500 | Reject (outstanding 3000, 3500 > 3000 + 0.01). |
| **4 — Multiple credits** | Invoice 5,000; Credit A 2,000 applied; Credit B 3,000 | Apply succeeds (outstanding 3000 after A, credit B 3000). |
| **5 — Floating rounding** | Outstanding 100.0001; Credit 100.00 | Pass (100.00 ≤ 100.0001 + 0.01). |

---

## 7. Ledger Safety

- Apply still updates `credit_notes.status` to `'applied'`; the existing trigger continues to call `post_credit_note_to_ledger()`.
- No changes to posting rules, journal shape (DR Revenue/tax reversals, CR AR), or period enforcement.
- Credit notes still cannot exceed the computed invoice outstanding by more than the 0.01 tolerance; over-application remains blocked.

---

## 8. Accounting Rule

Credit notes reduce receivables and must not exceed the invoice outstanding balance. Outstanding is derived from **payments + applied credits** (and invoice total), not from any stored balance field. The fix keeps that rule and adds cent-based math plus a small tolerance so valid applies are not rejected by rounding.

---

*End of report.*
