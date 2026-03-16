# FINZA Global Accounting Failure Audit

**READ-ONLY — NO FIXES — NO ASSUMPTIONS — FULL SYSTEM SCAN**

---

## 1. Executive failure summary

Accounting fails at **initialization**: the first gate is the RPC `ensure_accounting_initialized`, which calls `create_system_accounts`. That function (in migrations 043, 162, and any version before 251) uses **`INSERT ... ON CONFLICT (business_id, code) DO NOTHING`**. The database in the failure environment has **no unique constraint or unique index** on `(business_id, code)` for the `accounts` table that matches this conflict target. Migrations 248/249/250 **drop** the original constraint `accounts_business_id_code_key` and **create** a partial unique index `accounts_unique_business_code_active_idx`; if those migrations did not run to completion (e.g. rollback after DROP, or CREATE UNIQUE INDEX failed due to remaining duplicates), the table can be left with **no supporting constraint/index**, causing Postgres to raise: *"there is no unique or exclusion constraint matching the ON CONFLICT specification"*. That single break **blocks** initialization, which in turn blocks every accounting route that calls `ensureAccountingInitialized` (trial balance, ledger list, reports, invoice mark-paid, payments, expenses, etc.). Posting fails because the payment/invoice flow runs bootstrap before creating the payment; the trigger that posts to the ledger never runs if the API returns 500 at bootstrap. Trial balance "sometimes" fails to load because the **reports** trial balance (`/api/reports/trial-balance`) and the **accounting** trial balance (`/api/accounting/trial-balance`) both depend on bootstrap and then on period resolution and `get_trial_balance_from_snapshot`; the first failure is bootstrap. The frontend "Duplicate keys" in accounting reports come from the **portal** (and possibly other report UIs) mapping API section lines to rows with **`id: ""`** for every line, then using **`key={a.id}`** in React, which produces duplicate keys. Ledger data can still be queried manually because that only requires direct table/RPC access and does not require bootstrap to have succeeded.

---

## 2. Root cause analysis (ranked by likelihood)

| Rank | Failure source | Evidence | Likelihood |
|------|----------------|----------|------------|
| 1 | **ON CONFLICT vs missing unique constraint/index on `accounts`** | Observed error: "there is no unique or exclusion constraint matching the ON CONFLICT specification". `create_system_accounts` (043, 162) uses `ON CONFLICT (business_id, code) DO NOTHING`. Original schema (043) had `UNIQUE(business_id, code)`. Migrations 248/249/250 drop that constraint and create partial unique index; if DROP ran but CREATE failed (e.g. duplicates remained) or migrations never ran, no constraint exists. | **Confirmed** (observed error) |
| 2 | **Migration order / partial rollback** | 248/249/250 perform `ALTER TABLE accounts DROP CONSTRAINT ...` then `CREATE UNIQUE INDEX ...`. If the transaction rolls back after DROP (e.g. later step exception) or a different code path dropped the constraint without creating the index, the table is left without any uniqueness for `(business_id, code)`. | **High** |
| 3 | **Frontend duplicate React keys (report UIs)** | Portal accounting page builds P&L/BS display by mapping API sections to `{ id: "", code, name, period_total }` (or balance). It then renders with `key={a.id}`. All lines get `id: ""` → duplicate keys. API (getProfitAndLossReport / getBalanceSheetReport) does not include `account_id` in the line shape sent to the client. | **Confirmed** (code path) |
| 4 | **Multiple accounts per code still present** | If 248/249/250 never ran or dedup step was skipped, `accounts` can still have multiple rows per `(business_id, code)`. Then: (a) CoA list API returns all rows → UI shows "massive duplicate accounts by code"; (b) `get_account_by_code` uses `LIMIT 1` → posting arbitrarily uses one account; (c) `generate_trial_balance` iterates all accounts → snapshot contains multiple rows per code → reports show repeated codes. | **High** if dedup not applied |
| 5 | **Resolver or snapshot RPC failure after bootstrap** | Once bootstrap is fixed, period resolution or `get_trial_balance_from_snapshot` could still fail (e.g. invalid period, snapshot generation exception, orphan `account_id` in ledger). Not the current blocker; would surface after fixing (1). | **Medium** (secondary) |

---

## 3. Contract violation report (by layer)

### 3.1 Database

