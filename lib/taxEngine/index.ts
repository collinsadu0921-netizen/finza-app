/**
 * Tax Engine Entry Point
 * 
 * AUTHORITATIVE SOURCE OF TRUTH for:
 * - Country recognition and normalization
 * - Tax calculation logic
 * - Effective date selection for versioned tax rates
 * 
 * This module is the explicit authority for all tax-related operations.
 * Legacy tax engines (lib/ghanaTaxEngine.ts, lib/vat.ts) are NOT authoritative
 * and should not be used for new code. They remain for backward compatibility.
 * 
 * Usage:
 * - Invoices: Use sent_at date (or issue_date for drafts that haven't been sent)
 * - POS/Sales: Use created_at date (or provided sale_date)
 */

import type { TaxEngine, TaxCalculationResult, TaxEngineConfig, LineItem } from './types'
import { ghanaTaxEngine } from './jurisdictions/ghana'
import { nigeriaTaxEngine } from './jurisdictions/nigeria'
import { kenyaTaxEngine } from './jurisdictions/kenya'
import { zambiaTaxEngine } from './jurisdictions/zambia'
import { eastAfricaTaxEngine } from './jurisdictions/east-africa'
import { normalizeCountry, SUPPORTED_COUNTRIES, UNSUPPORTED_COUNTRY_MARKER } from '@/lib/payments/eligibility'
import { MissingCountryError, UnsupportedCountryError } from './errors'

/**
 * Registry of tax engines by jurisdiction code
 * 
 * This registry is the authoritative list of implemented tax engines.
 * Only countries with implemented engines should be added here.
 * 
 * Tier 1 (Implemented):
 * - GH: Ghana (ghanaTaxEngine) - Compound VAT with NHIL, GETFund, COVID
 * 
 * Tier 2 (Implemented - VAT-only):
 * - NG: Nigeria (nigeriaTaxEngine) - 7.5% VAT
 * - KE: Kenya (kenyaTaxEngine) - 16% VAT
 * - UG: Uganda (eastAfricaTaxEngine) - 18% VAT
 * - TZ: Tanzania (eastAfricaTaxEngine) - 18% VAT
 * - RW: Rwanda (eastAfricaTaxEngine) - 18% VAT
 * - ZM: Zambia (zambiaTaxEngine) - 16% VAT
 */
const TAX_ENGINES: Record<string, TaxEngine> = {
  'GH': ghanaTaxEngine, // Ghana - Tier 1 (compound VAT)
  'NG': nigeriaTaxEngine, // Nigeria - Tier 2 (7.5% VAT)
  'KE': kenyaTaxEngine, // Kenya - Tier 2 (16% VAT)
  'UG': eastAfricaTaxEngine, // Uganda - Tier 2 (18% VAT)
  'TZ': eastAfricaTaxEngine, // Tanzania - Tier 2 (18% VAT)
  'RW': eastAfricaTaxEngine, // Rwanda - Tier 2 (18% VAT)
  'ZM': zambiaTaxEngine, // Zambia - Tier 2 (16% VAT)
}

/**
 * Normalize country to jurisdiction code using shared normalization
 * 
 * Authority: Uses lib/payments/eligibility.normalizeCountry() as source of truth.
 * This ensures consistent country normalization across the system.
 * 
 * @param country - Business/store country code or name
 * @returns ISO country code for supported countries
 * @throws MissingCountryError if country is null/undefined
 * @throws UnsupportedCountryError if country is supported but engine not implemented
 */
function normalizeJurisdiction(country: string | null | undefined): string {
  // Use shared normalization function (authoritative source)
  const normalized = normalizeCountry(country)
  
  // Missing country (null) - configuration issue
  if (normalized === null) {
    throw new MissingCountryError()
  }
  
  // Unsupported country (not in Tier 1/2) - return zero-tax fallback is acceptable
  // This allows operation in countries not yet in our supported set
  if (normalized === UNSUPPORTED_COUNTRY_MARKER) {
    // For now, return a valid code to allow fallback behavior
    // In future, this could throw UnsupportedCountryError if we want strict enforcement
    return 'UNSUPPORTED'
  }
  
  // Supported country - return ISO code
  return normalized
}

/**
 * Fallback tax engine that returns zero taxes for explicitly unsupported jurisdictions
 * 
 * This engine is used ONLY for countries not in the supported set (Tier 1/2).
 * Supported countries (Tier 1/2) without implemented engines throw UnsupportedCountryError.
 * 
 * This allows operation in countries outside our supported set without blocking.
 * Zero-tax fallback should NOT be used for supported countries - explicit error is thrown instead.
 */
const fallbackTaxEngine: TaxEngine = {
  calculateFromLineItems(lineItems: LineItem[], config: TaxEngineConfig): TaxCalculationResult {
    const subtotal = lineItems.reduce((sum, item) => {
      const lineTotal = item.quantity * item.unit_price
      const discount = item.discount_amount || 0
      return sum + lineTotal - discount
    }, 0)
    
    return {
      taxLines: [],
      subtotal_excl_tax: subtotal,
      tax_total: 0,
      total_incl_tax: subtotal,
    }
  },
  
  calculateFromAmount(taxableAmount: number, config: TaxEngineConfig): TaxCalculationResult {
    return {
      taxLines: [],
      subtotal_excl_tax: taxableAmount,
      tax_total: 0,
      total_incl_tax: taxableAmount,
    }
  },
  
  reverseCalculate(totalInclusive: number, config: TaxEngineConfig): TaxCalculationResult {
    // For unsupported countries, assume no taxes - total equals base
    return {
      taxLines: [],
      subtotal_excl_tax: totalInclusive,
      tax_total: 0,
      total_incl_tax: totalInclusive,
    }
  },
}

