# Finza load tests (k6)

Repeatable API load tests for the **service workspace** — used to verify P0 scalability fixes and find the next bottleneck with evidence.

**Do not use production customer data or commit real session cookies.**

## Prerequisites

1. [k6 installed](https://grafana.com/docs/k6/latest/set-up/install-k6/) — on Windows often at `C:\Program Files\k6\k6.exe` (may not be on PATH)
2. Staging app deployed with migrations **497–506** applied — see `docs/staging/setup.md` and `docs/scalability/p0-migration-readiness.md`
3. Heavy tenant seeded — see `docs/scalability/load-test-seed-plan.md`
4. Session file copied from `sessions.example.json` → `sessions.staging.json` (gitignored)

## Scenario selection (required)

Exactly **one** scenario runs per invocation. Set `SCENARIO` — do **not** use k6 v2 `--scenario` (removed).

| `SCENARIO` | Peak VUs | Duration (approx) | p95 threshold |
|------------|----------|-------------------|---------------|
| `smoke` | 1 | 1 iteration | 5000 ms |
| `workday_50` | 50 | 9 min | 2000 ms |
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

> **Safety:** The harness exports exactly one scenario per run. It refuses `sessions.example.json` and placeholder cookies. Do not edit the script to run multiple scenarios.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SCENARIO` | No | `smoke` | One of: `smoke`, `workday_50`, `workday_100`, `workday_200`, `stress_500` |
| `ROUTE_FILTER` | No | `all` | Isolate routes: `all`, `business_profile`, `dashboard_metrics`, `dashboard_timeline`, `dashboard_activity`, `dashboard`, `reports`, `lists`, `invoices`, `bills`, `payroll` |
| `WORKDAY_SKIP_REPORTS` | No | — | When `1`, skip `reports_pnl` in workday scenarios (not smoke; not when `ROUTE_FILTER=reports`) |
| `BASE_URL` | **Yes** | — | Finza app origin, no trailing slash |
| `SESSIONS_JSON` | Yes (real runs) | `./sessions.example.json` | Path relative to this script file |
| `SOFT_P95_MS` | No | `10000` | Per-request check warning threshold (ms) |

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
