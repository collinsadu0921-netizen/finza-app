/**
 * Shared Ghana Tax Versioning Logic
 * 
 * This module provides shared versioning logic for all Ghana tax calculation paths.
 * It ensures numerical consistency across:
 * - New tax engine (lib/taxEngine/jurisdictions/ghana.ts)
 * - Legacy engine (lib/ghanaTaxEngine.ts)
 * - Retail VAT helpers (lib/vat.ts)
 * 
 * All paths MUST use these functions to ensure identical results for the same effective date.
 */

/**
 * Ghana tax rate version
 */
export interface GhanaTaxRates {
  nhil: number
  getfund: number
  covid: number
  vat: number
}

/**
 * Ghana tax rate versions
 * Key: effective date (YYYY-MM-DD) - date when this version becomes active
 * Value: tax rates for that version
 */
const GHANA_TAX_VERSIONS: Record<string, GhanaTaxRates> = {
  // Version A: Includes COVID tax (effective from beginning until 2026-01-01)
  '1970-01-01': {
    nhil: 0.025, // 2.5%
    getfund: 0.025, // 2.5%
    covid: 0.01, // 1%
    vat: 0.15, // 15%
  },
  // Version B: COVID removed (effective from 2026-01-01)
  '2026-01-01': {
    nhil: 0.025, // 2.5%
    getfund: 0.025, // 2.5%
    covid: 0, // 0% - removed
    vat: 0.15, // 15%
  },
}

/**
 * Get tax rates for a specific effective date
 * 
 * Authority: This is the single source of truth for Ghana tax rates by date.
 * All Ghana tax calculation paths MUST use this function to ensure consistency.
 * 
 * Returns the most recent version that is effective on or before the given date.
 * 
 * @param effectiveDate ISO date string (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)
 * @returns Tax rates for the effective date
 */
export function getGhanaTaxRatesForDate(effectiveDate: string): GhanaTaxRates {
  const date = effectiveDate.split('T')[0] // Extract date part (YYYY-MM-DD)
  const versions = Object.keys(GHANA_TAX_VERSIONS)
    .filter(versionDate => versionDate <= date)
    .sort()
    .reverse() // Most recent first
  
  const latestVersion = versions[0] || '1970-01-01'
  return GHANA_TAX_VERSIONS[latestVersion]
}

/**
 * Check if effective date is on or after 2026-01-01 (simplified regime)
 * 
 * @param effectiveDate ISO date string (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)
 * @returns true if date is >= 2026-01-01 (simplified regime)
 */
export function isSimplifiedRegime(effectiveDate: string): boolean {
  const date = effectiveDate.split('T')[0] // Extract date part (YYYY-MM-DD)
  return date >= '2026-01-01'
}

/**
 * Calculate the tax multiplier for reverse calculation (tax-inclusive)
 * 
 * Authority: This is the single source of truth for Ghana tax multiplier calculation.
 * All reverse calculations MUST use this function to ensure consistency.
 * 
 * Pre-2026 (Compound Regime):
 * - VAT is calculated on (base + NHIL + GETFund + COVID)
 * - Formula: multiplier = (1 + nhil_rate + getfund_rate + covid_rate) * (1 + vat_rate)
 * - Example: (1 + 0.025 + 0.025 + 0.01) * 1.15 = 1.06 * 1.15 = 1.219
 * 
 * Post-2026 (Simplified Regime):
 * - VAT, NHIL, and GETFund are all calculated on the SAME base
 * - Total tax rate = vat_rate + nhil_rate + getfund_rate = 0.15 + 0.025 + 0.025 = 0.20
 * - Formula: multiplier = 1 + total_tax_rate = 1 + 0.20 = 1.20
 * 
 * @param rates Ghana tax rates (from getGhanaTaxRatesForDate)
 * @param effectiveDate ISO date string (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)
 * @returns Multiplier for reverse calculation
 */
export function getGhanaTaxMultiplier(rates: GhanaTaxRates, effectiveDate: string): number {
  if (isSimplifiedRegime(effectiveDate)) {
    // 2026+ Simplified Regime: All taxes on same base
    // Multiplier = 1 + total_tax_rate = 1 + (vat + nhil + getfund) = 1 + 0.20 = 1.20
    const totalTaxRate = rates.vat + rates.nhil + rates.getfund
    return 1 + totalTaxRate
  } else {
    // Pre-2026 Compound Regime: VAT on top of levies
    // Multiplier = (1 + nhil_rate + getfund_rate + covid_rate) * (1 + vat_rate)
    const leviesMultiplier = 1 + rates.nhil + rates.getfund + rates.covid
    const vatMultiplier = 1 + rates.vat
    return leviesMultiplier * vatMultiplier
  }
}

/**
 * Round to 2 decimal places.
 *
 * Uses Number.EPSILON correction before multiplication to prevent IEEE 754
 * half-rounding errors. Without this, values like 1.005 (represented internally
 * as 1.00499999…) round DOWN to 1.00 instead of UP to 1.01.
 *
 * Example failure without fix:
 *   Math.round(1.005 * 100) / 100  → 1.00  ❌ (should be 1.01)
 * With fix:
 *   Math.round((1.005 + ε) * 100) / 100 → 1.01  ✓
 */
export function roundGhanaTax(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Apply rounding balance to subtotal so subtotal + vat + nhil + getfund + covid = targetTotal.
 * Used to prevent unbalanced journal entries when tax components are rounded individually.
 * Delta is applied to the subtotal (expense line) only; tax rates and tax line amounts are unchanged.
 *
 * Decimal-safe: uses cents for comparison (abs(delta) >= 0.01).
 *
 * @param subtotal Current subtotal (before tax)
 * @param vat VAT amount
 * @param nhil NHIL amount
 * @param getfund GETFund amount
 * @param covid COVID amount
 * @param targetTotal Invoice/bill total that debits must equal
 * @returns Adjusted subtotal such that subtotal + vat + nhil + getfund + covid = targetTotal (to 2dp)
 */
export function applySubtotalRoundingBalance(
  subtotal: number,
  vat: number,
  nhil: number,
  getfund: number,
  covid: number,
  targetTotal: number
): number {
  const computedTotal = subtotal + vat + nhil + getfund + covid
  const deltaCents = Math.round((targetTotal - computedTotal) * 100)
  if (Math.abs(deltaCents) < 1) return subtotal // delta < 0.01
  const delta = deltaCents / 100
  return roundGhanaTax(subtotal + delta)
}

/**
 * Get engine version string for Ghana tax engine
 * 
 * Returns:
 * - "GH-2025-A" for dates before 2026-01-01 (Version A with COVID)
 * - "GH-2026-B" for dates on or after 2026-01-01 (Version B without COVID)
 * 
 * @param effectiveDate ISO date string (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)
 * @returns Engine version string (e.g., "GH-2025-A", "GH-2026-B")
 */
export function getGhanaEngineVersion(effectiveDate: string): string {
  const isPost2026 = isSimplifiedRegime(effectiveDate)
  return isPost2026 ? 'GH-2026-B' : 'GH-2025-A'
}