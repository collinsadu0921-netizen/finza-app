"use client"

import { useState } from "react"
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
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

export type FinancialFlowChartProps = {
  data: TimelinePoint[]
  currencyCode?: string
  showCash?: boolean
}

type FinancialFlowTooltipProps = TooltipProps<number, string> & {
  payload?: Array<{ payload?: Record<string, unknown> }>
  label?: string
  currencyCode: string
  showCash: boolean
}
function FinancialFlowTooltip({
  active,
  payload,
  label,
  currencyCode,
  showCash,
}: FinancialFlowTooltipProps) {
  if (!active || !payload?.length || label == null) return null
  const p = payload[0]?.payload as Record<string, unknown>
  if (!p) return null
  return (
    <div
      className="rounded-lg border border-gray-200 bg-white p-3 shadow-md dark:border-gray-700 dark:bg-gray-800"
      style={{ fontSize: "0.875rem" }}
    >
      <div className="font-medium text-gray-700 dark:text-gray-200 mb-2">{label}</div>
      <div className="space-y-1 text-gray-600 dark:text-gray-400">
        <div>Revenue: {formatMoney(Number(p.revenue ?? 0), currencyCode)}</div>
        <div>Expenses: {formatMoney(Number(p.expenses ?? 0), currencyCode)}</div>
        <div>Profit: {formatMoney(Number(p.netProfit ?? 0), currencyCode)}</div>
        {showCash && (
          <div>Cash Movement: {formatMoney(Number(p.cashMovement ?? 0), currencyCode)}</div>
        )}
      </div>
    </div>
  )
}

export default function FinancialFlowChart({
  data,
  currencyCode = "USD",
  showCash = false,
}: FinancialFlowChartProps) {
  const [showRevenue, setShowRevenue] = useState(true)
  const [showExpenses, setShowExpenses] = useState(true)
  const [showProfit, setShowProfit] = useState(true)
  const [showCashLine, setShowCashLine] = useState(false)

  const chartData = data.map((d) => ({
    ...d,
    name: d.label,
  }))

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-6 shadow-sm dark:border-gray-700/80 dark:bg-gray-800/80">
      <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
        Financial flow
      </h2>
      <div className="mb-4 flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showRevenue}
            onChange={(e) => setShowRevenue(e.target.checked)}
            className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span className="text-emerald-700 dark:text-emerald-400">Revenue</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showExpenses}
            onChange={(e) => setShowExpenses(e.target.checked)}
            className="rounded border-gray-300 text-red-600 focus:ring-red-500"
          />
          <span className="text-red-700 dark:text-red-400">Expenses</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showProfit}
            onChange={(e) => setShowProfit(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-blue-700 dark:text-blue-400">Profit</span>
        </label>
        {showCash && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showCashLine}
              onChange={(e) => setShowCashLine(e.target.checked)}
              className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
            />
            <span className="text-amber-700 dark:text-amber-400">Cash</span>
          </label>
        )}
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 8, right: 8, left: -8, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="2 4" stroke="#e5e7eb" className="dark:stroke-gray-700" vertical={false} />
            <XAxis
              dataKey="name"
              stroke="transparent"
              tick={{ fill: "#9ca3af", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="transparent"
              tick={{ fill: "#9ca3af", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: unknown) => {
                const num = typeof v === "number" && !Number.isNaN(v) ? v : 0
                const formatted = formatMoney(num, currencyCode)
                return formatted.replace(/[\d,]+\.\d{2}/, (m) =>
                  Number(m) >= 1000 ? `${(Number(m) / 1000).toFixed(0)}k` : m
                )
              }}
              width={48}
            />
            <Tooltip
              content={(props: TooltipProps<number, string>) => (
                <FinancialFlowTooltip
                  {...props}
                  currencyCode={currencyCode}
                  showCash={showCash}
                />
              )}
            />
            {showRevenue && (
              <Line
                type="monotone"
                dataKey="revenue"
                name="Revenue"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
                isAnimationActive
                animationDuration={400}
              />
            )}
            {showExpenses && (
              <Line
                type="monotone"
                dataKey="expenses"
                name="Expenses"
                stroke="#ef4444"
                strokeWidth={2}
                dot={false}
                isAnimationActive
                animationDuration={400}
              />
            )}
            {showProfit && (
              <Line
                type="monotone"
                dataKey="netProfit"
                name="Profit"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                isAnimationActive
                animationDuration={400}
              />
            )}
            {showCash && showCashLine && (
              <Line
                type="monotone"
                dataKey="cashMovement"
                name="Cash"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
                isAnimationActive
                animationDuration={400}
              />
            )}
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
