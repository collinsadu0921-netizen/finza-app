# Audit: `post_invoice_to_ledger` — Journal Entry Imbalance

**Error:** `"Journal entry must balance. Debit: 10000, Credit: 8333.33"`  
**Interpretation:** Debit = AR (invoice total, gross). Credit = Revenue (subtotal, ex tax) only. Tax credits are missing.

**Scope:** `post_invoice_to_ledger` and related parsing/posting. Read-only; no fixes.

---

## 1) Amounts used for each journal line

**File:** `supabase/migrations/190_fix_posting_source_default_bug.sql`

| Line type | Amount source | File:line | Snippet |
|-----------|---------------|-----------|---------|
| **AR debit** | `invoice_record.total` | 190:443–444 | `'debit', invoice_record.total` |
| **Revenue credit** | `subtotal` | 190:447–449 | `'credit', subtotal` |
| **Tax credits (VAT, NHIL, GETFund, COVID)** | `(tax_line_item->>'amount')::NUMERIC` from `parsed_tax_lines` | 190:457–472 | `tax_amount := COALESCE((tax_line_item->>'amount')::NUMERIC, 0)`; only posted when `ledger_account_code IS NOT NULL AND tax_amount > 0` |

**`subtotal` definition:**

```sql
subtotal := COALESCE(invoice_record.subtotal, 0);
```

- **190:401**

**Invoice fields used:**

- **190:378–387** — `SELECT i.business_id, i.total, i.subtotal, i.total_tax, i.customer_id, i.invoice_number, i.issue_date, i.tax_lines INTO invoice_record FROM invoices i WHERE i.id = p_invoice_id`

---

## 2) Why tax amounts are NOT included in the journal entry

Tax lines are only posted when they come from `parsed_tax_lines`. That array is filled from `invoice_record.tax_lines` via the parser at **190:403–419**.

**Parser logic (190:403–419):**

```sql
tax_lines_jsonb := invoice_record.tax_lines;
IF tax_lines_jsonb IS NOT NULL THEN
  IF jsonb_typeof(tax_lines_jsonb) = 'object' AND tax_lines_jsonb ? 'tax_lines' THEN
    tax_lines_jsonb := tax_lines_jsonb->'tax_lines';
  END IF;
  IF jsonb_typeof(tax_lines_jsonb) = 'array' THEN
    FOR tax_line_item IN SELECT * FROM jsonb_array_elements(tax_lines_jsonb)
    LOOP
      IF tax_line_item ? 'code' AND tax_line_item ? 'amount' THEN
        parsed_tax_lines := array_append(parsed_tax_lines, tax_line_item);
      END IF;
    END LOOP;
  END IF;
END IF;
```

- The parser only treats a key named **`tax_lines`** as the array container (**190:406–408**).
- It never checks for **`lines`**.

**Stored format (canonical):**

- Invoice `tax_lines` are written via `toTaxLinesJsonb()` (`lib/taxEngine/serialize.ts`).
- **serialize.ts:26–41:** Output is `{ lines: [...], meta: {...}, pricing_mode }` — array key is **`lines`**, not `tax_lines`.
- **app/api/invoices/create/route.ts:297** uses `tax_lines: taxResult ? toTaxLinesJsonb(taxResult) : null`.

**Result:**

- Stored shape is `{ lines: [...], meta, pricing_mode }`.
- Parser looks for `tax_lines` only → condition false → `tax_lines_jsonb` stays the full object.
- `jsonb_typeof(tax_lines_jsonb) = 'array'` is false → loop never runs → **`parsed_tax_lines` remains empty**.
- **190:454–484:** Tax loop runs over `parsed_tax_lines`, so no tax lines are ever added.
- Tax amounts are never posted.

**Additional filter:** Even when a tax line is parsed, it is only posted if **190:462** holds:

```sql
IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0 THEN
```

So tax is skipped if `ledger_account_code` is missing or amount is zero. Here, the primary issue is that no tax lines are parsed at all due to the `lines` vs `tax_lines` mismatch.

---

## 3) Tax-inclusive vs tax-exclusive

**Ledger design:**

- AR debit = **total** (gross).
- Revenue credit = **subtotal** (ex tax).
- Tax = separate credit lines (when parsed).

So the **intended** treatment is **tax-inclusive**: total = subtotal + tax; AR receives gross; revenue is ex tax; tax is in tax control accounts.

**Evidence:**

- **190:444** — AR uses `invoice_record.total`.
- **190:401, 449** — Revenue uses `invoice_record.subtotal`.
- **190:457–472** — Tax lines (when present) are credited by `tax_amount` from each line.

**`total_tax`:** Read in the SELECT (**190:382**) but **not** used when building `journal_lines`. Posting relies entirely on `parsed_tax_lines`. With the parser never filling that array, tax is never posted.

---

## 4) Where the imbalance is introduced

| Location | Role |
|----------|------|
| **190:406–408** | Parser checks only `tax_lines` key. Canonical format uses `lines` → array never extracted. |
| **190:410–418** | Array loop runs only when `jsonb_typeof(...) = 'array'`. Object with `lines` fails → `parsed_tax_lines` stays empty. |
| **190:439–451** | Base lines built: AR debit = `invoice_record.total`, Revenue credit = `subtotal`. No tax lines. |
| **190:454–484** | Tax loop over `parsed_tax_lines` adds no lines. |
| **190:487–503** | `post_journal_entry(..., journal_lines, ...)` is called with only AR debit + Revenue credit. |
| **190:161–169** | `post_journal_entry` sums `debit`/`credit` from `p_lines`, then raises `"Journal entry must balance. Debit: %, Credit: %"` when `ABS(total_debit - total_credit) > 0.01`. |

**Imbalance:**

- Debit = total (e.g. 10000).
- Credit = subtotal only (e.g. 8333.33).
- Difference = tax (e.g. 1666.67) — never posted because no tax lines are added.

**Comparison:**

- **Credit note** posting (**190:1325–1343**) uses `tax_lines_jsonb ? 'lines'` and `tax_lines_jsonb->'lines'`, i.e. the canonical `lines` format. Invoice posting does not.

---

## 5) Summary

| Item | Detail |
|------|--------|
| **AR debit** | `invoice_record.total` (gross). **190:444** |
| **Revenue credit** | `invoice_record.subtotal` (ex tax). **190:401, 449** |
| **Tax credits** | From `parsed_tax_lines`; only if `ledger_account_code` and `amount` present. **190:454–484** |
| **Why tax missing** | Parser expects `tax_lines` key; app stores `lines`. Array never parsed → `parsed_tax_lines` empty → no tax lines posted. **190:406–419** |
| **Tax-inclusive?** | Yes. AR = total, Revenue = subtotal, tax = separate credits. |
| **Balance check** | **190:168–169** in `post_journal_entry`: `RAISE EXCEPTION 'Journal entry must balance. Debit: %, Credit: %', total_debit, total_credit` |

**Root cause:** Invoice `tax_lines` parsing in `post_invoice_to_ledger` (190:403–419) only handles the `tax_lines` array key. The canonical format uses `lines`. No tax lines are parsed, so none are posted, and the journal entry fails the balance check.
