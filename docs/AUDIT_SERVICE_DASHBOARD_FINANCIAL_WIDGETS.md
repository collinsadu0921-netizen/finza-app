# Service Dashboard Financial Widgets — Audit Report

## 1. Data source (tables / flow)

| Widget | Source | Flow |
|--------|--------|------|
| **Revenue** | Ledger (trial balance) | `service-metrics` → `getProfitAndLossReport` → `resolveAccountingPeriodForReport` → `get_profit_and_loss_from_trial_balance(period_id)` → `get_trial_balance_from_snapshot(period_id)` → `trial_balance_snapshots` (or regenerate from `period_opening_balances` + `journal_entry_lines`) |
| **Expenses** | Same as Revenue | Same P&L report; expense sections (cogs, operating_expenses, other_expenses, taxes) summed |
| **Net Profit** | Same as Revenue | `pnl.totals.net_profit` from same P&L report |
| **Accounts Receivable** | Ledger (trial balance) | `service-metrics` → `getBalanceSheetReport` → same period → `get_balance_sheet_from_trial_balance` → **extractAR(bs)** looks for **account_code "1200"** in assets (see bug below) |
| **Accounts Payable** | Same | **extractAP(bs)** sums `current_liabilities` subtotal from balance sheet |
| **Cash Balance** | Same | **extractCash(bs)** sums asset lines with account_code in `["1000","1010","1020","1030"]` |
| **Financial flow chart** | Same ledger | **Timeline**: `service-timeline` (last 12 `accounting_periods`, P&L per period) or `service-analytics` (V2, RPC `get_service_analytics_timeline`). **Chart** uses same timeline; no separate source. |

**Conclusion:** All values are **ledger-derived** via trial balance (and snapshots). No direct reads from `invoices` or `payments` for the dashboard widgets; invoices affect the numbers only after they are posted to the ledger.

---

## 2. Filters (business_id, workspace, date)

- **business_id:** Required in all API routes (`service-metrics`, `service-timeline`, `service-analytics`). Enforced by `checkAccountingAuthority(supabase, user.id, businessId, "read")`. Period resolution and RPCs are scoped by `businessId` / `p_business_id`.
- **Workspace:** Service-only by route; no mixed retail/service in these APIs.
- **Date range:** Widgets are **period-based**, not date-range. Period comes from either:
  - **With timeline:** `period_start` = last item of timeline (see root cause), and `previous_period_start` = second-to-last.
  - **Without timeline:** No `period_start` → `resolveAccountingPeriodForReport` uses **resolve_default_accounting_period** (latest OPEN with activity → SOFT_CLOSED → LOCKED → current month fallback).

No missing business scope or join that would override `business_id`.

---

## 3. Aggregation / logic issues

- **SUM(NULL):** Handled with `Number(x ?? 0)` and `Math.round(…* 100)/100` in JS; RPCs use `COALESCE` in SQL. No observed SUM(NULL) bug.
- **JOINs:** P&L and Balance Sheet read from trial balance snapshot (no joins that would nullify results).
- **Revenue and paid invoices:** Revenue is from **ledger** (income accounts in trial balance). Once an invoice is **posted**, its revenue is in the ledger; when it’s **paid**, the cash/AR posting does not remove revenue—it only moves AR/cash. So paid invoices are included in revenue for the period in which the revenue was posted. No condition that excludes “paid” invoices in the dashboard path.
- **Real bug (AR widget):** In `app/api/dashboard/service-metrics/route.ts`, **AR_CODE = "1200"**. In this codebase, **Accounts Receivable is 1100**; **1200 is Inventory** (asset). So **extractAR** looks for the wrong account and effectively returns **0** for service businesses that use 1100 for AR. This is a **logic bug**.

---

## 4. Widget vs chart

- **Summary cards:** Values come from **one** call to `service-metrics`, with optional `period_start` and `previous_period_start`.
- **Chart:** Uses **timeline** from `service-timeline` (or `service-analytics`). Each point = one period’s P&L totals.
- **Inconsistency:** When `tl.length >= 2`, the cockpit passes **current = timeline[timeline.length - 1]** (the **latest period by date**) to `service-metrics`. So **widgets show the latest calendar period**, while the chart shows the same 12 periods. If the latest period is a **new, empty** period (e.g. new month), widgets show **₵0.00** even though the previous period (where the 1200 GHS was posted) has revenue. So widget and chart use the **same** data source (ledger/trial balance), but **period selection for widgets** is wrong.

---

## 5. Snapshot logic

- **Stale-aware:** Migration 247: when a journal entry is inserted, `mark_trial_balance_snapshot_stale` marks that period’s snapshot stale. On report request, `get_trial_balance_from_snapshot` regenerates if missing or stale. So new postings (e.g. invoice) are reflected after the next report load.
- **New customers:** Adding customers does **not** reset or invalidate trial balance snapshots. Only **journal_entries** (and triggers) do. So “30+ customers” does not directly change snapshot state.
- **Onboarding:** No snapshot logic tied to onboarding step. Period resolution can use “current month fallback” when there is no activity; that can point to an empty new period, but the root cause here is **which period the cockpit sends** to `service-metrics`, not snapshot refresh.

