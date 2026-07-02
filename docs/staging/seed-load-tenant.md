# Staging load tenant seed

**Staging Supabase only** (`adonhhtooawkeemdqqeo`). Fake data for load-test smoke — not production.

| Phase | Script | Purpose |
|-------|--------|---------|
| **1** | [`scripts/seed-staging-load-tenant.mjs`](../../scripts/seed-staging-load-tenant.mjs) | Customers + accounting periods |
| **1.5** | [`scripts/seed-staging-accounting-setup.mjs`](../../scripts/seed-staging-accounting-setup.mjs) | COA sync + control mappings (AR/AP/CASH/BANK) |
| **2** | [`scripts/seed-staging-load-tenant-phase2.mjs`](../../scripts/seed-staging-load-tenant-phase2.mjs) | Invoices, payments, bills, expenses (ledger triggers) |

Phase 2 requires Phase 1.5. Phase 1 alone creates periods but **does not** populate `chart_of_accounts` / `chart_of_accounts_control_map`; posting invoices without Phase 1.5 fails with `Missing control account mapping: AR`.

---

## Required order

```text
Phase 1 customers + periods
Phase 1.5 accounting foundation
Phase 2 invoices/payments/bills/expenses/journal-trigger data
SQL smoke
sessions.staging.json
k6 smoke
workday_50 gates (after smoke passes)
```

### Commands (staging terminal)

```powershell
$env:ALLOW_STAGING_LOAD_SEED = "true"

# Phase 1
node scripts/seed-staging-load-tenant.mjs --apply --business-id=<uuid>

# Phase 1.5 (required before Phase 2)
node scripts/seed-staging-accounting-setup.mjs --apply --business-id=<uuid>

# Phase 2
node scripts/seed-staging-load-tenant-phase2.mjs --apply --business-id=<uuid>
```

Phase 1.5 calls `ensure_accounting_initialized_system` (service_role RPC). It is idempotent and preserves existing accounting periods from Phase 1.

---

## Initial smoke target (before 5,000-invoice campaign)

| Entity | Count | Notes |
|--------|------:|-------|
| Businesses | 1 | Service industry, accounting initialized |
| Users | 1+ | Owner via staging signup |
| Customers | 50 | Phase 1 script |
| Invoices | 500 | Phase 2 script |
| Payments | 200 | Linked to invoices |
| Expenses | 200 | With ledger posting |
| Bills | 100 | Open/paid mix |
| Accounting periods | 12 | Phase 1 script |
| Journal lines | Enough for dashboard RPCs | Via posting triggers |

Do **not** seed 5,000 invoices until k6 smoke passes on this smaller dataset.

---

## Prerequisites

- Staging migrations **497–501** applied
- [`docs/staging/setup.md`](./setup.md) complete
- `STAGING_LOAD_BUSINESS_ID` set (from onboarding or script output)
- `ALLOW_STAGING_LOAD_SEED=true` only when running seed scripts
- `NEXT_PUBLIC_SUPABASE_URL` must resolve to staging ref `adonhhtooawkeemdqqeo`

---

## Phase 1.5 verification

After Phase 1.5, for the load-test `business_id`:

- `accounts` count ≥ 1
- `chart_of_accounts` count ≥ 1
- `chart_of_accounts_control_map` contains `AR`, `AP`, `CASH`, `BANK`
- `accounting_periods` count ≥ 1 (Phase 1 periods unchanged)

Dry-run: `node scripts/seed-staging-accounting-setup.mjs --dry-run --business-id=<uuid>`

---

## SQL batch outline (optional manual bulk — staging only)

Replace `:business_id` with your staging load-test business UUID. Prefer Phase 2 script for ledger-aware inserts.

### Customers (if not using Phase 1 script)

```sql
INSERT INTO customers (business_id, name, email, created_at)
SELECT
  :business_id::uuid,
  'Staging Load Customer ' || g,
  'staging-load-' || g || '@example.invalid',
  NOW() - (g || ' days')::interval
FROM generate_series(1, 50) g
ON CONFLICT DO NOTHING;
```

### Overdue subset (Phase 2 script)

Ensure some invoices have `due_date < CURRENT_DATE` and partial/no payments so `get_operational_overdue_invoices_page` returns rows.

---

## Cleanup

Delete the fake tenant by `business_id` on staging only, or drop/recreate staging project between campaigns. Posted journal entries are immutable; prefer idempotent rerun over delete.

---

## After seed — k6 scalability gates

Complete steps 1–3 below before any gate. See [`workday50-read-model-plan.md`](./workday50-read-model-plan.md) for accepted results and env requirements.

### Required order

```text
Phase 1 → 1.5 → 2
SQL smoke (setup.md)
sessions.staging.json updated
node scripts/refresh-staging-load-session.mjs --probe   ← must pass
k6 smoke
Operational-only gate (WORKDAY_SKIP_REPORTS=1)
Reports-only gate (ROUTE_FILTER=reports)
Mixed gate (workday_50_plus_reports_5)
```

### Probe-first workflow

Always refresh and probe the session before k6:

