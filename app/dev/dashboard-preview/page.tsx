"use client"

/**
 * ISOLATED DESIGN PREVIEW — safe to delete.
 *
 * Direction A: P&L performance panel. Hardcoded sample data only.
 * Local preview-only currency formatters — not exported.
 */

import { useMemo, useState } from "react"
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Cell,
  TooltipProps,
} from "recharts"

function formatCompactCurrencyPreview(value: number): string {
  const sign = value < 0 ? "-" : ""
  const abs = Math.abs(value)
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  }
  if (abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`
  }
  return `${sign}$${abs.toLocaleString("en-US")}`
}

function formatFullCurrencyPreview(value: number): string {
  const sign = value < 0 ? "-" : ""
  const abs = Math.abs(value)
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`
}

type PreviewPoint = {
  month: string
  revenue: number
  expenses: number
  netProfit: number
}

type ChartPoint = {
  label: string
  revenue: number
  expenses: number
  netProfit: number
}

type PeriodMode = "monthly" | "quarterly" | "ytd"

const PERIOD_MODES: { id: PeriodMode; label: string }[] = [
  { id: "monthly", label: "Monthly" },
  { id: "quarterly", label: "Quarterly" },
  { id: "ytd", label: "YTD" },
]

const MONTHLY_SAMPLE: PreviewPoint[] = [
  { month: "Jan", revenue: 42_000, expenses: 51_500, netProfit: -9_500 },
  { month: "Feb", revenue: 48_000, expenses: 51_500, netProfit: -3_500 },
  { month: "Mar", revenue: 57_000, expenses: 54_000, netProfit: 3_000 },
  { month: "Apr", revenue: 63_200, expenses: 55_600, netProfit: 7_600 },
  { month: "May", revenue: 71_200, expenses: 58_300, netProfit: 12_900 },
  { month: "Jun", revenue: 83_300, expenses: 62_100, netProfit: 21_200 },
]

const COLORS = {
  revenue: "#10b981",
  expenses: "#64748b",
  profitPos: "#4f46e5",
  profitNeg: "#dc2626",
} as const

// --- Dashboard context sample data (hardcoded preview only) ----------------

type FinancialStateCard = {
  key: string
  label: string
  value: number
  caption: string
  accent: string
  trend?: { direction: "up" | "down"; text: string }
}

const FINANCIAL_STATE: FinancialStateCard[] = [
  {
    key: "cash",
    label: "Cash position",
    value: 128_400,
    caption: "Across 2 accounts",
    accent: "#10b981",
    trend: { direction: "up", text: "+$12.3k this month" },
  },
  {
    key: "receivables",
    label: "Receivables",
    value: 46_200,
    caption: "18 open invoices",
    accent: "#4f46e5",
    trend: { direction: "down", text: "$8.1k overdue" },
  },
  {
    key: "payables",
    label: "Payables",
    value: 23_750,
    caption: "9 bills outstanding",
    accent: "#f59e0b",
    trend: { direction: "up", text: "$5.4k due this week" },
  },
  {
    key: "tax",
    label: "VAT reserve",
    value: 14_900,
    caption: "Next filing Jul 31",
    accent: "#64748b",
  },
]

type ActionItem = {
  key: string
  title: string
  detail: string
  count: number
  tone: "danger" | "warning" | "info" | "neutral"
}

const ACTION_ITEMS: ActionItem[] = [
  {
    key: "overdue-invoices",
    title: "Overdue invoices",
    detail: "Oldest 32 days · $8,100 total",
    count: 3,
    tone: "danger",
  },
  {
    key: "bills-due",
    title: "Bills due this week",
    detail: "$5,400 across 2 suppliers",
    count: 2,
    tone: "warning",
  },
  {
    key: "documents-review",
    title: "Documents awaiting review",
    detail: "Receipts and statements to match",
    count: 4,
    tone: "info",
  },
  {
    key: "payroll",
    title: "Payroll pending approval",
    detail: "June run · 6 staff",
    count: 1,
    tone: "neutral",
  },
]

const ACTION_TONE: Record<ActionItem["tone"], { dot: string; badge: string }> = {
  danger: { dot: "#dc2626", badge: "bg-red-50 text-red-700" },
  warning: { dot: "#f59e0b", badge: "bg-amber-50 text-amber-700" },
  info: { dot: "#4f46e5", badge: "bg-indigo-50 text-indigo-700" },
  neutral: { dot: "#64748b", badge: "bg-slate-100 text-slate-600" },
}

