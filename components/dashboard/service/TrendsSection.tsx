"use client"

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
import { DEFAULT_PLATFORM_CURRENCY_CODE } from "@/lib/currency"
import { formatMoney } from "@/lib/money"
import {
  buildQuarterlyChartPoints,
  formatShortDisplayDate,
  quarterAccessibleLabel,
  quarterMonthRangeLabel,
  resolveSelectedQuarterKey,
  type QuarterlyChartPoint,
} from "@/lib/dashboard/trendsQuarterUtils"
import DashboardExpensesInfo from "./DashboardExpensesInfo"

export type TimelinePoint = {
  period_start: string
  period_end: string
  label: string
  revenue: number
  expenses: number
  netProfit: number
  cashMovement?: number
}

export type TrendsSectionProps = {
  data: TimelinePoint[]
  currencyCode?: string
  /** Current period totals — used only as a fallback when no timeline exists. */
  currentRevenue?: number
  currentExpenses?: number
  currentNetProfit?: number
  /** Optional note when period KPIs come from ledger fallback instead of snapshot. */
  periodCaption?: string
  /** For expense-breakdown info popover (lazy-loaded). */
  businessId?: string
  /** Fallback period when timeline has no visible point (metrics period). */
  fallbackPeriodStart?: string
  fallbackPeriodEnd?: string
  /** Dashboard period picker — monthly hero/breakdown follow this when set. */
  dashboardPeriodStart?: string | null
  dashboardPeriodEnd?: string | null
}

type PeriodMode = "monthly" | "quarterly" | "ytd"

type ChartPoint = {
  label: string
  revenue: number
  expenses: number
  netProfit: number
  /** Present in quarterly mode — used for bar selection. */
  quarterKey?: string
}

const PERIOD_MODES: { id: PeriodMode; label: string }[] = [
  { id: "monthly", label: "Monthly" },
  { id: "quarterly", label: "Quarterly" },
  { id: "ytd", label: "YTD" },
]

const COLORS = {
  revenue: "#10b981",
  expenses: "#64748b",
  profitPos: "#4f46e5",
  profitNeg: "#dc2626",
} as const

/**
 * Monthly default window: the latest available (non-future) month plus up to
 * five previous months (6 max). Display-only — no calculation or query is
 * affected, and periods are never fabricated.
 */
const MONTHLY_WINDOW = 6

/** Current calendar month as a comparable "YYYY-MM" string (local time). */
function currentYearMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

/**
 * Returns the timeline sorted chronologically with future-dated periods
 * removed. Anchors on real data only — if every period is future-dated, falls
 * back to the full sorted list rather than inventing or dropping all data.
 */
function sortedNonFuture(points: TimelinePoint[]): TimelinePoint[] {
  if (points.length === 0) return []
  const sorted = [...points].sort((a, b) =>
    a.period_start.localeCompare(b.period_start)
  )
  const currentYM = currentYearMonth()
  const notFuture = sorted.filter((p) => p.period_start.slice(0, 7) <= currentYM)
  return notFuture.length > 0 ? notFuture : sorted
}

/** Short, locale-aware month label (e.g. "May") derived from the period start. */
function shortMonthLabel(periodStart: string): string {
  const d = new Date(periodStart + "T12:00:00")
  if (Number.isNaN(d.getTime())) return periodStart
  return d.toLocaleDateString(undefined, { month: "short" })
}

/** Revenue below this is too small for a meaningful margin percentage. */
const MIN_MEANINGFUL_MARGIN_REVENUE = 1

type NetMarginDisplay = {
  value: number | null
  /** Hero margin badge — includes " margin" when meaningful. */
  label: string
  /** Breakdown table Net margin row. */
  shortLabel: string
}

/**
 * Display-only net margin. Keeps the formula correct internally but avoids
 * showing absurd percentages when revenue is negligible (e.g. ₵0.84 vs a
 * large loss). Single source for hero badge and breakdown row.
 */
