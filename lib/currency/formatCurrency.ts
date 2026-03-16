import { resolveCurrencyDisplay } from "./resolveCurrencyDisplay"
import type { CurrencyContext } from "./resolveCurrencyDisplay"

/**
 * Format amount with resolved currency symbol. Safe when amount or contexts are missing.
 */
export function formatCurrency(
  amount: number | null | undefined,
  ...contexts: (CurrencyContext | null | undefined)[]
): string {
  const symbol = resolveCurrencyDisplay(...contexts)
  const value = Number(amount ?? 0).toFixed(2)
  return `${symbol}${value}`
}

/**
 * Canonical safe formatter for financial UI. Never throws.
 * Renders undefined/null/NaN as "0.00". Use for all numeric display in reports and tables.
 */
export function formatCurrencySafe(
  amount?: number | null,
  locale?: string
): string {
  if (process.env.NODE_ENV === "development" && (amount === undefined || amount === null)) {
    console.warn("formatCurrencySafe: undefined or null financial value rendered as 0.00")
  }
  const safeAmount =
    typeof amount === "number" && !Number.isNaN(amount) ? amount : 0
  return safeAmount.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
