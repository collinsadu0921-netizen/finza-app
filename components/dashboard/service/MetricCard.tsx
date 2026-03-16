"use client"

import Link from "next/link"
import { formatMoney } from "@/lib/money"

export type MetricCardProps = {
  title: string
  value: number | null
  previousValue?: number | null
  reportHref?: string
  currencyCode?: string
  variant?: "default" | "positive" | "negative"
  sparklineData?: number[]
  /** Override sparkline bar color. Defaults to gray. */
  sparklineColor?: string
  static?: boolean
  /** "currency" (default), "percent" (shows e.g. 15.5%), or "count" (plain integer). */
  valueFormat?: "currency" | "percent" | "count"
  /** Small label shown below the value, e.g. "overdue" */
  subtitle?: string
}

export default function MetricCard({
  title,
  value,
  previousValue,
  reportHref,
  currencyCode = "USD",
  variant = "default",
  sparklineData,
  sparklineColor = "#9ca3af",
  static: isStatic = false,
  valueFormat = "currency",
  subtitle,
}: MetricCardProps) {
  const pct =
    value != null && previousValue != null && previousValue !== 0
      ? Math.round(((value - previousValue) / Math.abs(previousValue)) * 100)
      : null

  const valueDisplay =
    valueFormat === "percent"
      ? value == null
        ? "—"
        : `${value}%`
      : valueFormat === "count"
        ? value == null
          ? "—"
          : String(Math.round(value))
        : formatMoney(value ?? 0, currencyCode)

  const content = (
    <>
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {title}
      </p>
      <p
        className={`mt-1.5 text-xl font-semibold tabular-nums tracking-tight ${
          variant === "positive"
            ? "text-emerald-600 dark:text-emerald-400"
            : variant === "negative"
              ? "text-red-600 dark:text-red-400"
              : "text-gray-900 dark:text-white"
        }`}
      >
        {valueDisplay}
      </p>
      {subtitle && (
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
      )}
      {(pct !== null || (sparklineData && sparklineData.length > 0)) && (
        <div className="mt-2 flex items-center justify-between gap-2">
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
            <div className="flex items-end gap-0.5" style={{ height: 18 }}>
              {sparklineData.slice(-14).map((v, i) => {
                const max = Math.max(...sparklineData, 1)
                const h = max > 0 ? (v / max) * 14 : 0
                return (
                  <div
                    key={i}
                    className="w-1 rounded-sm"
                    style={{
                      height: Math.max(2, h),
                      backgroundColor: sparklineColor,
                      opacity: 0.75,
                    }}
                    title={String(v)}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}
    </>
  )

  const baseClass =
    "rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-colors dark:border-gray-700 dark:bg-gray-800/80"

  if (isStatic || !reportHref) {
    return <div className={baseClass}>{content}</div>
  }

  return (
    <Link href={reportHref} className={`block ${baseClass} hover:border-gray-300 dark:hover:border-gray-600`}>
      {content}
    </Link>
  )
}
