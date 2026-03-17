"use client"

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
import { formatMoney } from "@/lib/money"

const safeNumber = (v: unknown): number =>
  typeof v === "number" && !Number.isNaN(v) ? v : 0

const REVENUE_COLOR = "#16a34a"
const COST_COLOR = "#dc2626"
const NET_COLOR = "#1e3a8a"
const GRID_STROKE = "#e5e7eb"

export type RawChartPoint = {
  name: string
  amount?: number
  revenue?: number
  cost?: number
  net?: number
}

export type ExecutiveFinancialFlowChartProps = {
  rawChartData: RawChartPoint[]
  revenueTotal: number
  costTotal: number
  currencyCode?: string
  loading?: boolean
}

type ChartPoint = {
  name: string
  revenue: number
  cost: number
  costBar: number
  net: number
}

type ExecutiveTooltipProps = TooltipProps<number, string> & {
  payload?: Array<{ payload?: ChartPoint }>
  label?: string
  currencyCode: string
}
function FinancialFlowTooltip({
  active,
  payload,
  label,
  currencyCode,
}: ExecutiveTooltipProps) {
  if (!active || !payload?.length || label == null) return null
  const p = payload[0]?.payload as ChartPoint | undefined
  if (!p) return null
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-lg">
      <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
        {label}
      </div>
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: REVENUE_COLOR }} />
          <span className="text-gray-600">Revenue:</span>
          <span className="font-medium tabular-nums">{formatMoney(p.revenue, currencyCode)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: COST_COLOR }} />
          <span className="text-gray-600">Costs:</span>
          <span className="font-medium tabular-nums">{formatMoney(p.cost, currencyCode)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: NET_COLOR }} />
          <span className="text-gray-600">Net:</span>
          <span className="font-medium tabular-nums">{formatMoney(p.net, currencyCode)}</span>
        </div>
      </div>
    </div>
  )
}

function deriveChartData(raw: RawChartPoint[]): ChartPoint[] {
  return raw.map((d) => {
    const revenue = safeNumber(d.revenue ?? d.amount)
    const cost = safeNumber(d.cost)
    const net = d.net !== undefined ? safeNumber(d.net) : revenue - cost
    return { name: d.name, revenue, cost, costBar: -cost, net }
  })
}

function computeDomain(chartData: ChartPoint[]): [number, number] {
  if (chartData.length === 0) return [-100, 100]
  let maxVal = 0
  let minVal = 0
  for (const d of chartData) {
    maxVal = Math.max(maxVal, d.revenue, Math.abs(d.net))
    minVal = Math.min(minVal, d.costBar, d.net)
  }
  const padding = Math.max(maxVal, Math.abs(minVal)) * 0.12 || 10
  return [minVal - padding, maxVal + padding]
}

export default function ExecutiveFinancialFlowChart({
  rawChartData,
  revenueTotal,
  costTotal,
  currencyCode = "GHS",
  loading = false,
}: ExecutiveFinancialFlowChartProps) {
  const chartData = deriveChartData(rawChartData ?? [])
  const netTotal = safeNumber(revenueTotal) - safeNumber(costTotal)
  const hasData = chartData.length > 0
  const domain = computeDomain(chartData)

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header: title + subtitle + legend */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 bg-gray-50/80 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-gray-900">
            Financial Flow
          </h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Revenue vs costs · This month
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-6 text-xs font-medium text-gray-600">
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: REVENUE_COLOR }} />
            Revenue
          </span>
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COST_COLOR }} />
            Costs
          </span>
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: NET_COLOR }} />
            Net
          </span>
        </div>
      </div>

      {/* KPI row: three distinct blocks */}
      <div className="grid grid-cols-3 gap-px bg-gray-100">
        <div className="bg-white px-6 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
            Revenue
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight" style={{ color: REVENUE_COLOR }}>
            {formatMoney(revenueTotal, currencyCode)}
          </p>
        </div>
        <div className="bg-white px-6 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
            Costs
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight" style={{ color: COST_COLOR }}>
            {formatMoney(costTotal, currencyCode)}
          </p>
        </div>
        <div className="bg-white px-6 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
            Net Profit
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight" style={{ color: NET_COLOR }}>
            {formatMoney(netTotal, currencyCode)}
          </p>
        </div>
      </div>

      {/* Chart zone: clearly separated area */}
      <div className="p-6 pt-4">
        <div className="rounded-lg bg-gray-50/50 p-4">
          {loading ? (
            <div className="flex h-[340px] items-center justify-center rounded-lg bg-white">
              <div className="h-8 w-32 animate-pulse rounded bg-gray-200" />
            </div>
          ) : !hasData ? (
            <div className="flex h-[340px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-white">
              <p className="max-w-xs text-center text-sm text-gray-500">
                Financial data will appear once invoices or expenses are recorded.
              </p>
            </div>
          ) : (
            <div className="h-[340px] w-full">
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart
                  data={chartData}
                  margin={{ top: 20, right: 20, left: 12, bottom: 20 }}
                  barCategoryGap="14%"
                  barGap={6}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={GRID_STROKE}
                    vertical={false}
                  />
                  <ReferenceLine y={0} stroke="#9ca3af" strokeWidth={1.5} />
                  <XAxis
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "#6b7280", fontSize: 11 }}
                    interval={0}
                    tickMargin={12}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "#6b7280", fontSize: 11 }}
                    width={54}
                    domain={domain}
                    tickFormatter={(value: unknown) => {
                      const num = safeNumber(value)
                      if (num >= 1000) return `${(num / 1000).toFixed(0)}k`
                      if (num <= -1000) return `-${(Math.abs(num) / 1000).toFixed(0)}k`
                      return String(Math.round(num))
                    }}
                  />
                  <Tooltip
                    content={(props: ExecutiveTooltipProps) => (
                      <FinancialFlowTooltip {...props} currencyCode={currencyCode} />
                    )}
                    cursor={{ stroke: "#d1d5db", strokeWidth: 1 }}
                  />
                  <Bar
                    dataKey="revenue"
                    fill={REVENUE_COLOR}
                    radius={[4, 4, 0, 0]}
                    barSize={32}
                    isAnimationActive
                    animationDuration={400}
                  />
                  <Bar
                    dataKey="costBar"
                    fill={COST_COLOR}
                    radius={[0, 0, 4, 4]}
                    barSize={32}
                    isAnimationActive
                    animationDuration={400}
                  />
                  <Line
                    type="monotone"
                    dataKey="net"
                    stroke={NET_COLOR}
                    strokeWidth={2.5}
                    dot={false}
                    isAnimationActive
                    animationDuration={400}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
