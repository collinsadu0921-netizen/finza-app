/**
 * Money Formatting Utilities
 * Centralized formatting layer for currency display across the application
 * 
 * No Ghana fallbacks - returns safe placeholders for missing currency
 */

import { getCurrencySymbol } from "./currency"

export interface MoneyFormatOptions {
  /**
   * Show currency code (e.g., "USD 1,234.50")
   * Default: false (shows symbol only)
   */
  showCode?: boolean
  
  /**
   * Placeholder for missing currency
   * Default: "—" (em dash)
   */
  missingPlaceholder?: string
  
  /**
   * Minimum decimal places
   * Default: 2
   */
  minimumFractionDigits?: number
  
  /**
   * Maximum decimal places
   * Default: 2
   */
  maximumFractionDigits?: number
  
  /**
   * Use grouping separator (thousands separator)
   * Default: true
   */
  useGrouping?: boolean
}

/**
 * Format money amount with currency symbol
 * 
 * @param amount - Numeric amount to format
 * @param currencyCode - ISO currency code (e.g., 'GHS', 'USD', 'KES')
 * @param options - Formatting options
 * @returns Formatted string (e.g., "₵1,234.50" or "—" if currency missing)
 * 
 * @example
 * formatMoney(1234.5, 'GHS') // "₵1,234.50"
 * formatMoney(1234.5, 'USD') // "$1,234.50"
 * formatMoney(1234.5, null) // "—"
 */
export function formatMoney(
  amount: number | null | undefined,
  currencyCode: string | null | undefined,
  options: MoneyFormatOptions = {}
): string {
  const {
    missingPlaceholder = "—",
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
    useGrouping = true,
  } = options

  // Handle null/undefined amount
  if (amount === null || amount === undefined || isNaN(amount)) {
    return missingPlaceholder
  }

  // Handle missing currency - return safe placeholder
  if (!currencyCode) {
    return missingPlaceholder
  }

  // Separate sign from magnitude so the symbol always sits between the
  // minus and the digits: -₵112,368.00 rather than ₵-112,368.00
  const isNegative = amount < 0
  const formattedNumber = new Intl.NumberFormat('en-US', {
    minimumFractionDigits,
    maximumFractionDigits,
    useGrouping,
  }).format(Math.abs(amount))

  // Get currency symbol
  const symbol = getCurrencySymbol(currencyCode)

  // Return formatted string with symbol
  return isNegative ? `-${symbol}${formattedNumber}` : `${symbol}${formattedNumber}`
}

/**
 * Format money amount with currency code
 * 
 * @param amount - Numeric amount to format
 * @param currencyCode - ISO currency code
 * @returns Formatted string with code (e.g., "USD 1,234.50")
 * 
 * @example
 * formatMoneyWithCode(1234.5, 'GHS') // "GHS 1,234.50"
 * formatMoneyWithCode(1234.5, 'KES') // "KES 1,234.50"
 * formatMoneyWithCode(1234.5, null) // "—"
 */
export function formatMoneyWithCode(
  amount: number | null | undefined,
  currencyCode: string | null | undefined
): string {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return "—"
  }

  if (!currencyCode) {
    return "—"
  }

  // Fixed locale 'en-US' for deterministic formatting across environments
  const formattedNumber = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(amount)

  return `${currencyCode} ${formattedNumber}`
}

/**
 * Format money amount with custom symbol
 * Useful for cases where you want to override the default symbol
 * 
 * @param amount - Numeric amount to format
 * @param symbol - Currency symbol to use
 * @param options - Formatting options
 * @returns Formatted string (e.g., "₵1,234.50")
 */
export function formatMoneyWithSymbol(
  amount: number | null | undefined,
  symbol: string,
  options: Omit<MoneyFormatOptions, 'showCode'> = {}
): string {
  const {
    missingPlaceholder = "—",
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
    useGrouping = true,
  } = options

  if (amount === null || amount === undefined || isNaN(amount)) {
    return missingPlaceholder
  }

  // Fixed locale 'en-US' for deterministic formatting across environments
  const formattedNumber = new Intl.NumberFormat('en-US', {
    minimumFractionDigits,
    maximumFractionDigits,
    useGrouping,
  }).format(amount)

  return `${symbol}${formattedNumber}`
}

