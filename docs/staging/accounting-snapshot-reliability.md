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

## Worker execution (539+ / 546+)

| Environment | Drain path |
|-------------|------------|
| Staging / Preview | **Primary recovery:** Supabase Cron (`* * * * *`) → `invoke_accounting_snapshot_recovery_worker()` → protected Vercel process URL (migration **546**). **Backup:** GitHub Action `accounting-snapshot-drain.yml` (`*/5`) with Bearer + bypass headers. |
| Production | Do not apply 546/547 here without a separate production plan. Vercel cron `0 2 * * *` → `/api/cron/accounting-snapshots` remains the production path until then. |

Staging Vault secret setup (values never committed):

```powershell
# After applying 546/547 on staging:
$env:ACCOUNTING_SNAPSHOT_CRON_URL="https://finza-app-git-staging-….vercel.app/api/internal/accounting-snapshots/process"
# Also set CRON_SECRET / VERCEL_AUTOMATION_BYPASS_SECRET in the shell, then:
node scripts/staging-setup-snapshot-recovery-secrets.mjs
```

Requires `CRON_SECRET` on the Preview deployment and matching Vault / GitHub secrets.

Queue reliability (539):

- Enqueue invalidates snapshot freshness immediately
- Pending-only unique key allows one follow-up while a job is processing
- Claim uses `FOR UPDATE SKIP LOCKED` + lease reclaim for abandoned `processing` rows
- Combined `finza_worker_refresh_period_snapshots` refreshes dashboard + P&L in one transaction
- Diagnostics: `get_accounting_snapshot_queue_diagnostics(business_id)`

Target freshness SLA: posted journal reflected in snapshot-backed reports within **60 seconds** when the Action drain is configured; without a drain consumer the queue will backlog again.

## Migration history note (staging)

Authoritative `supabase_migrations.schema_migrations` on staging previously ended at **523**.
Queue reliability objects corresponding to repo migration **539** were already present in the live schema out-of-band (not backfilled into history).
**544**–**547** are recorded on staging as applied. Do not rewrite or invent historical 524–543 rows.

## Immediate targeted refresh (544+)

| Layer | Location |
|-------|----------|
| Scoped claim RPC | `claim_accounting_snapshot_refresh_jobs_for_period` (migration 544) |
| Targeted processor | `processAccountingSnapshotsForPeriod` in `lib/server/accountingSnapshotWorker.ts` |
| Scheduler + flag | `scheduleTargetedSnapshotRefresh` / `ACCOUNTING_IMMEDIATE_REFRESH_ENABLED` in `lib/server/accountingSnapshotRefresh.ts` |
| Period normalize | `toAccountingDateOnly` in `lib/server/accountingPeriodDate.ts` |
| Enqueue-then-schedule | `enqueueAndScheduleTargetedSnapshotRefresh` |
| Flag diagnostic | `GET /api/internal/accounting-snapshots/health` → `immediate_refresh_enabled` (boolean only) |

`ACCOUNTING_IMMEDIATE_REFRESH_ENABLED` defaults **OFF**. When off, the durable queue and recovery cron continue unchanged. Enable only on staging (`true`/`1`) and **rebuild** Preview (not artifact-only redeploy) so the runtime value is live.

Background ownership: routes attach `waitUntil` once to the schedule/process promise. `afterAccountingPost` awaits the targeted promise inside the `fireAfterAccountingPost` + `waitUntil` chain. Scoped claim retries once after 150ms on empty claim (enqueue race). Cooldown arms after work finishes.
