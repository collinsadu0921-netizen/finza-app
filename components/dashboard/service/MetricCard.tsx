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
  /** Override sparkline bar color. */
  sparklineColor?: string
  static?: boolean
  /** "currency" (default), "percent" (shows e.g. 15.5%), or "count" (plain integer). */
  valueFormat?: "currency" | "percent" | "count"
  /** Small label shown below the value */
  subtitle?: string
}

export default function MetricCard({
  title,
  value,
  previousValue,
  reportHref,
  currencyCode = "GHS",
  variant = "default",
  sparklineData,
  sparklineColor = "#94a3b8",
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

  // Derive variant from value when not explicitly set
  const resolvedVariant =
    variant !== "default"
      ? variant
      : valueFormat === "currency" && value != null && value < 0
        ? "negative"
        : "default"

  const valueTone =
    resolvedVariant === "positive"
      ? "text-emerald-600"
      : resolvedVariant === "negative"
        ? "text-red-500"
        : "text-slate-900"

  const valueSizeClass =
    valueFormat === "currency"
      ? "text-base font-semibold tabular-nums tracking-tight sm:text-lg md:text-xl [overflow-wrap:anywhere]"
      : "text-lg font-semibold tabular-nums tracking-tight sm:text-xl [overflow-wrap:anywhere]"

  const content = (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </p>
      <p className={`mt-1.5 min-w-0 leading-tight ${valueSizeClass} ${valueTone}`}>
        {valueDisplay}
      </p>
      {subtitle && (
        <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>
      )}
      {(pct !== null || (sparklineData && sparklineData.length > 0)) && (
        <div className="mt-2 flex items-center justify-between gap-2">
          {pct !== null && (
            <span
              className={`text-xs font-medium ${
                pct >= 0 ? "text-emerald-600" : "text-red-500"
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
    </div>
  )

  const baseClass =
    "block min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors"

  if (isStatic || !reportHref) {
    return <div className={baseClass}>{content}</div>
  }

  return (
    <Link href={reportHref} className={`${baseClass} hover:border-slate-300 hover:shadow`}>
      {content}
    </Link>
  )
}