/**
 * Get tax engine for a jurisdiction
 * 
 * Authority: This function determines which tax engine to use for a country.
 * 
 * Behavior:
 * - If country is in supported set (Tier 1/2) but engine not implemented: throws UnsupportedCountryError
 * - If country is explicitly unsupported: returns zero-tax fallback (allows operation)
 * - If engine exists: returns the engine
 * 
 * @param jurisdiction - Normalized jurisdiction code (ISO alpha-2)
 * @returns TaxEngine instance
 * @throws UnsupportedCountryError if country is supported but engine not implemented
 */
function getTaxEngine(jurisdiction: string): TaxEngine {
  const engine = TAX_ENGINES[jurisdiction]
  
  // Engine exists - return it
  if (engine) {
    return engine
  }
  
  // Country is in supported set (Tier 1/2) but engine not implemented
  // This is a supported country that needs plugin development
  if ((SUPPORTED_COUNTRIES as readonly string[]).includes(jurisdiction)) {
    throw new UnsupportedCountryError(
      jurisdiction,
      `Tax calculation is not yet implemented for country "${jurisdiction}". Tax engine plugin required.`
    )
  }
  
  // Country is explicitly unsupported (not in Tier 1/2)
  // Return zero-tax fallback to allow operation
  console.warn(
    `Country "${jurisdiction}" is not in supported set. Using zero-tax fallback. ` +
    `Tax calculation is not supported for this country.`
  )
  return fallbackTaxEngine
}

/**
 * Calculate taxes from line items
 * 
 * Authority: This is the authoritative function for tax calculation.
 * All tax calculations should go through this function or calculateTaxesFromAmount().
 * 
 * Error semantics:
 * - MissingCountryError: Country is null/undefined (configuration issue)
 * - UnsupportedCountryError: Country is supported (Tier 1/2) but engine not implemented
 * 
 * @param lineItems Array of line items
 * @param country Business/store country code or name
 * @param effectiveDate ISO date string (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)
 * @param taxInclusive Whether input prices include tax (default: true for invoices, true for POS)
 * @returns TaxCalculationResult with tax lines and totals
 * @throws MissingCountryError if country is null/undefined
 * @throws UnsupportedCountryError if country is supported but engine not implemented
 */
export function calculateTaxes(
  lineItems: LineItem[],
  country: string | null | undefined,
  effectiveDate: string,
  taxInclusive: boolean = true
): TaxCalculationResult {
  const jurisdiction = normalizeJurisdiction(country)
  const engine = getTaxEngine(jurisdiction)
  const dateStr = effectiveDate.split('T')[0] // Extract date part
  
  const config: TaxEngineConfig = {
    jurisdiction,
    effectiveDate: dateStr,
    taxInclusive,
  }

  if (taxInclusive) {
    // If tax-inclusive, first calculate total from line items, then reverse calculate
    const subtotal = lineItems.reduce((sum, item) => {
      const lineTotal = item.quantity * item.unit_price
      const discount = item.discount_amount || 0
      return sum + lineTotal - discount
    }, 0)
    
    return engine.reverseCalculate(subtotal, config)
  } else {
    // If tax-exclusive, calculate directly from line items
    return engine.calculateFromLineItems(lineItems, config)
  }
}

/**
 * Calculate taxes from a taxable amount (after discounts)
 * 
 * Authority: This is the authoritative function for tax calculation from a single amount.
 * 
 * Error semantics:
 * - MissingCountryError: Country is null/undefined (configuration issue)
 * - UnsupportedCountryError: Country is supported (Tier 1/2) but engine not implemented
 * 
 * @param taxableAmount Base amount before taxes
 * @param country Business/store country code or name
 * @param effectiveDate ISO date string
 * @param taxInclusive Whether the amount includes tax
 * @returns TaxCalculationResult with tax lines and totals
 * @throws MissingCountryError if country is null/undefined
 * @throws UnsupportedCountryError if country is supported but engine not implemented
 */
export function calculateTaxesFromAmount(
  taxableAmount: number,
  country: string | null | undefined,
  effectiveDate: string,
  taxInclusive: boolean = true
): TaxCalculationResult {
  const jurisdiction = normalizeJurisdiction(country)
  const engine = getTaxEngine(jurisdiction)
  const dateStr = effectiveDate.split('T')[0]
  
  const config: TaxEngineConfig = {
    jurisdiction,
    effectiveDate: dateStr,
    taxInclusive,
  }

  if (taxInclusive) {
    return engine.reverseCalculate(taxableAmount, config)
  } else {
    return engine.calculateFromAmount(taxableAmount, config)
  }
}

/**
 * Helper to get tax line by code
 */
export function getTaxLineByCode(
  result: TaxCalculationResult,
  code: string
): { code: string; name: string; rate: number; base: number; amount: number } | undefined {
  return result.taxLines.find(line => line.code.toUpperCase() === code.toUpperCase())
}

/**
 * Helper to get legacy format for backward compatibility during migration
 * Returns object with nhil, getfund, covid, vat properties (for Ghana)
 */
export function getLegacyTaxAmounts(result: TaxCalculationResult): {
  nhil: number
  getfund: number
  covid: number
  vat: number
  totalTax: number
  grandTotal: number
} {
  const nhil = getTaxLineByCode(result, 'NHIL')?.amount || 0
  const getfund = getTaxLineByCode(result, 'GETFUND')?.amount || 0
  const covid = getTaxLineByCode(result, 'COVID')?.amount || 0
  const vat = getTaxLineByCode(result, 'VAT')?.amount || 0

  return {
    nhil,
    getfund,
    covid,
    vat,
    totalTax: result.tax_total,
    grandTotal: result.total_incl_tax,
  }
}

