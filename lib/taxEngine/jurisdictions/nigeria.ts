/**
 * Nigeria Tax Engine Implementation
 * 
 * Minimal VAT-only tax engine for Nigeria.
 * VAT Rate: 7.5%
 * 
 * Calculation:
 * - Exclusive: tax = baseAmount * 0.075
 * - Inclusive: base = total / 1.075
 */

import type { TaxEngine, TaxCalculationResult, TaxEngineConfig, LineItem } from '../types'

/**
 * Round to 2 decimal places
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

const VAT_RATE = 0.075 // 7.5%

/**
 * Nigeria Tax Engine
 */
export const nigeriaTaxEngine: TaxEngine = {
  calculateFromLineItems(
    lineItems: LineItem[],
    config: TaxEngineConfig
  ): TaxCalculationResult {
    // Calculate subtotal after discounts
    const subtotal = lineItems.reduce((sum: number, item: LineItem) => {
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

    const transactionType = config.transactionType || 'sale'

    // Simple VAT calculation: tax = base * rate
    const vatAmount = round2(taxableAmount * VAT_RATE)

    // VAT is creditable for purchases
    const isCreditableInput = transactionType === 'purchase'

    const taxLines: Array<import('../types').LegacyTaxLine> = [
      {
        code: 'VAT',
        name: 'VAT',
        rate: VAT_RATE,
        base: round2(taxableAmount),
        amount: vatAmount,
        ledger_account_code: '2100', // Standard VAT control account
        ledger_side: transactionType === 'sale' ? 'credit' : 'debit',
        is_creditable_input: isCreditableInput,
        absorbed_to_cost: false,
      },
    ]

    const tax_total = round2(vatAmount)
    const total_incl_tax = round2(taxableAmount + tax_total)

    return {
      taxLines,
      subtotal_excl_tax: round2(taxableAmount),
      tax_total,
      total_incl_tax,
    }
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

    // Reverse calculation: base = total / (1 + rate)
    // For 7.5% VAT: base = total / 1.075
    const baseAmount = round2(totalInclusive / (1 + VAT_RATE))

    // Now calculate taxes on the base amount
    return this.calculateFromAmount(baseAmount, config)
  },
}
