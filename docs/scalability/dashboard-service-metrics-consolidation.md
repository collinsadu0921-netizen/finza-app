# Dashboard service metrics consolidation (P1)

Migration **501** + refactor of `GET /api/dashboard/service-metrics`.

## Previous behavior

1. Auth + `checkAccountingAuthority`
2. **Parallel:**
   - `getProfitAndLossReport` → `get_profit_and_loss_movement` + `businesses` (currency)
   - `getFinancialOverviewPositions` → `get_balance_sheet_as_of` + row extraction
3. `get_cash_collected_total` RPC
4. Optional **previous period:**
   - Second `getProfitAndLossReport`
   - Second `getFinancialOverviewPositions` (as of previous period end)

**Typical request (no comparison):** 2 heavy report paths + 1 cash RPC ≈ **3 ledger/report RPCs** + period resolution inside P&L.

**With `previous_period_start`:** up to **5 ledger/report RPCs**.

## New behavior

1. Auth unchanged
2. `resolvePnLMovementRange` (period_id / period_start) — lightweight period lookup
3. `getBusinessToday` — business timezone for position as-of date
4. Optional previous period range resolution (same helper)
5. **One RPC:** `get_service_dashboard_metrics`

**Typical request:** **1** consolidated metrics RPC + period resolution queries.

**With comparison:** still **1** metrics RPC (previous period computed inside SQL).

## Expected DB/report call reduction

| Scenario | Before (report RPCs) | After | Reduction |
|----------|---------------------:|------:|----------:|
| Default metrics load | 3 | 1 | ~67% |
| With previous period | 5 | 1 | ~80% |

Network round-trips also drop because P&L, balance sheet, and cash are no longer separate app-level calls.

## Migration dependency

```text
501_dashboard_service_metrics_rpc.sql
```

Depends on:

- `497` — `get_cash_collected_total`
- `486` — `get_balance_sheet_as_of`

Verify:

```sql
SELECT get_service_dashboard_metrics(
  '<business_id>'::uuid,
  '2026-06-01'::date,
  '2026-06-30'::date,
  CURRENT_DATE,
  NULL,
  NULL
);
```

**Failure if missing:** HTTP 500 `"Could not load dashboard metrics"`.

## Fields preserved

| Response field | Source |
|----------------|--------|
| `period` | TypeScript `resolvePnLMovementRange` (unchanged resolution) |
| `currency` | RPC `currency_code` + `getCurrencySymbol` / `getCurrencyName` |
| `revenue`, `expenses`, `netProfit` | P&L movement (490 sign rules) |
| `cashCollected` | `get_cash_collected_total` (497) |
| `cashBalance`, `accountsReceivable`, `accountsPayable` | `get_balance_sheet_as_of` (486) + same extraction as `financialOverviewFromRows` |
| `positionBalancesAsOfToday`, `positionAsOfDate` | Unchanged |
| `previousPeriod` | Optional compare dates in RPC |

Position extraction matches `lib/accounting/reports/cumulativeBalanceSheet.ts`:

- Cash codes: `1000`, `1010`, `1020`, `1030`
- AR code: `1100`
- AP: liability accounts with code 2000–2499

## What was intentionally not changed

- Dashboard UI (`ServiceDashboardCockpit`, KPI cards)
- Period resolution logic (`resolveAccountingPeriodForReport` / `resolvePnLMovementRange`)
- Invoice, payment, payroll, tax, journal posting
- Timeline route (500), activity feed, auth churn
- No caching / snapshots
- No fallback to old multi-RPC path (RPC failure → 500)

## Remaining dashboard risks

| Risk | Severity |
|------|----------|
| Cockpit still loads metrics + timeline + activity + overdue in parallel | High |
| `get_service_dashboard_metrics` runs P&L + 2× balance sheet (current + compare) in one DB call — still heavy for compare path | Medium |
| Period resolution remains 1–2 queries per request | Low |
| Auth churn in `ProtectedLayout` | High |
| `service-activity` journal + email queries | Medium |
| Values computed live, not snapshotted | Medium |

## Recommended k6 checks

After applying migration **501** on staging:

```powershell
$env:SCENARIO = "smoke"
& "C:\Program Files\k6\k6.exe" run `
  -e BASE_URL="https://your-staging-url.com" `
  -e SESSIONS_JSON="./sessions.staging.json" `
  load-tests/finza-service-workday.js

# Then workday_50 / workday_100 one at a time:
$env:SCENARIO = "workday_50"
& "C:\Program Files\k6\k6.exe" run ...
```

Compare `http_req_duration{name:dashboard_metrics}` p95 before/after.

Only run `workday_200` after migrations 497–501 are applied and smoke passes.

## Rollback

1. Revert app route to pre-P1 version
2. Optional: `DROP FUNCTION get_service_dashboard_metrics(...);`

No data migration to undo.
