# Audit: `post_invoice_to_ledger` Tax-Line Parse, Skip Conditions, and Send-Time `tax_lines`

**Context:** Send modal errors with "Debit 10000, Credit 8333.33" — AR = total, Revenue = subtotal, tax credits missing.

**Scope:** Trace `tax_lines` parsing in migration 190, list all skip conditions, determine whether at send-time the invoice has `tax_lines` populated and whether trigger uses NEW vs re-SELECT. Read-only; no fixes.

---

## 1) Exact trace: how `tax_lines` is parsed and looped

**File:** `supabase/migrations/190_fix_posting_source_default_bug.sql`

### 1.1 Read from DB

```sql
SELECT i.business_id, i.total, i.subtotal, i.total_tax, i.customer_id, i.invoice_number, i.issue_date, i.tax_lines
INTO invoice_record FROM invoices i WHERE i.id = p_invoice_id;
```

- **190:378–387** — `tax_lines` comes from `invoice_record.tax_lines` (column `invoices.tax_lines`).

### 1.2 Parse into `parsed_tax_lines`

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

- **190:404** — `tax_lines_jsonb := invoice_record.tax_lines`
- **190:405** — If NULL, entire block skipped; `parsed_tax_lines` stays `ARRAY[]::JSONB[]`
- **190:406–408** — If object and has key `'tax_lines'`, replace `tax_lines_jsonb` with `tax_lines_jsonb->'tax_lines'`
- **190:411** — If `jsonb_typeof(tax_lines_jsonb) = 'array'`, iterate `jsonb_array_elements(tax_lines_jsonb)`
- **190:414–416** — Only append items that have both `'code'` and `'amount'`

**Canonical stored format (from `toTaxLinesJsonb`):** `{ lines: [...], meta: {...}, pricing_mode }` — array key is **`lines`**, not `tax_lines`. See **lib/taxEngine/serialize.ts:26–41** and **app/api/invoices/create/route.ts:297**.

### 1.3 Use `parsed_tax_lines` for validation and posting

- **190:427–433** — Loop over `parsed_tax_lines` to `assert_account_exists` for each `ledger_account_code` (when non-null and amount > 0). No filtering of `parsed_tax_lines`.
- **190:454–484** — Loop over `parsed_tax_lines`; for each item, optionally append a JE line (see skip conditions below).

---

## 2) Skip conditions (tax-line credits not posted)

| # | Skip reason | File:line | Condition |
|---|-------------|-----------|-----------|
| 1 | **`tax_lines` NULL** | 190:405 | `IF tax_lines_jsonb IS NOT NULL` false → parse block skipped → `parsed_tax_lines` empty |
| 2 | **Array key mismatch (parse failure)** | 190:406–408, 411 | Parser only checks `'tax_lines'`. Stored format uses `'lines'` → `tax_lines_jsonb` never becomes array → `jsonb_typeof = 'array'` false → loop 412–417 never runs → `parsed_tax_lines` empty |
| 3 | **Direct array format** | 190:411 | If top-level `tax_lines` is stored as raw array (no wrapper), `jsonb_typeof` is array and loop runs. Unused by create/update; they store `{ lines, meta, pricing_mode }`. |
| 4 | **Item missing `code` or `amount`** | 190:414–416 | `IF tax_line_item ? 'code' AND tax_line_item ? 'amount'` false → item not appended to `parsed_tax_lines` |
| 5 | **`ledger_account_code` NULL** | 190:462 | `IF tax_ledger_account_code IS NOT NULL AND tax_amount > 0` false → no JE line added for that tax line |
| 6 | **`tax_amount` ≤ 0** | 190:462 | Same as above |
| 7 | **`ledger_side` not `'credit'` or `'debit'`** | 190:465–482 | Only `IF tax_ledger_side = 'credit'` and `ELSIF tax_ledger_side = 'debit'` add lines. No ELSE → null or other values skip adding a JE line |

**Not a skip condition in `post_invoice_to_ledger`:**  
- **`apply_taxes`** — Not read by posting. SELECT (**190:378–387**) does not include `apply_taxes`. It only affects create/update (whether `tax_lines` are computed and stored). If `apply_taxes` false, `tax_lines` can be null → skip **1** applies.

---

## 3) Send-time `tax_lines` and trigger behaviour

### 3.1 Send route: what it updates and what it reads

