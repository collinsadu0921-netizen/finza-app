/**
 * Ghana Tax Engine Implementation
 * Implements Ghana's compound VAT structure with versioned rules:
 * 
 * Version A (before 2026-01-01):
 * - NHIL: 2.5% of taxable amount
 * - GETFund: 2.5% of taxable amount
 * - COVID: 1% of taxable amount
 * - VAT: 15% of (taxable amount + NHIL + GETFund + COVID)
 * 
 * Version B (>= 2026-01-01):
 * - NHIL: 2.5% of taxable amount
 * - GETFund: 2.5% of taxable amount
 * - COVID: 0% (removed)
 * - VAT: 15% of (taxable amount + NHIL + GETFund)
 * 
 * Authority: Uses shared versioning logic from ghana-shared.ts to ensure
 * numerical consistency with legacy engine and retail VAT helpers.
 */

import type { TaxEngine, TaxCalculationResult, TaxEngineConfig, LineItem, LegacyTaxLine } from '../types'
import type { TaxResult } from '../types'
import { getGhanaTaxRatesForDate, getGhanaTaxMultiplier, roundGhanaTax, isSimplifiedRegime, getGhanaEngineVersion } from './ghana-shared'
import { legacyToCanonicalResult } from '../adapters'

/**
 * Check if a date is on or after 2026-01-01 (post-reform)
 */
function isPostReform(effectiveDate: string): boolean {
  const date = effectiveDate.split('T')[0] // Extract date part (YYYY-MM-DD)
  return date >= '2026-01-01'
}

/**
 * Get ledger posting metadata for a tax line
 * Returns { ledger_account_code, ledger_side, is_creditable_input }
 */
function getLedgerMetadata(
  taxCode: string,
  transactionType: 'sale' | 'purchase',
  effectiveDate: string
): {
  ledger_account_code: string | null
  ledger_side: 'debit' | 'credit' | null
  is_creditable_input: boolean
} {
  const postReform = isPostReform(effectiveDate)
  const isSale = transactionType === 'sale'
  const isPurchase = transactionType === 'purchase'

  // VAT: Always posts to control account
  if (taxCode === 'VAT') {
    if (isSale) {
      return {
        ledger_account_code: '2100',
        ledger_side: 'credit',
        is_creditable_input: false,
      }
    } else {
      // Purchase: always creditable, debit control account
      return {
        ledger_account_code: '2100',
        ledger_side: 'debit',
        is_creditable_input: true,
      }
    }
  }

  // NHIL
  if (taxCode === 'NHIL') {
    if (isSale) {
      return {
        ledger_account_code: '2110',
        ledger_side: 'credit',
        is_creditable_input: false,
      }
    } else {
      // Purchase
      if (postReform) {
        // Post-2026: creditable, debit control account
        return {
          ledger_account_code: '2110',
          ledger_side: 'debit',
          is_creditable_input: true,
        }
      } else {
        // Pre-2026: non-creditable, null account/side (absorb into expense/asset)
        return {
          ledger_account_code: null,
          ledger_side: null,
          is_creditable_input: false,
        }
      }
    }
  }

  // GETFund
  if (taxCode === 'GETFUND') {
    if (isSale) {
      return {
        ledger_account_code: '2120',
        ledger_side: 'credit',
        is_creditable_input: false,
      }
    } else {
      // Purchase
      if (postReform) {
        // Post-2026: creditable, debit control account
        return {
          ledger_account_code: '2120',
          ledger_side: 'debit',
          is_creditable_input: true,
        }
      } else {
        // Pre-2026: non-creditable, null account/side (absorb into expense/asset)
        return {
          ledger_account_code: null,
          ledger_side: null,
          is_creditable_input: false,
        }
      }
    }
  }

  // COVID (only pre-2026)
  if (taxCode === 'COVID') {
    // Post-2026: always return null/null/false even if called
    if (postReform) {
      return {
        ledger_account_code: null,
        ledger_side: null,
        is_creditable_input: false,
      }
    }
    
    // Pre-2026 logic
    if (isSale) {
      // Sales: credit control account (pre-2026 only)
      return {
        ledger_account_code: '2130',
        ledger_side: 'credit',
        is_creditable_input: false,
      }
    } else {
      // Purchase: always non-creditable, null account/side (absorb into expense/asset)
      return {
        ledger_account_code: null,
        ledger_side: null,
        is_creditable_input: false,
      }
    }
  }

  // Default fallback
  return {
    ledger_account_code: null,
    ledger_side: null,
    is_creditable_input: false,
  }
}