function marginPct(revenue: number, netProfit: number): number {
  if (revenue === 0) return 0
  return Math.round((netProfit / revenue) * 100)
}

function toChartPoints(months: PreviewPoint[]): ChartPoint[] {
  return months.map((m) => ({
    label: m.month,
    revenue: m.revenue,
    expenses: m.expenses,
    netProfit: m.netProfit,
  }))
}

function aggregateMonths(months: PreviewPoint[], label: string): ChartPoint {
  return {
    label,
    revenue: months.reduce((s, m) => s + m.revenue, 0),
    expenses: months.reduce((s, m) => s + m.expenses, 0),
    netProfit: months.reduce((s, m) => s + m.netProfit, 0),
  }
}

function buildQuarterlyPoints(months: PreviewPoint[]): ChartPoint[] {
  return [
    aggregateMonths(months.slice(0, 3), "Q1"),
    aggregateMonths(months.slice(3, 6), "Q2"),
  ]
}

function buildYtdCumulative(months: PreviewPoint[]): ChartPoint[] {
  let revenue = 0
  let expenses = 0
  let netProfit = 0
  return months.map((m) => {
    revenue += m.revenue
    expenses += m.expenses
    netProfit += m.netProfit
    return { label: m.month, revenue, expenses, netProfit }
  })
}

function buildPeriodView(mode: PeriodMode) {
  const monthly = MONTHLY_SAMPLE
  const chartData =
    mode === "monthly"
      ? toChartPoints(monthly)
      : mode === "quarterly"
        ? buildQuarterlyPoints(monthly)
        : buildYtdCumulative(monthly)

  const latestPoint = chartData[chartData.length - 1]

  let heroRevenue: number
  let heroExpenses: number
  let heroNetProfit: number
  let breakdownTitle: string
  let breakdownSubtitle: string
  let heroCaption: string
  let profitLaneLabel: string
  let trendLabel: string
  let trendValue: string
  let scopeLabel: string
  let insight: string
  let insightBullets: string[]

  const latestMonth = monthly[monthly.length - 1]

  if (mode === "monthly") {
    heroRevenue = monthly.reduce((s, m) => s + m.revenue, 0)
    heroExpenses = monthly.reduce((s, m) => s + m.expenses, 0)
    heroNetProfit = heroRevenue - heroExpenses
    breakdownTitle = `${latestPoint.label} breakdown`
    breakdownSubtitle = "Latest month · P&L summary"
    heroCaption = "Revenue outpaced expenses over the period"
    profitLaneLabel = "Net profit by month"
    trendLabel = "Months profitable"
    trendValue = `${monthly.filter((m) => m.netProfit >= 0).length} of ${monthly.length}`
    scopeLabel = "Monthly"
    insight =
      "Expenses stayed largely flat while revenue grew each month, turning early losses into a profitable run."
    insightBullets = [
      `Revenue rose from ${formatCompactCurrencyPreview(monthly[0].revenue)} to ${formatCompactCurrencyPreview(latestMonth.revenue)}.`,
      "Operating costs stayed broadly flat as revenue climbed.",
      `Latest month margin reached ${marginPct(latestMonth.revenue, latestMonth.netProfit)}%.`,
    ]
  } else if (mode === "quarterly") {
    heroRevenue = latestPoint.revenue
    heroExpenses = latestPoint.expenses
    heroNetProfit = latestPoint.netProfit
    breakdownTitle = `${latestPoint.label} breakdown`
    breakdownSubtitle = "Latest quarter · P&L summary"
    heroCaption = "Latest quarter turned strongly profitable"
    profitLaneLabel = "Net profit by quarter"
    const quarters = buildQuarterlyPoints(monthly)
    trendLabel = "Quarters profitable"
    trendValue = `${quarters.filter((q) => q.netProfit >= 0).length} of ${quarters.length}`
    scopeLabel = "Quarterly"
    insight =
      "Q2 reversed Q1's shortfall as revenue accelerated faster than operating costs."
    insightBullets = [
      "Q2 reversed Q1's shortfall.",
      "Revenue growth outpaced operating costs.",
      `Q2 net margin reached ${marginPct(latestPoint.revenue, latestPoint.netProfit)}%.`,
    ]
  } else {
    heroRevenue = latestPoint.revenue
    heroExpenses = latestPoint.expenses
    heroNetProfit = latestPoint.netProfit
    breakdownTitle = "YTD breakdown"
    breakdownSubtitle = "Cumulative through Jun · P&L summary"
    heroCaption = "Year-to-date performance improved through the period"
    profitLaneLabel = "Cumulative net profit"
    trendLabel = "YTD through"
    trendValue = latestPoint.label
    scopeLabel = "YTD"
    insight =
      "Year-to-date the business moved into cumulative profit as monthly revenue consistently outpaced spending."
    insightBullets = [
      "Cumulative profit turned positive in May.",
      `Year-to-date revenue reached ${formatCompactCurrencyPreview(latestPoint.revenue)}.`,
      `YTD net margin is ${marginPct(latestPoint.revenue, latestPoint.netProfit)}%.`,
    ]
  }

  return {
    chartData,
    latestPoint,
    heroRevenue,
    heroExpenses,
    heroNetProfit,
    heroMargin: marginPct(heroRevenue, heroNetProfit),
    breakdownMargin: marginPct(latestPoint.revenue, latestPoint.netProfit),
    breakdownTitle,
    breakdownSubtitle,
    heroCaption,
    profitLaneLabel,
    trendLabel,
    trendValue,
    scopeLabel,
    insight,
    insightBullets,
  }
}

