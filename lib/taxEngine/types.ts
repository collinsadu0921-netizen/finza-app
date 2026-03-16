/**
 * Shared Tax Engine Types
 * Generic types for all tax jurisdictions
 */

/**
 * Canonical Tax Line Type (Locked Contract)
 * This is the authoritative shape for tax lines returned by tax engines.
 */
export type TaxLine = {
  code: string           // e.g. VAT, NHIL, GETFUND, COVID
  amount: number         // 2dp rounded
  rate?: number          // optional, for audit/explainability
  name?: string          // human-readable
  meta?: Record<string, any>
}

/**
 * Canonical Tax Result Type (Locked Contract)
 * This is the authoritative shape for tax calculation results.
 * All tax engines MUST return this exact shape.
 */
export type TaxResult = {
  base_amount: number    // subtotal excl tax (2dp)
  total_tax: number      // sum of tax lines (2dp)
  total_amount: number   // base + tax (2dp)
  pricing_mode: "inclusive" | "exclusive"
  lines: TaxLine[]
  meta: {
    jurisdiction: string          // e.g. "GH"
    effective_date_used: string   // ISO date actually applied
    engine_version: string        // e.g. "GH-2025-A", "GH-2026-B"
  }
}

/**
 * Legacy Tax Line Interface (for backward compatibility with TaxEngine interface)
 * @deprecated Use TaxLine type instead. This is kept for the TaxEngine interface.
 */
export interface LegacyTaxLine {
  code: string
  name: string
  rate: number // Decimal rate (e.g., 0.15 for 15%)
  base: number // Taxable base amount
  amount: number // Calculated tax amount
  ledger_account_code?: string | null // Ledger account code for posting (e.g., '2100', '2110'). null = non-creditable input (absorb into expense/asset)
  ledger_side?: 'debit' | 'credit' | null // Posting side. null = non-creditable input (absorb into expense/asset)
  is_creditable_input?: boolean // Whether input tax is creditable (can offset output tax)
  absorbed_to_cost?: boolean // Whether tax is absorbed into cost (true for purchase + non-creditable inputs)
}

export interface TaxCalculationResult {
  taxLines: LegacyTaxLine[]
  subtotal_excl_tax: number // Subtotal before taxes (after discounts)
  tax_total: number // Sum of all tax amounts
  total_incl_tax: number // Final total including all taxes
}

export interface TaxEngineConfig {
  jurisdiction: string // Country code (e.g., 'GH', 'US', 'KE')
  effectiveDate: string // ISO date string (YYYY-MM-DD)
  taxInclusive: boolean // Whether input prices include tax
  transactionType?: 'sale' | 'purchase' // Transaction type: 'sale' = output tax, 'purchase' = input tax. Defaults to 'sale' if not provided
}

export interface LineItem {
  quantity: number
  unit_price: number
  discount_amount?: number // Discount reduces taxable base
}

/**
 * Tax Engine Interface
 * All jurisdiction-specific tax engines must implement this interface
 */
export interface TaxEngine {
  /**
   * Calculate taxes from line items
   * @param lineItems Array of line items with quantity, price, and optional discount
   * @param config Tax engine configuration
   * @returns Tax calculation result with tax lines and totals
   */
  calculateFromLineItems(
    lineItems: LineItem[],
    config: TaxEngineConfig
  ): TaxCalculationResult

  /**
   * Calculate taxes from a taxable amount
   * @param taxableAmount Base amount before taxes (after discounts)
   * @param config Tax engine configuration
   * @returns Tax calculation result
   */
  calculateFromAmount(
    taxableAmount: number,
    config: TaxEngineConfig
  ): TaxCalculationResult

  /**
   * Reverse calculate: extract base amount and taxes from a tax-inclusive total
   * @param totalInclusive Total amount that includes all taxes
   * @param config Tax engine configuration
   * @returns Tax calculation result with extracted base and taxes
   */
  reverseCalculate(
    totalInclusive: number,
    config: TaxEngineConfig
  ): TaxCalculationResult
}

