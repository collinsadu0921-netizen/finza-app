/**
 * Monthly VAT position resolution.
 *
 * Filed returns are immutable and authoritative. Months without a filed
 * return use the canonical regime-aware VAT calculation. VAT 3 net VAT is
 * VAT-only; pre-2026 NHIL/GETFund/COVID are separate levy liabilities and
 * are never offset by a VAT refund.
 */

import {
  calculateVatReturnTotals,
  resolveVatReturnPosition,
  roundMoney,
  type VatReturnPosition,
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
  total_output_nhil?: number | null
  total_output_getfund?: number | null
  total_output_covid?: number | null
} | null | undefined

export function resolveMonthlyVatPosition(input: {
  month: string
  ledger: MonthlyVatLedgerTotals
  filed?: MonthlyFiledVatReturn
}): VatReturnPosition {
  const periodEndDate = yearMonthToEnd(input.month) ?? `${input.month}-28`

  if (input.filed) {
    return resolveVatReturnPosition({
      periodEndDate,
      netVatPayable: input.filed.net_vat_payable,
      netVatRefund: input.filed.net_vat_refund,
      totalOutputNhil: input.filed.total_output_nhil,
      totalOutputGetfund: input.filed.total_output_getfund,
      totalOutputCovid: input.filed.total_output_covid,
    })
  }

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

  return {
    net_vat_payable: calculation.net_vat_payable,
    net_vat_refund: calculation.net_vat_refund,
    separate_nhil_payable: calculation.separate_nhil_payable,
    separate_getfund_payable: calculation.separate_getfund_payable,
    separate_covid_payable: calculation.separate_covid_payable,
    separate_levies_payable: calculation.separate_levies_payable,
    total_tax_payable: calculation.total_tax_payable,
    total_tax_refund: calculation.total_tax_refund,
    period_is_post_2026: calculation.period_is_post_2026,
  }
}

export function resolveMonthlyVatNet(input: {
  month: string
  ledger: MonthlyVatLedgerTotals
  filed?: MonthlyFiledVatReturn
}): number {
  const position = resolveMonthlyVatPosition(input)
  return roundMoney(position.net_vat_payable - position.net_vat_refund)
}
