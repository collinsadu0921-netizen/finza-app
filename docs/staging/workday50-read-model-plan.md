# Workday 50 read-model plan (staging)

**Status:** Staging scalability gate **complete** for the validated workload (50 operational VUs + 5 report VUs). Design sections below remain as historical context for read-model work; production rollout (G5) is **not** approved by this gate.

**Scope:** This validates staging under the tested k6 workload — not unlimited scale and **not** production.

**Staging load-test business:** `4e6cdfba-e2ab-4ee4-ac00-9b077d696544`  
**Staging Supabase ref:** `adonhhtooawkeemdqqeo` (never apply to production `qjxhibvbmzogyzbhswjj`).

---

## Final accepted gate summary (2026-07-02)

Three validation modes were run in order. All three **passed** on staging with the app guards and env settings documented below.

| Gate | Scenario | VUs | Result |
|------|----------|-----|--------|
| **Operational-only** | `workday_50` + `ROUTE_FILTER=all` + `WORKDAY_SKIP_REPORTS=1` | 50 | **PASS** |
| **Reports-only** | `workday_50` + `ROUTE_FILTER=reports` | 50 | **PASS** |
| **Mixed (final)** | `workday_50_plus_reports_5` | 50 operational + 5 reports | **PASS** |

**Accepted scalability target:** 50 concurrent operational users + 5 concurrent report users on staging, with reports excluded from the operational-only gate and validated separately before mixed load.

### Operational-only gate (PASS)

| Metric | Value |
|--------|------:|
| `http_req_failed` | 7 / 15,190 = **0.04%** |
| Global p95 | **1.92s** |
| `dashboard_cluster` p95 | **2.64s** |
| `invoices_overdue` p95 | **1.68s** |
| Interrupted iterations | 1 |

Failure breakdown (all transient; no sustained route failure):

- `business_profile` status 0: 1
- `invoices_overdue` status 0: 2
- `bills_list_default_bounded` status 0: 1
- `payroll_runs` status 0: 1
- `invoices_list` status 0: 1
- `bills_list_paginated` 500: 1

**Conclusion:** Operational `workday_50` with reports skipped is accepted.

### Reports-only gate (PASS)

| Metric | Value |
|--------|------:|
| `reports_pnl` 200 | **5,916 / 5,916** |
| `http_req_failed` | **0.00%** |
| `reports_pnl` p95 | **1.33s** |
| Checks | 100% |
| Interrupted iterations | 0 |

**Conclusion:** Reports isolation at 50 VUs is accepted.

### Mixed gate (PASS) — realistic final gate

| Metric | Value |
|--------|------:|
| `http_req_failed` | 1 / 15,482 ≈ **0.006%** |
| Global p95 | **1.67s** |
| `dashboard_cluster` p95 | **2.57s** |
| `invoices_overdue` p95 | **1.43s** |
| `reports_pnl` p95 | **2.16s** |
| Interrupted iterations | 3 |
| Only app error | `invoices_overdue` 500 × 1 |

**Conclusion:** Mixed 50 operational + 5 report users is accepted as the final staging scalability gate.

---

## Why three validation modes

### Operational-only (`WORKDAY_SKIP_REPORTS=1`)

Measures service workspace hot paths (dashboard cluster, lists, payroll, profile) without report contention. Reports were excluded because in-loop `reports_pnl` at 50 VUs caused shared-resource saturation (~3% errors, 22–30s p95) even after dashboard fixes. Operational capacity must be proven independently before adding report load.

### Reports-only (`ROUTE_FILTER=reports`)

Isolates `reports_pnl` at 50 VUs to prove auth correctness and snapshot/cache read path without operational noise. Used to validate the session-first auth fix and refresh guard before mixed load.

### Mixed 50 + 5 (`workday_50_plus_reports_5`)

The **realistic final gate**: separate k6 journeys — 50 VUs on the operational workday loop (no reports) and 5 VUs on a reports-only loop with paced sleeps (20–60s). This matches “most users on dashboard/lists, a few running P&L” better than sampling reports inside the operational loop. In-loop sampling and every-iteration reports at 50 VUs both failed historically.

---

## Vercel staging env requirements (validated mode)

These flags must remain **unset or `0`** for normal staging validation. Do **not** set them to `1` unless running a controlled manual experiment.

