# Dashboard cluster — staging performance baseline (July 2026)

Staging gate for **100 operational VUs + separate reports journey** after dashboard cache hardening.

| Field | Value |
|-------|--------|
| **Staging branch commit** | `2c8c722` (`fix: guard dashboard background refresh scheduling`) |
| **Prior commits** | `1d156ca` (SWR), `a7156bb` (first-load preparing UX) |
| **BASE_URL** | `https://finza-app-git-staging-collins-projects-f49524b8.vercel.app` |
| **Load-test business** | `4e6cdfba-e2ab-4ee4-ac00-9b077d696544` |
| **Passing artifact** | `load-tests/results/workday_100_plus_reports_5_dashboard_refresh_guard.json` |

---

## 1. Problems addressed

### Dashboard cluster cache stampede (100+5 mixed load)

Under `SCENARIO=workday_100_plus_reports_5`, every operational VU hits `GET /api/dashboard/service-cluster` each iteration. Before SWR, a per-instance 30s cache expired simultaneously across waiters, causing **cache stampede**: many concurrent full dashboard builds (timeline + metrics + activity) per serverless instance. Symptom: `dashboard_cluster` p95 ~30s, hundreds of requests ≥10s.

### First-load / no-cache UX regression

After initial SWR, cold-cache paths returned a **fake empty degraded payload** (zeros, empty timeline) with HTTP 200. The service dashboard cockpit treated it as final data and stopped loading — tenants saw an empty dashboard until manual browser refresh.

### Preparing / background-refresh pressure

The first-load fix (`a7156bb`) introduced `dashboard_status=preparing` and background rebuilds on cache miss. Waiters on the preparing path **each scheduled their own background refresh**, and owner foreground timeout dropped from 8s to 4s — increasing rebuild frequency. Under 100 VUs this added **shared Supabase pressure** on unrelated routes (`invoices_overdue`, `reports_pnl`, bills, payroll) even though those routes were unchanged.

---

## 2. Fixes (commits `1d156ca` → `2c8c722`)

### Stale-while-revalidate dashboard cache (`1d156ca`)

- In-process L1 SWR for `dashboard_cluster` (`FINZA_DASHBOARD_CLUSTER_CACHE_TTL_SEC`, default 30s soft / 120s hard).
- **Fresh hit** → return immediately.
- **Stale hit** → return stale payload immediately; schedule background refresh.
- **Singleflight** on foreground compute per cache key.
- Response headers: `x-finza-dashboard-cache-source`, `x-finza-dashboard-cache-age-ms`, `x-finza-dashboard-refresh-mode`.

### First-load preparing state (`a7156bb`)

- API fields: `dashboard_status` (`fresh` | `stale` | `preparing` | `degraded`), `dashboard_ready`.
- No-cache / timeout → `preparing` + `dashboard_ready: false` (not fake zeros as final state).
- Bounded **foreground build** (~4s, `FINZA_DASHBOARD_CLUSTER_FOREGROUND_MS`).
- **Preparing payloads are not cached** (`timelineCacheable: false`, `shouldStore` rejects preparing).
- Frontend (`ServiceDashboardCockpit`) shows loading skeleton on `preparing`, auto-refetches with backoff until real data arrives.

### Background refresh guard (`2c8c722`)

- Per-key **inflight map** + **15s cooldown** (`FINZA_DASHBOARD_CLUSTER_REFRESH_COOLDOWN_MS`, clamped 10–30s).
- **Waiters** on preparing return fast; they **do not** schedule background refresh.
- **Owner timeout** schedules at most one refresh per key per cooldown window.
- Refresh modes in headers: `started`, `skipped_inflight`, `skipped_cooldown`, `foreground`, `skipped`.

### Cross-instance limitation

All guards are **L1 (per serverless instance) only**. Cross-instance stampede protection is not included. Pair with summary tables / remote cache in a follow-up if needed.

---

## 3. Validated gates

| Gate | Scenario | Status | Notes |
|------|----------|--------|-------|
| 100 operational users | `workday_100` | **Pass** | Pre-mixed-load baseline |
| 100 operational + 5 reports | `workday_100_plus_reports_5` | **Pass** | Current readiness gate |