function getNetMarginDisplay(revenue: number, netProfit: number): NetMarginDisplay {
  const unavailable: NetMarginDisplay = {
    value: null,
    label: "Margin not shown",
    shortLabel: "—",
  }

  if (!Number.isFinite(revenue) || Math.abs(revenue) < MIN_MEANINGFUL_MARGIN_REVENUE) {
    return unavailable
  }

  const margin = (netProfit / revenue) * 100

  if (!Number.isFinite(margin) || Math.abs(margin) > 999) {
    return unavailable
  }

  const rounded = Math.round(margin)
  return {
    value: margin,
    label: `${rounded}% margin`,
    shortLabel: `${rounded}%`,
  }
}

/**
 * Builds a cumulative year-to-date progression from the available months of the
 * latest year present in the timeline. Uses only real periods.
 */
function buildYtdCumulative(months: TimelinePoint[]): ChartPoint[] {
  if (months.length === 0) return []
  const latestYear = months[months.length - 1].period_start.slice(0, 4)
  const yearMonths = months.filter(
    (m) => m.period_start.slice(0, 4) === latestYear
  )
  let revenue = 0
  let expenses = 0
  let netProfit = 0
  return yearMonths.map((m) => {
    revenue += m.revenue
    expenses += m.expenses
    netProfit += m.netProfit
    return { label: shortMonthLabel(m.period_start), revenue, expenses, netProfit }
  })
}

type OperatingTooltipProps = TooltipProps<number, string> & {
  payload?: Array<{ name?: string; value?: number }>
  label?: string
  currencyCode: string
}

function OperatingTooltip({
  active,
  payload,
  label,
  currencyCode,
}: OperatingTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2 shadow-md ring-1 ring-black/[0.03]">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </div>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div
            key={entry.name}
            className="flex items-center justify-between gap-6 text-[11px]"
          >
            <span className="text-slate-500">{entry.name}</span>
            <span className="font-semibold tabular-nums text-slate-900">
              {formatMoney(Number(entry.value ?? 0), currencyCode)}
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
  currencyCode: string
}

