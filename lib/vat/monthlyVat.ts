/**
 * Monthly VAT net resolution.
 *
 * Filed returns are immutable and authoritative. Months without a filed
 * return use the canonical regime-aware VAT calculation. This keeps the VAT
 * Filings list, detail modal, API and PDF aligned without introducing a
 * second VAT formula in the list component.
 */

import {
  calculateVatReturnTotals,
  roundMoney,
} from "./vatReturnCalculation"
import { yearMonthToEnd } from "./vatPeriod"

export type MonthlyVatLedgerTotals = {
  output_vat: number
  input_vat: number
  output_nhil: number
  input_nhil: number
  output_getfund: number
  input_getfund: number
  output_covid: number
  input_covid: number
}

export type MonthlyFiledVatReturn = {
  net_vat_payable?: number | null
  net_vat_refund?: number | null
} | null | undefined

export function resolveMonthlyVatNet(input: {
  month: string
  ledger: MonthlyVatLedgerTotals
  filed?: MonthlyFiledVatReturn
}): number {
  if (input.filed) {
    return roundMoney(
      Number(input.filed.net_vat_payable ?? 0) -
        Number(input.filed.net_vat_refund ?? 0)
    )
  }

  const periodEndDate = yearMonthToEnd(input.month) ?? `${input.month}-28`
  const calculation = calculateVatReturnTotals({
    rows: [
      {
        tax_code: "VAT",
        period_debits: input.ledger.input_vat,
        period_credits: input.ledger.output_vat,
      },
      {
        tax_code: "NHIL",
        period_debits: input.ledger.input_nhil,
        period_credits: input.ledger.output_nhil,
      },
      {
        tax_code: "GETFund",
        period_debits: input.ledger.input_getfund,
        period_credits: input.ledger.output_getfund,
      },
      {
        tax_code: "COVID",
        period_debits: input.ledger.input_covid,
        period_credits: input.ledger.output_covid,
      },
    ],
    periodEndDate,
  })

  return roundMoney(
    calculation.net_vat_payable - calculation.net_vat_refund
  )
}