| Variable | Required value | Purpose |
|----------|------------------|---------|
| `FINZA_DASHBOARD_CLUSTER_REFRESH_ON_REQUEST` | unset / `0` | No heavy dashboard refresh in request path |
| `FINZA_REPORTS_PNL_REFRESH_ON_REQUEST` | unset / `0` | No live P&L / snapshot refresh in request path |
| `FINZA_DASHBOARD_PNL_SUMMARY_FAST_PATH` | unset / `0` | Dashboard metrics stay on proven path |

Optional (defaults are fine for validated gates):

- `FINZA_PNL_REPORT_CACHE_TTL_SEC` — default 30s full-response cache for `reports_pnl`
- `FINZA_DASHBOARD_CLUSTER_CACHE_TTL_SEC` — optional per-instance cluster cache

Prime read models before first k6 run if cold:

- Dashboard summaries: `scripts/audit-staging-dashboard-timeline.mjs`
- P&L movement snapshots: `scripts/verify-staging-migration-513.sql` (manual refresh queries)

---

## Session and probe validity

**Invalid sessions invalidate performance results.** Before any k6 gate:

```powershell
node scripts/refresh-staging-load-session.mjs --probe
```

Probe must pass for **business profile** and **dashboard cluster**. If a run shows:

- **100% failures with fast latency** (< 1s) → bad session, wrong `BASE_URL`, or harness bypass — not a performance regression.
- **`business_profile` 404 + operational routes 401** → stale or invalid session — refresh session before diagnosing.
- **`reports_pnl` 401 after minute 1** → was route-specific auth pressure (fixed); if it recurs, re-probe session first.

Do not interpret k6 output as a scalability failure until session validity is confirmed.

---

## Testing rules (post-pass)

- **Do not run `workday_100` or `workday_200`** — blocked until explicit approval and production migration plan (G5).
- **Do not keep rerunning mixed loops** after the accepted pass unless validating a new change.
- k6 only after: seed → SQL smoke → session refresh → `--probe` pass → smoke → gate under test.
- Store results under `load-tests/results/` with descriptive filenames (see [`seed-load-tenant.md`](./seed-load-tenant.md)).

---

## Changelog — app guards that enabled the pass

| Change | Env flag | Default behavior |
|--------|----------|------------------|
| Dashboard cluster request-path refresh guard | `FINZA_DASHBOARD_CLUSTER_REFRESH_ON_REQUEST` | Off: read summary/cache only; degraded 200s instead of blocking refresh in hot path |
| Accounting reports auth hardened | — | Session-first cookie/JWT read; `getUser()` fallback only when needed; fixes reports 401 collapse under concurrent load |
| Reports P&L refresh guard | `FINZA_REPORTS_PNL_REFRESH_ON_REQUEST` | Off: no live `get_profit_and_loss_movement` or blocking snapshot refresh in request path |
| Reports P&L final response cache + singleflight | `FINZA_PNL_REPORT_CACHE_TTL_SEC` (default 30s) | Cached final JSON; singleflight on miss; expired cache served while rebuild in flight |

Diagnostics on `reports_pnl` 200 responses: `x-finza-reports-source`, `x-finza-reports-cache`, `x-finza-reports-refresh-on-request`.

---

## Problem statement (original design context)

Hot routes recompute ledger aggregates on every request:

| Route | Current computation |
|-------|---------------------|
| `dashboard_metrics` | P&L + cash collected + position KPIs (multiple journal scans) |
| `dashboard_timeline` | Single-pass movement across N accounting periods |
| `reports_pnl` | Full P&L movement report |
| `invoices_overdue` | Operational outstanding across payments + credits |

Under 50 concurrent VUs, identical business/period keys stampede the same scans. Indexes and slimmer RPCs (506) stabilize baseline latency but do not remove O(ledger) work per request.

---

## Proposed summary tables

All tables are **business-scoped**, **period-aware**, and store **derived numbers only** — never replace journal entries as source of truth.

### 1. `service_dashboard_period_summary`

One row per `(business_id, period_id)` (or calendar month when month granularity is used).

| Column | Type | Notes |
|--------|------|-------|
| `business_id` | UUID | PK part |
| `period_id` | UUID | PK part; nullable for month buckets with synthetic key |
| `period_start` / `period_end` | DATE | Denormalized for reads |
| `revenue`, `expenses`, `net_profit` | NUMERIC | Movement totals |
| `cash_collected` | NUMERIC | Cash account debits in period |
| `refreshed_at` | TIMESTAMPTZ | Last successful refresh |
| `source_journal_max_id` | UUID | High-water mark for incremental refresh |

### 2. `service_dashboard_position_summary`

