"use client"

import { formatMoney } from "@/lib/money"

export type ServiceHealthPanelProps = {
  expenseRatio: number | null
  payablesAging: { current: number; overdue1_30: number; overdue31_60: number; overdue61Plus: number } | null
  receivablesAging: { current: number; overdue1_30: number; overdue31_60: number; overdue61Plus: number } | null
  burnRate: number | null
  currencyCode?: string
}

export default function ServiceHealthPanel({
  expenseRatio,
  payablesAging,
  receivablesAging,
  burnRate,
  currencyCode = "USD",
}: ServiceHealthPanelProps) {
  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-sm dark:border-gray-700/80 dark:bg-gray-800/80 space-y-5">
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Financial health</h3>

      {expenseRatio != null && (
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Expense ratio</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            {(expenseRatio * 100).toFixed(1)}%
          </p>
        </div>
      )}

      {receivablesAging && (
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Receivables aging</p>
          <ul className="space-y-1 text-sm">
            <li className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Current</span>
              <span className="font-medium tabular-nums">{formatMoney(receivablesAging.current, currencyCode)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">1–30 days</span>
              <span className="font-medium tabular-nums">{formatMoney(receivablesAging.overdue1_30, currencyCode)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">31–60 days</span>
              <span className="font-medium tabular-nums">{formatMoney(receivablesAging.overdue31_60, currencyCode)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">61+ days</span>
              <span className="font-medium tabular-nums text-amber-600 dark:text-amber-400">{formatMoney(receivablesAging["overdue61Plus"], currencyCode)}</span>
            </li>
          </ul>
        </div>
      )}

      {payablesAging && (
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Payables aging</p>
          <ul className="space-y-1 text-sm">
            <li className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Current</span>
              <span className="font-medium tabular-nums">{formatMoney(payablesAging.current, currencyCode)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">1–30 days</span>
              <span className="font-medium tabular-nums">{formatMoney(payablesAging.overdue1_30, currencyCode)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">31–60 days</span>
              <span className="font-medium tabular-nums">{formatMoney(payablesAging.overdue31_60, currencyCode)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">61+ days</span>
              <span className="font-medium tabular-nums text-amber-600 dark:text-amber-400">{formatMoney(payablesAging["overdue61Plus"], currencyCode)}</span>
            </li>
          </ul>
        </div>
      )}

      {burnRate != null && burnRate !== 0 && (
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Burn rate (monthly)</p>
          <p className={`text-lg font-semibold ${burnRate > 0 ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}>
            {formatMoney(burnRate, currencyCode)}/mo
          </p>
        </div>
      )}
    </div>
  )
}
