# Invoicing, Tax & Posting Invariants

Short reference for canonical tax format, posting rules, guards, UI policy, and atomicity. No code — invariants only.

---

## 1. Canonical `tax_lines` format

Stored in `invoices.tax_lines` (and equivalent document fields) as JSONB. Application uses `toTaxLinesJsonb`; DB posting accepts both formats below.

**Canonical (preferred):**

```json
{
  "lines": [
    {
      "code": "VAT",
      "amount": 15.90,
      "ledger_account_code": "2100",
      "ledger_side": "credit",
      "rate": 0.15,
      "name": "VAT"
    }
  ],
  "meta": {
    "jurisdiction": "GH",
    "effective_date_used": "2025-12-31",
    "engine_version": "GH-2025-A"
  },
  "pricing_mode": "inclusive"
}
```

- **`lines`**: Array of tax line items. Each has `code`, `amount`; posting uses `ledger_account_code` and `ledger_side` when present.
- **`meta`**: Jurisdiction, effective date, engine version.
- **`pricing_mode`**: e.g. `"inclusive"`.

Legacy `{ "tax_lines": [...] }` is also supported by `post_invoice_to_ledger` for backward compatibility.

---

## 2. Posting rules (invoice)

`post_invoice_to_ledger` builds the journal entry as follows:

| Line    | Account | Amount        | Source                    |
|--------|---------|---------------|---------------------------|
| **AR** | AR (control) | `invoice.total` | Gross receivable          |
| **Revenue** | 4000 | `invoice.subtotal` | Base (ex-tax)              |
| **Tax** | Per tax line | `lines[].amount` | `tax_lines.lines[]` with `ledger_account_code` |

- **AR** = `invoice.total` (gross, tax-inclusive).
- **Revenue** = `invoice.subtotal` (stored).
- **Tax** = Sum of posted tax lines from `tax_lines.lines[]`. Only lines with `ledger_account_code` and `amount > 0` are posted; `ledger_side` determines debit vs credit.

---

## 3. Guard behavior

**Defensive guard in `post_invoice_to_ledger`:**

- If `invoice.total_tax > 0` **and** no tax journal lines are posted from `parsed_tax_lines` → **raise** and abort posting.
- Prevents silent imbalance (e.g. AR debited, revenue credited, tax credits missing).

**Invariant:**

- Invoices with **`total_tax = 0`** may post with **zero** tax journal lines (AR + Revenue only). The guard does **not** apply in that case.

---

## 4. UI rules (tax display)

- **COVID levy:** Never shown in UI. Filtered out everywhere (invoice, credit note, preview, PDF).
- **Zero-amount tax lines:** Never rendered. Only lines with `amount !== 0` are displayed.
- Data is not mutated; filtering is display-only. Ledger and exports are unchanged.

See `lib/taxes/readTaxLines.ts` (module header and `getTaxLinesForDisplay`) for the canonical UI policy.

---

## 5. Atomicity guarantees

| Operation | Trigger / flow | Guarantee |
|-----------|----------------|-----------|
| **Invoice send** | Status → `sent` (and `invoice_number` if missing). `trigger_auto_post_invoice` fires on `UPDATE OF status`. | If `post_invoice_to_ledger` fails (e.g. period closed, COA, tax guard), the **status update is rolled back**. No “sent” invoice without a journal entry. |
| **Payment** | `trigger_post_payment` on INSERT. Calls `post_payment_to_ledger`. No `EXCEPTION` handler (fail-fast). | If posting fails, the **payment INSERT is rolled back**. |
| **Credit note apply** | `trigger_post_credit_note` on `UPDATE` when `status` → `applied`. Calls `post_credit_note_to_ledger`. No `EXCEPTION` handler. | If posting fails (e.g. period closed), the **status update is rolled back**. No “applied” credit note without a journal entry. |

In all cases, posting runs in the same transaction as the row change. Exceptions abort the transaction; no swallowed errors.
