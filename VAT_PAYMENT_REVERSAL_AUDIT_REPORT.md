# VAT Lines in Payment and Reversal Journal Entries — Audit Report

**Scope:** `supabase/migrations/` and reversal API.  
**Rule:** Invoice-basis (accrual) VAT. VAT posted only at invoice/bill issuance. Payments and payment reversals are cash movements only and must **never** contain VAT account lines.

---

## AUDIT TASK 1 — post_payment_to_ledger

**Location:** `258_payment_posting_idempotency.sql` (canonical).  
Also invoked via `post_invoice_payment_to_ledger` in same file (trigger path).

### Exact journal lines inserted

**post_invoice_payment_to_ledger** (lines 95–102):

| # | Account | Debit | Credit | Description           |
|---|--------|-------|--------|------------------------|
| 1 | Asset (Cash/Bank/MoMo by method) | payment_amount | 0   | Payment received       |
| 2 | AR (control key `AR`)           | 0              | payment_amount | Reduce receivable |

**post_payment_to_ledger** (lines 204–209):

| # | Account | Debit | Credit | Description           |
|---|--------|-------|--------|------------------------|
| 1 | AR (control key `AR`)           | 0              | payment_amount | Reduce receivable |
| 2 | Asset (Cash/Bank/MoMo by method) | payment_amount | 0   | Payment received       |

Account resolution: `get_control_account_code(business_id, 'AR')`, `get_control_account_code(..., 'CASH')`, `get_control_account_code(..., 'BANK')`, and `get_account_by_code(..., '1020')` for MoMo. No account codes 2200, 2210, 2220, 1150, 1200 or any VAT/tax/NHIL/GETFund accounts referenced.

### VAT / revenue / other accounts

- **VAT account codes (2200, 2210, 2220, 2100, 2110, 2120, etc.):** Not referenced.
- **Revenue (4xxx):** Not referenced.
- **Accounts used:** AR only (via control key `AR`, typically 1100/1200) and Bank/Cash/MoMo (CASH, BANK, 1020).

### Verdict

**CLEAN** — Only two lines: DR Bank/Cash/MoMo, CR AR. No VAT, no revenue, no extra lines.

---

## AUDIT TASK 2 — post_bill_payment_to_ledger

**Location:** `270_bill_payment_open_status_guard.sql` (latest override of 268).

### Exact journal lines inserted

Lines 119–124:

| # | Account | Debit | Credit | Description    |
|---|--------|-------|--------|----------------|
| 1 | AP (control key `AP`) | payment_amount | 0 | Reduce payable |
| 2 | Asset (Cash/Bank/MoMo by method) | 0 | payment_amount | Payment made |

Account resolution: `get_control_account_code(..., 'AP')`, CASH, BANK, and code `1020` for MoMo. No VAT or expense account codes.

### VAT / expense lines

- **VAT accounts:** Not referenced.
- **Expense accounts:** Not referenced.
- **Accounts used:** AP (typically 2000) and Bank/Cash/MoMo only.

### Verdict

**CLEAN** — Only DR AP, CR Bank/Cash. No VAT, no expense lines.

---

## AUDIT TASK 3 — Reversal entries in production data

**How reversal entries are created:**  
There is **no** dedicated `post_reversal_to_ledger` function. Reversals are created by the API `app/api/accounting/reversal/route.ts`, which:

1. Loads the original JE and its lines.
2. Builds new lines with the **same accounts**, **debit and credit swapped**.
3. Calls `post_journal_entry(..., p_reference_type = 'reversal', p_reference_id = original_je_id, p_lines = reversal_lines)`.

So reversal JEs always mirror the original JE’s accounts; only sides are flipped.

- If the original JE is a **payment** JE → it has only AR + Bank/Cash → the reversal has only AR + Bank/Cash (no VAT).
- If the original JE is an **invoice** JE → it has AR + Revenue + VAT → the reversal has AR + Revenue + VAT (that is an invoice reversal, not a payment reversal).

So **payment reversals** (reversing a JE with `reference_type = 'payment'`) will not introduce VAT in code. The only way a reversal could touch VAT is if the **original** JE already had VAT (e.g. someone reversed an invoice JE).