One row per `(business_id, as_of_date)` — typically **today** and recent month-ends only (retention policy).

| Column | Type | Notes |
|--------|------|-------|
| `business_id` | UUID | PK part |
| `as_of_date` | DATE | PK part |
| `cash_balance`, `accounts_receivable`, `accounts_payable` | NUMERIC | KPI subset only |
| `refreshed_at` | TIMESTAMPTZ | |
| `source_journal_max_id` | UUID | |

### 3. `service_operational_overdue_summary` (optional phase 2)

Materialized counts + top-N invoice IDs for list pages:

| Column | Type | Notes |
|--------|------|-------|
| `business_id` | UUID | PK |
| `total_count` | BIGINT | |
| `snapshot_at` | TIMESTAMPTZ | |
| `top_invoice_ids` | JSONB | Bounded array for first page cache |

Operational outstanding remains defined by payments + applied credits (same rules as `get_operational_overdue_invoices_page`).

---

## Refresh function design

### `refresh_service_dashboard_summaries(p_business_id UUID, p_force BOOLEAN DEFAULT FALSE)`

**Responsibilities:**

1. Resolve current accounting period(s) and `as_of_date` (business timezone via existing helpers).
2. **Advisory lock** per business: `pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0))` so only one refresh runs at a time.
3. Compare `source_journal_max_id` / `max(journal_entries.created_at)` — skip if unchanged and not `p_force`.
4. Recompute period movement using existing primitives:
   - `finza_dashboard_pnl_totals`
   - `get_cash_collected_total`
   - `finza_dashboard_positions_as_of`
5. Upsert summary rows in a single transaction.
6. Return `{ refreshed: boolean, periods: int, ms: numeric }`.

**Triggers (async-friendly):**

- **Scheduled:** pg_cron / Supabase cron every 1–5 minutes for businesses with recent activity (activity flag on `businesses` or last request timestamp).
- **On-demand:** API routes call refresh only on cache miss **after** acquiring advisory lock (see stampede prevention).
- **Post-posting hook (future):** enqueue refresh job when journal entries insert — do not run inline in posting triggers.

### Incremental path (phase 2)

Track `last_journal_entry_id` per summary row; on refresh, scan only new entries since watermark when period bounds unchanged. Falls back to full recompute on period rollover or mismatch.

---

## Backfill plan (staging load-test business)

1. Apply summary table migration on **staging only** (`adonhhtooawkeemdqqeo`).
2. Run one-shot backfill:

```sql
SELECT refresh_service_dashboard_summaries(
  '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'::uuid,
  true
);
```

3. Verify row counts:

```sql
SELECT COUNT(*) FROM service_dashboard_period_summary
WHERE business_id = '4e6cdfba-e2ab-4ee4-ac00-9b077d696544';

SELECT * FROM service_dashboard_position_summary
WHERE business_id = '4e6cdfba-e2ab-4ee4-ac00-9b077d696544'
ORDER BY as_of_date DESC LIMIT 5;
```

4. Compare RPC vs summary for current period (tolerance ±0.01):

```sql
-- Manual reconciliation query (to be scripted in phase 2)
```

5. Re-run k6 `ROUTE_FILTER=dashboard_metrics` at 50 VUs; compare p95 to 506 baseline.

---

## Routes that read summaries first

| Priority | Route | Read path | Fallback |
|----------|-------|-----------|----------|
| P0 | `GET /api/dashboard/service-metrics` | Join current period + position summary | Live `get_service_dashboard_metrics` RPC |
| P0 | `GET /api/dashboard/service-timeline` | Last N rows from `service_dashboard_period_summary` | Live `get_service_dashboard_timeline` |
| P1 | `GET /api/accounting/reports/profit-and-loss` | Summary when query matches canonical period only | Live `getProfitAndLossReport` |
| P2 | `GET /api/invoices/list?status=overdue` | Optional overdue snapshot | Live `get_operational_overdue_invoices_page` |

Routes **not** switching first: `business_profile`, `invoices_list`, `bills_list_*`, `payroll_runs` (list queries; index-only fixes in 506).

---

## Fallback behavior

1. Summary row missing → trigger refresh (with lock); if refresh fails or times out → **live RPC** (current behavior).
2. Summary stale (`refreshed_at` older than TTL, e.g. 5 min) → serve stale + async refresh (stale-while-revalidate), or sync refresh if `FINZA_SUMMARY_STRICT=1`.
3. Compare-period dashboard metrics → always live compute for previous period until compare columns added to summary schema.
4. Log `cache_source: summary | summary_stale | live | live_fallback` when `FINZA_ROUTE_DIAG=1`.

