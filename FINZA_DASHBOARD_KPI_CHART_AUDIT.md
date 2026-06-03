# Finza Dashboard KPI & Chart Audit

> **Audit-only deliverable.** No financial logic, accounting calculations, database
> queries, reports, KPI definitions, or chart code were changed. Findings below
> identify problems and recommend a staged plan; nothing is implemented.

## Executive summary

- **Current dashboard source/components:** The dashboard with KPI cards + grouped-bar
  trend chart is the **real, logged-in Service workspace dashboard**:
  - Page wrapper: `app/service/dashboard/page.tsx`
  - Orchestrator: `components/dashboard/service/ServiceDashboardCockpit.tsx`
  - KPI cards: `components/dashboard/service/MetricCard.tsx`
  - Trend chart: `components/dashboard/service/TrendsSection.tsx` (Recharts grouped `BarChart`)
- **Marketing vs real app — same or separate?** They are effectively **the same UI**.
  There is **no marketing dashboard component, no `AnimatedDashboardHero`, no
  `components/home`, and no static screenshot/mock dashboard** in the codebase.
  `app/page.tsx` simply redirects authenticated users to a workspace dashboard, and
  `app/demo/page.tsx` is a **YouTube video embed** (`components/marketing/FinzaDemoVideoEmbed.tsx`),
  not a live UI. **Any "product screenshot" of a dashboard is therefore a screenshot of
  the real authenticated app rendering a real tenant's ledger data.** There is no
  separate demo dataset.
- **Main chart problem:** `TrendsSection` is a **3-series grouped bar chart** (Revenue,
  Expenses, Net Profit) fed by **up to 12 monthly accounting periods**. That is
  ~36 bars at `maxBarSize=14`; bars are already thin and the chart reads like an
  accounting report. **There is no date-range control on the chart** — it always shows
  N accounting periods (default 12). The X-axis has **no tick-thinning strategy**, so
  longer ranges would drop/crowd labels. An optional `SERVICE_ANALYTICS_V2` path
  (currently **off** — env flag not set) would feed **daily** points over 365 days into
  the *same bar chart*, which would be unreadable.
- **KPI risks (flagged, not fixed):**
  - **"Accounts Payable"** is computed as the **sum of *all* current-liability subtotals**,
    not just trade payables (account `2100`). It can silently include VAT payable,
    accruals, short-term loans, etc. — a **mislabel risk**.
  - **"Revenue"** is **P&L recognized income** (accrual) but its subtitle says
    *"billed this period"*, conflating recognized revenue with invoiced amount.
  - **"Cash Collected"** = sum of **all debits to cash accounts** in the period (any
    inflow), but its subtitle frames it as *"% of billed"* (a collection rate). Inflows
    like owner contributions, loans, or transfers inflate it.
  - **Position cards (Cash / AR / AP) are "as of today"** when a *historical* period is
    selected (QuickBooks-style split). Correct by design, but a screenshot taken while
    browsing an old period can look internally inconsistent.
- **Recommended chart direction:** Replace the 3-series grouped bars with a **calmer
  smooth area/line chart**. Two viable area/line components **already exist but are
  unused** (`FinancialFlowChart.tsx` = multi-line; `ExecutiveFinancialFlowChart.tsx` =
  composed bars+net line). Prefer **2 series max** in the main chart (e.g. Revenue line +
  Net Profit area, or the invoiced/collected/outstanding story) and move the third series
  to the current-period summary / KPI cards.
- **Implementation risk level:**
  - **Chart-type swap in `TrendsSection` (presentation only): LOW** — it consumes an
    already-computed `TimelinePoint[]`; changing chart geometry touches no calculations.
  - **KPI relabel/semantics fixes: MEDIUM–HIGH** — must not be done during this audit;
    requires business confirmation because they change financial meaning.
  - **Adding date-range/adaptive labeling: MEDIUM** — needs a new helper and possibly a
    new data path; not required for the cosmetic chart improvement.

---

## Files inspected

