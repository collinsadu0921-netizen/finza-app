# Workday 50 read-model plan (staging)

**Status:** Design only — not implemented in migration 506.  
**Context:** `workday_50` at 50 VUs saturates Postgres/Supabase connection pool across many concurrent ledger scans. Per-instance Vercel cache and singleflight cannot be the primary fix. This document defines a staged read-model path that preserves accounting correctness.

**Staging load-test business:** `4e6cdfba-e2ab-4ee4-ac00-9b077d696544`  
**Staging Supabase ref:** `adonhhtooawkeemdqqeo` (never apply to production `qjxhibvbmzogyzbhswjj`).

---

## Problem statement

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

| Gate | Requirement |
|------|-------------|
| G1 | 506 applied; `workday_50` re-run documents baseline |
| G2 | Summary migration + refresh function on staging only |
| G3 | Backfill + reconciliation clean for load-test business |
| G4 | `ROUTE_FILTER=dashboard_metrics` at 50 VUs shows ≥30% p95 improvement **or** failure rate < 1% |
| G5 | Explicit approval before production migration |

**Until G5:** `workday_100` and `workday_200` remain **blocked**.

---

## Related artifacts

- Migration 506: `supabase/migrations/506_stabilize_workday50_hot_paths.sql`
- k6: `ROUTE_FILTER`, `WORKDAY_SKIP_REPORTS`, `WORKDAY_REPORTS_EVERY_N`, `workday_50_plus_reports_5` in `load-tests/finza-service-workday.js`
- Migration **512**: `service_pnl_movement_lines` + shared refresh with `service_dashboard_period_summary`
- **Dashboard metrics summary fast path** (512 app): **off by default**. Set `FINZA_DASHBOARD_PNL_SUMMARY_FAST_PATH=1` on staging preview only after operational `workday_50` re-validates. Reports `pnlMovement` snapshot-first path is unchanged.
- Route diagnostics: `FINZA_ROUTE_DIAG=1` on staging preview (`dashboard_pnl_source`: `live_metrics_rpc` | `summary_fast_path`)
