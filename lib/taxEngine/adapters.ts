/**
 * Tax Engine Adapters
 * 
 * Explicit conversion functions between canonical and legacy types.
 * 
 * Rule: Canonical types are authoritative. Legacy types are adapters.
 * - Canonical types must never depend on legacy types
 * - Legacy code must adapt to canonical, not the reverse
 * - No casting, no "as unknown as", ever.
 */

import type { TaxResult, TaxLine } from './types'
import type { TaxCalculationResult, LegacyTaxLine } from './types'

/**
 * Convert canonical TaxResult to legacy TaxCalculationResult
 * 
 * Used when feeding legacy TaxEngine interface or old code.
 * 
 * @param canonical Canonical TaxResult
 * @returns Legacy TaxCalculationResult
 */
export function canonicalToLegacyResult(canonical: TaxResult): TaxCalculationResult {
  return {
    taxLines: canonicalToLegacyLines(canonical),
    subtotal_excl_tax: canonical.base_amount,
    tax_total: canonical.total_tax,
    total_incl_tax: canonical.total_amount,
  }
}

/**
 * Convert canonical TaxResult lines to legacy LegacyTaxLine[]
 * 
 * @param canonical Canonical TaxResult
 * @returns Array of legacy tax lines
 */
export function canonicalToLegacyLines(canonical: TaxResult): LegacyTaxLine[] {
  return canonical.lines.map(line => {
    // Extract ledger metadata from meta if present
    const ledgerMetadata = line.meta || {}
    
    return {
      code: line.code,
      name: line.name || line.code, // Use code as fallback for name
      rate: line.rate || 0, // Use 0 as fallback for rate
      base: (ledgerMetadata.base as number) || 0, // Extract base from meta if present
      amount: line.amount,
      ledger_account_code: ledgerMetadata.ledger_account_code as string | null | undefined,
      ledger_side: ledgerMetadata.ledger_side as 'debit' | 'credit' | null | undefined,
      is_creditable_input: ledgerMetadata.is_creditable_input as boolean | undefined,
      absorbed_to_cost: ledgerMetadata.absorbed_to_cost as boolean | undefined,
    }
  })
}

/**
 * Convert legacy TaxCalculationResult to canonical TaxResult
 * 
 * Used when converting from old TaxEngine interface to canonical format.
 * 
 * @param legacy Legacy TaxCalculationResult
 * @param config Tax engine configuration (for meta fields)
 * @param getEngineVersion Function to get engine version string for the date
 * @returns Canonical TaxResult
 */
export function legacyToCanonicalResult(
  legacy: TaxCalculationResult,
  config: {
    jurisdiction: string
    effectiveDate: string
    taxInclusive: boolean
  },
  getEngineVersion: (date: string) => string
): TaxResult {
  const effectiveDateUsed = config.effectiveDate.split('T')[0] // Extract date part (YYYY-MM-DD)
  
  // Convert legacy tax lines to canonical tax lines
  const canonicalLines: TaxLine[] = legacy.taxLines.map(line => ({
    code: line.code,
    amount: line.amount,
    rate: line.rate,
    name: line.name,
    // Preserve legacy metadata in meta field
    meta: {
      base: line.base,
      ...(line.ledger_account_code !== undefined && { ledger_account_code: line.ledger_account_code }),
      ...(line.ledger_side !== undefined && { ledger_side: line.ledger_side }),
      ...(line.is_creditable_input !== undefined && { is_creditable_input: line.is_creditable_input }),
      ...(line.absorbed_to_cost !== undefined && { absorbed_to_cost: line.absorbed_to_cost }),
    },
  }))

  return {
    base_amount: legacy.subtotal_excl_tax,
    total_tax: legacy.tax_total,
    total_amount: legacy.total_incl_tax,
    pricing_mode: config.taxInclusive ? 'inclusive' : 'exclusive',
    lines: canonicalLines,
    meta: {
      jurisdiction: config.jurisdiction,
      effective_date_used: effectiveDateUsed,
      engine_version: getEngineVersion(effectiveDateUsed),
    },
  }
}