/**
 * Convert legacy TaxCalculationResult to canonical TaxResult
 */
function toTaxResult(
  result: TaxCalculationResult,
  config: TaxEngineConfig
): TaxResult {
  return legacyToCanonicalResult(
    result,
    {
      jurisdiction: config.jurisdiction,
      effectiveDate: config.effectiveDate,
      taxInclusive: config.taxInclusive,
    },
    getGhanaEngineVersion
  )
}
/**
 * Ghana Tax Engine
 * 
 * Returns TaxResult (canonical contract) for all operations.
 * For backward compatibility with TaxEngine interface, also implements TaxCalculationResult.
 */
export const ghanaTaxEngine: TaxEngine = {
  calculateFromLineItems(
    lineItems: LineItem[],
    config: TaxEngineConfig
  ): TaxCalculationResult {
    // Calculate subtotal after discounts
    const subtotal = lineItems.reduce((sum, item) => {
      const lineTotal = item.quantity * item.unit_price
      const discount = item.discount_amount || 0
      return sum + lineTotal - discount
    }, 0)

    return this.calculateFromAmount(subtotal, config)
  },

  calculateFromAmount(
    taxableAmount: number,
    config: TaxEngineConfig
  ): TaxCalculationResult {
    if (taxableAmount <= 0) {
      return {
        taxLines: [],
        subtotal_excl_tax: 0,
        tax_total: 0,
        total_incl_tax: 0,
      }
    }

    const rates = getGhanaTaxRatesForDate(config.effectiveDate)
    const transactionType = config.transactionType || 'sale' // Default to 'sale' for backward compatibility
    const simplified = isSimplifiedRegime(config.effectiveDate)

    // Calculate individual taxes on taxable amount (UNROUNDED first for reconciliation)
    const nhilAmountUnrounded = taxableAmount * rates.nhil
    const getfundAmountUnrounded = taxableAmount * rates.getfund
    const covidAmountUnrounded = taxableAmount * rates.covid

    // VAT calculation depends on regime:
    // Pre-2026 (Compound): VAT on (base + NHIL + GETFund + COVID)
    // Post-2026 (Simplified): VAT on same base as NHIL and GETFund
    let vatBase: number
    let vatAmountUnrounded: number
    if (simplified) {
      // 2026+ Simplified Regime: All taxes on same base
      vatBase = taxableAmount
      vatAmountUnrounded = vatBase * rates.vat
    } else {
      // Pre-2026 Compound Regime: VAT on top of levies
      // Use unrounded amounts for VAT base calculation to avoid compounding rounding errors
      vatBase = taxableAmount + nhilAmountUnrounded + getfundAmountUnrounded + covidAmountUnrounded
      vatAmountUnrounded = vatBase * rates.vat
    }

    // ROUNDING RECONCILIATION: Calculate total_tax unrounded, round the total authoritatively,
    // then round each component independently. Any residual delta becomes an explicit ROUNDING line
    // (account 7990) rather than being silently absorbed into VAT.
    const totalTaxUnrounded = nhilAmountUnrounded + getfundAmountUnrounded + covidAmountUnrounded + vatAmountUnrounded
    const roundedTotalTax = roundGhanaTax(totalTaxUnrounded) // Authoritative rounded total

    // Round individual components — each at its own mathematically correct value
    const nhilAmount = roundGhanaTax(nhilAmountUnrounded)
    const getfundAmount = roundGhanaTax(getfundAmountUnrounded)
    const covidAmount = roundGhanaTax(covidAmountUnrounded)
    const vatAmount = roundGhanaTax(vatAmountUnrounded) // NOT adjusted — pure rate × base

    // Rounding delta: difference between authoritative total and sum of individually-rounded components.
    // Typically ±0.01 or zero. Will become an explicit ROUNDING TaxLine when non-zero.
    const sumOfRoundedComponents = nhilAmount + getfundAmount + covidAmount + vatAmount
    const roundingDelta = Math.round((roundedTotalTax - sumOfRoundedComponents) * 100) / 100

    // Build tax lines (only include non-zero taxes)
    const nhilMetadata = getLedgerMetadata('NHIL', transactionType, config.effectiveDate)
    const getfundMetadata = getLedgerMetadata('GETFUND', transactionType, config.effectiveDate)
    
    const taxLines: LegacyTaxLine[] = [
      {
        code: 'NHIL',
        name: 'NHIL',
        rate: rates.nhil,
        base: roundGhanaTax(taxableAmount),
        amount: nhilAmount,
        ledger_account_code: nhilMetadata.ledger_account_code,
        ledger_side: nhilMetadata.ledger_side,
        is_creditable_input: nhilMetadata.is_creditable_input,
        absorbed_to_cost: transactionType === 'purchase' && !nhilMetadata.is_creditable_input,
      },
      {
        code: 'GETFUND',
        name: 'GETFund',
        rate: rates.getfund,
        base: roundGhanaTax(taxableAmount),
        amount: getfundAmount,
        ledger_account_code: getfundMetadata.ledger_account_code,
        ledger_side: getfundMetadata.ledger_side,
        is_creditable_input: getfundMetadata.is_creditable_input,
        absorbed_to_cost: transactionType === 'purchase' && !getfundMetadata.is_creditable_input,
      },
    ]

    // Only include COVID if rate is non-zero (Version A only, removed in Version B)
    if (rates.covid > 0) {
      const covidMetadata = getLedgerMetadata('COVID', transactionType, config.effectiveDate)
      taxLines.push({
        code: 'COVID',
        name: 'COVID',
        rate: rates.covid,
        base: roundGhanaTax(taxableAmount),
        amount: covidAmount,
        ledger_account_code: covidMetadata.ledger_account_code,
        ledger_side: covidMetadata.ledger_side,
        is_creditable_input: covidMetadata.is_creditable_input,
        absorbed_to_cost: transactionType === 'purchase' && !covidMetadata.is_creditable_input,
      })
    }

    const vatMetadata = getLedgerMetadata('VAT', transactionType, config.effectiveDate)
    taxLines.push({
        code: 'VAT',
        name: 'VAT',
        rate: rates.vat,
        base: roundGhanaTax(vatBase),
        amount: vatAmount,
      ledger_account_code: vatMetadata.ledger_account_code,
      ledger_side: vatMetadata.ledger_side,
      is_creditable_input: vatMetadata.is_creditable_input,
      absorbed_to_cost: transactionType === 'purchase' && !vatMetadata.is_creditable_input,
    })

    // Explicit ROUNDING line: industry-standard approach — never silently inflate a tax component.
    // If the sum of individually-rounded components doesn't reach the authoritative total,
    // the delta is posted as a separate line to account 7990 (Rounding Adjustment).
    if (Math.abs(roundingDelta) >= 0.005) {
      // For a sale the rounding credit closes the AR/Revenue/Tax journal.
      // For a purchase the same delta closes the AP/Expense/Tax journal on the debit side.
      // If delta is negative (components sum > authoritative total), flip the side.
      const roundingAmount = Math.abs(roundingDelta)
      const isSale = transactionType === 'sale'
      const deltaIsPositive = roundingDelta > 0
      const roundingLedgerSide: 'credit' | 'debit' =
        isSale
          ? deltaIsPositive ? 'credit' : 'debit'
          : deltaIsPositive ? 'debit' : 'credit'

      taxLines.push({
        code: 'ROUNDING',
        name: 'Rounding Adjustment',
        rate: 0,
        base: 0,
        amount: roundingAmount,
        ledger_account_code: '7990',
        ledger_side: roundingLedgerSide,
        is_creditable_input: false,
        absorbed_to_cost: false,
      })
    }

    // tax_total is the authoritative rounded total (= sumOfRoundedComponents + roundingDelta)
    const tax_total = roundedTotalTax
    // total_incl_tax = subtotal + tax_total. Both are already 2dp so no further rounding needed,
    // but roundGhanaTax is a no-op on 2dp values and serves as defensive documentation.
    const subtotal_excl_tax = roundGhanaTax(taxableAmount)
    const total_incl_tax = roundGhanaTax(taxableAmount + tax_total)

    const legacyResult: TaxCalculationResult = {
      taxLines,
      subtotal_excl_tax,
      tax_total,
      total_incl_tax,
    }

    return legacyResult
  },

  reverseCalculate(
    totalInclusive: number,
    config: TaxEngineConfig
  ): TaxCalculationResult {
    if (totalInclusive <= 0) {
      return {
        taxLines: [],
        subtotal_excl_tax: 0,
        tax_total: 0,
        total_incl_tax: 0,
      }
    }

    const rates = getGhanaTaxRatesForDate(config.effectiveDate)
    const multiplier = getGhanaTaxMultiplier(rates, config.effectiveDate)

    // Step 1: derive the pre-tax base by dividing by the multiplier.
    // Rounding the base to 2dp is unavoidable (e.g. 20000/1.20 = 16666.666…),
    // which means base × multiplier ≠ totalInclusive in general.
    const baseAmount = roundGhanaTax(totalInclusive / multiplier)

    // Step 2: compute tax components on the rounded base (forward calc).
    const result = this.calculateFromAmount(baseAmount, config)

    // Step 3: anchor the result to the original user input.
    //
    // calculateFromAmount returns total_incl_tax = base + roundedTotalTax.
    // Due to rounding, this can differ from totalInclusive by ±0.01 (e.g.
    // base=16666.67, roundedTotalTax=3333.33, total=19999.00 → not 20000.00).
    // It also emits a ROUNDING TaxLine (Dr/Cr 0.01 to account 7990) to balance
    // the journal entry — but that line makes the journal entry total 20000.01,
    // which is what the user saw in the ledger.
    //
    // For a REVERSE calculation the correct behaviour is:
    //   • totalInclusive is authoritative (what the customer pays = AR debit).
    //   • The revenue line absorbs the cent-level rounding difference.
    //   • No ROUNDING (7990) line is needed.
    //
    // Approach:
    //   1. Drop any ROUNDING lines from the forward result.
    //   2. Sum only the credit-side tax amounts (NHIL, GETFund, VAT).
    //   3. anchoredSubtotal = totalInclusive − creditTaxSum.
    //      In PostgreSQL NUMERIC (exact decimal) this makes:
    //        Cr Revenue + Cr NHIL + Cr GETFund + Cr VAT = totalInclusive  ✓
    //   4. tax_total = creditTaxSum (the real charges, not roundedTotalTax).

    const nonRoundingLines = result.taxLines.filter(l => l.code !== 'ROUNDING')

    const creditTaxSum = roundGhanaTax(
      nonRoundingLines
        .filter(l => l.ledger_side === 'credit')
        .reduce((sum, l) => sum + l.amount, 0)
    )

    // Revenue = invoice total − tax credits.  Stored as invoice.subtotal.
    // PostgreSQL NUMERIC ensures anchoredSubtotal + creditTaxSum = totalInclusive exactly.
    const anchoredSubtotal = roundGhanaTax(totalInclusive - creditTaxSum)

    return {
      ...result,
      taxLines: nonRoundingLines,         // no 7990 ROUNDING line for reverse calc
      subtotal_excl_tax: anchoredSubtotal, // revenue credit — anchored to user's total
      tax_total: creditTaxSum,             // actual sum charged (may differ from roundedTotalTax by 0.01)
      total_incl_tax: totalInclusive,      // exact user input — never re-derived from components
    }
  },
}

/**
 * Ghana Tax Engine - Canonical API
 * 
 * Public API that always returns TaxResult (locked contract).
 * Use these functions instead of the TaxEngine interface methods.
 */
export const ghanaTaxEngineCanonical = {
  calculateFromLineItems(
    lineItems: LineItem[],
    config: TaxEngineConfig
  ): TaxResult {
    const legacyResult = ghanaTaxEngine.calculateFromLineItems(lineItems, config)
    return toTaxResult(legacyResult, config)
  },

  calculateFromAmount(
    taxableAmount: number,
    config: TaxEngineConfig
  ): TaxResult {
    const legacyResult = ghanaTaxEngine.calculateFromAmount(taxableAmount, config)
    return toTaxResult(legacyResult, config)
  },

  reverseCalculate(
    totalInclusive: number,
    config: TaxEngineConfig
  ): TaxResult {
    const legacyResult = ghanaTaxEngine.reverseCalculate(totalInclusive, config)
    return toTaxResult(legacyResult, config)
  },
}





