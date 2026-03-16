# Chart of Accounts Deduplication — Verification & Rollback

**Do not run this file as SQL.** This is a Markdown document. To apply the fix:

- **248** — `supabase/migrations/248_deduplicate_chart_of_accounts.sql` (CoA dedup + ledger consolidation).
- **249** — `supabase/migrations/249_coa_dedup_integrity_patch.sql` (integrity patch: dynamic FK discovery, _affected_businesses for snapshot stale, COALESCE canonical ordering, LOCK before index, dynamic orphan validation). Run after 248, or run 249 alone for a single production-safe pass.

The code blocks below are verification queries to copy-paste into your SQL client separately.

---

## 1. Verification Queries

Run these **before** and **after** migration (or after only, for sanity check).

### 1.1 Detect duplicate accounts (should be 0 after migration)

```sql
SELECT business_id, code, COUNT(*) AS duplicate_count
FROM accounts
WHERE deleted_at IS NULL
GROUP BY business_id, code
HAVING COUNT(*) > 1;
```

### 1.2 Ledger preservation — journal entry line count unchanged

```sql
SELECT COUNT(*) AS journal_entry_lines_count FROM journal_entry_lines;
```

Before and after must match.

### 1.3 Balance preservation (per account code, per business)

Run **before** migration and save results; compare **after** (by business_id + code, sum debit/credit per account code).

```sql
SELECT
  a.business_id,
  a.code,
  SUM(jel.debit) AS total_debit,
  SUM(jel.credit) AS total_credit
FROM journal_entry_lines jel
JOIN accounts a ON a.id = jel.account_id
WHERE a.deleted_at IS NULL
GROUP BY a.business_id, a.code
ORDER BY a.business_id, a.code;
```

After migration, the same query should show the same totals per (business_id, code) — only duplicate account ids were merged into one.

### 1.4 Uniqueness: partial unique index present

Migration 248 uses a **partial unique index** (not a table constraint) so soft-deleted rows can keep duplicate (business_id, code).

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'accounts'
  AND indexname = 'accounts_unique_business_code_active_idx';
```

Expect one row: `WHERE deleted_at IS NULL` in the definition.

### 1.5 Reporting validation (after migration)

Call the canonical report RPCs for an affected business and period; confirm they return data and balance:

```sql
-- Replace :period_id with a real period id for a business that had duplicates
SELECT * FROM get_trial_balance_from_snapshot(:period_id);
SELECT * FROM get_profit_and_loss_from_trial_balance(:period_id);
SELECT * FROM get_balance_sheet_from_trial_balance(:period_id);
```

---

## 2. Report of affected accounts

To **preview** which accounts will be merged (run before migration, read-only):

```sql
WITH dup_groups AS (
  SELECT business_id, code
  FROM accounts
  WHERE deleted_at IS NULL
  GROUP BY business_id, code
  HAVING COUNT(*) > 1
),
with_activity AS (
  SELECT
    a.id,
    a.business_id,
    a.code,
    a.name,
    a.created_at,
    (SELECT COUNT(*) FROM journal_entry_lines jel WHERE jel.account_id = a.id) AS line_count
  FROM accounts a
  JOIN dup_groups d ON d.business_id = a.business_id AND d.code = a.code
  WHERE a.deleted_at IS NULL
),
canonical AS (
  SELECT DISTINCT ON (business_id, code)
    business_id, code, id AS canonical_id, name AS canonical_name, created_at, line_count
  FROM with_activity
  ORDER BY business_id, code, line_count DESC, created_at ASC, id ASC
)
SELECT
  c.business_id,
  c.code,
  c.canonical_id,
  c.canonical_name,
  c.line_count AS canonical_line_count,
  ARRAY_AGG(wa.id ORDER BY wa.created_at, wa.id) FILTER (WHERE wa.id <> c.canonical_id) AS duplicate_account_ids,
  ARRAY_AGG(wa.name ORDER BY wa.created_at, wa.id) FILTER (WHERE wa.id <> c.canonical_id) AS duplicate_names
