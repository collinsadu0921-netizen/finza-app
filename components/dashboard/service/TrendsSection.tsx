"use client"

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  TooltipProps,
} from "recharts"
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
}

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
    <div className="rounded border border-gray-200 bg-white px-3 py-2.5 shadow-lg dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">{label}</div>
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-emerald-500" />
          <span className="text-gray-600 dark:text-gray-400">Revenue</span>
          <span className="ml-auto tabular-nums font-medium text-gray-900 dark:text-white">
            {formatMoney(Number(p.revenue ?? 0), currencyCode)}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-red-400" />
          <span className="text-gray-600 dark:text-gray-400">Expenses</span>
          <span className="ml-auto tabular-nums font-medium text-gray-900 dark:text-white">
            {formatMoney(Number(p.expenses ?? 0), currencyCode)}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-blue-500" />
          <span className="text-gray-600 dark:text-gray-400">Net Profit</span>
          <span className="ml-auto tabular-nums font-medium text-gray-900 dark:text-white">
            {formatMoney(Number(p.netProfit ?? 0), currencyCode)}
          </span>
        </div>
      </div>
    </div>
  )
}

const LEGEND = [
  { key: "revenue", label: "Revenue", color: "#10b981" },
  { key: "expenses", label: "Expenses", color: "#f87171" },
  { key: "netProfit", label: "Net Profit", color: "#3b82f6" },
] as const

export default function TrendsSection({
  data,
  currencyCode = "USD",
  currentRevenue = 0,
  currentExpenses = 0,
  currentNetProfit = 0,
}: TrendsSectionProps) {
  const chartData = data.map((d) => ({ ...d, name: d.label }))

  const breakdown = [
    { label: "Revenue", value: currentRevenue, color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Expenses", value: currentExpenses, color: "text-red-500 dark:text-red-400" },
    {
      label: "Net profit",
      value: currentNetProfit,
      color:
        currentNetProfit >= 0
          ? "text-blue-600 dark:text-blue-400"
          : "text-red-600 dark:text-red-400",
    },
  ]

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/80">
      <div className="flex flex-col gap-3 border-b border-gray-200 p-4 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Trends
        </h2>
        {/* Series legend */}
        <div className="flex items-center gap-4">
          {LEGEND.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row">
        <div className="min-h-[240px] flex-1 p-4">
          {chartData.length === 0 ? (
            <div className="flex h-60 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
              No trend data for this period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 8, left: -8, bottom: 8 }}
                barCategoryGap="30%"
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
                />
                <YAxis
                  stroke="transparent"
                  tick={{ fill: "#6b7280", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: unknown) => {
                    const num = typeof v === "number" && !Number.isNaN(v) ? v : 0
                    const abs = Math.abs(num)
                    if (abs >= 1_000_000) {
                      return formatMoney(num / 1_000_000, currencyCode).replace(/\.\d+$/, "") + "M"
                    }
                    if (abs >= 1000) {
                      return formatMoney(num / 1000, currencyCode).replace(/\.\d+$/, "") + "k"
                    }
                    return formatMoney(num, currencyCode).replace(/\.\d{2}$/, "")
                  }}
                  width={60}
                />
                <Tooltip
                  content={(props: TooltipProps<number, string>) => (
                    <CustomTooltip {...props} currencyCode={currencyCode} />
                  )}
                  cursor={{ fill: "rgba(0,0,0,0.04)" }}
                />
                <Bar dataKey="revenue" fill="#10b981" radius={[2, 2, 0, 0]} maxBarSize={14} isAnimationActive animationDuration={400} />
                <Bar dataKey="expenses" fill="#f87171" radius={[2, 2, 0, 0]} maxBarSize={14} isAnimationActive animationDuration={400} />
                <Bar dataKey="netProfit" fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={14} isAnimationActive animationDuration={400} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="w-full border-t border-gray-200 lg:w-56 lg:border-t-0 lg:border-l dark:border-gray-700">
          <div className="p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Current period
            </p>
            <ul className="space-y-2">
              {breakdown.map((row) => (
                <li key={row.label} className="flex justify-between gap-2 text-sm">
                  <span className="text-gray-600 dark:text-gray-400">{row.label}</span>
                  <span className={`tabular-nums font-medium ${row.color}`}>
                    {formatMoney(row.value, currencyCode)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