---

## Stampede prevention

| Layer | Mechanism |
|-------|-----------|
| Database | Advisory lock inside `refresh_service_dashboard_summaries` |
| Application | Short TTL in-memory “refresh in flight” flag per `(business_id, period)` on each Vercel instance |
| Request path | On miss: one waiter runs refresh; others read live RPC or stale summary (configurable) |
| Cron | Spreads refresh load off the request path |

Never rely on Vercel in-memory cache as the **only** coalescing layer — it is per-instance.

---

## Accounting correctness

1. **Journal remains authoritative.** Summary tables are disposable; drop and rebuild from ledger at any time.
2. **Same functions as live path** for refresh (`finza_dashboard_pnl_totals`, `get_cash_collected_total`, `finza_dashboard_positions_as_of`) — no duplicate sign rules.
3. **Reconciliation job** (daily on staging): compare summary vs live RPC for all active businesses; alert on drift > 0.01.
4. **No write-path changes** in phase 1 — posting triggers unchanged.
5. **RLS:** summary tables use `finza_user_can_access_business(business_id)` policies matching other business data.

---

## Rollout gates

| Gate | Requirement | Status |
|------|-------------|--------|
| G1 | 506 applied; `workday_50` re-run documents baseline | Done |
| G2 | Summary migration + refresh function on staging only | Done (507–513) |
| G3 | Backfill + reconciliation clean for load-test business | Done |
| G4 | Operational + reports + mixed gates pass at 50 (+5 reports) VUs | **Done (2026-07-02)** |
| G5 | Explicit approval before production migration | **Not started** |

**Until G5:** `workday_100` and `workday_200` remain **blocked**. Staging gate complete ≠ production proven.

---

## Related artifacts

- Migration 506: `supabase/migrations/506_stabilize_workday50_hot_paths.sql`
- k6: `ROUTE_FILTER`, `WORKDAY_SKIP_REPORTS`, `WORKDAY_REPORTS_EVERY_N`, `workday_50_plus_reports_5` in `load-tests/finza-service-workday.js`
- Migration **512**: `service_pnl_movement_lines` + reports snapshot read-through
- Migration **513**: decouples P&L line snapshot **refresh** from `refresh_service_dashboard_period_summaries` — dashboard timeline refresh no longer rebuilds movement lines (protects operational `workday_50`)
- **Dashboard metrics summary fast path** (512 app): **off by default**. Set `FINZA_DASHBOARD_PNL_SUMMARY_FAST_PATH=1` on staging preview only after operational `workday_50` re-validates. Reports use `try_refresh_service_pnl_movement_snapshot` on snapshot miss.
- **Dashboard cluster refresh on request** (app): **off by default**. Operational `workday_50` gate must run with `FINZA_DASHBOARD_CLUSTER_REFRESH_ON_REQUEST` **unset or `0`**. Cluster reads summary/cache only; no `refresh_service_dashboard_period_summaries` / `try_refresh_*` / live `get_service_dashboard_metrics` in the request path. Prime summaries before k6 (`scripts/audit-staging-dashboard-timeline.mjs` or cron) or enable `FINZA_DASHBOARD_CLUSTER_REFRESH_ON_REQUEST=1` only for controlled validation.
- **Reports P&L refresh on request** (app): **off by default**. Operational, reports-isolation, and mixed gates must run with `FINZA_REPORTS_PNL_REFRESH_ON_REQUEST` **unset or `0`**. `reports_pnl` reads snapshot/cache only — no live `get_profit_and_loss_movement` or `try_refresh_service_pnl_movement_snapshot` in the request path. Prime P&L movement snapshots before mixed load (`scripts/verify-staging-migration-513.sql` / manual refresh) or enable `FINZA_REPORTS_PNL_REFRESH_ON_REQUEST=1` only for controlled validation.
- **Reports P&L full-response cache** (app): **on by default** (30s process TTL). Repeated same-business/same-period requests serve cached final JSON with singleflight on miss. Override with `FINZA_PNL_REPORT_CACHE_TTL_SEC` (set `0` to disable). Diagnostic headers: `x-finza-reports-source`, `x-finza-reports-cache`, `x-finza-reports-refresh-on-request`.
- Route diagnostics: `FINZA_ROUTE_DIAG=1` on staging preview (`dashboard_pnl_source`: `live_metrics_rpc` | `summary_fast_path`)