| Contract / assumption | Expected | Actual / violated | Where |
|-----------------------|----------|-------------------|--------|
| Uniqueness of `(business_id, code)` for active accounts | One row per `(business_id, code)` where `deleted_at IS NULL`; supported by constraint or partial unique index. | In failing env: no constraint/index matching `ON CONFLICT (business_id, code)`. Postgres raises when `create_system_accounts` runs. | 043 (UNIQUE), 248/249/250 (DROP + partial index) |
| INSERT ... ON CONFLICT target | A unique constraint or unique index on the conflict columns. | Code assumes constraint/index exists; DB may have neither after DROP without successful CREATE. | create_system_accounts (043, 162) |
| FK integrity to `accounts.id` | All `journal_entry_lines.account_id`, `period_opening_balances.account_id`, etc., reference existing `accounts.id`. | Dedup migrations reassign FKs to canonical account and delete duplicates; if migrations did not run or failed partway, orphans or duplicate accounts can remain. | 248/249/250 validation steps |
| Trial balance snapshot shape | One row per account in snapshot; `snapshot_data` JSONB array of `{ account_id, account_code, ... }`. | If duplicate accounts exist, `generate_trial_balance` loops over all accounts → multiple entries per code in snapshot; downstream P&L/BS return multiple rows per code. | 247 generate_trial_balance (FOR over accounts) |
| `trial_balance_snapshots.period_id` | UNIQUE(period_id) for ON CONFLICT (period_id) in `generate_trial_balance`. | Table has UNIQUE(period_id) (169); no violation observed. | 169, 247 |

### 3.2 RPC

| Contract / assumption | Expected | Actual / violated | Where |
|-----------------------|----------|-------------------|--------|
| `create_system_accounts` idempotency | Inserts system accounts; no-op for existing (business_id, code) via ON CONFLICT. | Fails at INSERT if no matching unique constraint/index. | 043, 162; 251 replaces with WHERE NOT EXISTS (no ON CONFLICT) |
| `ensure_accounting_initialized` | Calls create_system_accounts, initialize_business_chart_of_accounts, then (if no period) initialize_business_accounting_period. | Fails on first call (create_system_accounts). | 245 |
| `get_account_by_code` | Returns one account id for (business_id, code). | Uses `LIMIT 1`; with duplicates returns arbitrary row. Posting then targets one account; if dedup later picks another as canonical, ledger lines can point to deleted/non-canonical id. | 043, 100 (get_account_by_control_key → get_account_by_code) |
| `get_trial_balance_from_snapshot` | Returns one row per account in snapshot. | If snapshot was built with duplicate accounts, returns multiple rows per code (different account_id). | 247 |
| `generate_trial_balance` | One row per account (id, code, name, type, balances). | Iterates `SELECT ... FROM accounts WHERE business_id = ... AND deleted_at IS NULL` — no deduplication by code; duplicates produce multiple rows per code. | 247 |
| `initialize_business_chart_of_accounts` | Syncs accounts → chart_of_accounts; ON CONFLICT (business_id, account_code) DO UPDATE. | chart_of_accounts has UNIQUE(business_id, account_code); no violation. With duplicate accounts, same code is written twice (last wins). | 176 |

### 3.3 Backend API

| Contract / assumption | Expected | Actual / violated | Where |
|-----------------------|----------|-------------------|--------|
| Bootstrap before any accounting read/write | All accounting/report routes call `ensureAccountingInitialized`; 500 with "Unable to start accounting" if RPC fails. | Implemented; failure is upstream (RPC). Routes return generic message until structured error added; no violation. | All routes using ensureAccountingInitialized |
| Period resolution | Reports use `resolveAccountingPeriodForReport`; resolver uses period_id, period_start, as_of_date, date range, then resolve_default_accounting_period, then ensure_accounting_period fallback. | Implemented. If bootstrap fails, period resolution is never reached. | resolveAccountingPeriodForReport.ts, report routes |
| create_system_accounts called after bootstrap | Some routes call `create_system_accounts` again after bootstrap (e.g. trial balance, reports). | Same RPC; if bootstrap passed (e.g. after 251), second call is redundant but safe. If bootstrap failed, never reached. | trial-balance, reports routes |
| Report response shape (P&L/BS) | Sections with lines; lines have account_code, account_name, amount (or balance). getProfitAndLossReport / getBalanceSheetReport do not expose account_id in line shape. | By design; frontend that expects unique id per line does not get it and substitutes "". | getProfitAndLossReport.ts, getBalanceSheetReport.ts |

### 3.4 Frontend

| Contract / assumption | Expected | Actual / violated | Where |
|-----------------------|----------|-------------------|--------|
| Unique React key per list item | Each row in report tables should have a stable unique key. | Portal accounting: P&L and BS map API lines to `{ id: "", code, name, period_total }` (or balance). Renders with `key={a.id}` → all keys are "" → duplicate keys. | app/portal/accounting/page.tsx (revenueAccounts, expenseAccounts, flattenGroups) |
| Chart of Accounts list | One logical account per code. | If API returns multiple rows per code (from accounts table with duplicates), UI shows repeated codes; key={account.id} remains unique. | app/accounting/chart-of-accounts/page.tsx, GET /api/accounting/coa |
| Trial Balance / report tables | key=account.id or account_id. | Accounting trial balance uses key={account.id}; reports trial balance uses key={account.account_id}. If backend sends duplicate account_id (e.g. bug), duplicate keys. Currently backend sends one row per account from snapshot; with duplicate accounts, different ids → keys unique but repeated codes. | app/accounting/trial-balance/page.tsx, app/accounting/reports/trial-balance/page.tsx |

