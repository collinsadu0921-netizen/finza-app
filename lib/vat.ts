/**
 * Ghana VAT Calculation Engine
 * Implements Ghana's mixed/compound VAT formula for Retail/POS
 * 
 * NOTE: This is a legacy implementation maintained for Retail compatibility.
 * Uses shared versioning logic (ghana-shared.ts) to ensure numerical consistency
 * with the new tax engine and legacy engine.
 * 
 * Supports VAT type filtering (standard/zero/exempt) for retail categories.
 */

import { getGhanaTaxRatesForDate, getGhanaTaxMultiplier, roundGhanaTax, isSimplifiedRegime } from './taxEngine/jurisdictions/ghana-shared'

export type VatType = "standard" | "zero" | "exempt"

export interface TaxBreakdown {
  taxable_amount: number
  nhil: number
  getfund: number
  covid: number
  vat_base: number
  vat: number
  total_tax: number
  total_with_tax: number
}

export interface CartItemTax {
  product_id: string
  product_name: string
  quantity: number
  unit_price: number
  subtotal: number
  vat_type: VatType
  tax_breakdown: TaxBreakdown
}

/**
 * Extract tax portions from VAT-inclusive price
 * 
 * Uses shared versioning logic to ensure consistency with new engine.
 * Removed hardcoded 1.219 multiplier - now uses dynamic multiplier based on effective date.
 * 
 * @param inclusivePrice - Price per unit (tax-inclusive)
 * @param quantity - Quantity
 * @param vatType - VAT type (standard/zero/exempt)
 * @param effectiveDate - Optional effective date (ISO string YYYY-MM-DD). Defaults to current date.
 * @returns Tax breakdown
 */
export function extractTaxFromInclusivePrice(
  inclusivePrice: number,
  quantity: number,
  vatType: VatType,
  effectiveDate?: string
): TaxBreakdown {
  const totalInclusive = inclusivePrice * quantity

  if (vatType === "zero" || vatType === "exempt") {
    return {
      taxable_amount: totalInclusive,
      nhil: 0,
      getfund: 0,
      covid: 0,
      vat_base: 0,
      vat: 0,
      total_tax: 0,
      total_with_tax: totalInclusive,
    }
  }

  // Use shared versioning logic - default to current date for backward compatibility
  const dateToUse = effectiveDate || new Date().toISOString().split('T')[0]
  const rates = getGhanaTaxRatesForDate(dateToUse)
  
  // Use shared multiplier calculation (dynamic, not hardcoded)
  // For pre-2026: multiplier = 1.219 (compound regime)
  // For post-2026: multiplier = 1.20 (simplified regime - all taxes on same base)
  const multiplier = getGhanaTaxMultiplier(rates, dateToUse)

  // Reverse calculation: base = total_inclusive / multiplier
  const basePrice = totalInclusive / multiplier
  
  // Calculate taxes using versioned rates
  const nhil = basePrice * rates.nhil
  const getfund = basePrice * rates.getfund
  const covid = basePrice * rates.covid
  const vat_base = basePrice + nhil + getfund + covid
  const vat = vat_base * rates.vat

  const total_tax = nhil + getfund + covid + vat
  const total_with_tax = totalInclusive // Already includes tax

  return {
    taxable_amount: roundGhanaTax(basePrice),
    nhil: roundGhanaTax(nhil),
    getfund: roundGhanaTax(getfund),
    covid: roundGhanaTax(covid),
    vat_base: roundGhanaTax(vat_base),
    vat: roundGhanaTax(vat),
    total_tax: roundGhanaTax(total_tax),
    total_with_tax: roundGhanaTax(total_with_tax),
  }
}

/**
 * Calculate Ghana VAT for a single item
 * 
 * Uses shared versioning logic to ensure consistency with new engine.
 * 
 * @param price - Price per unit
 * @param quantity - Quantity
 * @param vatType - VAT type (standard/zero/exempt)
 * @param effectiveDate - Optional effective date (ISO string YYYY-MM-DD). Defaults to current date.
 * @returns Tax breakdown
 */
