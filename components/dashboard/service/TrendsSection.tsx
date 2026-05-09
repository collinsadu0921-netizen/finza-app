"use client"

import { useMemo } from "react"
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  TooltipProps,
} from "recharts"
import { DEFAULT_PLATFORM_CURRENCY_CODE } from "@/lib/currency"
import { formatMoney } from "@/lib/money"

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
  /** Current period totals for breakdown panel */
  currentRevenue?: number
  currentExpenses?: number
  currentNetProfit?: number
  /** Human-readable label for the resolved period (e.g. "Mar '26"). */
  periodLabel?: string
  /** Whether the user explicitly selected a historical period in the cockpit. */
  selectedPeriodStart?: string | null
}

const SERIES_COLORS = {
  revenue: "#10b981",
  // Softer red (Tailwind red-400) so expense bars read clearly without dominating
  // the composition next to revenue and the Net Profit line.
  expenses: "#f87171",
  netProfit: "#3b82f6",
} as const

const LEGEND = [
  { key: "revenue", label: "Revenue", color: SERIES_COLORS.revenue },
  { key: "expenses", label: "Expenses", color: SERIES_COLORS.expenses },
  { key: "netProfit", label: "Net Profit", color: SERIES_COLORS.netProfit },
] as const

type CustomTooltipProps = TooltipProps<number, string> & {
  payload?: Array<{ payload?: Record<string, unknown> }>
  label?: string
  currencyCode: string
}

function CustomTooltip({
  active,
  payload,
  label,
  currencyCode,
}: CustomTooltipProps) {
  if (!active || !payload?.length || label == null) return null
  const p = payload[0]?.payload as Record<string, unknown> | undefined
  if (!p) return null

  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2.5 shadow-md dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
        {label}
      </div>
      <div className="space-y-1.5">
        <TooltipRow
          shape="square"
          color={SERIES_COLORS.revenue}
          label="Revenue"
          value={Number(p.revenue ?? 0)}
          currencyCode={currencyCode}
        />
        <TooltipRow
          shape="square"
          color={SERIES_COLORS.expenses}
          label="Expenses"
          value={Number(p.expenses ?? 0)}
          currencyCode={currencyCode}
        />
        <TooltipRow
          shape="line"
          color={SERIES_COLORS.netProfit}
          label="Net Profit"
          value={Number(p.netProfit ?? 0)}
          currencyCode={currencyCode}
        />
      </div>
    </div>
  )
}

function TooltipRow({
  shape,
  color,
  label,
  value,
  currencyCode,
}: {
  shape: "square" | "line"
  color: string
  label: string
  value: number
  currencyCode: string
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {shape === "line" ? (
        <span
          className="h-0.5 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      ) : (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: color }}
        />
      )}
      <span className="text-gray-600 dark:text-gray-400">{label}</span>
      <span className="ml-auto tabular-nums font-medium text-gray-900 dark:text-white">
        {formatMoney(value, currencyCode)}
      </span>
    </div>
  )
}

