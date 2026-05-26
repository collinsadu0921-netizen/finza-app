/**
 * Tax Engine Helper Functions
 * Utilities for storing and deriving tax data
 */

import type { LegacyTaxLine, TaxCalculationResult, TaxLine, TaxResult, TaxEngineConfig, LineItem } from './types'
import { ghanaTaxEngineCanonical } from './jurisdictions/ghana'
import { legacyToCanonicalResult } from './adapters'
import { getGhanaEngineVersion } from './jurisdictions/ghana-shared'

/**
 * Derive legacy Ghana tax amounts from tax_lines
 * Used for backward compatibility with existing database schema
 * 
 * CRITICAL: This function should ONLY be called for Ghana (GH) businesses.
 * For non-GH businesses, return zeros instead of calling this function.
 * 
 * @param taxLines - Tax lines from tax calculation result
 * @returns Legacy Ghana tax amounts (nhil, getfund, covid, vat)
 */
export function deriveLegacyGhanaTaxAmounts(taxLines: TaxLine[]): {
  nhil: number
  getfund: number
  covid: number
  vat: number
} {
  const result = {
    nhil: 0,
    getfund: 0,
    covid: 0,
    vat: 0,
  }

  for (const line of taxLines) {
    const code = line.code.toUpperCase()
    switch (code) {
      case 'NHIL':
        result.nhil = line.amount
        break
      case 'GETFUND':
        result.getfund = line.amount
        break
      case 'COVID':
        result.covid = line.amount
        break
      case 'VAT':
        result.vat = line.amount
        break
    }
  }

  return result
}

/**
 * Derive legacy tax columns from canonical tax lines
 * Generic helper that extracts legacy column values from TaxResult.lines
 * No rate logic, no cutoff logic, no country branching - pure extraction
 * 
 * @param taxLines - Canonical tax lines from TaxResult
 * @returns Legacy tax columns (nhil, getfund, covid, vat)
 */
export function deriveLegacyTaxColumnsFromTaxLines(taxLines: Array<{ code: string; amount: number }>): {
  nhil: number
  getfund: number
  covid: number
  vat: number
} {
  const result = {
    nhil: 0,
    getfund: 0,
    covid: 0,
    vat: 0,
  }

  for (const line of taxLines) {
    const code = line.code.toUpperCase()
    switch (code) {
      case 'NHIL':
        result.nhil = line.amount
        break
      case 'GETFUND':
        result.getfund = line.amount
        break
      case 'COVID':
        result.covid = line.amount
        break
      case 'VAT':
        result.vat = line.amount
        break
    }
  }

  return result
}

/**
 * Get tax engine code from jurisdiction
 */
export function getTaxEngineCode(jurisdiction: string): string {
  const normalized = jurisdiction.toUpperCase().trim()
  
  // Map jurisdiction codes to engine codes
  const engineMap: Record<string, string> = {
    'GH': 'ghana',
    'GHA': 'ghana',
  }
  
  return engineMap[normalized] || normalized.toLowerCase()
}

/**
 * Get canonical tax result from line items
 * Uses canonical engines when available, falls back to legacy engines with adapter conversion
 * 
 * @param lineItems Array of line items
 * @param config Tax engine configuration
 * @returns Canonical TaxResult
 */
export function getCanonicalTaxResultFromLineItems(
  lineItems: LineItem[],
  config: TaxEngineConfig
): TaxResult {
  // Use canonical engine for Ghana (canonical engines available)
  if (config.jurisdiction === 'GH') {
    return ghanaTaxEngineCanonical.reverseCalculate(
      lineItems.reduce((sum, item) => {
        const lineTotal = item.quantity * item.unit_price
        const discount = item.discount_amount || 0
        return sum + lineTotal - discount
      }, 0),
      config
    )
  }
  
  // For other jurisdictions, use legacy engine and convert via adapter
  // TODO: Create canonical engines for other jurisdictions
  const { calculateTaxes } = require('./index')
  const legacyResult = calculateTaxes(
    lineItems,
    config.jurisdiction,
    config.effectiveDate,
    config.taxInclusive
  )
  
  return legacyToCanonicalResult(legacyResult, config, (date: string) => {
    // Determine engine version based on date
    // Use Ghana versioning function if available, otherwise use simplified versioning
    if (config.jurisdiction === 'GH') {
      return getGhanaEngineVersion(date)
    }
    // Simplified versioning for other jurisdictions
    return `${config.jurisdiction}-${date.split('-')[0]}`
  })
}

/**
 * Convert TaxCalculationResult to JSONB format for storage
 * CONTRACT: tax_lines MUST include ledger_account_code and ledger_side for ledger posting
 */