| File | Role |
| ---- | ---- |
| `app/page.tsx` | Root landing — redirects authenticated users to a workspace dashboard; **no marketing hero** |
| `app/demo/page.tsx` | Public "How Finza works" page — **YouTube video embed only** |
| `components/marketing/FinzaDemoVideoEmbed.tsx` | Demo video component (referenced; not a dashboard) |
| `app/service/dashboard/page.tsx` | Real Service workspace dashboard page wrapper |
| `components/dashboard/service/ServiceDashboardCockpit.tsx` | Orchestrates KPI fetch, timeline fetch, activity, overdue count; renders cards + chart |
| `components/dashboard/service/MetricCard.tsx` | KPI card (value, %-vs-prev, mini sparkline) |
| `components/dashboard/service/TrendsSection.tsx` | **Live trend chart — Recharts grouped `BarChart`** |
| `components/dashboard/service/FinancialFlowChart.tsx` | **Unused** Recharts `LineChart` (multi-line, series toggles) |
| `components/dashboard/service/ExecutiveFinancialFlowChart.tsx` | **Unused** Recharts `ComposedChart` (revenue/cost bars + net line, diverging zero baseline) |
| `components/dashboard/service/ServiceDashboardSkeleton.tsx` | Loading skeletons (metrics, trends, activity) |
| `components/dashboard/service/RecentActivityFeed.tsx` | Recent activity list (referenced) |
| `components/dashboard/service/DashboardHeader.tsx` | Period selector + currency + refresh (referenced) |
| `app/api/dashboard/service-metrics/route.ts` | **KPI calculations** (P&L + Balance Sheet derived) |
| `app/api/dashboard/service-timeline/route.ts` | **Chart data** — per accounting period (default 12), P&L per period |
| `app/api/dashboard/service-analytics/route.ts` | V2 daily/weekly/monthly timeseries (behind `NEXT_PUBLIC_SERVICE_ANALYTICS_V2`, **off**) |
| `app/retail/dashboard/page.tsx` | Retail dashboard — today-only cards (sales/revenue/till), **no trend chart** |
| `app/accounting/dashboard/page.tsx` | Accountant "control tower" — work items/clients, **no trend chart** |

Searched and confirmed absent: `AnimatedDashboardHero`, `components/home`, `home-hero`,
`finza-dashboard`, any static screenshot/mock dashboard component, any landing-page hero
that renders KPI cards or charts.

---

## Dashboard ownership map

| Dashboard/context | File/component | Real data or demo/static | Public or app | Notes |
| ----------------- | -------------- | ------------------------ | ------------- | ----- |
| **Service workspace dashboard** (the KPI + grouped-bar-chart dashboard) | `app/service/dashboard/page.tsx` → `ServiceDashboardCockpit.tsx` → `MetricCard`, `TrendsSection` | **Real** (ledger-derived via P&L / Balance Sheet APIs) | **Logged-in app** | This is what marketing screenshots actually capture |
| Retail workspace dashboard | `app/retail/dashboard/page.tsx` | **Real** (`sales` table, today only) | Logged-in app | No trend chart; 3 "today" cards + Open POS |
| Accountant firm dashboard | `app/accounting/dashboard/page.tsx` | **Real** (control-tower / firm APIs) | Logged-in app | Work-items/risk, no financial trend chart |
| Public landing | `app/page.tsx` | n/a | Public→redirect | Redirects to `/login` or a workspace; renders only a spinner |
| Public product demo | `app/demo/page.tsx` + `FinzaDemoVideoEmbed.tsx` | **Static video** | Public marketing | YouTube embed; not a live dashboard |
| (Dead code) Financial flow line chart | `FinancialFlowChart.tsx` | n/a | n/a | **Not imported anywhere** — candidate reference for area/line direction |
| (Dead code) Executive financial flow | `ExecutiveFinancialFlowChart.tsx` | n/a | n/a | **Not imported anywhere** — has diverging bars + net line + zero `ReferenceLine` |

**Conclusion:** There is **no separate marketing dashboard**. Improving the chart affects
the **real logged-in Service dashboard** and, by extension, any screenshot taken of it.

---

## KPI findings

KPI cards are rendered in `ServiceDashboardCockpit.tsx` (primary grid lines ~536–578,
secondary grid lines ~581–628). Values come from `/api/dashboard/service-metrics`.