export default function TrendsSection({
  data,
  currencyCode = DEFAULT_PLATFORM_CURRENCY_CODE,
  currentRevenue = 0,
  currentExpenses = 0,
  currentNetProfit = 0,
  periodLabel,
  selectedPeriodStart,
}: TrendsSectionProps) {
  const chartData = useMemo(
    () => data.map((d) => ({ ...d, name: d.label })),
    [data]
  )

  // Compact axis number formatter — no currency code on Y-axis ticks.
  // Currency is preserved in tooltip and breakdown panel.
  const compactNumberFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        notation: "compact",
        maximumFractionDigits: 1,
      }),
    []
  )

  // Point-count-aware X-axis tick density.
  //   <=  6 → every label
  //    7–12 → every 2nd label
  //   13–60 → every 6th label
  //    >60 → ~12 labels (≈monthly cadence on V2 daily timelines)
  const xAxisInterval = useMemo<number>(() => {
    const n = chartData.length
    if (n <= 6) return 0
    if (n <= 12) return 1
    if (n <= 60) return 5
    return Math.max(0, Math.ceil(n / 12) - 1)
  }, [chartData.length])

  // Show per-point dots on the Net Profit line only when the timeline is
  // sparse enough for them to read individually.
  const showNetProfitDots = chartData.length <= 24

  // Net Profit lives on its own hidden right Y-axis ("profit"). The bars stay on
  // the visible left currency axis ("money"). This domain controls how the line
  // is positioned vertically — it does NOT change reported netProfit values
  // (tooltip and summary panel always show the real numbers).
  //
  // Logic:
  //   - if no finite values, fall back to [-1, 1]
  //   - if all values are equal, return [v - 1, v + 1] so the line still renders
  //   - otherwise pad the [min, max] range by max(range * 0.18, 1)
  const netProfitDomain = useMemo<[number, number]>(() => {
    const values = chartData
      .map((d) => Number(d.netProfit))
      .filter((v) => Number.isFinite(v))
    if (values.length === 0) return [-1, 1]
    const minProfit = Math.min(...values)
    const maxProfit = Math.max(...values)
    if (minProfit === maxProfit) {
      return [minProfit - 1, maxProfit + 1]
    }
    const range = maxProfit - minProfit
    const padding = Math.max(range * 0.18, 1)
    return [minProfit - padding, maxProfit + padding]
  }, [chartData])

  const headingText = useMemo(() => {
    const safeLabel = periodLabel && periodLabel !== "—" ? periodLabel : null
    if (!safeLabel) return "Current period"
    return selectedPeriodStart
      ? `Selected period — ${safeLabel}`
      : `Current period — ${safeLabel}`
  }, [periodLabel, selectedPeriodStart])

  const breakdown = useMemo(
    () => [
      {
        label: "Revenue",
        value: currentRevenue,
        color: "text-emerald-600 dark:text-emerald-400",
      },
      {
        label: "Expenses",
        value: currentExpenses,
        color: "text-red-600 dark:text-red-400",
      },
      {
        label: "Net profit",
        value: currentNetProfit,
        color:
          currentNetProfit >= 0
            ? "text-blue-600 dark:text-blue-400"
            : "text-red-600 dark:text-red-400",
      },
    ],
    [currentRevenue, currentExpenses, currentNetProfit]
  )

  // Display-only insight string. No accounting math; pure UI signposting.
  const insightText = useMemo<string | null>(() => {
    if (currentRevenue === 0 && currentExpenses > 0) {
      return "Expenses were recorded for this period, but no revenue was recorded."
    }
    if (currentRevenue > 0 && currentNetProfit < 0) {
      return "Expenses are higher than revenue for this period."
    }
    if (currentRevenue > 0 && currentNetProfit >= 0) {
      return "Revenue is covering expenses for this period."
    }
    return null
  }, [currentRevenue, currentExpenses, currentNetProfit])

  return (
    <div className="w-full rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/80">
      <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Financial Trends
          </h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            Revenue, expenses, and profit movement
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {LEGEND.map((s) => (
            <span
              key={s.key}
              className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
            >
              {s.key === "netProfit" ? (
                <span
                  className="h-0.5 w-3 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
              ) : (
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: s.color }}
                />
              )}
              {s.label}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-stretch lg:gap-6">
        {/* Chart column — gets visual priority via flex-1 + min-w-0 */}
        <div className="h-[280px] w-full flex-1 min-w-0">
          {chartData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
              No trend data for this period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 12, right: 8, left: 0, bottom: 8 }}
                barCategoryGap="25%"
                barGap={2}
              >
                <CartesianGrid
                  strokeDasharray="2 4"
                  stroke="#e5e7eb"
                  vertical={false}
                  className="dark:stroke-gray-700"
                />
                <XAxis
                  dataKey="name"
                  stroke="transparent"
                  tick={{ fill: "#6b7280", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  interval={xAxisInterval}
                  minTickGap={24}
                />
                {/* Visible currency axis used by Revenue and Expenses bars. */}
                <YAxis
                  yAxisId="money"
                  stroke="transparent"
                  tick={{ fill: "#6b7280", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tickFormatter={(v: unknown) => {
                    const num =
                      typeof v === "number" && Number.isFinite(v) ? v : 0
                    return compactNumberFormatter.format(num)
                  }}
                />
                {/*
                  Hidden right axis used only by the Net Profit line. The line is
                  a visual overlay that floats across the chart based on its own
                  domain — it does not share scale with the bars. width={0} +
                  hide ensures this axis reserves no layout slot, so the plot
                  area width stays driven by the left "money" axis only.
                */}
                <YAxis
                  yAxisId="profit"
                  orientation="right"
                  hide
                  width={0}
                  tick={false}
                  axisLine={false}
                  tickLine={false}
                  domain={netProfitDomain}
                />
                <ReferenceLine
                  yAxisId="money"
                  y={0}
                  stroke="#6b7280"
                  strokeOpacity={0.6}
                  strokeWidth={1}
                  ifOverflow="extendDomain"
                />
                <Tooltip
                  content={(props: TooltipProps<number, string>) => (
                    <CustomTooltip
                      {...props}
                      currencyCode={currencyCode}
                    />
                  )}
                  cursor={{ fill: "rgba(0,0,0,0.04)" }}
                />
                <Bar
                  yAxisId="money"
                  dataKey="revenue"
                  fill={SERIES_COLORS.revenue}
                  radius={[2, 2, 0, 0]}
                  maxBarSize={14}
                  isAnimationActive={false}
                />
                <Bar
                  yAxisId="money"
                  dataKey="expenses"
                  fill={SERIES_COLORS.expenses}
                  radius={[2, 2, 0, 0]}
                  maxBarSize={14}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="profit"
                  type="monotone"
                  dataKey="netProfit"
                  stroke={SERIES_COLORS.netProfit}
                  strokeWidth={2}
                  dot={
                    showNetProfitDots
                      ? { r: 3, strokeWidth: 0, fill: SERIES_COLORS.netProfit }
                      : false
                  }
                  activeDot={{
                    r: 4,
                    strokeWidth: 0,
                    fill: SERIES_COLORS.netProfit,
                  }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Compact summary panel */}
        <div className="w-full shrink-0 border-t border-gray-200 pt-4 dark:border-gray-700 lg:w-52 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {headingText}
          </p>
          <ul className="space-y-2">
            {breakdown.map((row) => (
              <li
                key={row.label}
                className="flex items-baseline justify-between gap-2 text-sm"
              >
                <span className="text-gray-600 dark:text-gray-400">
                  {row.label}
                </span>
                <span
                  className={`tabular-nums font-medium ${row.color}`}
                >
                  {formatMoney(row.value, currencyCode)}
                </span>
              </li>
            ))}
          </ul>
          {insightText && (
            <p className="mt-4 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {insightText}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
