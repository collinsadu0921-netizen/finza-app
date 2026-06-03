# Audit: Service Dashboard Financial Flow Chart

**Scope:** Service workspace dashboard “Financial flow” chart only. Read-only; no fixes implemented.

> **Source contract (2026-06):** Live P&L uses journal movement via `get_profit_and_loss_movement`, not Trial Balance `closing_balance`. See [REPORTING_SOURCE_CONTRACT.md](./REPORTING_SOURCE_CONTRACT.md). Sections below that reference `get_profit_and_loss_from_trial_balance` describe the pre-2026 path.

---

## 1. Where the chart data is sourced

| Layer | Source |
|-------|--------|
| **UI** | `ServiceDashboardCockpit` → `FinancialFlowChart` with `data={chartData}`. |
| **chartData** | Derived in cockpit from `timeline` array: `timeline.map(t => ({ period_start, period_end, label: formatPeriodLabel(...), revenue, expenses, netProfit }))`. |
| **timeline** | From API **GET `/api/dashboard/service-timeline`** with `business_id` and `periods` (default 12, max 24). |

**API route:** `app/api/dashboard/service-timeline/route.ts`

**Data flow in API:**

1. Auth: `createSupabaseServerClient()` → `getUser()` → 401 if no user; `checkAccountingAuthority(supabase, user.id, businessId, "read")` → 403 if no access.
2. Periods: query `accounting_periods` for `business_id`, order `period_start` desc, limit `periods` (1–24).
3. For each period (after reversing to chronological order): call `getPnLTotals(supabase, businessId, row.period_start)`.
4. `getPnLTotals` calls `getProfitAndLossReport(supabase, { businessId, period_start })` which:
   - Resolves period via `resolveAccountingPeriodForReport` (gets `period_start` / `period_end`).
   - Calls RPC **`get_profit_and_loss_movement(p_business_id, p_start_date, p_end_date)`** (journal movement in range).

**Underlying SQL/RPC chain (current):**

- **`get_profit_and_loss_movement`** (migrations 489/490): aggregates `journal_entry_lines` joined to `journal_entries` and `accounts` for the business and inclusive date range. Income/revenue = Σ(credit − debit); expense = Σ(debit − credit).
- Period bounds come from `resolveAccountingPeriodForReport` / `resolvePnLMovementRange`.

So the **data source for the chart** is: **service-timeline** → **`getProfitAndLossReport`** → **`get_profit_and_loss_movement`** → **ledger** (`journal_entries`, `journal_entry_lines`). Trial Balance snapshots are not used for P&L movement.

---

## 2. Totals vs timeseries

- **Type:** **Timeseries** — one point per **accounting period**.
- **Aggregation:** Per-period P&L totals (revenue = sum of income/other_income sections; expenses = sum of cogs/operating/other_expenses/taxes; netProfit = from P&L totals or revenue − expenses).
- **Not:** A single global total; the chart shows a time series of period-level aggregates (typically 12 periods).

---

## 3. How tick labels are formatted

**X-axis (period labels):**

- **Data key:** `name` (Recharts). In the chart, each point has `name: d.label` where `label` is set in the cockpit.
- **Formatter:** **`formatPeriodLabel(period_start, period_end)`** in `ServiceDashboardCockpit.tsx`:
  - `const opts: Intl.DateTimeFormatOptions = { month: "short", year: "2-digit" }`
  - Returns: **`${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`**
  - Example: `"Jan 25 – Feb 25"`.
- Recharts config: `XAxis dataKey="name"`, `tick={{ fill: "#9ca3af", fontSize: 10 }}`, no custom `tickFormatter` (so the label string is used as-is).

**Y-axis (money):**

- **Formatter:**  
  **`tickFormatter={(v) => formatMoney(v, currencyCode).replace(/[\d,]+\.\d{2}/, (m) => (Number(m) >= 1000 ? `${(Number(m) / 1000).toFixed(0)}k` : m))}`**
- Logic: format full amount with `formatMoney(v, currencyCode)`, then replace the numeric part (regex `[\d,]+\.\d{2}`). If that number ≥ 1000, show it as `(value/1000).toFixed(0) + "k"`; otherwise keep the original substring. So values ≥ 1000 are abbreviated (e.g. "1k", "2k"); smaller values keep full decimals.
- **Note:** `Number(m)` on a string like `"1,234.50"` can be NaN (comma); the replace is applied to the formatted string, so behaviour may vary by locale. The intent is to shorten large numbers on the axis.

**Tooltip:**

- **`formatter={(value: number) => [formatMoney(value, currencyCode), ""]}`** — full money format; **`labelFormatter={(label) => label}`** — label passed through (the period range string).

---

## 4. Profit: fetched independently or derived

**Derived**, not fetched as a separate metric.

- **service-timeline:**  
  `getPnLTotals` gets `data` from `getProfitAndLossReport`, then:
  - `revenue` = sum of income/other_income section subtotals.
  - `expenses` = sum of cogs/operating/other_expenses/taxes section subtotals.
  - **`netProfit = data.totals?.net_profit ?? revenue - expenses`** (API derives it from P&L totals or revenue − expenses).