export function calculateGhanaVAT(
  price: number,
  quantity: number,
  vatType: VatType,
  effectiveDate?: string
): TaxBreakdown {
  const taxable_amount = price * quantity

  if (vatType === "zero" || vatType === "exempt") {
    return {
      taxable_amount,
      nhil: 0,
      getfund: 0,
      covid: 0,
      vat_base: 0,
      vat: 0,
      total_tax: 0,
      total_with_tax: taxable_amount,
    }
  }

  // Use shared versioning logic - default to current date for backward compatibility
  const dateToUse = effectiveDate || new Date().toISOString().split('T')[0]
  const rates = getGhanaTaxRatesForDate(dateToUse)
  const simplified = isSimplifiedRegime(dateToUse)

  // Standard Rated - Ghana tax calculation using versioned rates
  const nhil = taxable_amount * rates.nhil
  const getfund = taxable_amount * rates.getfund
  const covid = taxable_amount * rates.covid

  // VAT calculation depends on regime:
  // Pre-2026 (Compound): VAT on (base + NHIL + GETFund + COVID)
  // Post-2026 (Simplified): VAT on same base as NHIL and GETFund
  let vat_base: number
  let vat: number
  if (simplified) {
    // 2026+ Simplified Regime: All taxes on same base
    vat_base = taxable_amount
    vat = vat_base * rates.vat
  } else {
    // Pre-2026 Compound Regime: VAT on top of levies
    vat_base = taxable_amount + nhil + getfund + covid
    vat = vat_base * rates.vat
  }

  const total_tax = nhil + getfund + covid + vat
  const total_with_tax = taxable_amount + total_tax

  return {
    taxable_amount: roundGhanaTax(taxable_amount),
    nhil: roundGhanaTax(nhil),
    getfund: roundGhanaTax(getfund),
    covid: roundGhanaTax(covid),
    vat_base: roundGhanaTax(vat_base),
    vat: roundGhanaTax(vat),
    total_tax: roundGhanaTax(total_tax),
    total_with_tax: roundGhanaTax(total_with_tax),
  }
}

/**
 * Calculate taxable subtotal from cart items
 * Only includes items where taxable === true (standard VAT type)
 */
function calculateTaxableSubtotal(
  cartItems: Array<{ product: { id: string; name: string; price: number; category_id?: string }; quantity: number }>,
  categories: Array<{ id: string; vat_type?: VatType }>
): number {
  return cartItems
    .filter((item) => {
      const category = categories.find((c) => c.id === item.product.category_id)
      const vatType: VatType = (category?.vat_type as VatType) || "standard"
      return vatType === "standard" // Only standard VAT type is taxable
    })
    .reduce((sum, item) => sum + item.product.price * item.quantity, 0)
}

/**
 * Calculate taxes for all cart items
 * Taxes are calculated ONCE on the combined taxable subtotal to avoid decimal inaccuracies
 * 
 * Uses shared versioning logic to ensure consistency with new engine.
 * 
 * @param cartItems - Array of cart items with product and quantity
 * @param categories - Array of product categories with VAT type
 * @param vatInclusive - If true, prices are VAT-inclusive. Taxes will be extracted internally but not added to total.
 * @param effectiveDate - Optional effective date (ISO string YYYY-MM-DD). Defaults to current date.
 */
