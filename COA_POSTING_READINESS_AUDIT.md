# CoA Posting Readiness Audit (Ledger-Safe)

**Objective:** Verify that every operational posting path maps to a **valid, active, compatible account**.  
**No mutations.** Read-only audit.

---

## 1. Posting matrix (source of truth)

| Posting Source     | Debit Account  | Credit Account | Account Type Required     |
| ------------------ | -------------- | -------------- | ------------------------- |
| Invoice issuance   | AR             | Revenue        | asset / income            |
| Payment received   | Cash           | AR             | asset / asset             |
| Expense            | Expense        | Cash           | expense / asset           |
| VAT (input)        | VAT receivable | Cash           | asset                     |
| VAT (output)       | AR             | VAT payable    | liability                 |
| NHIL / GETFund     | AR or Expense  | Tax payable    | liability                 |
| Reconciliation adj | varies         | varies         | controlled                |
| Period close       | none           | none           | n/a                       |

---

## 2. Actual schema (this codebase)

- **`accounts`** — Posting source. `journal_entry_lines.account_id` references `accounts.id`.  
  Columns: `id`, `business_id`, `name`, `code`, `type` (asset|liability|equity|**income**|expense), `description`, `is_system`, `deleted_at`, …

- **`chart_of_accounts`** — Validation source. Used by `assert_account_exists` and `get_control_account_code`.  
  Columns: `id`, `business_id`, `account_code`, `account_name`, `account_type` (asset|liability|equity|**revenue**|expense), `is_active`, …  
  **No `normal_balance` or `deleted_at`.** Normal balance is inferred: asset/expense → debit; liability/equity/income(revenue) → credit.

- **`chart_of_accounts_control_map`** — Maps control keys (AR, CASH, BANK, AP) to `account_code`.

---

## 3. Account inventory (per business)

Run against **accounts** (posting source):

```sql
SELECT
  a.code AS account_code,
  a.name AS account_name,
  a.type AS account_type,
  a.is_system,
  a.deleted_at
FROM accounts a
WHERE a.business_id = '<BUSINESS_ID>'
  AND a.deleted_at IS NULL
ORDER BY a.code;
```

Optional: join to **chart_of_accounts** to see validation view:

```sql
SELECT
  a.code AS account_code,
  a.name AS account_name,
  a.type AS account_type,
  c.account_type AS coa_account_type,
  c.is_active AS coa_is_active
FROM accounts a
LEFT JOIN chart_of_accounts c
  ON c.business_id = a.business_id AND c.account_code = a.code
WHERE a.business_id = '<BUSINESS_ID>'
  AND a.deleted_at IS NULL
ORDER BY a.code;
```

---

## 4. Posting-readiness checks (adapted to actual schema)

### A. Expense accounts (e.g. 5100)

Expense posting requires an **accounts** row with `type = 'expense'` and `deleted_at IS NULL`. If using **chart_of_accounts** for validation, it must have `account_type = 'expense'` and `is_active = true`.

**Audit query (accounts — posting source):**

```sql
SELECT a.code, a.name, a.type, a.deleted_at
FROM accounts a
WHERE a.business_id = '<BUSINESS_ID>'
  AND a.code BETWEEN '5000' AND '5999'
  AND (a.type <> 'expense' OR a.deleted_at IS NOT NULL);
```

➡️ **Any row = expense posting failure waiting to happen.**

**Audit query (chart_of_accounts — validation source):**

```sql
SELECT c.account_code, c.account_name, c.account_type, c.is_active
FROM chart_of_accounts c
WHERE c.business_id = '<BUSINESS_ID>'
  AND c.account_code BETWEEN '5000' AND '5999'
  AND (c.account_type <> 'expense' OR c.is_active <> true);
```

---

### B. Revenue accounts (e.g. 4000)

**accounts:** `type = 'income'`, `deleted_at IS NULL`.  
**chart_of_accounts:** `account_type = 'revenue'` (synced from income), `is_active = true`.

```sql
SELECT a.code, a.name, a.type, a.deleted_at
FROM accounts a
WHERE a.business_id = '<BUSINESS_ID>'
  AND a.code BETWEEN '4000' AND '4099'
  AND (a.type <> 'income' OR a.deleted_at IS NOT NULL);
```

