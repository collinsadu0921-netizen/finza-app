# Service Dashboard Charts — Audit Report

## 1) Files / Components Where Charts Are Defined

| Location | Component / Block | Chart type | Data source |
|----------|-------------------|------------|-------------|
| `app/dashboard/page.tsx` | Inline (service branch) | **AreaChart** (Recharts) | `stats.chartData` from `loadServiceDashboardStats()` |
| `components/dashboard/service/ServiceDashboardCockpit.tsx` | Wraps `FinancialFlowChart` | Timeline + summary cards | `/api/dashboard/service-analytics`, `/api/dashboard/service-timeline`, `/api/dashboard/service-metrics` |
| `components/dashboard/service/FinancialFlowChart.tsx` | `FinancialFlowChart` | **LineChart** (Recharts) | Prop `data` (from Cockpit `chartData` / timeline) |

**Note:** The main service dashboard at `/dashboard` (industry === "service") uses only the **AreaChart** in `app/dashboard/page.tsx`. The **ServiceDashboardCockpit** (and thus **FinancialFlowChart**) is used on a different view (e.g. portal or accounting dashboard) that mounts that component with a `business` prop.

---

## 2) Data Sources per Chart

### Main dashboard (`app/dashboard/page.tsx`)

| Chart | UI label | Data source | Filters |
|-------|----------|-------------|---------|
| AreaChart | "Cash collected · this month" | Built inside `loadServiceDashboardStats()`: Supabase `payments` | `business_id`, `deleted_at IS NULL`, `date >= startOfMonth` (current month) |
| KPI: Invoiced (Gross) | Card | Same load: `invoices` (non-draft), sum of `total` | `business_id`, `status != 'draft'`, `deleted_at IS NULL` |
| KPI: Collected this month | Card | Same load: `payments` for current month, sum of `amount` | Same as chart: current month payments |
| KPI: Overdue / Outstanding | Cards | Same load: from `invoices` + `payments` + `credit_notes` (operational) | Non-draft invoices; overdue = outstanding > 0 and due_date < today |
| KPI: Total Expenses | Card | **API** `GET /api/dashboard/ledger-expense-total?business_id=...` | Ledger RPC `get_ledger_expense_total` (expense accounts) |

**Chart data shape:** `Array<{ name: string; amount: number }>` — one entry per day of current month; `name` = short date label, `amount` = sum of payments that day.

### ServiceDashboardCockpit + FinancialFlowChart

| Chart / block | Data source | Filters |
|---------------|-------------|--------|
| Timeline (FinancialFlowChart) | `GET /api/dashboard/service-timeline?business_id=...&periods=12` or `service-analytics?...&interval=day` | business_id, date range / periods |
| Summary cards (Revenue, Expenses, etc.) | `GET /api/dashboard/service-metrics?business_id=...` (optional period params) | business_id, optional period_start / previous_period_start |

---

## 3) Mismatches Between KPI Logic and Chart Logic

- **None found.**  
  - "Cash collected · this month" chart and the "Collected this month" KPI both use the same Supabase query: payments with `date >= startOfMonth` (first day of current month), same `business_id`.  
  - Invoiced (Gross), Outstanding, Overdue, and Total Expenses all use the same `loadServiceDashboardStats()` load and the same filters (non-draft invoices, operational outstanding, ledger expense total).  
  - No draft invoices in revenue/outstanding (drafts excluded in query and in `nonDraftInvoices`).

---

## 4) Minimal Patch Plan and Implementation

### 4.1 Business_id gating

- **`loadServiceDashboardStats(businessId: string)`**  
  - Added early return: `if (!businessId) return` so the function never runs without a business id.

### 4.2 Unmounted state update fix

- **`app/dashboard/page.tsx`**  
  - Added `mountedRef` (useRef) set to `true` on mount and `false` in a useEffect cleanup.  
  - After computing stats, reconciliation flag, and before `setStatsLoading(false)`: all `setStats`, `setHasReconciliationDiscrepancy`, and `setStatsLoading` are guarded with `if (mountedRef.current)` so no state updates run after unmount.

### 4.3 Null-safe formatting and chart data

- **AreaChart**  
  - `data={stats.chartData ?? []}` so the chart always receives an array.  
  - **Tooltip formatter:** argument typed as `unknown`, normalized to number: `const num = typeof value === "number" && !Number.isNaN(value) ? value : 0`, then `formatMoney(num, business?.default_currency)`.  
  - **YAxis tickFormatter:** same pattern — normalize `value` to a number before calling `formatMoney` and string replace.

- **FinancialFlowChart**  
  - **YAxis tickFormatter:** `v` treated as `unknown`, then `const num = typeof v === "number" && !Number.isNaN(v) ? v : 0` before formatting.  
  - Tooltip already uses `formatMoney(Number(p.revenue ?? 0), ...)` etc., so it was already safe.

### 4.4 Colorful icons (chart / KPI blocks)

- **Audit:** The service dashboard KPI blocks and the "Cash collected · this month" chart header are text-only (no Lucide/emoji icons). The notification bar uses semantic SVGs (warning/success); FinancialFlowChart uses colored text for Revenue/Expenses/Profit (semantic).  
- **Decision:** No change. No decorative icons were removed; semantic color and icons were left as-is.

### 4.5 Logging

- **Dashboard load:** The two `console.log` calls in the dashboard load path are wrapped with `process.env.NODE_ENV === "development"` so they only run in dev.

### 4.6 Double fetch

- **Verified:** Chart data is loaded only once per dashboard load, inside `loadBusinessAndRedirect` after business and industry are resolved and only when not redirecting. There is no separate useEffect that refetches on `business?.id`; a single flow runs. No change made.

---

## 5) Files Modified

- `app/dashboard/page.tsx` — mountedRef, unmount guards, businessId gate, chart `data` fallback, tooltip/YAxis null-safe formatting, dev-only logs.  
- `components/dashboard/service/FinancialFlowChart.tsx` — YAxis tickFormatter null-safe.

---

## 6) Verification Checklist (Manual)

- Load `/dashboard` as service owner → charts render; no redirect loops.  
- No state update on unmount: navigate away while stats are loading → no React warning about setState on unmounted component (guarded by `mountedRef.current`).  
- Fresh account (no invoices/payments) → chart shows current month days with 0; no crash (empty array + safe formatters).  
- Existing account with data → "Cash collected" chart and "Collected this month" KPI use same payments query; totals align.  
- Chart fetch only runs when staying on dashboard (service mode) and after business is loaded; all fetches use `business_id` consistently.  
- Debug logs only in development.

---

## 7) No Refactor / No Engine Changes

- No changes to ledger posting, triggers, or accounting engine.  
- No changes to invoice/payment/credit-note business rules or reporting math.  
- No changes to `/api/dashboard/ledger-expense-total` or other dashboard API logic.  
- Only UI stability, null-safety, and unmount guards were added.