```powershell
# Mint or refresh session cookie (writes load-tests/sessions.staging.json)
node scripts/refresh-staging-load-session.mjs

# Verify profile + dashboard cluster respond 200 with current session
node scripts/refresh-staging-load-session.mjs --probe
```

If `--probe` fails, do **not** run k6 gates. Fix session/`BASE_URL`/business_id first.

### Vercel staging env (must remain off)

| Variable | Value for validated gates |
|----------|---------------------------|
| `FINZA_DASHBOARD_CLUSTER_REFRESH_ON_REQUEST` | unset or `0` |
| `FINZA_REPORTS_PNL_REFRESH_ON_REQUEST` | unset or `0` |
| `FINZA_DASHBOARD_PNL_SUMMARY_FAST_PATH` | unset or `0` |

### k6 command examples (PowerShell)

Set once per terminal session:

```powershell
$env:BASE_URL = "https://<your-staging-preview>.vercel.app"
$env:SESSIONS_JSON = "./sessions.staging.json"
$env:SCENARIO = "workday_50"
```

#### a) Operational-only gate (PASS: 0.04% failed, global p95 1.92s)

```powershell
$env:ROUTE_FILTER = "all"
$env:WORKDAY_SKIP_REPORTS = "1"
Remove-Item Env:WORKDAY_REPORTS_EVERY_N -ErrorAction SilentlyContinue

& "C:\Program Files\k6\k6.exe" run `
  -e BASE_URL=$env:BASE_URL `
  -e SESSIONS_JSON=$env:SESSIONS_JSON `
  -e SCENARIO=workday_50 `
  -e ROUTE_FILTER=all `
  -e WORKDAY_SKIP_REPORTS=1 `
  --out json="load-tests/results/workday_50_all_skip_reports_dashboard_refresh_guard_valid_session.json" `
  load-tests/finza-service-workday.js
```

#### b) Reports-only gate (PASS: 5916/5916, p95 1.33s)

```powershell
$env:ROUTE_FILTER = "reports"
Remove-Item Env:WORKDAY_SKIP_REPORTS -ErrorAction SilentlyContinue

& "C:\Program Files\k6\k6.exe" run `
  -e BASE_URL=$env:BASE_URL `
  -e SESSIONS_JSON=$env:SESSIONS_JSON `
  -e SCENARIO=workday_50 `
  -e ROUTE_FILTER=reports `
  --out json="load-tests/results/workday_50_reports_auth_fix.json" `
  load-tests/finza-service-workday.js
```

#### c) Mixed 50 + 5 gate (PASS: global p95 1.67s, reports_pnl p95 2.16s)

```powershell
$env:SCENARIO = "workday_50_plus_reports_5"
$env:ROUTE_FILTER = "all"
Remove-Item Env:WORKDAY_SKIP_REPORTS -ErrorAction SilentlyContinue

& "C:\Program Files\k6\k6.exe" run `
  -e BASE_URL=$env:BASE_URL `
  -e SESSIONS_JSON=$env:SESSIONS_JSON `
  -e SCENARIO=workday_50_plus_reports_5 `
  -e ROUTE_FILTER=all `
  --out json="load-tests/results/workday_50_plus_reports_5_reports_guard.json" `
  load-tests/finza-service-workday.js
```

**Recommended result filenames** (store under `load-tests/results/`):

| Gate | Filename |
|------|----------|
| Operational-only | `workday_50_all_skip_reports_dashboard_refresh_guard_valid_session.json` |
| Reports-only | `workday_50_reports_auth_fix.json` |
| Mixed 50+5 | `workday_50_plus_reports_5_reports_guard.json` |

### Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| ~100% failures, sub-second latency | Invalid session, wrong `BASE_URL`, or placeholder cookies | Run `refresh-staging-load-session.mjs --probe`; verify `sessions.staging.json` |
| `business_profile` 404 + operational 401 | Stale/expired session | Refresh session; re-probe before re-running |
| `reports_pnl` 401 dominating after minute 1 | Was auth-server pressure on accounting routes (fixed) | If recurrence: probe session first, then check middleware deploy |
| 0% failures but high p95 in mixed (20s+) | Shared-resource contention (reports + operational) | Ensure refresh guards off; prime snapshots; confirm full-response cache deployed |
| `reports_pnl` 503 spike | Missing P&L movement snapshot | Run snapshot refresh from `scripts/verify-staging-migration-513.sql` |
| Single `invoices_overdue` 500 | Transient app/DB blip | Accepted at ≤0.01% mixed gate rate; investigate only if sustained |

### What not to run

- **`workday_100` / `workday_200`** — blocked until G5 production approval.
- Repeated mixed loops after an accepted pass — only re-run when validating a new deploy.

### Quick reference (legacy one-liner)

Operational gate only: `WORKDAY_SKIP_REPORTS=1` with `FINZA_DASHBOARD_CLUSTER_REFRESH_ON_REQUEST` and `FINZA_REPORTS_PNL_REFRESH_ON_REQUEST` unset. Mixed gate: `SCENARIO=workday_50_plus_reports_5`. Details: [`load-tests/README.md`](../../load-tests/README.md).
