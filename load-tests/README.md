# Finza load tests (k6)

Repeatable API load tests for the **service workspace** — used to verify P0 scalability fixes and find the next bottleneck with evidence.

**Do not use production customer data or commit real session cookies.**

## Prerequisites

1. [k6 installed](https://grafana.com/docs/k6/latest/set-up/install-k6/) — on Windows often at `C:\Program Files\k6\k6.exe` (may not be on PATH)
2. Staging app deployed with migrations **497–507** applied — see `docs/staging/setup.md` and `docs/scalability/p0-migration-readiness.md`
3. Heavy tenant seeded — see `docs/scalability/load-test-seed-plan.md`
4. Session file copied from `sessions.example.json` → `sessions.staging.json` (gitignored)

## Scenario selection (required)

Exactly **one** logical scenario runs per invocation. Set `SCENARIO` — do **not** use k6 v2 `--scenario` (removed). The mixed scenario `workday_50_plus_reports_5` runs **two concurrent k6 scenarios** (operational + reports journeys).

| `SCENARIO` | Peak VUs | Duration (approx) | p95 threshold |
|------------|----------|-------------------|---------------|
| `smoke` | 1 | 1 iteration | 5000 ms (global) |
| `workday_50` | 50 | 9 min | 2000 ms (global) |
| `workday_50_plus_reports_5` | 50 + 5 reports | 9 min | per-route only (see below) |
| `workday_100_plus_reports_5` | 100 + 5 reports | 10 min | per-route only (see below) |
| `workday_100` | 100 | 10 min | 3000 ms |
| `workday_200` | 200 | 18 min | 5000 ms |
| `stress_500` | 500 | 12 min | 8000 ms |

Default if omitted: `smoke`.

## Session file paths

k6 `open()` paths are **relative to `load-tests/finza-service-workday.js`**, not your shell cwd.

| Correct | Wrong |
|---------|-------|
| `./sessions.staging.json` | `./load-tests/sessions.staging.json` |

## Quick start (Windows)

```powershell
# 1. Copy and fill sessions (never commit real cookies)
Copy-Item load-tests/sessions.example.json load-tests/sessions.staging.json

# 2. Smoke test (1 VU, 1 iteration) — k6 on PATH
$env:SCENARIO = "smoke"
k6 run `
  -e BASE_URL="https://your-staging-url.com" `
  -e SESSIONS_JSON="./sessions.staging.json" `
  load-tests/finza-service-workday.js

# 3. Smoke — k6 NOT on PATH (typical Windows install)
$env:SCENARIO = "smoke"
& "C:\Program Files\k6\k6.exe" run `
  -e BASE_URL="https://your-staging-url.com" `
  -e SESSIONS_JSON="./sessions.staging.json" `
  load-tests/finza-service-workday.js

# 4. Workday 50 (only after smoke passes with real sessions)
$env:SCENARIO = "workday_50"
& "C:\Program Files\k6\k6.exe" run `
  -e BASE_URL="https://your-staging-url.com" `
  -e SESSIONS_JSON="./sessions.staging.json" `
  --out json="load-tests/results/workday_50.json" `
  load-tests/finza-service-workday.js
```

Replace `workday_50` with `workday_100`, `workday_200`, or `stress_500` as needed. Run **one scenario at a time**.

> **Safety:** The harness exports one k6 scenario per run (two for `workday_50_plus_reports_5` and `workday_100_plus_reports_5`). It refuses `sessions.example.json` and placeholder cookies. Do not edit the script to run multiple unrelated scenarios.

### Staging performance baseline (July 2026)

Current passing mixed gate: **`workday_100_plus_reports_5`** at commit `2c8c722` — dashboard SWR, first-load preparing UX, and background-refresh guard. Full problem/fix/gate write-up: [`docs/scalability/dashboard-cluster-staging-baseline-2026-07.md`](../docs/scalability/dashboard-cluster-staging-baseline-2026-07.md).

**Do not** use legacy in-loop `reports_pnl` (`WORKDAY_REPORTS_EVERY_N` unset on `ROUTE_FILTER=all`) as the readiness gate. Use the separate operational + reports journey scenarios above.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SCENARIO` | No | `smoke` | One of: `smoke`, `workday_50`, `workday_50_plus_reports_5`, `workday_100_plus_reports_5`, `workday_100`, `workday_200`, `stress_500` |
| `ROUTE_FILTER` | No | `all` | Isolate routes: `all`, `business_profile`, `dashboard_metrics`, `dashboard_timeline`, `dashboard_activity`, `dashboard`, `reports`, `lists`, `invoices`, `bills`, `payroll`. `workday_50_plus_reports_5` requires `all`. |
| `WORKDAY_SKIP_REPORTS` | No | — | When `1`, skip `reports_pnl` in workday scenarios (not smoke; not when `ROUTE_FILTER=reports`). Takes precedence over `WORKDAY_REPORTS_EVERY_N`. |
| `WORKDAY_REPORTS_EVERY_N` | No | unset | Legacy in-loop sampling for `ROUTE_FILTER=all`. Prefer `workday_50_plus_reports_5` for realistic mixed load. Unset = every iteration (backward compatible). `0` = skip. `N>=2` = `__ITER % N === 0` per VU. |
| `REPORTS_VUS` | No | `5` | Reports journey VUs for `workday_50_plus_reports_5` only |
| `REPORTS_SLEEP_MIN_SEC` | No | `20` | Min seconds between report views in reports journey |
| `REPORTS_SLEEP_MAX_SEC` | No | `60` | Max seconds between report views in reports journey |
| `BASE_URL` | **Yes** | — | Finza app origin, no trailing slash |
| `SESSIONS_JSON` | Yes (real runs) | `./sessions.example.json` | Path relative to this script file |
| `SOFT_P95_MS` | No | `10000` | Per-request check warning threshold (ms) |

### `reports_pnl` response headers (k6 capture)

For `reports_pnl` requests only, the harness records:

| Header | k6 counter |
|--------|------------|
| `x-finza-reports-source` | `finza_reports_pnl_source{source:…}` |
| `x-finza-reports-cache` | `finza_reports_pnl_cache{cache:…}` |

Counts print at end of run via `handleSummary`. Use before mixed gates to confirm cache vs snapshot paths.

**Prime July snapshot (staging load-test business) before mixed gate:**

```powershell
node scripts/prime-staging-pnl-snapshot.mjs
```

## Session file format

`load-tests/sessions.example.json`:

```json
[
  {
    "label": "load-user-1",
    "businessId": "uuid-here",
    "cookie": "sb-<project-ref>-auth-token=...; other-cookies-if-present"
  }
]
```

- **businessId:** Must match the seeded load-test business.
- **cookie:** Full `Cookie` header value from an authenticated browser session.
- Use **5 entries** (one per load-test user) for realistic rotation across VUs.

## How to capture session cookies (staging)

1. Log in to staging as a load-test user (e.g. `load-owner@example.invalid`).
2. Open DevTools → **Application** → **Cookies** → your staging domain.
3. Copy all Supabase auth cookies. Typical name: `sb-<project-ref>-auth-token`.
4. Format for k6:
   ```
   sb-abcdef-auth-token=base64value; sb-abcdef-auth-token-code-verifier=...
   ```
5. Paste into `sessions.staging.json` for that user.
6. Repeat for each of the 5 load-test users.

**Expiry:** Supabase sessions expire. Refresh cookies before long campaigns.

## Routes exercised

| Group | Endpoint |
|-------|----------|
| Profile | `GET /api/business/profile?business_id=` |
| Dashboard | `GET /api/dashboard/service-metrics?business_id=` |
| Dashboard | `GET /api/dashboard/service-timeline?business_id=&periods=6` |
| Dashboard | `GET /api/dashboard/service-activity?business_id=&limit=10` |
| Invoices | `GET /api/invoices/list?business_id=&page=1&limit=25` |
| Invoices | `GET /api/invoices/list?business_id=&status=overdue&page=1&limit=25` |
| Bills | `GET /api/bills/list?business_id=&page=1&limit=50` |
| Bills (regression) | `GET /api/bills/list?business_id=` (must stay bounded) |
| Payroll | `GET /api/payroll/runs` |
| Reports | `GET /api/accounting/reports/profit-and-loss?business_id=` |

## Route isolation (`ROUTE_FILTER`)

Use after smoke passes to find which route group saturates the DB under 50 VUs. Auth/session validation is unchanged; checks and status-code assertions are not weakened.

| `ROUTE_FILTER` | k6 route tag(s) | Use when |
|----------------|-----------------|----------|
| `dashboard_metrics` | `dashboard_metrics` | Isolate consolidated KPI RPC |
| `dashboard_timeline` | `dashboard_timeline` | Isolate ledger timeline RPC |
| `dashboard_activity` | `dashboard_activity` | Isolate activity feed queries |
| `dashboard` | all three above | Combined dashboard pressure (full cockpit load) |

**Interpretation:**

- If `dashboard_metrics` passes alone but `dashboard` fails → timeline and/or activity contribute; run `dashboard_timeline` and `dashboard_activity` separately.
- If a single-route filter fails → that route is the direct bottleneck.
- If each single route passes but `dashboard` fails → combined DB pool / query contention; consider read-model work (`docs/staging/workday50-read-model-plan.md`).

```powershell
# Timeline only @ 50 VUs (~9 min)
$env:SCENARIO = "workday_50"
$env:ROUTE_FILTER = "dashboard_timeline"
& "C:\Program Files\k6\k6.exe" run `
  -e BASE_URL="https://YOUR-STAGING-PREVIEW.vercel.app" `
  -e SESSIONS_JSON="./sessions.staging.json" `
  load-tests/finza-service-workday.js

# Activity only @ 50 VUs
$env:ROUTE_FILTER = "dashboard_activity"
& "C:\Program Files\k6\k6.exe" run `
  -e BASE_URL="https://YOUR-STAGING-PREVIEW.vercel.app" `
  -e SESSIONS_JSON="./sessions.staging.json" `
  load-tests/finza-service-workday.js
```

Do **not** run `workday_100` or `workday_200` until `workday_50` passes for the target route group.

## Reports workload (`reports_pnl`)

Real users do not open P&L on every dashboard/list cycle. Proven patterns:

| Goal | Env | `reports_pnl` behavior |
|------|-----|------------------------|
| **Operational gate** (proven) | `SCENARIO=workday_50` + `WORKDAY_SKIP_REPORTS=1` | Skipped every iteration |
| **Reports isolation** (proven) | `SCENARIO=workday_50` + `ROUTE_FILTER=reports` | Every iteration, reports only |
| **Realistic mixed gate** (preferred) | `SCENARIO=workday_50_plus_reports_5` | Separate journeys: 50 operational VUs (no reports) + 5 report VUs with 20–60s sleep |
| **Legacy in-loop sampling** (failed @ 50 VUs) | `WORKDAY_REPORTS_EVERY_N=10` | Not recommended — reports still contend with operational loop |

`ROUTE_FILTER=all` with reports on **every** operational iteration failed under 50 VUs (~3% errors, 22–30s p95). In-loop sampling (`EVERY_N=10`) also failed (~1.2% errors, 7–21s p95). Use separate journeys instead.

Startup logs print scenario, VU split, sleep range, `ROUTE_FILTER`, skip/sampling env, and `reports_pnl mode`.

```powershell
# Operational gate — skip reports (proven clean @ workday_50)
$env:SCENARIO = "workday_50"
$env:ROUTE_FILTER = "all"
$env:WORKDAY_SKIP_REPORTS = "1"
Remove-Item Env:WORKDAY_REPORTS_EVERY_N -ErrorAction SilentlyContinue
& "C:\Program Files\k6\k6.exe" run `
  -e BASE_URL="https://YOUR-STAGING-PREVIEW.vercel.app" `
  -e SESSIONS_JSON="./sessions.staging.json" `
  load-tests/finza-service-workday.js

# Reports isolation — reports only, every iteration (proven ~2s p95)
$env:SCENARIO = "workday_50"
$env:ROUTE_FILTER = "reports"
Remove-Item Env:WORKDAY_SKIP_REPORTS -ErrorAction SilentlyContinue
Remove-Item Env:WORKDAY_REPORTS_EVERY_N -ErrorAction SilentlyContinue
& "C:\Program Files\k6\k6.exe" run `
  -e BASE_URL="https://YOUR-STAGING-PREVIEW.vercel.app" `
  -e SESSIONS_JSON="./sessions.staging.json" `
  load-tests/finza-service-workday.js

# Realistic mixed gate — separate operational + report journeys (preferred)
$env:SCENARIO = "workday_50_plus_reports_5"
$env:ROUTE_FILTER = "all"
Remove-Item Env:WORKDAY_SKIP_REPORTS -ErrorAction SilentlyContinue
Remove-Item Env:WORKDAY_REPORTS_EVERY_N -ErrorAction SilentlyContinue
# Optional: $env:REPORTS_VUS = "5"; $env:REPORTS_SLEEP_MIN_SEC = "20"; $env:REPORTS_SLEEP_MAX_SEC = "60"
& "C:\Program Files\k6\k6.exe" run `
  -e BASE_URL="https://YOUR-STAGING-PREVIEW.vercel.app" `
  -e SESSIONS_JSON="./sessions.staging.json" `
  --out json="load-tests/results/workday_50_plus_reports_5.json" `
  load-tests/finza-service-workday.js
```

### Thresholds for `workday_50_plus_reports_5` and `workday_100_plus_reports_5`

No **global** `http_req_duration` threshold — operational and report requests have different latency profiles, so a single global p95 would either hide report regressions or fail on normal report latency. Per-route thresholds apply instead:

| Metric | Threshold |
|--------|-----------|
| `http_req_failed` | &lt; 1% |
| `http_req_duration{name:dashboard_cluster}` | p95 &lt; 20s (unchanged) |
| `http_req_duration{name:invoices_overdue}` | p95 &lt; 5s (unchanged) |
| `http_req_duration{name:reports_pnl}` | p95 &lt; 10s |

### Isolated route setup (not counted in workload)

When `ROUTE_FILTER` is not `all` or `business_profile`, k6 `setup()` runs once before VUs start:

1. `GET /api/business/profile?business_id=<session.businessId>` — validates auth + business context (tag: `setup_business_profile`)
2. A probe for the isolated route(s) — e.g. `setup_dashboard_activity` for `ROUTE_FILTER=dashboard_activity`

If either returns **401**, the harness aborts before load with a clear message to refresh `sessions.staging.json`. Isolated workload iterations use the same `authHeaders(session)` and `session.businessId` as the `all` flow.

## Local validation (no staging traffic)

Confirm the harness fails safely with placeholder data:

```powershell
$env:SCENARIO = "smoke"
& "C:\Program Files\k6\k6.exe" run `
  -e BASE_URL="https://app.finza.africa" `
  -e SESSIONS_JSON="./sessions.example.json" `
  load-tests/finza-service-workday.js
```

Expected: script exception **before** HTTP requests (refuses example sessions).

## Local dev without k6

Run unit tests for P0 routes:

```bash
npm test -- --testPathPatterns="bills/__tests__/list|invoices/__tests__/list|dashboard/__tests__/service-metrics"
```

## Related docs

- `docs/staging/setup.md`
- `docs/scalability/p0-migration-readiness.md`
- `docs/scalability/load-test-seed-plan.md`
- `docs/scalability/p0-load-test-report-template.md`