export function calculateCartTaxes(
  cartItems: Array<{ product: { id: string; name: string; price: number; category_id?: string }; quantity: number }>,
  categories: Array<{ id: string; vat_type?: VatType }>,
  vatInclusive: boolean = false,
  effectiveDate?: string
): {
  items: CartItemTax[]
  totals: {
    subtotal: number
    nhil: number
    getfund: number
    covid: number
    vat: number
    total_tax: number
    grand_total: number
  }
  vat_types: {
    standard: number
    zero: number
    exempt: number
  }
} {
  const items: CartItemTax[] = []
  let subtotal = 0
  const vat_types = {
    standard: 0,
    zero: 0,
    exempt: 0,
  }

  // First pass: categorize items and calculate subtotals
  for (const item of cartItems) {
    // Find category VAT type
    const category = categories.find((c) => c.id === item.product.category_id)
    const vatType: VatType = (category?.vat_type as VatType) || "standard"

    const sellingPrice = item.product.price * item.quantity
    subtotal += sellingPrice
    vat_types[vatType] += sellingPrice

    // Calculate tax breakdown based on mode, using shared effective date
    const dateToUse = effectiveDate || new Date().toISOString().split('T')[0]
    const taxBreakdown = vatInclusive
      ? extractTaxFromInclusivePrice(item.product.price, item.quantity, vatType, dateToUse)
      : calculateGhanaVAT(item.product.price, item.quantity, vatType, dateToUse)

    items.push({
      product_id: item.product.id,
      product_name: item.product.name,
      quantity: item.quantity,
      unit_price: item.product.price,
      subtotal: sellingPrice,
      vat_type: vatType,
      tax_breakdown: taxBreakdown,
    })
  }

  if (vatInclusive) {
    // VAT-inclusive mode: prices already include tax
    // Extract tax portions internally for reporting, but don't add to total
    const taxableSubtotal = calculateTaxableSubtotal(cartItems, categories)
    
    // Use shared versioning logic - default to current date for backward compatibility
    const dateToUse = effectiveDate || new Date().toISOString().split('T')[0]
    const rates = getGhanaTaxRatesForDate(dateToUse)
    const simplified = isSimplifiedRegime(dateToUse)
    
    // Use shared multiplier calculation (dynamic, not hardcoded)
    const multiplier = getGhanaTaxMultiplier(rates, dateToUse)
    
    // Extract base price from VAT-inclusive total using dynamic multiplier
    const basePrice = taxableSubtotal / multiplier
    
    // Calculate taxes using versioned rates
    // RETAIL: COVID Levy removed - always 0 for retail
    const nhil = basePrice * rates.nhil
    const getfund = basePrice * rates.getfund
    const covid = 0 // RETAIL: COVID Levy removed
    
    // VAT calculation depends on regime:
    // Pre-2026 (Compound): VAT on (base + NHIL + GETFund)
    // Post-2026 (Simplified): VAT on same base as NHIL and GETFund
    let vat_base: number
    let vat: number
    if (simplified) {
      // 2026+ Simplified Regime: All taxes on same base
      vat_base = basePrice
      vat = vat_base * rates.vat
    } else {
      // Pre-2026 Compound Regime: VAT on top of levies
      vat_base = basePrice + nhil + getfund // RETAIL: VAT base excludes COVID
      vat = vat_base * rates.vat
    }

    const total_tax = nhil + getfund + covid + vat
    // Grand total = subtotal (already includes tax, no need to add again)
    const grand_total = subtotal

    // ROUNDING RECONCILIATION: Round total_tax first, then ensure sum of rounded components equals it
    // This preserves the invariant: gross = base + tax (for VAT-inclusive pricing)
    const rounded_total_tax = roundGhanaTax(total_tax)
    const rounded_nhil = roundGhanaTax(nhil)
    const rounded_getfund = roundGhanaTax(getfund)
    const rounded_covid = roundGhanaTax(covid)
    const rounded_vat = roundGhanaTax(vat)
    
    // Calculate sum of rounded components
    const sum_of_rounded_components = rounded_nhil + rounded_getfund + rounded_covid + rounded_vat
    
    // Apply rounding adjustment to largest component (VAT) to reconcile
    const rounding_adjustment = rounded_total_tax - sum_of_rounded_components
    const adjusted_vat = rounded_vat + rounding_adjustment

    return {
      items,
      totals: {
        subtotal,
        nhil: rounded_nhil,
        getfund: rounded_getfund,
        covid: rounded_covid,
        vat: adjusted_vat, // Adjusted to preserve gross = base + tax
        total_tax: rounded_total_tax,
        grand_total,
      },
      vat_types,
    }
  }

  // VAT-exclusive mode: add taxes to price
  // Calculate taxable subtotal (only standard VAT type items)
  const taxableSubtotal = calculateTaxableSubtotal(cartItems, categories)

    // Use shared versioning logic - default to current date for backward compatibility
    const dateToUse = effectiveDate || new Date().toISOString().split('T')[0]
    const rates = getGhanaTaxRatesForDate(dateToUse)
    const simplified = isSimplifiedRegime(dateToUse)

    // Apply all Ghana taxes ONCE using versioned rates
    // Do NOT round at each step (round at end only)
    // RETAIL: COVID Levy removed - always 0 for retail
    const nhil = taxableSubtotal * rates.nhil
    const getfund = taxableSubtotal * rates.getfund
    const covid = 0 // RETAIL: COVID Levy removed
    
    // VAT calculation for retail (always simplified - excludes COVID):
    // RETAIL: VAT on (base + NHIL + GETFund) - COVID excluded
    const vat_base = taxableSubtotal + nhil + getfund
    const vat = vat_base * rates.vat

  const total_tax = nhil + getfund + covid + vat
  const grand_total = subtotal + total_tax

  return {
    items,
    totals: {
      subtotal,
      nhil: roundGhanaTax(nhil),
      getfund: roundGhanaTax(getfund),
      covid: roundGhanaTax(covid),
      vat: roundGhanaTax(vat),
      total_tax: roundGhanaTax(total_tax),
      grand_total: roundGhanaTax(grand_total),
    },
    vat_types,
  }
}