FROM canonical c
JOIN with_activity wa ON wa.business_id = c.business_id AND wa.code = c.code
GROUP BY c.business_id, c.code, c.canonical_id, c.canonical_name, c.line_count, c.created_at;
```

---

## 3. Safety rollback strategy

- **No application-level rollback** is provided: the migration deletes duplicate accounts and reassigns FKs. Reversing would require restoring deleted rows and reassigning FKs back, which is not scripted here.
- **Database-level rollback:** Run the migration inside a transaction (it already uses `BEGIN`/`COMMIT`). If you run it manually and want to roll back, run `ROLLBACK` before `COMMIT` if any step fails or if you abort.
- **Pre-migration backup:** Take a snapshot or dump of `accounts`, `journal_entry_lines`, `period_opening_balances`, `period_account_snapshot` (if present), `opening_balance_lines`, `opening_balance_batches` before applying the migration in production.
- **Post-migration:** If you discover a problem, restore from backup and fix data or logic before re-running the migration. Do not re-run the migration after a successful commit if you later restore backups (you would need to fix duplicates again and re-apply 248 or a variant).

---

## 4. Preventative guard (STEP 10)

Audit any onboarding or initialization that inserts into `accounts`. Prefer:

```sql
INSERT INTO accounts (business_id, name, code, type, ...)
VALUES (...)
ON CONFLICT (business_id, code) DO NOTHING;
-- or
ON CONFLICT (business_id, code) DO UPDATE SET name = EXCLUDED.name, ...
```

After 248, the partial unique index `accounts_unique_business_code_active_idx` prevents new active duplicates (same business_id, code with deleted_at IS NULL) at insert time.

### Audit summary: migrations that INSERT into `accounts`

| Migration | Uses ON CONFLICT (business_id, code)? | Note |
|-----------|---------------------------------------|------|
| 043_accounting_core.sql | Yes — `DO NOTHING` | `create_system_accounts()` — canonical source |
| 046_asset_register.sql | No | Audit: add ON CONFLICT where inserting by code |
| 047_payroll_system.sql | No | Audit: add ON CONFLICT where inserting by code |
| 049_combined_reconciliation_*.sql | No | Audit: add ON CONFLICT where inserting by code |
| 162_complete_sale_ledger_postings.sql | No | Audit: add ON CONFLICT where inserting by code |
| 187_retail_accounting_bootstrap.sql | No | Retail bootstrap — add ON CONFLICT for idempotency |
| 190_fix_posting_source_default_bug.sql | No | Audit: add ON CONFLICT where inserting by code |
| 200_fix_professional_system_accounts.sql | N/A | Calls `create_system_accounts()` which has ON CONFLICT |

Recommendation: add `ON CONFLICT (business_id, code) DO NOTHING` (or `DO UPDATE` as needed) to any migration that inserts into `accounts` so re-runs and backfills remain safe. After 248, duplicate active inserts will fail at the index if ON CONFLICT is omitted.

---

## 5. Definitive list: tables referencing accounts.id

| table | column | is_fk | notes |
|-------|--------|-------|------|
| journal_entry_lines | account_id | yes | 043 |
| period_opening_balances | account_id | yes | 086 |
| period_account_snapshot | account_id | yes | 086 |
| opening_balance_batches | equity_offset_account_id | yes | 134 |
| opening_balance_lines | account_id | yes | 134 |
| carry_forward_lines | account_id | yes | 135 |
| bank_transactions | account_id | yes | 045/049 |
| reconciliation_periods | account_id | yes | 045/049 |

Migration 248 reassigns all of the above from duplicate account_id → canonical_account_id (and merges balances where applicable for period_opening_balances / period_account_snapshot).

---

## 6. What changed (migration 248 final)

- **All account_id references** updated: added carry_forward_lines, bank_transactions, reconciliation_periods (previously only journal_entry_lines, period_opening_balances, period_account_snapshot, opening_balance_lines, opening_balance_batches).
- **Uniqueness:** full `UNIQUE (business_id, code)` replaced with **partial unique index** `accounts_unique_business_code_active_idx` on `(business_id, code) WHERE deleted_at IS NULL` so soft-deleted duplicates do not break the index.
- **Hard validations** added: transaction aborts if journal_entry_lines count changes, if any active duplicate (business_id, code) remains, or if any orphan account_id exists in the referencing tables.
- **Idempotent:** when no duplicates exist, migration runs without error and still ensures the partial unique index exists.
- **Canonical selection** unchanged: most journal_entry_lines, then earliest created_at, then lowest id; accounts.created_at confirmed in 043.

---

## 7. Exact verification queries after deploying

Run these read-only queries after applying 248 in production.

```sql
-- (1) No active duplicates (expect 0 rows)
SELECT business_id, code, COUNT(*) AS duplicate_count
FROM accounts
WHERE deleted_at IS NULL
GROUP BY business_id, code
HAVING COUNT(*) > 1;

-- (2) Partial unique index exists (expect 1 row)
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'accounts'
  AND indexname = 'accounts_unique_business_code_active_idx';

-- (3) No orphan journal_entry_lines (expect 0)
SELECT COUNT(*) FROM journal_entry_lines jel
WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = jel.account_id);

-- (4) No orphan period_opening_balances (expect 0)
SELECT COUNT(*) FROM period_opening_balances pob
WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = pob.account_id);

-- (5) Report RPCs return data (replace period_id with a real one for an affected business)
-- SELECT * FROM get_trial_balance_from_snapshot('...'::uuid);
-- SELECT * FROM get_profit_and_loss_from_trial_balance('...'::uuid);
-- SELECT * FROM get_balance_sheet_from_trial_balance('...'::uuid);
```
