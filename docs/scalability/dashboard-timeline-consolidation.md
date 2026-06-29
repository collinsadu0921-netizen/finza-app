# Dashboard timeline consolidation (P1)

Migration **500** + refactor of `GET /api/dashboard/service-timeline`.

## Previous behavior

1. `checkAccountingAuthority` + session auth
2. Query `accounting_periods` — last N rows (`periods` param, default **6**, max **24**; cockpit uses **12**)
3. For each period (up to N), call `getProfitAndLossReport` → `get_profit_and_loss_movement` RPC
4. Concurrency: **4** parallel P&L calls (`TIMELINE_PNL_CONCURRENCY`)
5. Map to `{ timeline: [{ period_id, period_start, period_end, revenue, expenses, netProfit }] }`

**Database calls per request (typical cockpit, periods=12):**

| Step | Calls |
|------|------:|
| Auth / access | 2–4 |
| `accounting_periods` SELECT | 1 |
| `get_profit_and_loss_movement` (via P&L report) | **12** |
| `businesses` (currency, per P&L) | up to 12 |
| **Total ledger-heavy** | **~13+** |

## New behavior

1. Auth unchanged
2. **One RPC:** `get_service_dashboard_timeline(p_business_id, …, p_granularity='accounting_period', p_periods_limit=N)`
3. RPC selects last N accounting periods and aggregates journal movement in **one query plan**
4. Same response shape for the frontend

**Database calls per request (periods=12):**

| Step | Calls |
|------|------:|
| Auth / access | 2–4 |
| `get_service_dashboard_timeline` | **1** |
| **Total ledger-heavy** | **1** |

**Estimated reduction:** ~**92%** fewer ledger/report round-trips for timeline (12 → 1). Latency should drop roughly proportional to removed network hops + duplicate period resolution.

## Accounting semantics

- Revenue = sum of `(credit − debit)` on `accounts.type IN ('income','revenue')` per period
- Expenses = sum of `(debit − credit)` on `accounts.type = 'expense'` per period
- `net_profit = revenue − expenses`

Same sign rules as `get_profit_and_loss_movement` (migration 490) and `pnlTotalsFromReport` in TypeScript.

Granularity:

- **`accounting_period`** (default) — one point per Finza accounting period; matches existing chart
- **`month`** — optional calendar months when `p_start_date` / `p_end_date` set (not used by API yet)

## Migration dependency

Apply before deploying the refactored route:

```text
500_dashboard_timeline_rpc.sql
```

Verify:

```sql
SELECT * FROM get_service_dashboard_timeline(
  '<business_id>'::uuid,
  NULL, NULL,
  'accounting_period',
  6
);
```

**Failure if missing:** HTTP 500, `"Could not load dashboard timeline"`.

## API route dependency

| RPC | Route |
|-----|-------|
| `get_service_dashboard_timeline` | `GET /api/dashboard/service-timeline` |

## Frontend consumer

- `components/dashboard/service/ServiceDashboardCockpit.tsx` → `fetchTimelineData` → `periods=12`
- `components/dashboard/service/TrendsSection` / `FinancialFlowChart` — expects `timeline[]` with `revenue`, `expenses`, `netProfit`

No UI changes required.

## Known remaining dashboard bottlenecks

| Area | Issue |
|------|-------|
| **service-metrics** | Still runs full P&L + balance sheet + cash RPC per load |
| **service-activity** | Journal + email queries; review under load |
| **Auth churn** | `ProtectedLayout` repeats business/role lookups per navigation |
| **Cockpit parallel load** | metrics + timeline + activity + overdue count on mount |

## k6 verification

After migration 500 on staging, compare `dashboard_timeline` trend before/after:

```powershell
$env:SCENARIO = "workday_50"
& "C:\Program Files\k6\k6.exe" run `
  -e BASE_URL="https://your-staging-url.com" `
  -e SESSIONS_JSON="./sessions.staging.json" `
  load-tests/finza-service-workday.js
```

In the report template, compare:

- `http_req_duration{name:dashboard_timeline}` p95
- Supabase query count / CPU during dashboard group

Run `workday_50` first; timeline should no longer dominate dashboard latency.

## Rollback

1. Revert app route to pre-P1 version (N× P&L loop)
2. Optional: `DROP FUNCTION get_service_dashboard_timeline(uuid, date, date, text, int);`

No data migration to undo.