- **send/route.ts:86–113** — Fetches invoice with `select('*', customers, businesses)`, i.e. full row including `tax_lines`.
- **send/route.ts:240–246, 314–319** — Calls `performSendTransition(supabase, invoiceId, invoice, sendMethod)` for email or default send.
- **performSendTransition** (**send/route.ts:8–48**):
  - Builds `updateData`: `status: 'sent'`, `sent_at`, optionally `invoice_number`, optionally `sent_via_method`.
  - Does **not** read or update `tax_lines`, `subtotal`, or `total`.
  - Executes `supabase.from('invoices').update(updateData).eq('id', invoiceId).select().single()`.

So the send route **only** updates `status`, `sent_at`, `invoice_number` (if missing), and `sent_via_method`. **`tax_lines` are never written or cleared at send-time.**

### 3.2 Does send route re-SELECT before the trigger?

The trigger runs **inside** the same DB transaction as the `UPDATE`. The route does a single `UPDATE ... WHERE id = invoiceId`; it does not run a separate SELECT immediately before that UPDATE. The **only** read of the invoice in the send path is the initial fetch (**86–113**), which occurs **before** `performSendTransition` and thus **before** the status update. The route does **not** re-SELECT the latest invoice row between the UPDATE and the trigger. The trigger runs on the DB side as part of the UPDATE; the route never “sees” the trigger.

### 3.3 Trigger: NEW vs re-SELECT

- **043_accounting_core.sql:928–946** — `trigger_post_invoice`:
  - Fires `AFTER INSERT OR UPDATE OF status` (**043:949–952**).
  - Calls `post_invoice_to_ledger(NEW.id)` (**043:941**).
  - Only **`NEW.id`** is passed; no other `NEW` fields (e.g. `NEW.tax_lines`) are used.

- **190:378–387** — `post_invoice_to_ledger` does its own `SELECT ... FROM invoices i WHERE i.id = p_invoice_id INTO invoice_record`.

So the trigger **does not** use `NEW.*` for posting. Posting **always** re-SELECTs the invoice row. The row seen by that SELECT is the updated row (status, sent_at, etc.) in the same transaction; `tax_lines` are unchanged by the send UPDATE.

### 3.4 Conclusion on send-time `tax_lines`

- At send-time, the invoice row **retains** whatever `tax_lines` it had before (from create/update). The send UPDATE does not touch them.
- For a draft created with `apply_taxes` true, create stores `tax_lines` via `toTaxLinesJsonb` (**create/route.ts:297**) in the form `{ lines, meta, pricing_mode }`.
- So for the typical “send from draft with tax” case, **`tax_lines` are present in the DB** when the trigger runs. They are **not** missing because of the send flow.

---

## 4) Definitive statement

**Tax_lines present but skipped by logic.**

- **Tax_lines missing in DB:** No, for the usual send-from-draft path. The send route does not clear or overwrite `tax_lines`. The draft already has `tax_lines` stored (canonical `{ lines, meta, pricing_mode }`) when we run the send UPDATE.
- **Tax_lines present but skipped by logic:** Yes. The parser in `post_invoice_to_ledger` (**190:406–408**) only handles the `'tax_lines'` array key. The app stores the array under **`lines`**. So the array is never extracted, `parsed_tax_lines` stays empty, and no tax-line credits are added. The imbalance (Debit 10000, Credit 8333.33) is due to this **parse failure**, not missing `tax_lines` in the DB.

---

## 5) Summary table

| Item | File:line | Evidence |
|------|-----------|----------|
| Parse: read | 190:404 | `tax_lines_jsonb := invoice_record.tax_lines` |
| Parse: array key | 190:406–408 | Only `tax_lines`; stored format uses `lines` |
| Parse: array loop | 190:411–417 | `jsonb_array_elements(tax_lines_jsonb)` only if `jsonb_typeof = 'array'` |
| Parse: item filter | 190:414–416 | Requires `code` and `amount` |
| Post filter | 190:462 | `ledger_account_code IS NOT NULL AND tax_amount > 0` |
| Post filter | 190:465–482 | `ledger_side` must be `'credit'` or `'debit'` |
| Trigger | 043:941 | `post_invoice_to_ledger(NEW.id)` only |
| Re-SELECT | 190:378–387 | `SELECT ... FROM invoices ... WHERE i.id = p_invoice_id` |
| Send UPDATE | send/route.ts:14–17, 35–39 | Only `status`, `sent_at`, `invoice_number`, `sent_via_method`; no `tax_lines` |
| Stored format | serialize.ts:26–41 | `{ lines, meta, pricing_mode }` |
