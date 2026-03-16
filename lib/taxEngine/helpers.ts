/**
 * Tax Engine Helper Functions
 * Utilities for storing and deriving tax data
 */

import type { TaxCalculationResult, TaxLine, TaxResult, TaxEngineConfig, LineItem } from './types'
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

/**
 * Parse tax_lines JSONB back to TaxCalculationResult
 */
export function jsonbToTaxResult(jsonb: any): TaxCalculationResult | null {
  if (!jsonb || !jsonb.tax_lines || !Array.isArray(jsonb.tax_lines)) {
    return null
  }

  return {
    taxLines: jsonb.tax_lines.map((line: any) => ({
      code: line.code,
      name: line.name,
      rate: line.rate,
      base: line.base,
      amount: line.amount,
    })),
    subtotal_excl_tax: jsonb.subtotal_excl_tax || 0,
    tax_total: jsonb.tax_total || 0,
    total_incl_tax: jsonb.total_incl_tax || 0,
  }
}