| KPI | Source | Meaning | Keep/change | Risk |
| --- | ------ | ------- | ----------- | ---- |
| **Revenue** | P&L `income` + `other_income` subtotals (`service-metrics` L213–221) | Accrual recognized income | **Keep value; review label** | Subtitle "billed this period" implies *invoiced*, but source is *recognized* income — semantic mismatch (flag) |
| **Expenses** | P&L `cogs`+`operating_expenses`+`other_expenses`+`taxes` subtotals (L214–222) | Accrual expenses incl. tax expense | Keep | Bundles tax expense into "Expenses"; fine but note for chart story |
| **Net Profit** | `pnl.totals.net_profit` (L223) | P&L net profit | Keep | Negative renders red + "negative" variant; correct |
| **Cash Balance** | Balance sheet accounts `1000/1010/1020/1030` (L25, `extractCash`) | Bank/cash on hand | Keep | "As of today" when a historical period is selected (by design) |
| **Accounts Receivable** | Balance sheet account `1100` only (`extractAR`, L42–51) | Trade receivables | Keep | Single control account; OK if `1100` is the AR control |
| **Accounts Payable** | **Sum of *all* `current_liabilities` group subtotals** (`extractAP`, L53–61) | Labeled "owed to suppliers" | **Flag — likely too broad** | Includes every current liability (VAT payable, accruals, short-term loans), not just trade payables (`2100`). Potential overstatement / mislabel. **Do not fix during audit.** |
| **Cash Collected** | Sum of **debits to cash accounts** in period (L231–265) | Framed as payments received / "% of billed" | **Flag** | Counts *all* cash inflows, not only customer collections; "% of billed" can mislead and exceed 100% |
| **Overdue Invoices** | Direct `invoices` query: status in `sent/overdue/partial` AND `due_date < today` (`fetchOverdueInvoiceCount`, L190–203) | Count of past-due invoices | Keep | **Invoice-domain metric mixed with ledger-domain cards** — different source of truth (flag conceptually, not a bug) |
| Profit margin % | Client-side `netProfit/revenue` (Cockpit L439–442) | Margin badge on Net Profit | Keep | Guards `revenue > 0` |
| Collection rate % | Client-side `cashCollected/revenue` (Cockpit L444–447) | Subtitle on Cash Collected | Keep | Inherits "Cash Collected" breadth issue above |
| Customer balances / Payments received / Outstanding invoices | **Not present as dedicated KPI cards** | — | — | Requested in brief but not implemented today; closest are AR, Cash Collected, Overdue Invoices |

**Crowding / hierarchy:** 8 KPI cards in two 4-up rows. Visually fine, but **Revenue vs
Cash Collected** and **AR vs Overdue Invoices** are conceptually adjacent and can read as
duplicative to a non-accountant. No KPI is broken; the concern is labeling/semantics and
density, not arithmetic.

---

## Chart findings

| Area | Current behavior | Problem | Recommended direction |
| ---- | ---------------- | ------- | --------------------- |
| Chart type | Recharts grouped `BarChart`, 3 series (`revenue`/`expenses`/`netProfit`), `maxBarSize=14`, `barCategoryGap="30%"` (`TrendsSection.tsx` L132–177) | 3×N bars get thin; reads like an accounting report | Smooth **area/line** chart; **≤2 series** in main chart |
| Chart library | Recharts (`recharts`) | Fine; already used by 3 components | Keep Recharts; reuse for area/line |
| Data source | `/api/dashboard/service-timeline` — **per accounting period**, default `periods=12`, P&L per period | Not a true "date range"; always whole periods | Keep ledger source; add range/granularity only if needed |
| Series shown | Revenue, Expenses, Net Profit | 3 competing series on small canvas | Pick a clearer story (see Chart-type recommendation) |
| Date-range support | **None on the chart.** The `DashboardHeader` period selector only changes which period's **KPI values** show, not the chart window | No 7/30/90-day, 12-month, multi-year control | If desired, add explicit range control + adaptive labels |
| X-axis labeling | `XAxis dataKey="name"`, no `interval`/tick-thinning (L144–150) | With many periods, Recharts auto-drops labels unpredictably | Add adaptive tick `interval` helper based on point count |
| Mobile behavior | `ResponsiveContainer` width 100%, fixed height 240; summary panel stacks below via `border-t` (L124–199) | 36 bars on a phone are extremely thin | Area/line scales far better on narrow screens |
| Empty state | "No trend data for this period" when `chartData.length===0` (L126–129) | Adequate | Keep; consider friendlier copy/icon |
| Loading state | `ServiceDashboardTrendsPanelSkeleton` + `next/dynamic` loader (Cockpit L19–27, L634–646) | Good | Keep |
| Negative values | Bars render below an implicit zero; **no explicit zero `ReferenceLine`** in `TrendsSection` (the unused `ExecutiveFinancialFlowChart` has one) | Negative net profit lacks a clear baseline | Add a zero baseline / use signed area for net |
| Crowding over range | At 12 periods = 36 bars @ width ≤14px | Already crowded; worsens with any longer/daily range | Area/line removes per-series bar-width pressure |