```sql
SELECT c.account_code, c.account_name, c.account_type, c.is_active
FROM chart_of_accounts c
WHERE c.business_id = '<BUSINESS_ID>'
  AND c.account_code BETWEEN '4000' AND '4099'
  AND (c.account_type <> 'revenue' OR c.is_active <> true);
```

---

### C. AR control account

Resolved via `chart_of_accounts_control_map`. Must be **asset** (debit normal).

```sql
SELECT m.control_key, m.account_code, a.type AS account_type
FROM chart_of_accounts_control_map m
JOIN accounts a ON a.business_id = m.business_id AND a.code = m.account_code AND a.deleted_at IS NULL
WHERE m.business_id = '<BUSINESS_ID>'
  AND m.control_key = 'AR';
```

Required: `account_type = 'asset'`.

---

### D. Cash / Bank control accounts

```sql
SELECT m.control_key, m.account_code, a.type AS account_type
FROM chart_of_accounts_control_map m
JOIN accounts a ON a.business_id = m.business_id AND a.code = m.account_code AND a.deleted_at IS NULL
WHERE m.business_id = '<BUSINESS_ID>'
  AND m.control_key IN ('CASH', 'BANK');
```

Required: `account_type = 'asset'`.

---

### E. Tax accounts (VAT / NHIL / GETFund / COVID)

| Code | Purpose        | Expected type  |
|------|----------------|----------------|
| 2100 | VAT Payable    | liability      |
| 2110 | NHIL Payable   | liability      |
| 2120 | GETFund Payable| liability      |
| 2130 | COVID (legacy) | liability      |

```sql
SELECT a.code, a.name, a.type, a.deleted_at
FROM accounts a
WHERE a.business_id = '<BUSINESS_ID>'
  AND a.code IN ('2100','2110','2120','2130')
  AND (a.type <> 'liability' OR a.deleted_at IS NOT NULL);
```

COVID (2130): only for legacy reads; zero amounts must not post.

---

## 5. Cross-check: type vs intended side

System does **not** store `normal_balance`. Convention: asset/expense → debit normal; liability/equity/income → credit normal.

**Debit-side accounts (should be asset or expense):**

```sql
SELECT a.code, a.type
FROM accounts a
WHERE a.business_id = '<BUSINESS_ID>'
  AND a.deleted_at IS NULL
  AND a.type IN ('expense','asset');
```

If any of these are used for **credits** only in posting logic, that’s a design issue (no column to enforce).

**Credit-side accounts (should be income or liability):**

```sql
SELECT a.code, a.type
FROM accounts a
WHERE a.business_id = '<BUSINESS_ID>'
  AND a.deleted_at IS NULL
  AND a.type IN ('income','liability','equity');
```

---

## 6. RPC: single-call readiness check

Use the read-only RPC **`check_coa_posting_readiness(p_business_id UUID)`** (migration `231_coa_posting_readiness_audit.sql`). It returns zero rows when the CoA is ready for all posting paths; otherwise one row per issue.

**Returns:** `(check_name, account_code, issue)`.

**Checks performed:**
- **expense_accounts_posting** / **expense_accounts_coa** — Expense codes 5000–5999: type=expense, active, not deleted.
- **revenue_account_posting** / **revenue_account_coa** — Revenue 4000–4099: type=income/revenue, active.
- **ar_control** — AR mapping exists and resolved account is asset (or: missing mapping, account missing/deleted, wrong type).
- **cash_control** — CASH mapping exists and resolved account is asset.
- **tax_accounts** / **tax_accounts_coa** — 2100, 2110, 2120 exist, liability, active (COVID 2130 not required for readiness).

**Example:**

```sql
SELECT * FROM check_coa_posting_readiness('<BUSINESS_ID>');
```

---

## 7. Expected outcomes

- **Clean:** All audit queries return **zero rows**; RPC returns no rows. Expense creation works; no “Invalid account code” errors; ledger stays immutable.
- **Issues found:** Fix **metadata** only (e.g. sync accounts → chart_of_accounts, fix type, activate account). One UPDATE per bad account. No reposts, no ledger mutations.
