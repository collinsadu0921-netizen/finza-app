/**
 * Withholding Tax (WHT) helpers for Ghana
 *
 * WHT is deducted at source from payments to suppliers.
 * The payer withholds the tax and remits it to GRA on behalf of the supplier.
 *
 * Example:
 *   Bill total (from supplier): GHS 1,000
 *   WHT @ 5%:                  -GHS 50    → payable to GRA
 *   Net paid to supplier:       GHS 950
 */

export type WHTRate = {
  code: string
  name: string
  rate: number        // decimal, e.g. 0.05 for 5%
  description: string
}

/** Default WHT rates for Ghana (mirrors wht_rates table seed) */
export const GH_WHT_RATES: WHTRate[] = [
  { code: 'GH_SVC_5',   name: 'Services – Resident (5%)',         rate: 0.05, description: 'Payments for services by a resident person' },
  { code: 'GH_GOODS_3', name: 'Supply of Goods – Resident (3%)',  rate: 0.03, description: 'Payments for supply of goods by a resident person' },
  { code: 'GH_RENT_8',  name: 'Rent (8%)',                        rate: 0.08, description: 'Rental payments for the use of property' },
  { code: 'GH_INT_8',   name: 'Interest (8%)',                    rate: 0.08, description: 'Interest payments to residents' },
  { code: 'GH_DIV_8',   name: 'Dividends (8%)',                   rate: 0.08, description: 'Dividend payments to residents' },
  { code: 'GH_MGMT_20', name: 'Management / Technical Fees (20%)', rate: 0.20, description: 'Fees paid to non-residents for management or technical services' },
  { code: 'GH_NR_20',   name: 'Non-Resident Payments (20%)',      rate: 0.20, description: 'Payments to non-resident persons (general)' },
]

/**
 * Calculate WHT amount from a gross bill total.
 * WHT is calculated on the gross (VAT-inclusive) amount.
 *
 * @param grossAmount  Total amount including VAT (what you'd normally pay the supplier)
 * @param rate         WHT rate as decimal (e.g. 0.05)
 * @returns            WHT amount (rounded to 2dp), and the net amount to pay supplier
 */
export function calculateWHT(grossAmount: number, rate: number): {
  whtAmount: number
  netPayable: number
} {
  const whtAmount = Math.round(grossAmount * rate * 100) / 100
  const netPayable = Math.round((grossAmount - whtAmount) * 100) / 100
  return { whtAmount, netPayable }
}

/**
 * Get a WHT rate by code.
 */
export function getWHTRate(code: string): WHTRate | undefined {
  return GH_WHT_RATES.find(r => r.code === code)
}

/**
 * Format WHT rate as percentage string.
 */
export function formatWHTRate(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`
}