### Range stress test (current grouped bars)

| Range | What the current chart does | Verdict |
| ----- | --------------------------- | ------- |
| 7 days | Not supported — chart is per accounting period; would show ~1 period (the current month) | Mismatch (no daily mode in active path) |
| 30 days | Same — shows current accounting period only | Mismatch |
| 90 days | ~3 monthly periods × 3 bars = 9 bars | Acceptable but trivial |
| 12 months | 12 periods × 3 bars = **36 thin bars** | **Crowded; the core complaint** |
| Multi-year | Capped at 24 periods (`service-timeline` L108) = up to **72 bars** | **Unreadable** |
| (V2 daily, flag off) | 365 daily points × 3 bars into the same `BarChart` | **Would be catastrophic** if enabled |

---

## Date-range behavior

| Date range | Current behavior | Recommended behavior |
| ---------- | ---------------- | -------------------- |
| 7 days | Not available (period-based; ~1 period shown) | Daily points, daily labels |
| 30 days | Not available (period-based) | Daily points, **weekly/selected** labels |
| 90 days | ~3 monthly periods | Weekly or monthly labels |
| 12 months | 12 monthly periods (all labels attempted, may overlap) | **Selected** month labels (e.g. every 2nd–3rd), not all 12 |
| Multi-year | Up to 24 periods (no year grouping) | **Yearly** (or quarterly) labels |

**Current support:** The chart has **no adaptive labeling and no range selector**. Adaptive
behavior would need (a) a small label-thinning helper keyed off point count, and
(b) optionally a range/granularity control wired to `service-analytics` (V2). Neither is
required for the cosmetic area/line upgrade and **should be a separate, later phase.**

---

## Marketing screenshot findings

- **No dedicated demo/marketing dashboard exists.** Screenshots of "the dashboard" are
  screenshots of the **real authenticated Service dashboard** rendering a real tenant's
  ledger. There is no curated demo dataset and no static mock to control what shows.
- **Risk: uncontrolled demo state.** A screenshot can capture: zero revenue, a loss month
  as the dominant story, "as of today" position cards that look inconsistent with a
  selected historical period, or empty/`—` cards (e.g. Overdue Invoices loading).
- **Risk: "Accounts Payable" overstatement** (all current liabilities) could make a demo
  business look more indebted than intended in a public image.
- **Risk: thin/crowded 36-bar chart** is the least "modern" element and the most likely to
  read as an old accounting report in a hero image.
- **No fake testimonials/logos/customer names** are present in the dashboard code — good.
- **Recommendation:** For public imagery, use a **dedicated seeded demo tenant** (clearly
  product-demonstration data) with a believable story — revenue trending up, expenses below
  revenue, mostly positive net, some outstanding/overdue to show tracking value — and only
  capture the "latest period" view (not a historical period) so position cards stay
  coherent. Do **not** invent real-looking customer names/logos.

---

## Recommended safe implementation plan

> Do not code yet. Staged so the safe, high-value cosmetic change can ship independently of
> any financial-semantics work.

