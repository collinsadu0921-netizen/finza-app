# AUDIT: Why owner-mode manual_draft still fails to post

## 1) Schema truth for journal_entries

**posting_source**

- **NOT NULL:** Yes. Migration 189: `ALTER COLUMN posting_source SET NOT NULL`. Migration 190: keeps NOT NULL (lines 73–74: `ALTER COLUMN posting_source SET NOT NULL` when `is_nullable = 'YES'`).
- **DEFAULT:** No. Migration 189 added `DEFAULT 'accountant'`. Migration 190: `ALTER COLUMN posting_source DROP DEFAULT` (lines 41, 62). Comment in 190 (line 79): "REQUIRED - must be explicitly set on insert. No default."

**Other NOT NULL columns that could affect INSERT**

- From 043 (create): `business_id`, `date`, `description` are NOT NULL; `date` has DEFAULT CURRENT_DATE.
- From 089: `posted_by_accountant_id` added without NOT NULL (nullable).
- From 090: `currency` added with DEFAULT 'GHS' (nullable in 090).
- No other migration sets NOT NULL on journal_entries columns that the manual_draft INSERT omits. The only NOT NULL column with **no** default in the current migration set is **posting_source** (after 190).

---

## 2) What post_manual_journal_draft_to_ledger inserts

**Exact INSERT column list** (from 297_fix_search_path_for_pgcrypto.sql / 294, lines 172–186):

```sql
INSERT INTO journal_entries (
  business_id,
  date,
  description,
  reference_type,
  reference_id,
  source_type,
  source_id,
  source_draft_id,
  input_hash,
  accounting_firm_id,
  period_id,
  created_by,
  posted_by
) VALUES (...)
```

**Required columns (NOT NULL without default) omitted from this INSERT**

- **posting_source** — NOT NULL, no default (after 190). Not in the INSERT list → value is NULL → violates NOT NULL.

**Columns with defaults or nullable (not the blocker)**

- currency: DEFAULT 'GHS' (090) → applied if column not listed.
- posted_by_accountant_id: nullable (089).
- is_adjustment: DEFAULT FALSE (166) → applied if not listed.

---

## 3) Current error response and categorization

**Exact error string:** The audit request did not include the exact error string returned to the client. The API (drafts/route.ts lines 558–581) returns `postError.message` as the `message` field with `reasonCode: "DATABASE_ERROR"`; that message is the PostgreSQL exception message from the failed RPC.

**Categorization from repo only:** Given the schema and INSERT, the only violation that must occur is:

- **(a) NOT NULL violation** on **posting_source** — the INSERT does not supply it and there is no default.

If the live DB still had a default on posting_source (e.g. 190 not applied), then a trigger could run with NEW.posting_source = 'accountant' and raise (b). From the migrations as written, (a) is the definitive violation.

---

## 4) Triggers on public.journal_entries

| Trigger | Timing | Events | Function |
|--------|--------|--------|----------|
| trigger_audit_journal_entry | AFTER | INSERT | audit_journal_entry_changes() |
| trigger_enforce_accountant_only_posting | BEFORE | INSERT | enforce_accountant_only_posting() |
| trigger_enforce_currency_fx_validation | BEFORE | INSERT OR UPDATE | enforce_currency_fx_validation() |
| trigger_enforce_period_state_on_entry | BEFORE | INSERT | validate_period_open_for_entry() |
| trigger_enforce_proposal_gating | BEFORE | INSERT | enforce_proposal_gating() |
| trigger_invalidate_snapshot_on_journal_entry | AFTER | INSERT | invalidate_snapshot_on_journal_entry() |
| trigger_prevent_journal_entry_modification | BEFORE | UPDATE OR DELETE | prevent_journal_entry_modification() |

**RAISE EXCEPTION in trigger functions (BEFORE INSERT only)**

- **validate_accountant_posting** (called by enforce_accountant_only_posting):  
  `'posted_by_accountant_id is required for accountant postings. Only accountants can post ledger entries manually.'`  
  `'User % does not have accountant role for business %. Only accountants can post ledger entries manually.'`
- **validate_currency_fx** (called by enforce_currency_fx_validation):  
  `'Currency is required for journal entries'`  
  `'Business currency is required. Please set default_currency in Business Profile settings.'`  
  `'FX rate is required when currency (%) differs from base currency (%).'`  
  `'FX rate must be greater than zero, got: %'`
- **validate_period_open_for_entry**:  
  `'No accounting period found for date %. Period must exist before posting. Business ID: %'`  
  `'Cannot insert journal entry into locked period (period_start: %)...'`  
  `'Cannot insert journal entry into soft-closed period (period_start: %). Regular postings are blocked...'`  
  (and other adjustment/period status messages)
- **validate_proposal_gating** (after 298): no RAISE for source_type IN ('manual_draft','opening_balance').

PostgreSQL applies column defaults before BEFORE triggers. So after 190 (no default for posting_source), the row passed to triggers has posting_source = NULL. The accountant trigger only raises when p_posting_source = 'accountant', so with NULL it does not raise. The failure is then at commit/constraint check: NOT NULL on posting_source.

---

## Deliverable (exact format)

- **Exact failing DB object:**  
  **Column constraint** on `public.journal_entries`: **NOT NULL on column `posting_source`**.

- **Exact rule:**  
  **NOT NULL** — `journal_entries.posting_source` must not be null.

- **Evidence:**  
  - **Column:** `posting_source`.  
  - **Default exists:** No. Migration 190 removes it: `ALTER TABLE journal_entries ALTER COLUMN posting_source DROP DEFAULT` and sets/keeps NOT NULL.

- **Why our INSERT violates it:**  
  The INSERT in `post_manual_journal_draft_to_ledger` does not include `posting_source`. With no default, the row has `posting_source = NULL`, which violates the NOT NULL constraint.

---

No fixes, migrations, or suggestions. Repo facts and schema only. The exact runtime error string was not provided; the conclusion follows from migrations and the RPC’s INSERT list.