---

## 4. Dependency impact map

```
CoA (accounts table)
  ├── Uniqueness: 043 UNIQUE(business_id, code) → 248/249/250 DROP + partial index
  │     └── If index missing → create_system_accounts fails → ensure_accounting_initialized fails
  ├── create_system_accounts (ON CONFLICT) depends on constraint/index
  ├── get_account_by_code (LIMIT 1) assumes one row per code (semantic; with duplicates returns one arbitrarily)
  └── initialize_business_chart_of_accounts reads accounts, writes chart_of_accounts (one row per code via ON CONFLICT)

Ledger (journal_entry_lines, journal_entries)
  ├── All posting RPCs depend on get_account_by_code / get_account_by_control_key (single account id per code)
  ├── FKs account_id → accounts.id; dedup migrations reassign to canonical
  └── If bootstrap fails, no new posting (API returns 500 before insert); existing ledger data still queryable

Snapshots (trial_balance_snapshots)
  ├── generate_trial_balance: reads accounts (all rows per business) → one snapshot row per account (duplicates → multiple rows per code)
  ├── get_trial_balance_from_snapshot: returns snapshot_data rows; no deduplication by code
  └── Stale marking: 247 trigger on journal_entries; independent of accounts uniqueness

Reports (P&L, BS, Trial Balance)
  ├── All require ensure_accounting_initialized → period resolve → get_trial_balance_from_snapshot (or direct TB RPC)
  ├── P&L/BS filter TB by type; if snapshot has duplicate codes, report has duplicate lines (different account_id)
  └── API layer does not pass account_id in section lines → portal sets id: "" → duplicate React keys

Portal initialization
  └── Resolve period → fetch report; both depend on bootstrap. Bootstrap failure → "Unable to start accounting" / 500.

Posting engine (invoice paid, payment create, expense, etc.)
  └── ensureAccountingInitialized first; then insert; DB trigger posts. Bootstrap failure → 500 before insert → no posting.
```

**Single architectural break that explains all observed failures:**  
The **absence of a unique constraint or unique index** on `accounts (business_id, code)` that supports `ON CONFLICT (business_id, code)` causes `create_system_accounts` to raise, which causes `ensure_accounting_initialized` to fail. Every route that gates on bootstrap then returns 500 ("Unable to start accounting") and never reaches period resolution, trial balance, or posting. The **duplicate keys** in the UI are a **separate** contract violation: the portal (and possibly other UIs) assign a blank `id` to report lines and use it as the React key.

---

## 5. Risk classification

| Issue | Data loss | Ledger integrity | Snapshot correctness | Multi-tenant isolation | Performance / concurrency |
|-------|-----------|-------------------|----------------------|------------------------|----------------------------|
| Missing ON CONFLICT constraint/index | No | N/A (posting blocked) | N/A (reports blocked) | No | No |
| Duplicate (business_id, code) in accounts | No | **Yes**: get_account_by_code non-deterministic; posting to one of N accounts; dedup could leave FKs on deleted id if done wrong | **Yes**: snapshot has multiple rows per code; P&L/BS/TB show repeated codes or wrong totals if merged incorrectly | No (all scoped by business_id) | Low |
| Orphan journal_entry_lines.account_id | No | **Yes**: joins to accounts fail or hide lines | Can break snapshot generation if RPC assumes all account_id exist | No | No |
| Portal key={a.id} with id="" | No | No | No | No | No (UI only) |
| ensure_accounting_initialized auth check | No | No | No | **Yes**: RPC enforces owner or admin/accountant; wrong user gets "Not allowed to initialize" | No |

---

## 6. Summary table: why each symptom occurs

| Symptom | Root cause (this audit) |
|---------|--------------------------|
| "Unable to start accounting" | ensure_accounting_initialized fails because create_system_accounts raises "there is no unique or exclusion constraint matching the ON CONFLICT specification". |
| Cannot post paid invoice | Mark-paid route calls ensureAccountingInitialized first; bootstrap fails → 500 → payment insert never attempted. |
| Trial balance sometimes fails to load ledger | Same bootstrap dependency; plus if period resolve or get_trial_balance_from_snapshot fails, 500 with resolver/snapshot error. |
| DB error: ON CONFLICT specification | accounts table has no unique constraint/index on (business_id, code) that supports ON CONFLICT in create_system_accounts. |
| Frontend: Duplicate keys in accounting reports | Portal (and possibly others) map report section lines to objects with id: "" and use key={a.id}, producing duplicate keys. |
| Ledger data exists and can be queried manually | Bootstrap and API routes are the gate; direct DB or Supabase client access to journal_entries / journal_entry_lines does not require bootstrap. |
| Massive duplicate accounts by code in UI | GET /api/accounting/coa returns all rows from accounts; if table has duplicate (business_id, code), UI shows them; key=account.id keeps keys unique. |

---

**End of audit. No fixes or migrations were implemented; no root cause was assumed without evidence from code or observed errors.**
