# Audit: Does migration 299 fix posting? + Remaining blocker identification

## 1. What was failing before

- `journal_entries.posting_source` is **NOT NULL** and **has no default** (after migration 190).
- `post_manual_journal_draft_to_ledger` did **not** set `posting_source` ⇒ INSERT failed with NOT NULL violation.

## 2. What the migration changed

- The INSERT now sets **`posting_source = 'system'`**.
- CHECK constraint allows `posting_source IN ('system', 'accountant')`, so `'system'` is valid.
- **Conclusion:** The NOT NULL violation on `posting_source` should be fixed.

## 3. Trigger impact

- **trigger_enforce_accountant_only_posting** only enforces when `posting_source = 'accountant'`.
- With `posting_source = 'system'`, it does **not** require `posted_by_accountant_id`.
- **Conclusion:** The accountant trigger should no longer block this INSERT.

## 4. How to identify the exact remaining blocker (if it still fails)

The **exact** Postgres error string is returned to the client in the failed POST response. The API returns it as the `message` field (e.g. `{ "reasonCode": "DATABASE_ERROR", "message": "<Postgres error>" }`).

**Where to get it:** Network tab → failed `POST /api/accounting/journals/drafts` (owner-mode) → Response body → copy the `message` value.

**Cursor cannot:** Run the app, open the Network tab, or see your runtime error. You must capture that string and match it to the list below.

---

## 5. Exact error strings for remaining blockers

If posting still fails after 299, the error must be one of the following. Match the **exact** (or prefix of the) `message` you see to identify the blocker.

### A. Period trigger — `trigger_enforce_period_state_on_entry`  
Function: `validate_period_open_for_entry()` (migration 166).

| Condition | Exact RAISE EXCEPTION message (prefix) |
|-----------|----------------------------------------|
| No period for (business_id, date) | `No accounting period found for date %. Period must exist before posting. Business ID: %` |
| Period status = locked | `Cannot insert journal entry into locked period (period_start: %). Journal entries are blocked for locked periods. Period ID: %, Date: %` |
| Period status = soft_closed (and row is not an adjustment) | `Cannot insert journal entry into soft-closed period (period_start: %). Regular postings are blocked. Only adjustments are allowed in soft-closed periods. Period ID: %, Date: %` |
| Period status not open (other) | `Cannot insert journal entry into period with status '%' (period_start: %). Only periods with status 'open' allow regular postings. Period ID: %, Date: %` |

### B. Currency/FX trigger — `trigger_enforce_currency_fx_validation`  
Function: `enforce_currency_fx_validation()` → `validate_currency_fx()` (migration 090).

| Condition | Exact RAISE EXCEPTION message |
|-----------|-------------------------------|
| currency NULL or empty | `Currency is required for journal entries` |
| business has no default_currency | `Business currency is required. Please set default_currency in Business Profile settings.` |
| currency ≠ base and fx_rate NULL | `FX rate is required when currency (%) differs from base currency (%).` (with actual codes in %) |
| fx_rate ≤ 0 | `FX rate must be greater than zero, got: %` |

**Note:** The INSERT does not set `currency` or `fx_rate`. Column `currency` has DEFAULT `'GHS'` (090), so the row gets `currency = 'GHS'`, `fx_rate = NULL`. The trigger runs with those values. So the only currency cases that can fire for this INSERT are: business `default_currency` NULL/empty, or base currency ≠ GHS (then fx_rate required).

### C. NOT NULL constraint (other column)

If the error is a generic NOT NULL violation (e.g. `null value in column "..." of relation "journal_entries" violates not-null constraint`), the column name in the message is the one still missing. Migration 299 only adds `posting_source`; any other NOT NULL column without default would need to be checked via `\d+ journal_entries` or `information_schema.columns` (nullable = 'NO' and no default).

### D. Other triggers

- **trigger_enforce_proposal_gating** — Already fixed for `manual_draft` (298).
- **trigger_prevent_journal_entry_modification** — UPDATE/DELETE only; does not run on INSERT.

---

## 6. Summary

- **Migration 299** should fix the original failure (posting_source NOT NULL + accountant trigger).
- If it still fails, capture the **exact** `message` from the failed POST response and match it to the strings in §5 to identify the **exact remaining blocker** (period trigger, currency trigger, or another NOT NULL column).
- No fixes requested; this audit only identifies how to determine the remaining blocker from the runtime error.