export function taxResultToJSONB(result: TaxCalculationResult): any {
  return {
    tax_lines: result.taxLines.map(line => ({
      code: line.code,
      name: line.name,
      rate: line.rate,
      base: line.base,
      amount: line.amount,
      // CONTRACT: Include ledger metadata for ledger posting
      ledger_account_code: line.ledger_account_code ?? null,
      ledger_side: line.ledger_side ?? null,
      is_creditable_input: line.is_creditable_input,
      absorbed_to_cost: line.absorbed_to_cost,
    })),
    subtotal_excl_tax: result.subtotal_excl_tax,
    tax_total: result.tax_total,
    total_incl_tax: result.total_incl_tax,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function parseJsonbRoot(jsonb: any): any {
  if (jsonb == null) return null
  if (typeof jsonb === "string") {
    try {
      return JSON.parse(jsonb)
    } catch {
      return null
    }
  }
  return jsonb
}

function mapJsonLineToLegacyTaxLine(line: any): LegacyTaxLine {
  const code = line?.code != null ? String(line.code) : ""
  const name = line?.name != null ? String(line.name) : code
  const rate = Number(line?.rate)
  const base = Number(line?.base)
  const amount = Number(line?.amount)
  const ledgerFromLine = line?.ledger_account_code ?? line?.meta?.ledger_account_code
  const sideFromLine = line?.ledger_side ?? line?.meta?.ledger_side
  return {
    code,
    name,
    rate: Number.isFinite(rate) ? rate : 0,
    base: Number.isFinite(base) ? base : 0,
    amount: Number.isFinite(amount) ? amount : 0,
    ledger_account_code: ledgerFromLine ?? null,
    ledger_side: sideFromLine === "debit" || sideFromLine === "credit" ? sideFromLine : null,
    ...(typeof line?.is_creditable_input === "boolean" ? { is_creditable_input: line.is_creditable_input } : {}),
    ...(typeof line?.absorbed_to_cost === "boolean" ? { absorbed_to_cost: line.absorbed_to_cost } : {}),
  }
}

/**
 * Parse tax_lines JSONB back to TaxCalculationResult.
 *
 * Supports:
 * - **Canonical** (Phase 2A): `{ lines: [...], meta?: {...}, pricing_mode?: string }`
 * - **Legacy** (taxResultToJSONB): `{ tax_lines: [...], subtotal_excl_tax, tax_total, total_incl_tax }`
 * - **Root array**: `[{ code, amount, ... }, ...]` (same line shape as legacy array)
 *
 * Returns null when the payload cannot be normalized to at least one tax line (canonical empty
 * `lines: []` with no legacy `tax_lines` fallback). Legacy `{ tax_lines: [] }` still returns an
 * empty `taxLines` array with totals from numeric fields (backward compatible).
 */
export function jsonbToTaxResult(jsonb: any): TaxCalculationResult | null {
  const root = parseJsonbRoot(jsonb)
  if (root == null) {
    return null
  }

  // Root JSON array of line objects
  if (Array.isArray(root)) {
    if (root.length === 0) {
      return null
    }
    const taxLines = root.map(mapJsonLineToLegacyTaxLine).filter((l) => l.code.length > 0)
    if (taxLines.length === 0) {
      return null
    }
    const tax_total = round2(taxLines.reduce((s, l) => s + l.amount, 0))
    return {
      taxLines,
      subtotal_excl_tax: 0,
      tax_total,
      total_incl_tax: tax_total,
    }
  }

  if (typeof root !== "object") {
    return null
  }

  const hasLinesKey = "lines" in root && Array.isArray((root as any).lines)
  const hasTaxLinesKey = "tax_lines" in root && Array.isArray((root as any).tax_lines)
  const linesArr = hasLinesKey ? ((root as any).lines as any[]) : null
  const taxLinesArr = hasTaxLinesKey ? ((root as any).tax_lines as any[]) : null

  let rawLines: any[] | null = null
  if (linesArr && linesArr.length > 0) {
    rawLines = linesArr
  } else if (taxLinesArr && taxLinesArr.length > 0) {
    rawLines = taxLinesArr
  } else if (taxLinesArr && taxLinesArr.length === 0) {
    rawLines = taxLinesArr
  } else if (linesArr && linesArr.length === 0) {
    // Canonical wrapper with no lines and no legacy array to fall back to
    return null
  } else {
    return null
  }

  const taxLines = rawLines.map(mapJsonLineToLegacyTaxLine).filter((l) => l.code.length > 0)
  if (taxLines.length === 0 && rawLines.length > 0) {
    return null
  }

  const sumAmount = round2(taxLines.reduce((s, l) => s + l.amount, 0))

  const r = root as Record<string, unknown>
  const hasExplicitLegacyTotals =
    ("subtotal_excl_tax" in r && r.subtotal_excl_tax != null && Number.isFinite(Number(r.subtotal_excl_tax))) ||
    ("tax_total" in r && r.tax_total != null && Number.isFinite(Number(r.tax_total))) ||
    ("total_incl_tax" in r && r.total_incl_tax != null && Number.isFinite(Number(r.total_incl_tax)))

  // Default: legacy taxResultToJSONB semantics (|| 0 for each total field)
  let subtotal_excl_tax = round2(Number(r.subtotal_excl_tax) || 0)
  let tax_total = round2(Number(r.tax_total) || 0)
  let total_incl_tax = round2(Number(r.total_incl_tax) || 0)

  const usedCanonicalLines = Boolean(linesArr && linesArr.length > 0 && rawLines === linesArr)

  if (usedCanonicalLines && !hasExplicitLegacyTotals) {
    tax_total = sumAmount
    const baseAmountOpt = Number(r.base_amount)
    if ("base_amount" in r && r.base_amount != null && Number.isFinite(baseAmountOpt)) {
      subtotal_excl_tax = round2(baseAmountOpt)
    } else {
      subtotal_excl_tax = 0
    }
    const totalAmountOpt = Number(r.total_amount)
    if ("total_amount" in r && r.total_amount != null && Number.isFinite(totalAmountOpt)) {
      total_incl_tax = round2(totalAmountOpt)
    } else {
      total_incl_tax = round2(subtotal_excl_tax + tax_total)
    }
  }

  return {
    taxLines,
    subtotal_excl_tax,
    tax_total,
    total_incl_tax,
  }
}

