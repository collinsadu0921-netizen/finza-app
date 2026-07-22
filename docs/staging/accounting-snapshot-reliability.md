# Accounting snapshot reliability (staging)

**Staging Supabase ref:** `adonhhtooawkeemdqqeo` — never apply migrations 522/523 to production `qjxhibvbmzogyzbhswjj`.

## Problem

Ledger activity existed but `service_pnl_movement_lines` and `service_dashboard_period_summary` were empty/stale. With refresh-on-request disabled (default), P&L returned `PNL_SNAPSHOT_UNAVAILABLE` and the dashboard showed degraded zero metrics.

## Components (522 + 523)

| Layer | Location |
|-------|----------|
| Queue + worker RPCs | `supabase/migrations/522_accounting_snapshot_read_model.sql` |
| Trigger gaps | `supabase/migrations/523_accounting_snapshot_reliability.sql` |
| Worker (TS) | `lib/server/accountingSnapshotWorker.ts` |
| Enqueue helpers | `lib/server/accountingSnapshotRefresh.ts` |
| P&L read path | `lib/accounting/reports/pnlMovement.ts` |
| Dashboard metrics | `lib/server/serviceDashboardMetricsLoader.ts` |
| Dashboard timeline | `lib/server/serviceDashboardTimeline.ts` |
| Cron worker | `app/api/cron/accounting-snapshots/route.ts` |
| Manual worker | `app/api/internal/accounting-snapshots/process/route.ts` |
| Health | `app/api/internal/accounting-snapshots/health/route.ts` |
| Backfill script | `scripts/backfill-accounting-snapshots.mjs` |

## Staging apply

1. Link staging: `supabase link --project-ref adonhhtooawkeemdqqeo`
2. Push migrations: `supabase db push` (522 then 523)
3. Verify: `scripts/verify-staging-migration-523.sql`
4. Backfill existing tenants: `node scripts/backfill-accounting-snapshots.mjs` (uses staging guard)
5. Process queue: `curl -H "Authorization: Bearer $CRON_SECRET" https://<staging>/api/internal/accounting-snapshots/process?batch=20`

## Local dev

Use `.env.staging` (from `.env.staging.example`), **not** `.env.local` if it points at production.

```powershell
# Confirm staging ref before any DB work
Select-String NEXT_PUBLIC_SUPABASE_URL .env.staging
# Must contain adonhhtooawkeemdqqeo
```

## Read-path behavior (default: refresh OFF)

- **Monthly P&L:** snapshot-first → enqueue refresh if missing → live `get_profit_and_loss_movement` fallback
- **Custom range:** live RPC (or monthly snapshots when exact period match exists)
- **Dashboard metrics/timeline:** snapshot-first → enqueue refresh → live RPC when ledger movement exists
- **Zero periods:** valid zero report (metadata `line_count=0`), not 503 unavailable

## Operational gates (unchanged)

| Env var | Default | Purpose |
|---------|---------|---------|
| `FINZA_REPORTS_PNL_REFRESH_ON_REQUEST` | off | Blocking refresh in P&L request path |
| `FINZA_DASHBOARD_CLUSTER_REFRESH_ON_REQUEST` | off | Blocking refresh in dashboard cluster path |

## Worker execution (539+)

| Environment | Drain path |
|-------------|------------|
| Staging / Preview | Vercel cron does **not** run on Preview. Use GitHub Action `accounting-snapshot-drain.yml` (`*/5`) against the staging URL, or `node scripts/process-accounting-snapshot-jobs.mjs --env .env.staging`. |
| Production | Vercel cron `0 2 * * *` → `/api/cron/accounting-snapshots` (Hobby: once daily). Prefer the same GitHub Action for sub-minute freshness. |

Requires `CRON_SECRET` on the deployment and matching `ACCOUNTING_SNAPSHOT_CRON_*` GitHub secrets.

Queue reliability (539):

- Enqueue invalidates snapshot freshness immediately
- Pending-only unique key allows one follow-up while a job is processing
- Claim uses `FOR UPDATE SKIP LOCKED` + lease reclaim for abandoned `processing` rows
- Combined `finza_worker_refresh_period_snapshots` refreshes dashboard + P&L in one transaction
- Diagnostics: `get_accounting_snapshot_queue_diagnostics(business_id)`

Target freshness SLA: posted journal reflected in snapshot-backed reports within **60 seconds** when the Action drain is configured; without a drain consumer the queue will backlog again.
