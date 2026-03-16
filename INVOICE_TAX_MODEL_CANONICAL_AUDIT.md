# Audit: Canonical Tax Model for Invoices

**Scope:** Invoice create route, invoice table columns, `post_invoice_to_ledger` inputs. Read-only; no fixes.

---

## 1) Is `invoice.total` tax-inclusive or tax-exclusive?

**Answer: TAX-INCLUSIVE.**

**Evidence:**

| Source | File:line | Detail |
|--------|-----------|--------|
| Create route | **create/route.ts:214** | `taxInclusive: true, // Invoices always use tax-inclusive pricing` |
| Create route | **create/route.ts:220–221** | `baseSubtotal = taxResult.base_amount`; `invoiceTotal = taxResult.total_amount` |
| Create route | **create/route.ts:291–292** | `total: invoiceTotal` (i.e. `result.total_amount`) |
| Tax engine types | **lib/taxEngine/types.ts:24–26** | `base_amount` = subtotal excl tax; `total_tax` = sum of tax; `total_amount` = **base + tax** |
| Update route | **route.ts:348** | `true // tax-inclusive pricing` |
| Update route | **route.ts:351–352, 377** | `baseSubtotal = taxCalculationResult.subtotal_excl_tax`; `invoiceTotal = taxCalculationResult.total_incl_tax`; `updateData.total = invoiceTotal` |

`total` is persisted as `total_amount` / `total_incl_tax` (base + tax). It is the gross amount including tax.

---

## 2) Is `invoice.subtotal` stored, or derived?

**Answer: STORED.**

**Evidence:**

| Source | File:line | Detail |
|--------|-----------|--------|
| Table schema | **036_complete_invoice_system_setup.sql:94** | `subtotal NUMERIC DEFAULT 0` on `invoices` |
| Create route | **create/route.ts:289–290** | `subtotal: baseSubtotal` in `invoiceData`; inserted into `invoices` |
| Update route | **route.ts:371, 402** | `updateData.subtotal = baseSubtotal`; written to DB |

`subtotal` is a physical column on `invoices` and is set by create/update. It is not computed on read (no view or derived column).

---

## 3) Does `post_invoice_to_ledger` assume subtotal + tax = total OR total already includes tax?

**Inputs used:** `post_invoice_to_ledger` reads from `invoices` only (**190:378–387**):

```sql
SELECT i.business_id, i.total, i.subtotal, i.total_tax, i.customer_id, i.invoice_number, i.issue_date, i.tax_lines
INTO invoice_record FROM invoices i WHERE i.id = p_invoice_id;
```

**Journal entry construction (**190:401, 439–451, 454–484**):**

- **AR debit:** `invoice_record.total` (**190:444**)
- **Revenue credit:** `subtotal` := `COALESCE(invoice_record.subtotal, 0)` (**190:401, 449**)
- **Tax credits:** from `parsed_tax_lines` (each `tax_line_item->>'amount'`), only when `ledger_account_code IS NOT NULL` and `tax_amount > 0` (**190:457–472**)

**Balance requirement:** Debits = credits ⇒ `total` = `subtotal` + sum(posted tax amounts). So the design **assumes**:

- **subtotal + tax = total** (tax = sum of tax line amounts).
- **total** is the gross amount (AR), so **total already includes tax**.

**`total_tax`:** Selected (**190:382**) but **not** used when building `journal_lines`. Posting relies on `parsed_tax_lines` for tax, not on `invoice_record.total_tax`.

**Answers:**

| Assumption | YES/NO |
|------------|--------|
| **subtotal + tax = total** | **YES** — JE balances only if total = subtotal + sum(tax lines). |
| **total already includes tax** | **YES** — AR debit = total (gross); revenue = subtotal (ex tax); tax from lines. |

---

## 4) Trace summary

| Layer | File:line | total | subtotal | total_tax | tax_lines |
|-------|-----------|--------|----------|-----------|-----------|
| **Create** | create/route.ts:209–221, 289–291 | `taxResult.total_amount` (base + tax) | `baseSubtotal` = `taxResult.base_amount` | `taxResult.total_tax` | `toTaxLinesJsonb(taxResult)` |
| **Update** | route.ts:351–352, 371–377, 402–408 | `total_incl_tax` | `subtotal_excl_tax` | `legacyTaxAmounts.totalTax` | `taxResultToJSONB(...)` |
| **Table** | 036:94, 98–99 | `total NUMERIC` | `subtotal NUMERIC` | `total_tax NUMERIC` | (JSONB elsewhere) |
| **post_invoice_to_ledger** | 190:378–387, 401, 439–451, 454–484 | AR debit | Revenue credit | not used | tax credits (parsed) |

---

## 5) Final YES/NO answers

| Question | Answer |
|----------|--------|
| 1) Is `invoice.total` tax-inclusive or tax-exclusive? | **TAX-INCLUSIVE** |
| 2) Is `invoice.subtotal` stored, or derived? | **STORED** |
| 3a) Does `post_invoice_to_ledger` assume **subtotal + tax = total**? | **YES** |
| 3b) Does `post_invoice_to_ledger` assume **total already includes tax**? | **YES** |
