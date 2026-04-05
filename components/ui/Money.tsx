import React from "react"
import { cn } from "@/lib/utils"
import { formatMoney } from "@/lib/money"

interface MoneyProps {
  amount: number | string
  /** ISO currency code (e.g. GHS, USD). Preferred over legacy `currency`. */
  currencyCode?: string | null
  /**
   * @deprecated Use `currencyCode`. If `currencyCode` is unset and this matches a 3-letter ISO code, it is used as the code.
   */
  currency?: string
  type?: "in" | "out" | "neutral" | "error"
  className?: string
  showSign?: boolean
}

export function Money({
  amount,
  currencyCode,
  currency,
  type = "neutral",
  className,
  showSign = false,
}: MoneyProps) {
  const numAmount = Number(amount) || 0

  const resolvedCode =
    currencyCode ??
    (currency && /^[A-Za-z]{3}$/.test(currency.trim()) ? currency.trim().toUpperCase() : null)

  const colorClass = {
    in: "text-emerald-600 dark:text-emerald-400",
    out: "text-slate-600 dark:text-slate-400",
    error: "text-rose-600 dark:text-rose-400",
    neutral: "text-slate-900 dark:text-gray-100",
  }[type]

  let text = formatMoney(numAmount, resolvedCode)
  if (showSign && type === "in" && numAmount > 0) {
    text = `+${text}`
  }

  return (
    <span
      className={cn(
        "tabular-nums font-medium tracking-tight",
        colorClass,
        className
      )}
    >
      {text}
    </span>
  )
}