---

## 6. Performance and stability

- **Suggestions:** Use explicit `SELECT` fields in RPCs where possible; ensure indexes on `accounting_periods(business_id, period_start)`, `journal_entries(business_id, date)`, `trial_balance_snapshots(period_id)`. Add error boundaries around the dashboard cockpit and fallback UI (e.g. “Unable to load metrics”) and loading/empty states for widgets (already partially present). Optional: short-lived cache for metrics per business+period to avoid duplicate work on re-renders.

---

## 7. Root cause: why 1200 GHS disappeared from widgets

- **What happened:** The 1200 GHS paid invoice was posted in **period A** (e.g. Feb 2025). Later, **period B** (e.g. Mar 2025) became the **latest** period in the timeline (calendar rollover or new period). The cockpit always uses **timeline[timeline.length - 1]** as the “current” period for **all six widgets**. So the dashboard requested metrics for **period B**, which has **no** journal entries yet → Revenue (and the other widgets) show **₵0.00**. The invoice still exists and is still in the ledger in period A; it was **not** overwritten and no WHERE clause was changed—only the **period passed to the API** changed.
- **Why it seemed to coincide with “30+ customers”:** Likely a **time** effect: after adding many customers, a new period had started (e.g. new month), so the “latest” period became that new, empty period. So: **logic bug** (wrong period selection for widgets), not a state or query bug in the ledger.

---

## 8. Recommended structural fix

### A. Period selection for widgets (main fix)

- **Problem:** Using `period_start = current.period_start` with `current = tl[tl.length - 1]` forces widgets to show the **latest period by date**, which may be empty.
- **Fix:** For the **primary** metrics request (the one that drives the six cards), **do not** pass `period_start` when you have a timeline. Let `service-metrics` use its default resolution (**resolve_default_accounting_period** → “latest period with activity” or current month). Use the optional `previous_period_start` only for the “previous period” comparison, by resolving the period **before** the default period (e.g. from `accounting_periods` where `period_end < resolved_period.period_start` order by `period_start` desc limit 1), or by still passing `previous_period_start` from the timeline’s second-to-last item when that is before the default period. Concretely: in **ServiceDashboardCockpit**, always call `service-metrics` **without** `period_start` (and optionally with a single `previous_period_start` for comparison). That way widgets always show “latest period with activity” (or current month) and the 1200 GHS will reappear when it’s in that period.

### B. AR account code (service-metrics)

- **Problem:** `AR_CODE = "1200"` is wrong for AR; 1100 is AR, 1200 is Inventory.
- **Fix:** In `app/api/dashboard/service-metrics/route.ts`, set `AR_CODE = "1100"`. If some businesses use a different AR code, consider resolving AR from `chart_of_accounts_control_map` (e.g. control key `AR`) and falling back to 1100.

### C. Centralized financial aggregation

- **Recommendation:** Keep using **ledger (trial balance)** as the single source of truth. The dashboard already does. Optionally add a small server-side helper that returns “default period + previous period” and the corresponding metrics in one place, so the cockpit has one contract and period resolution lives in one place.

---

## 9. Files involved

| File | Role |
|------|------|
| `app/service/dashboard/page.tsx` | Loads business (owner_id only), renders cockpit |
| `components/dashboard/service/ServiceDashboardCockpit.tsx` | Fetches timeline then metrics; **passes last timeline period as period_start** → root cause |
| `app/api/dashboard/service-metrics/route.ts` | P&L + Balance Sheet; **AR_CODE = "1200"** → AR bug |
| `app/api/dashboard/service-timeline/route.ts` | Last 12 periods, P&L per period |
| `app/api/dashboard/service-analytics/route.ts` | V2 timeline RPC |
| `lib/accounting/reports/getProfitAndLossReport.ts` | Resolves period, calls get_profit_and_loss_from_trial_balance |
| `lib/accounting/reports/getBalanceSheetReport.ts` | Resolves period, calls get_balance_sheet_from_trial_balance |
| `lib/accounting/resolveAccountingPeriodForReport.ts` | period_id → period_start → as_of_date → … → resolve_default_accounting_period → current month |
| DB: `get_trial_balance_from_snapshot`, `get_profit_and_loss_from_trial_balance`, `get_balance_sheet_from_trial_balance`, `resolve_default_accounting_period` | Canonical reporting and period resolution |

---

## 10. Summary

- **Root cause:** Widgets show the **latest period by date** (last item in timeline). When that period is new and empty, Revenue/Expenses/Net Profit (and the rest) show ₵0.00. The 1200 GHS invoice is in the **previous** period and is unchanged in the ledger.
- **Type:** **Logic bug** (period selection for widgets).
- **Fix:** Use default period (latest with activity) for widgets instead of last timeline period; fix AR code 1200 → 1100 in service-metrics.