### Phase A — Marketing/demo dashboard only
*Not applicable as a code change* — there is **no separate marketing dashboard** to edit.
Instead, the marketing-safe action is **operational, not code**:
- Create/seed a **dedicated demo tenant** with believable data and use it for screenshots.
- Capture only the **"Latest period"** state.
- If a truly separate marketing mock is desired later, build a read-only presentational
  variant that consumes the same `TimelinePoint[]`/metrics shape with curated demo props —
  **no shared mutation of real data.**

### Phase B — Real app chart UX (LOW risk, presentation-only)
Recommended first real change because it does **not** touch calculations:
1. In `TrendsSection.tsx`, swap the grouped `BarChart` for a **smooth area/line chart**
   (Recharts `AreaChart`/`LineChart` with `type="monotone"`). The existing
   `FinancialFlowChart.tsx` is a ready reference for line styling.
2. Reduce to **≤2 primary series** in the chart canvas; keep the third value in the
   "Current period" summary panel (already present, L183–199).
3. Add a **zero `ReferenceLine`** when Net Profit can be negative (pattern exists in
   `ExecutiveFinancialFlowChart.tsx` L205).
4. Add a small **adaptive X-axis tick interval** based on `chartData.length` so 12+ periods
   don't overlap.
5. Keep the same input contract (`TimelinePoint[]`, `currencyCode`, current totals) so
   `ServiceDashboardCockpit` needs no data changes.
- **Guardrail:** purely visual; verify against empty, single-period, negative-profit, and
  12-period cases.

### Phase C — Dashboard KPI polish (MEDIUM risk; visual only, no semantics)
- Tighten hierarchy: keep all 8 cards but visually de-emphasize secondary row; ensure the
  "Current period" summary doesn't visually compete with the chart.
- Improve number formatting/empty states (`—` vs "0") consistently.
- **Do not** relabel/redefine KPIs here — that is gated below.

### Phase D (gated, separate from this audit) — KPI semantics & ranges
Only after business confirmation:
- Resolve **Accounts Payable** breadth (all current liabilities vs trade payables `2100`).
- Clarify **Revenue** label (recognized vs invoiced) and **Cash Collected** definition.
- Optionally add a chart **date-range + adaptive granularity** wired to `service-analytics`.

---

## Do-not-change warnings

Do not modify without explicit business confirmation:
- **`app/api/dashboard/service-metrics/route.ts`** — KPI calculations (P&L/BS extraction,
  cash-collected aggregation, AR/AP/cash logic, QuickBooks as-of-today split).
- **`app/api/dashboard/service-timeline/route.ts`** and **`service-analytics/route.ts`** —
  period resolution and per-period P&L aggregation.
- **`getProfitAndLossReport` / `getBalanceSheetReport`** and anything under
  `lib/accounting/reports/**` — shared by reports/exports.
- KPI **labels and definitions** (Revenue/Expenses/Net Profit/Cash Balance/AR/AP/Cash
  Collected/Overdue) — relabeling changes financial meaning.
- The **invoice overdue query** semantics (status set + `due_date < today`).
- Account-code constants (`CASH_CODES`, `AR_CODE = "1100"`, current-liabilities grouping).
- Anything touching PDF/report exports or accountant reporting semantics.

---

## Open questions

- Should the main chart show **accounting (recognized) revenue** or **invoice/payment
  activity** (Invoiced / Payments received / Outstanding)?
- Should **"Revenue"** mean **invoiced amount**, **recognized revenue**, or **paid
  revenue**? (Card source = recognized; subtitle says "billed".)
- Should **"Cash collected"** be the primary owner-facing headline metric, and should it be
  restricted to **customer collections** rather than all cash debits?
- Should **expenses** remain a chart series, or live only in KPI cards (to declutter)?
- Is **"Accounts Payable"** intended to be **trade payables only** (`2100`) or **all current
  liabilities** (current behavior)?
- Should public screenshots use a **separate seeded demo tenant** rather than live tenant
  data, and should historical-period selection be disabled for marketing capture?
- Do we want an explicit **date-range selector** on the chart, or keep the
  period-based-12 default and only improve presentation?

---

## Verification

This is an **audit-only** deliverable. **No source files were modified** (only this new
report was added), so **no build is required**.

If any source file is touched in a later phase, run:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

**Do not implement dashboard changes until this audit is reviewed.**