### Query to run in production

```sql
SELECT 
  je.id,
  je.reference_type,
  je.reference_id AS original_je_id,
  je.description,
  jel.account_id,
  a.code AS account_code,
  a.name AS account_name,
  a.type AS account_type,
  jel.debit,
  jel.credit
FROM journal_entries je
JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
JOIN accounts a ON a.id = jel.account_id
WHERE je.reference_type = 'reversal'
ORDER BY je.created_at DESC;
```

Optional: join to the **original** JE to see what was reversed (payment vs invoice):

```sql
SELECT 
  je.id AS reversal_je_id,
  je.reference_id AS original_je_id,
  orig.reference_type AS original_reference_type,
  orig.reference_id AS original_entity_id,
  a.code AS account_code,
  a.name AS account_name,
  jel.debit,
  jel.credit
FROM journal_entries je
JOIN journal_entries orig ON orig.id = je.reference_id
JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
JOIN accounts a ON a.id = jel.account_id
WHERE je.reference_type = 'reversal'
ORDER BY je.created_at DESC;
```

### What to report after running

- **Count** of reversal JEs.
- **Flag** any line where:
  - `account_code` is in `('2100','2110','2120','2200','2210','2220')` or similar VAT/tax codes, or  
  - `account_name` contains vat, tax, nhil, getfund (case-insensitive).
- **Interpretation:** If such a line appears and the **original** JE has `reference_type = 'payment'` → **ISSUE** (payment reversal must not touch VAT). If the original has `reference_type = 'invoice'` (or bill/expense/credit_note) → VAT in the reversal is expected (reversal of that document). So: “All lines only AR/AP/Bank/Cash” is expected **only for reversals of payment (or bill_payment) JEs**.

### Verdict (code path only)

**CLEAN** — Reversal logic does not add any accounts; it only swaps debit/credit of the original JE. Payment JEs have no VAT, so their reversals do not introduce VAT. Production query is required to confirm no reversal of a **payment** JE incorrectly contains VAT (e.g. due to data or an old code path).

---

## AUDIT TASK 4 — post_invoice_to_ledger (confirm VAT is here)

**Location:** `226_accrual_ar_posting_invoice_finalisation.sql` (canonical for accrual invoice posting).

### Exact lines posted

1. **DR Accounts Receivable** (control key `AR`) — gross (invoice total). Description: `Invoice receivable`.
2. **CR Revenue** (account code `4000`) — subtotal. Description: `Service revenue`.
3. **Tax lines** — For each entry in `invoice.tax_lines` with `ledger_account_code` and non-zero `amount`:
   - Either **CR** or **DR** the tax account (from `tax_line_item->>'ledger_account_code'`, e.g. 2100, 2110, 2120) for that amount. Description includes `tax_code` (e.g. VAT, NHIL, GETFund).

Tax account codes come from the invoice’s `tax_lines` JSONB (`ledger_account_code` per line), not hardcoded in this function. Typical codes: 2100 (VAT), 2110 (NHIL), 2120 (GETFund).

### Confirmation

- **DR AR** — gross.
- **CR Revenue (4000)** — net (subtotal).
- **CR (or DR) VAT/tax control** — from `tax_lines` (e.g. VAT Output 2100, NHIL 2110, GETFund 2120 when present).

This is the only place in the **sales** flow where VAT is posted for invoices (accrual at issuance).

### Verdict

**CLEAN** — Invoice posting correctly includes AR, Revenue, and VAT/tax lines from `tax_lines`. VAT appears only here for sales, as required.

---

## AUDIT TASK 5 — VAT account usage across ALL posting functions

Search in `supabase/migrations/` for posting functions that reference VAT-related codes (2100, 2110, 2120, 2200, 2210, 2220) or VAT/tax/NHIL/GETFund by name or via `tax_lines` / `ledger_account_code`:

