"use client"

import Link from "next/link"
import { DEFAULT_PLATFORM_CURRENCY_CODE } from "@/lib/currency"
import { formatMoney } from "@/lib/money"

export type ServiceFinanceSummaryCardProps = {
  title: string
  value: number
  previousValue?: number | null
  sparklineData?: number[]
  reportHref: string
  currencyCode?: string
  variant?: "default" | "positive" | "negative"
}

export default function ServiceFinanceSummaryCard({
  title,
  value,
  previousValue,
  sparklineData,
  reportHref,
  currencyCode = DEFAULT_PLATFORM_CURRENCY_CODE,
  variant = "default",
}: ServiceFinanceSummaryCardProps) {
  const pct =
    previousValue != null && previousValue !== 0
      ? Math.round(((value - previousValue) / Math.abs(previousValue)) * 100)
      : null

  return (
    <Link
      href={reportHref}
      className="block min-w-0 rounded-xl border border-gray-200/80 bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:border-gray-300/80 dark:border-gray-700/80 dark:bg-gray-800/80 dark:hover:border-gray-600/80 dark:hover:shadow-lg"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {title}
      </p>
      <p
        className={`mt-2 min-w-0 text-base font-semibold tabular-nums leading-tight [overflow-wrap:anywhere] sm:text-lg md:text-xl lg:text-2xl ${
          variant === "positive"
            ? "text-emerald-600 dark:text-emerald-400"
            : variant === "negative"
              ? "text-red-600 dark:text-red-400"
              : "text-gray-900 dark:text-white"
        }`}
      >
        {formatMoney(value, currencyCode)}
      </p>
      {(pct !== null || (sparklineData && sparklineData.length > 0)) && (
        <div className="mt-3 flex items-center justify-between gap-2">
          {pct !== null && (
            <span
              className={`text-xs font-medium ${
                pct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
              }`}
            >
              {pct >= 0 ? "+" : ""}
              {pct}% vs prev
            </span>
          )}
          {sparklineData && sparklineData.length > 0 && (
            <div className="flex items-end gap-0.5" style={{ height: 20 }}>
              {sparklineData.slice(-14).map((v, i) => {
                const max = Math.max(...sparklineData, 1)
                const h = max > 0 ? (v / max) * 16 : 0
                return (
                  <div
                    key={i}
                    className="w-1 rounded-sm bg-blue-400/60 dark:bg-blue-500/60"
                    style={{ height: Math.max(2, h) }}
                    title={String(v)}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}
    </Link>
  )
}
