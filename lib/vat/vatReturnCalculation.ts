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
  output_debits?: number | null
  output_credits?: number | null
  input_debits?: number | null
  input_credits?: number | null
  settlement_debits?: number | null
  settlement_credits?: number | null
  unclassified_debits?: number | null
  unclassified_credits?: number | null
}

export type VatReturnCalculationInput = {
  rows: VatLedgerRow[]
  periodEndDate: string
  outputAdjustment?: number | null
  inputAdjustment?: number | null
  /**
   * Standard-rated taxable sales/purchases. These must come from persisted
   * transaction evidence (tax-line bases or classified retail categories).
   * They are never derived from VAT / 15%.
   */
  taxableSales?: number | null
  taxablePurchases?: number | null
  zeroRatedSales?: number | null
  exemptSales?: number | null
  zeroRatedPurchases?: number | null
  exemptPurchases?: number | null
}

export type VatReturnCalculation = {
  /** Standard-rated plus zero-rated taxable sales (excludes exempt). */
  total_taxable_sales: number
  total_standard_rated_sales: number
  total_zero_rated_sales: number
  total_exempt_sales: number
  total_output_nhil: number
  total_output_getfund: number
  total_output_covid: number
  total_output_vat: number
  total_output_tax: number
  /** Standard-rated plus zero-rated taxable purchases (excludes exempt). */
  total_taxable_purchases: number
  total_standard_rated_purchases: number
  total_zero_rated_purchases: number
  total_exempt_purchases: number
  total_input_nhil: number
  total_input_getfund: number
  total_input_covid: number
  total_input_vat: number
  total_input_tax: number
  /** Pre-2026 input levies that were not claimable; disclosure only. */
  total_noncreditable_input_nhil: number
  total_noncreditable_input_getfund: number
  total_noncreditable_input_covid: number
  total_noncreditable_input_tax: number
  /** Tax-account movements excluded from input/output boxes. */
  settlement_tax: number
  unclassified_tax: number
  net_vat_payable: number
  net_vat_refund: number
  /**
   * Pre-2026 NHIL/GETFund/COVID are output liabilities but were not
   * claimable as input credits. They are filed/paid separately from the
   * VAT 3 net VAT and must never be offset by a VAT refund.
   */
  separate_nhil_payable: number
  separate_getfund_payable: number
  separate_covid_payable: number
  separate_levies_payable: number
  /** VAT payable plus separate levies payable. Never net of VAT refunds. */
  total_tax_payable: number
  /** VAT-only refund. Separate levies remain payable independently. */
  total_tax_refund: number
  period_is_post_2026: boolean
  taxable_bases_source: "provided" | "unavailable"
  taxable_bases_complete: boolean
  warnings: string[]
}

export type VatReturnPositionInput = {
  periodEndDate: string
  netVatPayable?: number | null
  netVatRefund?: number | null
  totalOutputNhil?: number | null
  totalOutputGetfund?: number | null
  totalOutputCovid?: number | null
}

export type VatReturnPosition = {
  net_vat_payable: number
  net_vat_refund: number
  separate_nhil_payable: number
  separate_getfund_payable: number
  separate_covid_payable: number
  separate_levies_payable: number
  total_tax_payable: number
  total_tax_refund: number
  period_is_post_2026: boolean
}