| Function | File(s) | Uses VAT/tax accounts? | Expected? |
|----------|---------|------------------------|-----------|
| **post_invoice_to_ledger** | 226, 130, 043, 099, 100, 094, 172, 190, 220, 228 | Yes — tax lines from invoice `tax_lines` (ledger_account_code e.g. 2100, 2110, 2120) | Yes |
| **post_bill_to_ledger** | 043, 099, 100, 094, 267, 190, etc. | Yes — tax lines from bill (parsed_tax_lines, ledger_account_code) | Yes |
| **post_expense_to_ledger** | 043, 099, 324, 229, 172, 190, etc. | Yes — 324: 2100, 2110, 2120, 2130 for VAT/NHIL/GETFund input | Yes |
| **post_credit_note_to_ledger** | 043, 092, 099, 130, 219, 292, 172, 190 | Yes — 043: 2100 “Reverse VAT”; later migrations use tax_lines | Yes |
| **post_sale_to_ledger** (retail POS) | 043, 099, 162, 175, 178, 179, 180, 182, 183, 259, etc. | Yes — tax lines from sale (ledger_account_code), 1200 inventory | Yes |
| **post_payment_to_ledger** | 258, 227, 217, 091, 075, 072, 190, 858 | No | Yes (must not) |
| **post_invoice_payment_to_ledger** | 258, 217, 091, 100, 101, 227, etc. | No | Yes (must not) |
| **post_bill_payment_to_ledger** | 268, 270, 091, 100, 101, 190 | No | Yes (must not) |
| **post_payroll_to_ledger** | 047, 049, 289, 287, 190 | Uses 2210, 2220, 2230, 2231 (PAYE, SSNIT) — payroll tax liabilities, not sales VAT | Yes (no sales VAT) |
| **post_sale_refund_to_ledger** | 191, 192, 259, 174 | Yes — reverses sale (tax/VAT lines) | Yes |
| **post_sale_void_to_ledger** | 192, 259 | Yes — reversal of sale (tax/VAT) | Yes |
| **post_layaway_sale_to_ledger** | 197 | Yes — tax/VAT at sale | Yes |
| **post_layaway_payment_to_ledger** | 197 | No — DR Cash, CR AR only | Yes (must not) |
| **post_asset_*** / **post_depreciation_*** / **post_manual_journal_draft_to_ledger** | Various | No VAT in these flows | N/A |
| **post_journal_entry** | 328, 324, 292, 253, 252, 190, etc. | Does not build lines; validates revenue line by reference_type. Allows `reversal` to have revenue lines (reversing invoice). Does not add VAT itself | N/A |
| **Reversal API** | `app/api/accounting/reversal/route.ts` | Builds lines by swapping original JE lines; does not add any account | Yes (must not) |

No posting function that is **only** for payments or payment reversals was found to reference VAT accounts. Payroll uses 2210/2220 (and 2230/2231) for PAYE/SSNIT, which are payroll tax liabilities, not sales VAT.

### Verdict

**CLEAN** — VAT/tax accounts appear only in: post_invoice_to_ledger, post_bill_to_ledger, post_expense_to_ledger, post_credit_note_to_ledger, post_sale_to_ledger, post_sale_refund_to_ledger, post_sale_void_to_ledger, post_layaway_sale_to_ledger. They do **not** appear in post_payment_to_ledger, post_invoice_payment_to_ledger, post_bill_payment_to_ledger, post_layaway_payment_to_ledger, or the reversal API. No unexpected function touches VAT.

---

## Summary

| Task | Verdict | Notes |
|------|--------|--------|
| 1 post_payment_to_ledger | CLEAN | Only DR Bank/Cash, CR AR |
| 2 post_bill_payment_to_ledger | CLEAN | Only DR AP, CR Bank/Cash |
| 3 Reversal entries (production) | CLEAN (code) | Reversal = swap of original lines; payment JEs have no VAT. Run provided SQL to confirm no payment reversal has VAT in data |
| 4 post_invoice_to_ledger | CLEAN | DR AR, CR Revenue, CR/DR VAT/tax from tax_lines |
| 5 VAT usage across posting | CLEAN | VAT only in invoice/bill/expense/credit_note/sale (and refund/void/layaway sale); never in payment or bill_payment or reversal path |

**No fixes recommended from this audit.** Payment and bill-payment posting and the reversal path do not introduce VAT lines. Production run of the Task 3 query is recommended to confirm existing reversal JEs do not contain VAT when the original JE is a payment.