type OpTooltipProps = TooltipProps<number, string> & {
  payload?: Array<{ name?: string; value?: number; color?: string }>
  label?: string
}

function OperatingTooltip({ active, payload, label }: OpTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2 shadow-md ring-1 ring-black/[0.03]">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </div>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-6 text-[11px]">
            <span className="text-slate-500">{entry.name}</span>
            <span className="font-semibold tabular-nums text-slate-900">
              {formatFullCurrencyPreview(Number(entry.value ?? 0))}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

type ProfitTooltipProps = TooltipProps<number, string> & {
  payload?: Array<{ value?: number }>
  label?: string
}

function ProfitTooltip({ active, payload, label }: ProfitTooltipProps) {
  if (!active || !payload?.length) return null
  const value = Number(payload[0]?.value ?? 0)
  return (
    <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2 shadow-md ring-1 ring-black/[0.03]">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label} · Net profit
      </div>
      <div
        className="text-sm font-semibold tabular-nums"
        style={{ color: value >= 0 ? COLORS.profitPos : COLORS.profitNeg }}
      >
        {formatFullCurrencyPreview(value)}
      </div>
    </div>
  )
}

function BreakdownRow({
  label,
  value,
  emphasize,
  muted,
}: {
  label: string
  value: string
  emphasize?: boolean
  muted?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2.5 last:border-b-0">
      <span className={`text-xs ${muted ? "text-slate-400" : "text-slate-500"}`}>{label}</span>
      <span
        className={`text-right tabular-nums ${
          emphasize
            ? "text-sm font-semibold text-indigo-600"
            : "text-sm font-medium text-slate-800"
        }`}
      >
        {value}
      </span>
    </div>
  )
}

function FinancialStateStrip() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {FINANCIAL_STATE.map((card) => (
        <div
          key={card.key}
          className="relative overflow-hidden rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
        >
          <span
            className="absolute inset-y-3 left-0 w-[3px] rounded-r-full"
            style={{ backgroundColor: card.accent }}
            aria-hidden
          />
          <div className="pl-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {card.label}
            </div>
            <div className="mt-1 text-lg font-semibold tracking-tight tabular-nums text-slate-900">
              {formatFullCurrencyPreview(card.value)}
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-[10px] text-slate-400">{card.caption}</span>
              {card.trend ? (
                <span
                  className={`text-[10px] font-medium ${
                    card.trend.direction === "up" ? "text-emerald-600" : "text-amber-600"
                  }`}
                >
                  {card.trend.text}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function InsightCard({ text, bullets }: { text: string; bullets: string[] }) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3.5">
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600">
          Insight
        </span>
      </div>
      <p className="mt-2 text-[13px] font-medium leading-relaxed text-slate-700">{text}</p>
      <ul className="mt-3 space-y-1.5 border-t border-indigo-100/70 pt-3">
        {bullets.map((bullet) => (
          <li key={bullet} className="flex items-start gap-2 text-[11px] leading-snug text-slate-600">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-indigo-400" aria-hidden />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
      <p className="mt-auto pt-3 text-[10px] text-slate-400">
        Generated from this period&rsquo;s P&amp;L movement
      </p>
    </div>
  )
}

function ActionQueue() {
  const total = ACTION_ITEMS.reduce((s, item) => s + item.count, 0)
  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200/80 bg-white px-4 py-3.5">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Needs attention
        </h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
          {total} items
        </span>
      </div>
      <ul className="space-y-1.5">
        {ACTION_ITEMS.map((item) => {
          const tone = ACTION_TONE[item.tone]
          return (
            <li
              key={item.key}
              className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 transition-colors hover:bg-slate-50"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: tone.dot }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-slate-800">{item.title}</div>
                <div className="truncate text-[10px] text-slate-400">{item.detail}</div>
              </div>
              <span
                className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${tone.badge}`}
              >
                {item.count}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function PeriodSelector({
  mode,
  onChange,
}: {
  mode: PeriodMode
  onChange: (mode: PeriodMode) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200/80 bg-slate-50 p-0.5">
      {PERIOD_MODES.map((option) => {
        const active = mode === option.id
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
              active
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export default function DashboardPreviewPage() {
  const [periodMode, setPeriodMode] = useState<PeriodMode>("monthly")
  const view = useMemo(() => buildPeriodView(periodMode), [periodMode])

  const profitable = view.heroNetProfit >= 0

  return (
    <div className="min-h-screen bg-slate-100/80 px-4 py-10">
      <div className="mx-auto w-full max-w-[1160px] space-y-4">
        {/* Section heading */}
        <div className="flex items-end justify-between px-0.5">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">
              Financial overview
            </h1>
            <p className="mt-0.5 text-xs text-slate-400">
              State, performance, and what needs attention
            </p>
          </div>
          <span className="hidden text-[11px] text-slate-400 sm:block">As of Jun 30</span>
        </div>

        {/* 1. Financial state strip */}
        <FinancialStateStrip />

        {/* 2. P&L performance panel (central feature) */}
        <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_28px_-8px_rgba(15,23,42,0.12)]">
          {/* Header */}
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-base font-semibold tracking-tight text-slate-900">
                Revenue vs Expenses
              </h1>
              <p className="mt-0.5 text-xs text-slate-400">Profit and loss performance</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <PeriodSelector mode={periodMode} onChange={setPeriodMode} />
              <span
                className={`rounded-md border px-2.5 py-1 text-[11px] font-medium ${
                  profitable
                    ? "border-emerald-200/80 bg-emerald-50 text-emerald-700"
                    : "border-red-200/80 bg-red-50 text-red-700"
                }`}
              >
                {profitable ? "Profitable period" : "Loss period"}
              </span>
            </div>
          </div>

          {/* Hero summary */}
          <div className="border-b border-slate-100 px-5 py-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Net profit
                  </span>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600">
                    {view.heroMargin}% margin
                  </span>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                    · {view.scopeLabel}
                  </span>
                </div>
                <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums text-slate-900">
                  {formatFullCurrencyPreview(view.heroNetProfit)}
                </p>
                <p className="mt-2 text-xs text-slate-400">{view.heroCaption}</p>
              </div>

              <div className="flex divide-x divide-slate-200 rounded-lg border border-slate-200/80 bg-slate-50/60">
                <div className="px-4 py-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Revenue
                  </div>
                  <div className="mt-0.5 text-base font-semibold tabular-nums text-slate-800">
                    {formatFullCurrencyPreview(view.heroRevenue)}
                  </div>
                </div>
                <div className="px-4 py-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Expenses
                  </div>
                  <div className="mt-0.5 text-base font-semibold tabular-nums text-slate-800">
                    {formatFullCurrencyPreview(view.heroExpenses)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Main body */}
          <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1fr_320px]">
            <div className="border-b border-slate-100 px-4 py-4 lg:border-b-0 lg:border-r lg:px-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-4 text-[11px] font-medium text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-[2px]"
                      style={{ backgroundColor: COLORS.revenue }}
                    />
                    Revenue
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-[2px]"
                      style={{ backgroundColor: COLORS.expenses }}
                    />
                    Expenses
                  </span>
                </div>
                <span className="text-[11px] text-slate-400">
                  {periodMode === "ytd" ? "Cumulative operating activity" : "Operating activity"}
                </span>
              </div>

              <div className="h-[168px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={view.chartData}
                    margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                    barGap={3}
                    barCategoryGap={periodMode === "quarterly" ? "32%" : "22%"}
                  >
                    <CartesianGrid strokeDasharray="2 5" stroke="#eef2f6" vertical={false} />
                    <XAxis dataKey="label" hide />
                    <YAxis
                      stroke="transparent"
                      tick={{ fill: "#94a3b8", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      tickCount={4}
                      width={42}
                      tickFormatter={(v: number) => formatCompactCurrencyPreview(v)}
                    />
                    <Tooltip
                      content={<OperatingTooltip />}
                      cursor={{ fill: "rgba(15,23,42,0.03)" }}
                      wrapperStyle={{ outline: "none" }}
                    />
                    <Bar
                      dataKey="revenue"
                      name="Revenue"
                      fill={COLORS.revenue}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={periodMode === "quarterly" ? 44 : 36}
                    />
                    <Bar
                      dataKey="expenses"
                      name="Expenses"
                      fill={COLORS.expenses}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={periodMode === "quarterly" ? 44 : 36}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-3 rounded-xl border border-slate-200/70 bg-slate-50/50 px-3 pb-2 pt-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-600">
                    {view.profitLaneLabel}
                  </span>
                  <span className="text-[10px] text-slate-400">Signed outcome · hover for value</span>
                </div>
                <div className="h-[132px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={view.chartData}
                      margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
                      barCategoryGap={periodMode === "quarterly" ? "32%" : "22%"}
                    >
                      <CartesianGrid strokeDasharray="2 5" stroke="#eef2f6" vertical={false} />
                      <ReferenceLine y={0} stroke="#cbd5e1" strokeWidth={1.25} />
                      <XAxis
                        dataKey="label"
                        stroke="transparent"
                        tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: 500 }}
                        tickLine={false}
                        axisLine={false}
                        interval={0}
                        height={20}
                      />
                      <YAxis
                        stroke="transparent"
                        tick={{ fill: "#94a3b8", fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                        tickCount={3}
                        width={42}
                        domain={[
                          (dataMin: number) => (dataMin < 0 ? dataMin * 1.3 : 0),
                          (dataMax: number) => (dataMax > 0 ? dataMax * 1.2 : 0),
                        ]}
                        tickFormatter={(v: number) => formatCompactCurrencyPreview(v)}
                      />
                      <Tooltip
                        content={<ProfitTooltip />}
                        cursor={{ fill: "rgba(79,70,229,0.04)" }}
                        wrapperStyle={{ outline: "none" }}
                      />
                      <Bar
                        dataKey="netProfit"
                        name="Net profit"
                        radius={[2, 2, 2, 2]}
                        maxBarSize={periodMode === "quarterly" ? 40 : 30}
                      >
                        {view.chartData.map((entry) => (
                          <Cell
                            key={entry.label}
                            fill={entry.netProfit >= 0 ? COLORS.profitPos : COLORS.profitNeg}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="bg-slate-50/40 px-5 py-4">
              <div className="mb-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {view.breakdownTitle}
                </h2>
                <p className="mt-0.5 text-[11px] text-slate-400">{view.breakdownSubtitle}</p>
              </div>

              <div className="rounded-lg border border-slate-200/70 bg-white px-4 py-1">
                <BreakdownRow
                  label="Revenue"
                  value={formatFullCurrencyPreview(view.latestPoint.revenue)}
                />
                <BreakdownRow
                  label="Expenses"
                  value={formatFullCurrencyPreview(view.latestPoint.expenses)}
                />
                <BreakdownRow
                  label="Net profit"
                  value={formatFullCurrencyPreview(view.latestPoint.netProfit)}
                  emphasize
                />
                <BreakdownRow
                  label="Net margin"
                  value={`${view.breakdownMargin}%`}
                  muted
                />
              </div>

              <div className="mt-4 space-y-2 border-t border-slate-200/60 pt-3">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">Period trend</span>
                  <span className="font-medium text-emerald-600">Improving</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">{view.trendLabel}</span>
                  <span className="font-medium tabular-nums text-slate-700">{view.trendValue}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Insight + action queue */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.4fr]">
          <InsightCard text={view.insight} bullets={view.insightBullets} />
          <ActionQueue />
        </div>
      </div>
    </div>
  )
}
