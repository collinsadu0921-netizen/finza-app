/**
 * Canonical Helper for Reading Tax Information from tax_lines JSONB
 * 
 * This module provides pure functions to read and extract tax information
 * from the canonical tax_lines JSONB format stored in database.
 * 
 * Rules:
 * - Operate ONLY on tax_lines JSONB structure
 * - No rate logic, no cutoff dates, no country branching
 * - Extract information directly from tax_lines.lines[]
 * 
 * UI tax display policy (invoice, credit note, preview):
 * - COVID levy is intentionally hidden in UI. It is never rendered, regardless of amount.
 * - Zero-amount tax lines are never rendered. Only lines with amount !== 0 are shown.
 * - Data is not mutated; filtering is display-only. Ledger and exports unchanged.
 * 
 * Canonical tax_lines format:
 * {
 *   "lines": [
 *     {
 *       "code": "VAT",
 *       "amount": 15.90,
 *       "rate": 0.15,
 *       "name": "VAT",
 *       "meta": { ... }
 *     }
 *   ],
 *   "meta": {
 *     "jurisdiction": "GH",
 *     "effective_date_used": "2025-12-31",
 *     "engine_version": "GH-2025-A"
 *   },
 *   "pricing_mode": "inclusive"
 * }
 */

/**
 * Get tax breakdown as a map of tax code to amount
 * 
 * @param tax_lines JSONB tax_lines object (can be null/undefined)
 * @returns Record mapping tax code to amount (e.g., { VAT: 15.90, NHIL: 2.50 })
 */
export function getTaxBreakdown(tax_lines: any): Record<string, number> {
  if (!tax_lines) {
    return {}
  }

  const breakdown: Record<string, number> = {}

  // Handle canonical format: { lines: [...], meta: {...}, pricing_mode: "..." }
  let lines: any[] = []
  if (typeof tax_lines === 'object' && tax_lines !== null) {
    if (Array.isArray(tax_lines.lines)) {
      lines = tax_lines.lines
    } else if (Array.isArray(tax_lines)) {
      // Fallback: direct array format (legacy compatibility)
      lines = tax_lines
    } else if (tax_lines.tax_lines && Array.isArray(tax_lines.tax_lines)) {
      // Fallback: nested tax_lines key (legacy compatibility)
      lines = tax_lines.tax_lines
    }
  }

  // Extract code and amount from each line
  for (const line of lines) {
    if (line && typeof line === 'object' && typeof line.code === 'string') {
      const code = line.code
      const amount = typeof line.amount === 'number' ? line.amount : 0
      breakdown[code] = amount
    }
  }

  return breakdown
}

/**
 * Get tax lines for UI display.
 * Implements UI tax display policy (see module header): COVID hidden; zero-amount lines never rendered.
 * - Excludes zero-value lines (amount === 0).
 * - Excludes COVID levy entirely (never shown in UI).
 * Does not mutate or delete stored data.
 *
 * @param tax_lines JSONB tax_lines object (can be null/undefined)
 * @returns Array of { code, amount } with amount !== 0 and code !== 'COVID'
 */
export function getTaxLinesForDisplay(tax_lines: any): Array<{ code: string; amount: number }> {
  const breakdown = getTaxBreakdown(tax_lines)
  return Object.entries(breakdown)
    .map(([code, amount]) => ({ code, amount: Number(amount) }))
    .filter((t) => Number(t.amount) !== 0 && t.code.toUpperCase() !== "COVID")
}

/**
 * Get tax amount for a specific tax code
 * 
 * @param tax_lines JSONB tax_lines object (can be null/undefined)
 * @param code Tax code to look up (e.g., "VAT", "NHIL", "GETFUND", "COVID")
 * @returns Tax amount for the code, or 0 if not found
 */
export function getTaxAmount(tax_lines: any, code: string): number {
  if (!tax_lines || !code) {
    return 0
  }

  const breakdown = getTaxBreakdown(tax_lines)
  return breakdown[code] || 0
}

/**
 * Sum all tax amounts from tax_lines
 * 
 * @param tax_lines JSONB tax_lines object (can be null/undefined)
 * @returns Sum of all tax line amounts
 */
export function sumTaxLines(tax_lines: any): number {
  if (!tax_lines) {
    return 0
  }

  const breakdown = getTaxBreakdown(tax_lines)
  return Object.values(breakdown).reduce((sum, amount) => sum + amount, 0)
}

/**
 * Get Ghana legacy view: { vat, nhil, getfund, covid }
 * 
 * Extracts legacy tax columns from tax_lines JSONB.
 * This is a convenience function for backward compatibility.
 * 
 * Rules:
 * - No rate logic (amounts come directly from tax_lines)
 * - No cutoff dates (amounts reflect what's actually in tax_lines)
 * - No country branching (just extracts by code)
 * 
 * @param tax_lines JSONB tax_lines object (can be null/undefined)
 * @returns Legacy tax columns view: { vat: number, nhil: number, getfund: number, covid: number }
 */
export function getGhanaLegacyView(tax_lines: any): {
  vat: number
  nhil: number
  getfund: number
  covid: number
} {
  const breakdown = getTaxBreakdown(tax_lines)

  return {
    vat: breakdown.VAT || breakdown.vat || 0,
    nhil: breakdown.NHIL || breakdown.nhil || 0,
    getfund: breakdown.GETFUND || breakdown.GETFund || breakdown.getfund || 0,
    covid: breakdown.COVID || breakdown.Covid || breakdown.covid || 0,
  }
}
