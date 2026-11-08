/**
 * Shared Ghana VAT return calculation.
 *
 * This is the single source of truth for the regime-aware net VAT calculation
 * used by the calculate preview, the create route and any future PDF/report
 * path. It does not write to the database.
 */

export type VatLedgerRow = {
  tax_code: string
  period_debits?: number | null
  period_credits?: number | null
}

export type VatReturnCalculationInput = {
  rows: VatLedgerRow[]
  periodEndDate: string
  outputAdjustment?: number | null
  inputAdjustment?: number | null
  /**
   * Standard-rated taxable sales/purchases. When omitted, the legacy
   * VAT / 15% fallback is used and a warning is returned.
   */
  taxableSales?: number | null
  taxablePurchases?: number | null
  zeroRatedSales?: number | null
  exemptSales?: number | null
  zeroRatedPurchases?: number | null
  exemptPurchases?: number | null
}

export type VatReturnCalculation = {
  total_taxable_sales: number
  total_zero_rated_sales: number
  total_exempt_sales: number
  total_output_nhil: number
  total_output_getfund: number
  total_output_covid: number
  total_output_vat: number
  total_output_tax: number
  total_taxable_purchases: number
  total_zero_rated_purchases: number
  total_exempt_purchases: number
  total_input_nhil: number
  total_input_getfund: number
  total_input_covid: number
  total_input_vat: number
  total_input_tax: number
  net_vat_payable: number
  net_vat_refund: number
  period_is_post_2026: boolean
  taxable_bases_source: "provided" | "derived_from_vat"
  warnings: string[]
}

export function roundMoney(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function amount(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function rowAmount(rows: VatLedgerRow[], code: string, field: "period_debits" | "period_credits"): number {
  return rows
    .filter((row) => String(row.tax_code).toLowerCase() === code.toLowerCase())
    .reduce((sum, row) => sum + amount(row[field]), 0)
}

function providedNumber(value: number | null | undefined): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? roundMoney(n) : null
}

export function calculateVatReturnTotals(
  input: VatReturnCalculationInput
): VatReturnCalculation {
  const rows = Array.isArray(input.rows) ? input.rows : []
  const periodEndDate = String(input.periodEndDate || "").slice(0, 10)
  const periodIsPost2026 = periodEndDate >= "2026-01-01"

  const totalOutputVat = roundMoney(rowAmount(rows, "VAT", "period_credits"))
  const totalOutputNhil = roundMoney(rowAmount(rows, "NHIL", "period_credits"))
  const totalOutputGetfund = roundMoney(rowAmount(rows, "GETFund", "period_credits"))
  const totalOutputCovid = roundMoney(rowAmount(rows, "COVID", "period_credits"))

  const totalInputVat = roundMoney(rowAmount(rows, "VAT", "period_debits"))
  const totalInputNhil = roundMoney(rowAmount(rows, "NHIL", "period_debits"))
  const totalInputGetfund = roundMoney(rowAmount(rows, "GETFund", "period_debits"))
  const totalInputCovid = roundMoney(rowAmount(rows, "COVID", "period_debits"))

  const outputAdjustment = roundMoney(amount(input.outputAdjustment))
  const inputAdjustment = roundMoney(amount(input.inputAdjustment))

  const rawOutputTax = roundMoney(
    totalOutputVat + totalOutputNhil + totalOutputGetfund + totalOutputCovid
  )
  const rawInputTax = roundMoney(
    totalInputVat + totalInputNhil + totalInputGetfund + totalInputCovid
  )

  // Act 1151 (VAT Act 2025) from 2026-01-01: VAT, NHIL and GETFund are all
  // claimable input credits. Before 2026 only VAT was claimable; NHIL,
  // GETFund and COVID were absorbed into cost and are not part of net VAT.
  const regimeNet = periodIsPost2026
    ? roundMoney(
        totalOutputVat +
          totalOutputNhil +
          totalOutputGetfund -
          totalInputVat -
          totalInputNhil -
          totalInputGetfund
      )
    : roundMoney(totalOutputVat - totalInputVat)

  const adjustedNet = roundMoney(regimeNet + outputAdjustment - inputAdjustment)
  const netVatPayable = Math.max(adjustedNet, 0)
  const netVatRefund = Math.max(-adjustedNet, 0)

  const explicitTaxableSales = providedNumber(input.taxableSales)
  const explicitTaxablePurchases = providedNumber(input.taxablePurchases)
  const zeroRatedSales = providedNumber(input.zeroRatedSales) ?? 0
  const exemptSales = providedNumber(input.exemptSales) ?? 0
  const zeroRatedPurchases = providedNumber(input.zeroRatedPurchases) ?? 0
  const exemptPurchases = providedNumber(input.exemptPurchases) ?? 0

  const warnings: string[] = []
  let taxableBasesSource: "provided" | "derived_from_vat" = "provided"

  let totalTaxableSales = explicitTaxableSales
  if (totalTaxableSales == null) {
    totalTaxableSales = totalOutputVat > 0 ? roundMoney(totalOutputVat / 0.15) : 0
    taxableBasesSource = "derived_from_vat"
  }

  let totalTaxablePurchases = explicitTaxablePurchases
  if (totalTaxablePurchases == null) {
    totalTaxablePurchases = totalInputVat > 0 ? roundMoney(totalInputVat / 0.15) : 0
    taxableBasesSource = "derived_from_vat"
  }

  if (taxableBasesSource === "derived_from_vat") {
    warnings.push(
      "Taxable sales/purchases were derived from VAT at 15%. Zero-rated and exempt supplies require explicit classification and are not inferred."
    )
  }

  return {
    total_taxable_sales: roundMoney(totalTaxableSales),
    total_zero_rated_sales: roundMoney(zeroRatedSales),
    total_exempt_sales: roundMoney(exemptSales),
    total_output_nhil: totalOutputNhil,
    total_output_getfund: totalOutputGetfund,
    total_output_covid: totalOutputCovid,
    total_output_vat: totalOutputVat,
    total_output_tax: roundMoney(rawOutputTax + outputAdjustment),
    total_taxable_purchases: roundMoney(totalTaxablePurchases),
    total_zero_rated_purchases: roundMoney(zeroRatedPurchases),
    total_exempt_purchases: roundMoney(exemptPurchases),
    total_input_nhil: totalInputNhil,
    total_input_getfund: totalInputGetfund,
    total_input_covid: totalInputCovid,
    total_input_vat: totalInputVat,
    total_input_tax: roundMoney(rawInputTax + inputAdjustment),
    net_vat_payable: roundMoney(netVatPayable),
    net_vat_refund: roundMoney(netVatRefund),
    period_is_post_2026: periodIsPost2026,
    taxable_bases_source: taxableBasesSource,
    warnings,
  }
}