- **getProfitAndLossReport** (lib): Builds `totals.net_profit` from section subtotals (gross profit, operating profit, then **netProfit = operatingProfit**). So at report level, net profit is also derived from sections, not a separate DB column.
- **`get_profit_and_loss_movement`** returns account-level `period_total` (movement, not closing balance); it does not return a precomputed “profit” field. Profit exists only after the app aggregates sections and computes totals.

**Conclusion:** Profit is **derived** (revenue − expenses or P&L totals from section aggregation) in both the timeline API and the P&L report layer; it is **not** queried as an independent value from the DB.

---

## 5. Snapshot tables vs ledger aggregation

**Ledger movement is used** for the chart path (not Trial Balance closing balances).

- Chart data goes through: **service-timeline** → **getProfitAndLossReport** → **`get_profit_and_loss_movement`** → direct aggregation from **`journal_entries`** / **`journal_entry_lines`**.
- **Trial Balance snapshots** remain the source for Trial Balance reports only; they are not the live P&L source for the dashboard chart.

---

## 6. Time bucketing logic

- **Bucket:** One point per **accounting period** (one row in `accounting_periods`).
- **Selection:**  
  `accounting_periods` filtered by `business_id`, ordered by `period_start` **desc**, **limit** `periods` (param, default 6; service-timeline called with `periods=12` from the cockpit). Then the array is **reversed** so chronological order is oldest → newest for the chart.
- **No** day-level or calendar-month bucketing; no grouping by week or custom ranges. Period boundaries come entirely from `accounting_periods.period_start` / `period_end`.
- **Range:** Last N periods (N = 1–24 from query param; UI uses 12).

---

## 7. Data shape returned to the chart

**From API `GET /api/dashboard/service-timeline`:**

```ts
{ timeline: Array<{
  period_id: string
  period_start: string   // ISO date
  period_end: string     // ISO date
  revenue: number
  expenses: number
  netProfit: number
}> }
```

**After cockpit mapping (`chartData` / `TimelinePoint[]`):**

```ts
Array<{
  period_start: string
  period_end: string
  label: string          // formatPeriodLabel(period_start, period_end)
  revenue: number
  expenses: number
  netProfit: number
  cashMovement?: number  // optional; not set by timeline (showCash=false)
}>
```

**What Recharts receives:** Same array with an added **`name`** per point (`name: d.label`) so XAxis can use `dataKey="name"`. So each point has: `name`, `label`, `period_start`, `period_end`, `revenue`, `expenses`, `netProfit`, and optionally `cashMovement`.

---

## 8. Chart library and config

- **Library:** **Recharts** (imports from `"recharts"`: `ResponsiveContainer`, `AreaChart`, `Area`, `XAxis`, `YAxis`, `Tooltip`, `CartesianGrid`, `Legend`).
- **Component:** **`FinancialFlowChart`** in `components/dashboard/service/FinancialFlowChart.tsx`.
- **Chart type:** **AreaChart** (stacked areas; multiple `<Area>` with same data, so they overlay).
- **Axes:**  
  - **XAxis:** `dataKey="name"`, stroke transparent, tick 10px, no tick line/axis line.  
  - **YAxis:** stroke transparent, tick 10px, no tick line/axis line, `tickFormatter` as in §3, `width={48}`.
- **Series:** Up to four areas (toggled by checkboxes): **revenue** (green), **expenses** (red), **netProfit** (blue), **cashMovement** (amber, when `showCash`). Each uses a `linearGradient` def and `fill="url(#color...)"`.
- **Tooltip:** Custom content style; formatter shows `formatMoney(value, currencyCode)`; label is the period label.
- **Data:** `data={chartData}` where each item has `name`, `revenue`, `expenses`, `netProfit` (and optionally `cashMovement`). No stacking option; multiple areas are drawn on the same scale (overlay).
- **Height:** `h-64` (256px); `ResponsiveContainer width="100%" height="100%"`.

---

## 9. Summary table

| Question | Answer |
|----------|--------|
| **Data source (route)** | GET `/api/dashboard/service-timeline?business_id=...&periods=12` |
| **Data source (backend)** | RPC `get_profit_and_loss_from_trial_balance(period_id)` → `get_trial_balance_from_snapshot(period_id)` → table `trial_balance_snapshots` (regenerated from ledger when missing/stale) |
| **Aggregation** | Timeseries: one point per accounting period; revenue/expenses/netProfit per period |
| **Tick labels (X)** | `formatPeriodLabel(start, end)` → e.g. "Jan 25 – Feb 25" (month short, year 2-digit) |
| **Tick labels (Y)** | `formatMoney` then abbreviate numeric part to "Xk" if ≥ 1000 |
| **Profit** | **Derived** (revenue − expenses or P&L totals); not a separate query |
| **Snapshot vs ledger** | **Snapshot:** chart reads from `trial_balance_snapshots`; ledger used only when snapshot is missing or stale |
| **Time bucketing** | By **accounting period** (one point per `accounting_periods` row); last N periods (N=12 in UI); no day/month bucketing |
| **Chart library** | Recharts `AreaChart`; data keys `name`, `revenue`, `expenses`, `netProfit` |

---

**End of audit.**
