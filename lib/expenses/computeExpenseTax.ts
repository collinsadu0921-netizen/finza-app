import {
  calculateGhanaTaxes,
  calculateBaseFromTotalIncludingTaxes,
} from "@/lib/ghanaTaxEngine"

export type ExpensePricingMode = "inclusive" | "exclusive"

export type ComputedExpenseTax = {
  baseAmount: number
  nhil: number
  getfund: number
  covid: number
  vat: number
  totalTax: number
  total: number
}

/**
 * Authoritatively compute an expense's net base, tax components and gross total
 * from the user-entered amount and pricing mode.
 *
 * - inclusive: `enteredAmount` is the gross; taxes are extracted (reverse).
 * - exclusive: `enteredAmount` is the net; taxes are added on top (forward).
 * - taxes disabled: base = total = enteredAmount, no tax.
 *
 * Uses the legacy Ghana engine (the same functions the expense UI and posting
 * path already rely on) so rounding and historical-date behaviour are preserved.
 */
export function computeExpenseTax(
  enteredAmount: number,
  applyTaxes: boolean,
  pricingMode: ExpensePricingMode,
  effectiveDate: string
): ComputedExpenseTax {
  const amount = Number(enteredAmount) || 0
  const zero = { baseAmount: amount, nhil: 0, getfund: 0, covid: 0, vat: 0, totalTax: 0, total: amount }

  if (!applyTaxes || amount <= 0) {
    return zero
  }

  if (pricingMode === "exclusive") {
    const r = calculateGhanaTaxes(amount, true, effectiveDate)
    return {
      baseAmount: round2(amount),
      nhil: round2(r.nhil),
      getfund: round2(r.getfund),
      covid: round2(r.covid),
      vat: round2(r.vat),
      totalTax: round2(r.totalTax),
      total: round2(r.grandTotal),
    }
  }

  const { baseAmount, taxBreakdown } = calculateBaseFromTotalIncludingTaxes(
    amount,
    true,
    effectiveDate
  )
  return {
    baseAmount: round2(baseAmount),
    nhil: round2(taxBreakdown.nhil),
    getfund: round2(taxBreakdown.getfund),
    covid: round2(taxBreakdown.covid),
    vat: round2(taxBreakdown.vat),
    totalTax: round2(taxBreakdown.totalTax),
    total: round2(amount),
  }
}

export function normalizeExpensePricingMode(
  raw: unknown
): ExpensePricingMode {
  return raw === "exclusive" ? "exclusive" : "inclusive"
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
