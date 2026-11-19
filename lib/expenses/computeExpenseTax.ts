import {
  calculateGhanaTaxes,
  calculateBaseFromTotalIncludingTaxes,
} from "@/lib/ghanaTaxEngine"

export type ExpensePricingMode = "inclusive" | "exclusive"

export type ExpenseTaxLine = {
  code: "NHIL" | "GETFUND" | "COVID" | "VAT"
  name: string
  rate: number
  amount: number
  ledger_account_code: string
  ledger_side: "debit" | "credit"
  is_creditable_input: boolean
  absorbed_to_cost: boolean
}

export type ComputedExpenseTax = {
  baseAmount: number
  nhil: number
  getfund: number
  covid: number
  vat: number
  totalTax: number
  total: number
  taxLines: ExpenseTaxLine[]
}

/**
 * Authoritatively compute an expense's net base, tax components and gross total
 * from the user-entered amount and pricing mode.
 *
 * - inclusive: `enteredAmount` is the gross; taxes are extracted (reverse).
 * - exclusive: `enteredAmount` is the net; taxes are added on top (forward).
 * - taxes disabled: base = total = enteredAmount, no tax.
 *
 * Invariant (self-consistent rounding): `totalTax = nhil + getfund + covid + vat`
 * and `baseAmount + totalTax = total` exactly. This guarantees the persisted
 * columns (`amount`, `nhil/getfund/covid/vat`, `total`) are internally consistent,
 * so the ledger posting (which derives `base = total − tax components`) balances
 * and matches the stored `amount` without a one-cent drift.
 *
 * The legacy engine's `taxBreakdown.totalTax` rounds the *unrounded* sum, which
 * can differ from the sum of its individually-rounded components by ±0.01; we
 * deliberately recompute the total from the rounded components instead.
 */
export function computeExpenseTax(
  enteredAmount: number,
  applyTaxes: boolean,
  pricingMode: ExpensePricingMode,
  effectiveDate: string
): ComputedExpenseTax {
  const amount = Number(enteredAmount) || 0

  if (!applyTaxes || amount <= 0) {
    return {
      baseAmount: round2(amount),
      nhil: 0,
      getfund: 0,
      covid: 0,
      vat: 0,
      totalTax: 0,
      total: round2(amount),
      taxLines: [],
    }
  }

  let nhil: number
  let getfund: number
  let covid: number
  let vat: number

  if (pricingMode === "exclusive") {
    const r = calculateGhanaTaxes(amount, true, effectiveDate)
    nhil = round2(r.nhil)
    getfund = round2(r.getfund)
    covid = round2(r.covid)
    vat = round2(r.vat)
  } else {
    const { taxBreakdown } = calculateBaseFromTotalIncludingTaxes(
      amount,
      true,
      effectiveDate
    )
    nhil = round2(taxBreakdown.nhil)
    getfund = round2(taxBreakdown.getfund)
    covid = round2(taxBreakdown.covid)
    vat = round2(taxBreakdown.vat)
  }

  const totalTax = round2(nhil + getfund + covid + vat)
  const baseAmount =
    pricingMode === "exclusive" ? round2(amount) : round2(amount - totalTax)
  const total = round2(baseAmount + totalTax)

  return {
    baseAmount,
    nhil,
    getfund,
    covid,
    vat,
    totalTax,
    total,
    taxLines: buildExpenseTaxLines({ effectiveDate, nhil, getfund, covid, vat }),
  }
}

/**
 * Build ledger posting metadata for an expense.
 *
 * Pre-2026 purchase NHIL/GETFund/COVID are not creditable input tax. They are
 * absorbed into the expense cost (5100) so the ledger does not claim them as
 * recoverable. VAT remains an input-tax control account. From 2026-01-01 all
 * three levies are creditable under Act 1151 and post to 2110/2120; COVID is
 * abolished.
 */
export function buildExpenseTaxLines(input: {
  effectiveDate: string
  nhil: number
  getfund: number
  covid: number
  vat: number
}): ExpenseTaxLine[] {
  const pre2026 = String(input.effectiveDate || "").slice(0, 10) < "2026-01-01"
  const absorption = "5100"
  const lines: ExpenseTaxLine[] = []

  const add = (
    code: ExpenseTaxLine["code"],
    name: string,
    amount: number,
    rate: number,
    account: string,
    credited: boolean,
    absorbed: boolean
  ) => {
    if (!(amount > 0)) return
    lines.push({
      code,
      name,
      rate,
      amount: round2(amount),
      ledger_account_code: account,
      ledger_side: "debit",
      is_creditable_input: credited,
      absorbed_to_cost: absorbed,
    })
  }

  add(
    "NHIL",
    "NHIL",
    input.nhil,
    pre2026 ? 0.025 : 0.025,
    pre2026 ? absorption : "2110",
    !pre2026,
    pre2026
  )
  add(
    "GETFUND",
    "GETFund",
    input.getfund,
    pre2026 ? 0.025 : 0.025,
    pre2026 ? absorption : "2120",
    !pre2026,
    pre2026
  )
  add(
    "COVID",
    "COVID Levy",
    input.covid,
    0.01,
    pre2026 ? absorption : "2100",
    false,
    pre2026
  )
  add("VAT", "VAT", input.vat, 0.15, "2100", true, false)

  return lines
}

export function normalizeExpensePricingMode(
  raw: unknown
): ExpensePricingMode {
  return raw === "exclusive" ? "exclusive" : "inclusive"
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