function ProfitTooltip({ active, payload, label, currencyCode }: ProfitTooltipProps) {
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
        {formatMoney(value, currencyCode)}
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
      <span className={`text-xs ${muted ? "text-slate-400" : "text-slate-500"}`}>
        {label}
      </span>
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
            aria-pressed={active}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/90"
                : "text-slate-500 hover:bg-white/60 hover:text-slate-700"
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Accessible quarter controls synchronized with chart bar selection.
 * Recharts bars remain mouse/tooltip targets; these buttons provide keyboard + a11y.
 */
function AccessibleQuarterSelector({
  quarters,
  activeQuarterKey,
  onSelect,
}: {
  quarters: QuarterlyChartPoint[]
  activeQuarterKey: string | null
  onSelect: (key: string) => void
}) {
  if (quarters.length === 0) return null

  return (
    <div
      className="mt-2 flex flex-wrap gap-1.5"
      role="group"
      aria-label="Select quarter for breakdown"
    >
      {quarters.map((q) => {
        const selected = q.key === activeQuarterKey
        return (
          <button
            key={q.key}
            type="button"
            tabIndex={0}
            aria-label={quarterAccessibleLabel(q.year, q.quarter)}
            aria-pressed={selected}
            onClick={() => onSelect(q.key)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                onSelect(q.key)
              } else if (event.key === " ") {
                event.preventDefault()
                onSelect(q.key)
              }
            }}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${
              selected
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800"
            }`}
          >
            {q.label} {q.year}
            {q.isQuarterToDate ? " · QTD" : ""}
          </button>
        )
      })}
    </div>
  )
}

export default function TrendsSection({
  data,
  currencyCode = DEFAULT_PLATFORM_CURRENCY_CODE,
  currentRevenue = 0,
  currentExpenses = 0,
  currentNetProfit = 0,
  periodCaption,
  businessId,
  fallbackPeriodStart,
  fallbackPeriodEnd,
  dashboardPeriodStart,
  dashboardPeriodEnd,
}: TrendsSectionProps) {
  const [mode, setMode] = useState<PeriodMode>("monthly")
  const [selectedQuarterKey, setSelectedQuarterKey] = useState<string | null>(null)

  const handleModeChange = (next: PeriodMode) => {
    setMode(next)
    // Clear explicit quarter selection when leaving Quarterly so re-entry
    // re-seeds from the current dashboard period.
    if (next !== "quarterly") {
      setSelectedQuarterKey(null)
    }
  }

  const view = useMemo(() => {
    const nonFuture = sortedNonFuture(data)

    let chartData: ChartPoint[]
    let profitLaneLabel: string
    let breakdownTitle: string
    let breakdownSubtitle: string
    let scopeLabel: string
    let operatingCaption: string
    let breakdownSubtitleExtra: string | undefined
    let activeQuarterKey: string | null = null

    let selectedPeriodStart: string | undefined
    let selectedPeriodEnd: string | undefined

    const quarterlyPoints = buildQuarterlyChartPoints(nonFuture)

    if (mode === "monthly") {
      const windowMonths = nonFuture.slice(-MONTHLY_WINDOW)
      const dashboardMonth =
        dashboardPeriodStart != null && dashboardPeriodStart !== ""
          ? nonFuture.find((m) => m.period_start === dashboardPeriodStart) ?? null
          : null
      const latestMonth =
        dashboardMonth ??
        (windowMonths.length > 0 ? windowMonths[windowMonths.length - 1] : null)
      if (latestMonth) {
        selectedPeriodStart = latestMonth.period_start
        selectedPeriodEnd = latestMonth.period_end
      } else if (dashboardPeriodStart && dashboardPeriodEnd) {
        selectedPeriodStart = dashboardPeriodStart
        selectedPeriodEnd = dashboardPeriodEnd
      }
      chartData = windowMonths.map((m) => ({
        label: shortMonthLabel(m.period_start),
        revenue: m.revenue,
        expenses: m.expenses,
        netProfit: m.netProfit,
      }))
      profitLaneLabel = "Net profit by month"
      breakdownTitle = dashboardMonth
        ? `${shortMonthLabel(dashboardMonth.period_start)} breakdown`
        : "Latest breakdown"
      breakdownSubtitle = dashboardMonth
        ? `${shortMonthLabel(dashboardMonth.period_start)} summary`
        : "Latest month summary"
      scopeLabel = "Monthly"
      operatingCaption = "Revenue and expenses by month"
    } else if (mode === "quarterly") {
      activeQuarterKey = resolveSelectedQuarterKey(
        quarterlyPoints,
        selectedQuarterKey,
        dashboardPeriodStart
      )
      const selectedQuarter =
        quarterlyPoints.find((q) => q.key === activeQuarterKey) ??
        quarterlyPoints[quarterlyPoints.length - 1] ??
        null

      chartData = quarterlyPoints.map((q) => ({
        label: q.label,
        revenue: q.revenue,
        expenses: q.expenses,
        netProfit: q.netProfit,
        quarterKey: q.key,
      }))

      if (selectedQuarter) {
        // Popover + breakdown use effective range (QTD → latest timeline end).
        selectedPeriodStart = selectedQuarter.effectiveStart
        selectedPeriodEnd = selectedQuarter.effectiveEnd
      }

      profitLaneLabel = "Net profit by quarter"
      scopeLabel = "Quarterly"
      operatingCaption = "Select a quarter to inspect · revenue and expenses by quarter"

      if (selectedQuarter) {
        breakdownTitle = `Q${selectedQuarter.quarter} breakdown`
        if (selectedQuarter.isQuarterToDate) {
          breakdownSubtitle = `Quarter to date · ${quarterMonthRangeLabel(selectedQuarter.year, selectedQuarter.quarter)}`
          breakdownSubtitleExtra = `Data through ${formatShortDisplayDate(selectedQuarter.dataThroughEnd)}`
        } else {
          breakdownSubtitle = `${quarterMonthRangeLabel(selectedQuarter.year, selectedQuarter.quarter)} summary`
        }
      } else {
        breakdownTitle = "Latest breakdown"
        breakdownSubtitle = "Latest quarter summary"
      }
    } else {
      chartData = buildYtdCumulative(nonFuture)
      if (nonFuture.length > 0) {
        const latestYear = nonFuture[nonFuture.length - 1].period_start.slice(0, 4)
        const yearMonths = nonFuture.filter(
          (m) => m.period_start.slice(0, 4) === latestYear
        )
        if (yearMonths.length > 0) {
          selectedPeriodStart = yearMonths[0].period_start
          selectedPeriodEnd = yearMonths[yearMonths.length - 1].period_end
        }
      }
      profitLaneLabel = "Cumulative net profit"
      breakdownTitle = "YTD breakdown"
      breakdownSubtitle = "Year-to-date summary"
      scopeLabel = "YTD"
      operatingCaption = "Cumulative revenue and expenses"
    }

    const latestPoint = chartData.length > 0 ? chartData[chartData.length - 1] : null

    const dashboardTimelineMonth =
      mode === "monthly" && dashboardPeriodStart
        ? nonFuture.find((m) => m.period_start === dashboardPeriodStart)
        : null

    const selectedQuarter =
      mode === "quarterly" && activeQuarterKey
        ? quarterlyPoints.find((q) => q.key === activeQuarterKey) ?? null
        : null

    const selectedRevenue = dashboardTimelineMonth
      ? dashboardTimelineMonth.revenue
      : selectedQuarter
        ? selectedQuarter.revenue
        : latestPoint
          ? latestPoint.revenue
          : currentRevenue
    const selectedExpenses = dashboardTimelineMonth
      ? dashboardTimelineMonth.expenses
      : selectedQuarter
        ? selectedQuarter.expenses
        : latestPoint
          ? latestPoint.expenses
          : currentExpenses
    const selectedNetProfit = dashboardTimelineMonth
      ? dashboardTimelineMonth.netProfit
      : selectedQuarter
        ? selectedQuarter.netProfit
        : latestPoint
          ? latestPoint.netProfit
          : currentNetProfit

    if (mode === "monthly") {
      if (dashboardTimelineMonth) {
        breakdownTitle = `${shortMonthLabel(dashboardTimelineMonth.period_start)} breakdown`
      } else if (latestPoint) {
        breakdownTitle = `${latestPoint.label} breakdown`
      } else if (dashboardPeriodStart) {
        breakdownTitle = `${shortMonthLabel(dashboardPeriodStart)} breakdown`
      }
    } else if (mode === "ytd") {
      // breakdownTitle set in branch above
    } else if (!breakdownTitle) {
      breakdownTitle = latestPoint ? `${latestPoint.label} breakdown` : "Latest breakdown"
    }

    let footerLabel: string
    let footerValue: string
    if (mode === "ytd") {
      footerLabel = "YTD through"
      footerValue = latestPoint ? latestPoint.label : "—"
    } else {
      footerLabel = mode === "monthly" ? "Months profitable" : "Quarters profitable"
      const profitable = chartData.filter((p) => p.netProfit >= 0).length
      footerValue = `${profitable} of ${chartData.length}`
    }

    const marginDisplay = getNetMarginDisplay(selectedRevenue, selectedNetProfit)

    return {
      chartData,
      hasData: chartData.length > 0,
      selectedRevenue,
      selectedExpenses,
      selectedNetProfit,
      marginDisplay,
      breakdownTitle,
      breakdownSubtitle,
      profitLaneLabel,
      scopeLabel,
      operatingCaption,
      footerLabel,
      footerValue,
      selectedPeriodStart,
      selectedPeriodEnd,
      breakdownSubtitleExtra,
      activeQuarterKey,
      quarterlyPoints,
    }
  }, [
    data,
    mode,
    selectedQuarterKey,
    currentRevenue,
    currentExpenses,
    currentNetProfit,
    dashboardPeriodStart,
    dashboardPeriodEnd,
  ])

  const breakdownPeriodStart =
    mode === "quarterly"
      ? view.selectedPeriodStart ?? fallbackPeriodStart
      : dashboardPeriodStart ?? view.selectedPeriodStart ?? fallbackPeriodStart
  const breakdownPeriodEnd =
    mode === "quarterly"
      ? view.selectedPeriodEnd ?? fallbackPeriodEnd
      : dashboardPeriodEnd ?? view.selectedPeriodEnd ?? fallbackPeriodEnd

  const selectQuarter = (quarterKey: string) => {
    if (mode !== "quarterly") return
    setSelectedQuarterKey(quarterKey)
  }

  const handleQuarterBarClick = (barData: { payload?: ChartPoint }) => {
    const entry = barData?.payload
    if (!entry?.quarterKey) return
    selectQuarter(entry.quarterKey)
  }

  const quarterBarOpacity = (quarterKey?: string) => {
    if (mode !== "quarterly" || !quarterKey) return 1
    return quarterKey === view.activeQuarterKey ? 1 : 0.42
  }

  const expensesInfo = (
    <DashboardExpensesInfo
      businessId={businessId}
      periodStart={breakdownPeriodStart}
      periodEnd={breakdownPeriodEnd}
      displayTotal={view.selectedExpenses}
      currencyCode={currencyCode}
    />
  )

  // Profit/loss badge follows the SAME selected net profit used everywhere else.
  const profitable = view.selectedNetProfit >= 0
  const quarterly = mode === "quarterly"

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_28px_-8px_rgba(15,23,42,0.12)]">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:px-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-slate-900">
            Profit performance
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {periodCaption ?? "Revenue, expenses, and net profit for the selected period"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodSelector mode={mode} onChange={handleModeChange} />
          {view.hasData ? (
            <span
              className={`rounded-md border px-2.5 py-1 text-[11px] font-medium ${
                profitable
                  ? "border-emerald-200/80 bg-emerald-50 text-emerald-700"
                  : "border-red-200/80 bg-red-50 text-red-700"
              }`}
            >
              {profitable ? "Profitable period" : "Loss period"}
            </span>
          ) : null}
        </div>
      </div>

      {!view.hasData ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 px-5 py-10 text-center">
          <p className="text-sm font-medium text-slate-600">No profit trends to show yet</p>
          <p className="max-w-sm text-xs leading-relaxed text-slate-400">
            Send invoices and record expenses to see how your business performs over time.
          </p>
        </div>
      ) : (
        <>
          {/* Hero summary: net profit is the outcome; revenue/expenses support it */}
          <div
            className="border-b border-slate-100 px-4 py-4 sm:px-5"
            aria-label="Latest period profit summary"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Net profit
                  </span>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600">
                    {view.marginDisplay.label}
                  </span>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                    · {view.scopeLabel}
                  </span>
                </div>
                <p
                  className={`mt-1 text-3xl font-semibold tracking-tight tabular-nums ${
                    profitable ? "text-slate-900" : "text-red-600"
                  }`}
                >
                  {formatMoney(view.selectedNetProfit, currencyCode)}
                </p>
              </div>

              <div className="flex w-full flex-col divide-y divide-slate-200 rounded-lg border border-slate-200/80 bg-slate-50/60 sm:w-auto sm:flex-row sm:divide-x sm:divide-y-0">
                <div className="px-4 py-2.5 sm:min-w-[7.5rem]">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Revenue
                  </div>
                  <div className="mt-0.5 text-base font-semibold tabular-nums text-slate-800">
                    {formatMoney(view.selectedRevenue, currencyCode)}
                  </div>
                </div>
                <div className="px-4 py-2.5">
                  <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    <span>Expenses</span>
                    {expensesInfo}
                  </div>
                  <div className="mt-0.5 text-base font-semibold tabular-nums text-slate-800">
                    {formatMoney(view.selectedExpenses, currencyCode)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Main body: operating chart + net profit lane | breakdown table */}
          <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1fr_320px]">
            <div
              className="min-w-0 border-b border-slate-100 px-4 py-4 lg:border-b-0 lg:border-r lg:px-5"
              aria-label="Profit performance charts"
            >
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
                <span className="text-[11px] text-slate-400">{view.operatingCaption}</span>
              </div>

              {quarterly ? (
                <AccessibleQuarterSelector
                  quarters={view.quarterlyPoints}
                  activeQuarterKey={view.activeQuarterKey}
                  onSelect={selectQuarter}
                />
              ) : null}

              <div className="h-[156px] w-full min-w-0 sm:h-[168px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={view.chartData}
                    margin={{ top: 4, right: 4, left: 0, bottom: 4 }}
                    barGap={3}
                    barCategoryGap={quarterly ? "32%" : "22%"}
                  >
                    <CartesianGrid strokeDasharray="2 5" stroke="#eef2f6" vertical={false} />
                    <XAxis
                      dataKey="label"
                      stroke="transparent"
                      tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: 500 }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                      height={18}
                    />
                    <YAxis
                      stroke="transparent"
                      tick={{ fill: "#94a3b8", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      tickCount={4}
                      width={48}
                      tickFormatter={(v: number) => formatCompactMoney(v, currencyCode)}
                    />
                    <Tooltip
                      content={(props: TooltipProps<number, string>) => (
                        <OperatingTooltip {...props} currencyCode={currencyCode} />
                      )}
                      cursor={{ fill: "rgba(15,23,42,0.03)" }}
                      wrapperStyle={{ outline: "none" }}
                    />
                    <Bar
                      dataKey="revenue"
                      name="Revenue"
                      fill={COLORS.revenue}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={quarterly ? 44 : 36}
                      onClick={quarterly ? handleQuarterBarClick : undefined}
                    >
                      {quarterly
                        ? view.chartData.map((entry, index) => (
                            <Cell
                              key={`rev-${entry.quarterKey ?? index}`}
                              fill={COLORS.revenue}
                              fillOpacity={quarterBarOpacity(entry.quarterKey)}
                              stroke={
                                entry.quarterKey === view.activeQuarterKey ? "#047857" : "transparent"
                              }
                              strokeWidth={entry.quarterKey === view.activeQuarterKey ? 2 : 0}
                              cursor="pointer"
                            />
                          ))
                        : null}
                    </Bar>
                    <Bar
                      dataKey="expenses"
                      name="Expenses"
                      fill={COLORS.expenses}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={quarterly ? 44 : 36}
                      onClick={quarterly ? handleQuarterBarClick : undefined}
                    >
                      {quarterly
                        ? view.chartData.map((entry, index) => (
                            <Cell
                              key={`exp-${entry.quarterKey ?? index}`}
                              fill={COLORS.expenses}
                              fillOpacity={quarterBarOpacity(entry.quarterKey)}
                              stroke={
                                entry.quarterKey === view.activeQuarterKey ? "#334155" : "transparent"
                              }
                              strokeWidth={entry.quarterKey === view.activeQuarterKey ? 2 : 0}
                              cursor="pointer"
                            />
                          ))
                        : null}
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Separate signed net-profit outcome lane */}
              <div className="mt-3 rounded-xl border border-slate-200/70 bg-slate-50/50 px-3 pb-2 pt-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-600">
                    {view.profitLaneLabel}
                  </span>
                  <span className="hidden text-[10px] text-slate-400 sm:inline">
                    {quarterly
                      ? "Select a quarter above or click a bar"
                      : "Hover a bar for the amount"}
                  </span>
                </div>
                <div className="h-[120px] w-full min-w-0 sm:h-[132px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={view.chartData}
                      margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
                      barCategoryGap={quarterly ? "32%" : "22%"}
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
                        width={48}
                        domain={[
                          (dataMin: number) => (dataMin < 0 ? dataMin * 1.3 : 0),
                          (dataMax: number) => (dataMax > 0 ? dataMax * 1.2 : 0),
                        ]}
                        tickFormatter={(v: number) => formatCompactMoney(v, currencyCode)}
                      />
                      <Tooltip
                        content={(props: TooltipProps<number, string>) => (
                          <ProfitTooltip {...props} currencyCode={currencyCode} />
                        )}
                        cursor={{ fill: "rgba(79,70,229,0.04)" }}
                        wrapperStyle={{ outline: "none" }}
                      />
                      <Bar
                        dataKey="netProfit"
                        name="Net profit"
                        radius={[2, 2, 2, 2]}
                        maxBarSize={quarterly ? 40 : 30}
                        onClick={quarterly ? handleQuarterBarClick : undefined}
                      >
                        {view.chartData.map((entry, index) => (
                          <Cell
                            key={`${entry.label}-${index}`}
                            fill={entry.netProfit >= 0 ? COLORS.profitPos : COLORS.profitNeg}
                            fillOpacity={quarterBarOpacity(entry.quarterKey)}
                            stroke={
                              quarterly && entry.quarterKey === view.activeQuarterKey
                                ? entry.netProfit >= 0
                                  ? "#3730a3"
                                  : "#b91c1c"
                                : "transparent"
                            }
                            strokeWidth={
                              quarterly && entry.quarterKey === view.activeQuarterKey ? 2 : 0
                            }
                            cursor={quarterly ? "pointer" : "default"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Selected-period breakdown */}
            <div className="bg-slate-50/40 px-4 py-4 sm:px-5" aria-label="Period breakdown">
              <div className="mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {view.breakdownTitle}
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-400">{view.breakdownSubtitle}</p>
                {view.breakdownSubtitleExtra ? (
                  <p className="mt-0.5 text-[11px] text-slate-400">{view.breakdownSubtitleExtra}</p>
                ) : null}
              </div>

              <div className="rounded-lg border border-slate-200/70 bg-white px-4 py-1">
                <BreakdownRow
                  label="Revenue"
                  value={formatMoney(view.selectedRevenue, currencyCode)}
                />
                <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2.5">
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <span>Expenses</span>
                    {expensesInfo}
                  </span>
                  <span className="text-right text-sm font-medium tabular-nums text-slate-800">
                    {formatMoney(view.selectedExpenses, currencyCode)}
                  </span>
                </div>
                <BreakdownRow
                  label="Net profit"
                  value={formatMoney(view.selectedNetProfit, currencyCode)}
                  emphasize
                />
                <BreakdownRow label="Net margin" value={view.marginDisplay.shortLabel} muted />
              </div>

              <div className="mt-4 space-y-2 border-t border-slate-200/60 pt-3">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">{view.footerLabel}</span>
                  <span className="font-medium tabular-nums text-slate-700">
                    {view.footerValue}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Compact currency for axis ticks (e.g. "$12k", "$1.2M"). Reuses the production
 * `formatMoney` formatter so the currency symbol is never hard-coded.
 */
function formatCompactMoney(value: number, currencyCode: string): string {
  const num = typeof value === "number" && !Number.isNaN(value) ? value : 0
  const abs = Math.abs(num)
  if (abs >= 1_000_000) {
    return formatMoney(num / 1_000_000, currencyCode).replace(/\.\d+$/, "") + "M"
  }
  if (abs >= 1000) {
    return formatMoney(num / 1000, currencyCode).replace(/\.\d+$/, "") + "k"
  }
  return formatMoney(num, currencyCode).replace(/\.\d{2}$/, "")
}