export function roundMoney(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function amount(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function rowAmount(
  rows: VatLedgerRow[],
  code: string,
  field: keyof Pick<
    VatLedgerRow,
    | "period_debits"
    | "period_credits"
    | "output_debits"
    | "output_credits"
    | "input_debits"
    | "input_credits"
    | "settlement_debits"
    | "settlement_credits"
    | "unclassified_debits"
    | "unclassified_credits"
  >
): number {
  return rows
    .filter((row) => String(row.tax_code).toLowerCase() === code.toLowerCase())
    .reduce((sum, row) => sum + amount(row[field]), 0)
}

function providedNumber(value: number | null | undefined): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? roundMoney(n) : null
}

function buildVatReturnPosition(
  input: VatReturnPositionInput
): VatReturnPosition {
  const periodEndDate = String(input.periodEndDate || "").slice(0, 10)
  const periodIsPost2026 = periodEndDate >= "2026-01-01"
  const netVatPayable = roundMoney(amount(input.netVatPayable))
  const netVatRefund = roundMoney(amount(input.netVatRefund))

  // Pre-2026: NHIL/GETFund/COVID were charged on output but were not
  // claimable input credits. They are separate liabilities from VAT 3 net
  // VAT. From 2026 they are included in net VAT under Act 1151.
  const separateNhilPayable = periodIsPost2026
    ? 0
    : roundMoney(amount(input.totalOutputNhil))
  const separateGetfundPayable = periodIsPost2026
    ? 0
    : roundMoney(amount(input.totalOutputGetfund))
  const separateCovidPayable = periodIsPost2026
    ? 0
    : roundMoney(amount(input.totalOutputCovid))
  const separateLeviesPayable = roundMoney(
    separateNhilPayable + separateGetfundPayable + separateCovidPayable
  )

  return {
    net_vat_payable: netVatPayable,
    net_vat_refund: netVatRefund,
    separate_nhil_payable: separateNhilPayable,
    separate_getfund_payable: separateGetfundPayable,
    separate_covid_payable: separateCovidPayable,
    separate_levies_payable: separateLeviesPayable,
    // Never net a VAT refund against separate levies.
    total_tax_payable: roundMoney(netVatPayable + separateLeviesPayable),
    total_tax_refund: netVatRefund,
    period_is_post_2026: periodIsPost2026,
  }
}

/**
 * Read-model split for a stored VAT return. Keeps VAT 3 net VAT separate
 * from pre-2026 levy liabilities and never offsets a VAT refund against them.
 */
export function resolveVatReturnPosition(
  input: VatReturnPositionInput
): VatReturnPosition {
  return buildVatReturnPosition(input)
}

export function calculateVatReturnTotals(
  input: VatReturnCalculationInput
): VatReturnCalculation {
  const rows = Array.isArray(input.rows) ? input.rows : []
  const periodEndDate = String(input.periodEndDate || "").slice(0, 10)
  const periodIsPost2026 = periodEndDate >= "2026-01-01"

  const hasClassifiedMovements = rows.some(
    (row) =>
      row.output_debits != null ||
      row.output_credits != null ||
      row.input_debits != null ||
      row.input_credits != null
  )

  const outputNet = (code: string) =>
    hasClassifiedMovements
      ? roundMoney(
          rowAmount(rows, code, "output_credits") -
            rowAmount(rows, code, "output_debits")
        )
      : roundMoney(rowAmount(rows, code, "period_credits"))
  const inputNet = (code: string) =>
    hasClassifiedMovements
      ? roundMoney(
          rowAmount(rows, code, "input_debits") -
            rowAmount(rows, code, "input_credits")
        )
      : roundMoney(rowAmount(rows, code, "period_debits"))

  const totalOutputVat = outputNet("VAT")
  const totalOutputNhil = outputNet("NHIL")
  const totalOutputGetfund = outputNet("GETFund")
  const totalOutputCovid = outputNet("COVID")

  const totalInputVat = inputNet("VAT")
  const inputNhil = inputNet("NHIL")
  const inputGetfund = inputNet("GETFund")
  const inputCovid = inputNet("COVID")

  // Pre-2026 input NHIL/GETFund/COVID are not claimable. They are excluded
  // from input-tax boxes and total input tax, and disclosed separately.
  const totalInputNhil = periodIsPost2026 ? inputNhil : 0
  const totalInputGetfund = periodIsPost2026 ? inputGetfund : 0
  const totalInputCovid = 0
  const noncreditableInputNhil = periodIsPost2026 ? 0 : inputNhil
  const noncreditableInputGetfund = periodIsPost2026 ? 0 : inputGetfund
  const noncreditableInputCovid = periodIsPost2026 ? 0 : inputCovid
  const totalNoncreditableInputTax = roundMoney(
    noncreditableInputNhil + noncreditableInputGetfund + noncreditableInputCovid
  )

  const settlementTax = hasClassifiedMovements
    ? roundMoney(
        rowAmount(rows, "VAT", "settlement_debits") +
          rowAmount(rows, "NHIL", "settlement_debits") +
          rowAmount(rows, "GETFund", "settlement_debits") +
          rowAmount(rows, "COVID", "settlement_debits") -
          rowAmount(rows, "VAT", "settlement_credits") -
          rowAmount(rows, "NHIL", "settlement_credits") -
          rowAmount(rows, "GETFund", "settlement_credits") -
          rowAmount(rows, "COVID", "settlement_credits")
      )
    : 0
  const unclassifiedTax = hasClassifiedMovements
    ? roundMoney(
        rowAmount(rows, "VAT", "unclassified_debits") +
          rowAmount(rows, "NHIL", "unclassified_debits") +
          rowAmount(rows, "GETFund", "unclassified_debits") +
          rowAmount(rows, "COVID", "unclassified_debits") -
          rowAmount(rows, "VAT", "unclassified_credits") -
          rowAmount(rows, "NHIL", "unclassified_credits") -
          rowAmount(rows, "GETFund", "unclassified_credits") -
          rowAmount(rows, "COVID", "unclassified_credits")
      )
    : 0

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

  const position = buildVatReturnPosition({
    periodEndDate,
    netVatPayable,
    netVatRefund,
    totalOutputNhil,
    totalOutputGetfund,
    totalOutputCovid,
  })

  const standardRatedSales = providedNumber(input.taxableSales)
  const standardRatedPurchases = providedNumber(input.taxablePurchases)
  const zeroRatedSales = providedNumber(input.zeroRatedSales) ?? 0
  const exemptSales = providedNumber(input.exemptSales) ?? 0
  const zeroRatedPurchases = providedNumber(input.zeroRatedPurchases) ?? 0
  const exemptPurchases = providedNumber(input.exemptPurchases) ?? 0

  const warnings: string[] = []
  const taxableBasesComplete =
    standardRatedSales != null && standardRatedPurchases != null

  if (standardRatedSales == null) {
    warnings.push(
      "Standard-rated taxable sales could not be determined from transaction evidence. The return cannot be filed until sales are classified."
    )
  }
  if (standardRatedPurchases == null) {
    warnings.push(
      "Standard-rated taxable purchases could not be determined from transaction evidence. The return cannot be filed until purchases are classified."
    )
  }
  if (Math.abs(unclassifiedTax) > 0.009) {
    warnings.push(
      `Unclassified tax-account movements (${unclassifiedTax.toFixed(2)}) were excluded from the return. Classify the source adjustment before filing.`
    )
  }

  const totalTaxableSales = roundMoney((standardRatedSales ?? 0) + zeroRatedSales)
  const totalTaxablePurchases = roundMoney(
    (standardRatedPurchases ?? 0) + zeroRatedPurchases
  )

  return {
    total_taxable_sales: totalTaxableSales,
    total_standard_rated_sales: roundMoney(standardRatedSales ?? 0),
    total_zero_rated_sales: roundMoney(zeroRatedSales),
    total_exempt_sales: roundMoney(exemptSales),
    total_output_nhil: totalOutputNhil,
    total_output_getfund: totalOutputGetfund,
    total_output_covid: totalOutputCovid,
    total_output_vat: totalOutputVat,
    total_output_tax: roundMoney(rawOutputTax + outputAdjustment),
    total_taxable_purchases: totalTaxablePurchases,
    total_standard_rated_purchases: roundMoney(standardRatedPurchases ?? 0),
    total_zero_rated_purchases: roundMoney(zeroRatedPurchases),
    total_exempt_purchases: roundMoney(exemptPurchases),
    total_input_nhil: totalInputNhil,
    total_input_getfund: totalInputGetfund,
    total_input_covid: totalInputCovid,
    total_input_vat: totalInputVat,
    total_input_tax: roundMoney(rawInputTax + inputAdjustment),
    total_noncreditable_input_nhil: roundMoney(noncreditableInputNhil),
    total_noncreditable_input_getfund: roundMoney(noncreditableInputGetfund),
    total_noncreditable_input_covid: roundMoney(noncreditableInputCovid),
    total_noncreditable_input_tax: totalNoncreditableInputTax,
    settlement_tax: settlementTax,
    unclassified_tax: unclassifiedTax,
    net_vat_payable: roundMoney(netVatPayable),
    net_vat_refund: roundMoney(netVatRefund),
    separate_nhil_payable: position.separate_nhil_payable,
    separate_getfund_payable: position.separate_getfund_payable,
    separate_covid_payable: position.separate_covid_payable,
    separate_levies_payable: position.separate_levies_payable,
    total_tax_payable: position.total_tax_payable,
    total_tax_refund: position.total_tax_refund,
    period_is_post_2026: periodIsPost2026,
    taxable_bases_source: taxableBasesComplete ? "provided" : "unavailable",
    taxable_bases_complete: taxableBasesComplete,
    warnings,
  }
}
