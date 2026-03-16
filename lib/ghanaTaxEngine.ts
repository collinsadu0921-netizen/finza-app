/**
 * Ghana Tax Engine - Legacy Implementation
 * 
 * NOTE: This is a legacy engine maintained for backward compatibility.
 * New code should use lib/taxEngine/jurisdictions/ghana.ts (the authoritative engine).
 * 
 * This engine now uses shared versioning logic (ghana-shared.ts) to ensure
 * numerical consistency with the new engine and retail VAT helpers.
 * 
 * Tax Structure (Version A - pre-2026):
 * - NHIL: 2.5% of taxable amount
 * - GETFund: 2.5% of taxable amount
 * - COVID: 1% of taxable amount
 * - VAT: 15% of (taxable amount + NHIL + GETFund + COVID)
 * 
 * Tax Structure (Version B - post-2026):
 * - NHIL: 2.5% of taxable amount
 * - GETFund: 2.5% of taxable amount
 * - COVID: 0% (removed)
 * - VAT: 15% of (taxable amount + NHIL + GETFund)
 * 
 * Calculation Method (uses versioned rates based on effectiveDate):
 *   rates = getGhanaTaxRatesForDate(effectiveDate)
 *   nhil = taxableAmount * rates.nhil
 *   getfund = taxableAmount * rates.getfund
 *   covid = taxableAmount * rates.covid
 *   vatBase = taxableAmount + nhil + getfund + covid
 *   vat = vatBase * rates.vat
 *   totalTax = nhil + getfund + covid + vat
 *   grandTotal = taxableAmount + totalTax
 */

import { getGhanaTaxRatesForDate, getGhanaTaxMultiplier, roundGhanaTax, isSimplifiedRegime, applySubtotalRoundingBalance } from './taxEngine/jurisdictions/ghana-shared'

export interface GhanaTaxResult {
  nhil: number
  getfund: number
  covid: number
  vat: number
  totalTax: number
  grandTotal: number
}

/**
 * Calculate Ghana taxes from a taxable amount
 * 
 * Uses shared versioning logic to ensure consistency with new engine.
 * Defaults to current date for backward compatibility (Version A pre-2026).
 * 
 * @param taxableAmount - The base amount before taxes
 * @param applyTaxes - Whether to apply taxes (if false, returns zeros)
 * @param effectiveDate - Optional effective date (ISO string YYYY-MM-DD). Defaults to current date.
 * @returns Tax breakdown with all components rounded to 2 decimals
 */
export function calculateGhanaTaxes(
  taxableAmount: number,
  applyTaxes: boolean = true,
  effectiveDate?: string
): GhanaTaxResult {
  if (!applyTaxes || taxableAmount <= 0) {
    return {
      nhil: 0,
      getfund: 0,
      covid: 0,
      vat: 0,
      totalTax: 0,
      grandTotal: taxableAmount,
    }
  }

  // Use shared versioning logic - default to current date for backward compatibility
  const dateToUse = effectiveDate || new Date().toISOString().split('T')[0]
  const rates = getGhanaTaxRatesForDate(dateToUse)
  const simplified = isSimplifiedRegime(dateToUse)

  // Calculate individual taxes on taxable amount using versioned rates
  const nhil = taxableAmount * rates.nhil
  const getfund = taxableAmount * rates.getfund
  const covid = taxableAmount * rates.covid

  // VAT calculation depends on regime:
  // Pre-2026 (Compound): VAT on (base + NHIL + GETFund + COVID)
  // Post-2026 (Simplified): VAT on same base as NHIL and GETFund
  let vat: number
  if (simplified) {
    // 2026+ Simplified Regime: All taxes on same base
    vat = taxableAmount * rates.vat
  } else {
    // Pre-2026 Compound Regime: VAT on top of levies
    const vatBase = taxableAmount + nhil + getfund + covid
    vat = vatBase * rates.vat
  }

  // Total tax
  const totalTax = nhil + getfund + covid + vat

  // Grand total
  const grandTotal = taxableAmount + totalTax

  // Round all values to 2 decimals using shared rounding function
  return {
    nhil: roundGhanaTax(nhil),
    getfund: roundGhanaTax(getfund),
    covid: roundGhanaTax(covid),
    vat: roundGhanaTax(vat),
    totalTax: roundGhanaTax(totalTax),
    grandTotal: roundGhanaTax(grandTotal),
  }
}