### Latest passing `workday_100_plus_reports_5` run

Controlled run after session refresh, dashboard prime to `fresh`, 2.5 min warm wait.

| Metric | Result |
|--------|--------|
| `http_req_failed` | **0%** |
| `dashboard_cluster` p95 | **643 ms** |
| `invoices_overdue` p95 | **1.33 s** |
| `reports_pnl` p95 | **6.11 s** |
| Global p95 | **1.92 s** |
| Completed iterations | **5,242** |
| Exit code | **0** |

Artifact: `load-tests/results/workday_100_plus_reports_5_dashboard_refresh_guard.json`

### Earlier regression runs (for comparison)

| Artifact | dashboard p95 | overdue p95 | reports_pnl p95 | exit |
|----------|---------------|-------------|-----------------|------|
| `…_dashboard_swr.json` (`1d156ca`) | 569 ms | 911 ms | 4.1 s | 0 |
| `…_first_load_fix.json` (`a7156bb`, uncontrolled) | 4.9 s | 11.6 s | 18.7 s | 99 |
| `…_first_load_fix_rerun.json` (`a7156bb`, primed) | 2.2 s | 4.4 s | 20.5 s | 99 |
| `…_dashboard_refresh_guard.json` (`2c8c722`, primed) | **643 ms** | **1.33 s** | **6.11 s** | **0** |

---

## 4. Readiness gate rules

**Do not** use legacy in-loop reports sampling (`WORKDAY_REPORTS_EVERY_N` unset on `ROUTE_FILTER=all`) as the mixed-load readiness gate. That pattern runs `reports_pnl` on every operational iteration and does not match real user behavior.

**Use** the separate-journey mixed scenario:

- `SCENARIO=workday_100_plus_reports_5` (or `workday_50_plus_reports_5` for smaller gates)
- Two concurrent k6 scenarios: **operational workday** (no in-loop `reports_pnl`) + **reports journey** (`REPORTS_VUS` separate VUs, 20–60s sleep between views)
- `ROUTE_FILTER=all` required

See `load-tests/README.md` and `load-tests/finza-service-workday.js`.

---

## 5. Next planned gate

| Field | Value |
|-------|--------|
| Operational VUs | 100 |
| Reports VUs | **10** (`REPORTS_VUS=10`) |
| Scenario | `workday_100_plus_reports_5` (same scenario; override VU count only) |
| Threshold changes | **None** |

Example:

```powershell
$env:SCENARIO = "workday_100_plus_reports_5"
$env:REPORTS_VUS = "10"
& "C:\Program Files\k6\k6.exe" run `
  -e BASE_URL="https://finza-app-git-staging-collins-projects-f49524b8.vercel.app" `
  -e SESSIONS_JSON="./sessions.staging.json" `
  --out json="load-tests/results/workday_100_plus_reports_10.json" `
  load-tests/finza-service-workday.js
```

**Do not run** `workday_100_plus_reports_10` as a separate scenario name until added to the harness.

---

## 6. Recommended pre-gate checklist

1. Confirm `FINZA_ROUTE_DIAG` is off on staging preview.
2. Use git-staging alias `BASE_URL` (not ephemeral deployment hostname).
3. Refresh session: `node scripts/refresh-staging-load-session.mjs`
4. Prime `dashboard_cluster` until `fresh` / `fresh_hit`.
5. Wait 2–3 minutes for instance warmth.
6. Optional: `node scripts/prime-staging-pnl-snapshot.mjs` before mixed gates involving `reports_pnl` (requires `.env.staging` with staging `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`).

---

## Related code

| Area | Path |
|------|------|
| Cluster SWR cache | `lib/server/dashboardClusterCache.ts` |
| Status resolution | `lib/server/dashboardClusterStatus.ts` |
| API route | `app/api/dashboard/service-cluster/route.ts` |
| Frontend cockpit | `components/dashboard/service/ServiceDashboardCockpit.tsx` |
| k6 harness | `load-tests/finza-service-workday.js` |