/**
 * Calculate Ghana taxes from line items
 * 
 * Uses shared versioning logic via calculateGhanaTaxes().
 * Defaults to current date for backward compatibility.
 * 
 * @param lineItems - Array of line items with quantity, unit_price, and optional discount
 * @param applyTaxes - Whether to apply taxes
 * @param effectiveDate - Optional effective date (ISO string YYYY-MM-DD). Defaults to current date.
 * @returns Tax breakdown
 */
export function calculateGhanaTaxesFromLineItems(
  lineItems: Array<{
    quantity: number
    unit_price: number
    discount_amount?: number
  }>,
  applyTaxes: boolean = true,
  effectiveDate?: string
): GhanaTaxResult {
  // Calculate subtotal from line items
  const subtotal = lineItems.reduce((sum, item) => {
    const lineTotal = item.quantity * item.unit_price
    const discount = item.discount_amount || 0
    return sum + lineTotal - discount
  }, 0)

  return calculateGhanaTaxes(subtotal, applyTaxes, effectiveDate)
}

/**
 * Calculate base amount from total including taxes (reverse calculation)
 * 
 * Uses shared versioning logic to ensure consistency with new engine.
 * Removed hardcoded 1.219 multiplier - now uses dynamic multiplier based on effective date.
 * 
 * Used when user enters total amount including taxes
 * 
 * @param totalIncludingTaxes - The total amount that includes all taxes
 * @param applyTaxes - Whether taxes were applied
 * @param effectiveDate - Optional effective date (ISO string YYYY-MM-DD). Defaults to current date.
 * @returns Object with base amount and tax breakdown
 */
export function calculateBaseFromTotalIncludingTaxes(
  totalIncludingTaxes: number,
  applyTaxes: boolean = true,
  effectiveDate?: string
): {
  baseAmount: number
  taxBreakdown: GhanaTaxResult
} {
  if (!applyTaxes || totalIncludingTaxes <= 0) {
    return {
      baseAmount: totalIncludingTaxes,
      taxBreakdown: {
        nhil: 0,
        getfund: 0,
        covid: 0,
        vat: 0,
        totalTax: 0,
        grandTotal: totalIncludingTaxes,
      },
    }
  }

  // Use shared versioning logic - default to current date for backward compatibility
  const dateToUse = effectiveDate || new Date().toISOString().split('T')[0]
  const rates = getGhanaTaxRatesForDate(dateToUse)
  
  // Use shared multiplier calculation (dynamic, not hardcoded)
  // For pre-2026: multiplier = 1.219 (compound regime)
  // For post-2026: multiplier = 1.20 (simplified regime - all taxes on same base)
  const multiplier = getGhanaTaxMultiplier(rates, dateToUse)

  // Reverse calculate base amount using dynamic multiplier
  // base = total_inclusive / multiplier
  const baseAmountUnrounded = totalIncludingTaxes / multiplier

  // Now calculate taxes on the base amount using same effective date
  const taxBreakdown = calculateGhanaTaxes(baseAmountUnrounded, true, dateToUse)

  // Ghana rounding balance: ensure baseAmount + vat + nhil + getfund + covid = totalIncludingTaxes so JE balances
  const targetTotal = roundGhanaTax(totalIncludingTaxes)
  const baseAmount = applySubtotalRoundingBalance(
    roundGhanaTax(baseAmountUnrounded),
    taxBreakdown.vat,
    taxBreakdown.nhil,
    taxBreakdown.getfund,
    taxBreakdown.covid,
    targetTotal
  )

  return {
    baseAmount,
    taxBreakdown: {
      ...taxBreakdown,
      grandTotal: targetTotal,
    },
  }
}

/**
 * Format tax breakdown for display
 */
export function formatTaxBreakdown(result: GhanaTaxResult) {
  return {
    nhil: result.nhil.toFixed(2),
    getfund: result.getfund.toFixed(2),
    covid: result.covid.toFixed(2),
    vat: result.vat.toFixed(2),
    totalTax: result.totalTax.toFixed(2),
    grandTotal: result.grandTotal.toFixed(2),
  }
}
