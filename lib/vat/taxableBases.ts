/**
 * VAT taxable-base extraction result from the database.
 *
 * The database function `extract_vat_taxable_bases` reads persisted tax-line
 * bases, classified retail supplies and ledger revenue. This module only
 * normalizes that result for the API routes; it never derives a taxable base
 * from VAT / 15%.
 */

export type VatTaxableBases = {
  standard_rated_sales: number
  zero_rated_sales: number
  exempt_sales: number
  standard_rated_purchases: number
  zero_rated_purchases: number
  exempt_purchases: number
  ledger_revenue_credits: number
  unclassified_sales_count: number
  unclassified_purchases_count: number
  fallback_sales_count: number
  fallback_purchases_count: number
  warnings: string[]
}

function numeric(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0
}

function integer(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? Math.max(Math.trunc(n), 0) : 0
}

export function parseVatTaxableBases(value: unknown): VatTaxableBases {
  const row =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {}

  return {
    standard_rated_sales: numeric(row.standard_rated_sales),
    zero_rated_sales: numeric(row.zero_rated_sales),
    exempt_sales: numeric(row.exempt_sales),
    standard_rated_purchases: numeric(row.standard_rated_purchases),
    zero_rated_purchases: numeric(row.zero_rated_purchases),
    exempt_purchases: numeric(row.exempt_purchases),
    ledger_revenue_credits: numeric(row.ledger_revenue_credits),
    unclassified_sales_count: integer(row.unclassified_sales_count),
    unclassified_purchases_count: integer(row.unclassified_purchases_count),
    fallback_sales_count: integer(row.fallback_sales_count),
    fallback_purchases_count: integer(row.fallback_purchases_count),
    warnings: Array.isArray(row.warnings)
      ? row.warnings.filter((warning): warning is string => typeof warning === "string")
      : [],
  }
}

export function taxableBaseInputs(bases: VatTaxableBases) {
  return {
    taxableSales: bases.standard_rated_sales,
    taxablePurchases: bases.standard_rated_purchases,
    zeroRatedSales: bases.zero_rated_sales,
    exemptSales: bases.exempt_sales,
    zeroRatedPurchases: bases.zero_rated_purchases,
    exemptPurchases: bases.exempt_purchases,
  }
}

export type VatTaxableBaseException = {
  code: string
  message: string
}

/**
 * A return may only be filed when its standard-rated bases are supported by
 * transaction evidence. A period with output VAT but no standard-rated sales
 * base (or input VAT but no purchase base) is a data-quality exception.
 */
export function vatTaxableBaseException(input: {
  totalOutputVat: number
  totalInputVat: number
  standardRatedSales: number
  standardRatedPurchases: number
  taxableBasesComplete: boolean
}): VatTaxableBaseException | null {
  if (!input.taxableBasesComplete) {
    return {
      code: "VAT_TAXABLE_BASE_UNAVAILABLE",
      message:
        "Taxable sales and purchases could not be determined from transaction evidence. Classify the period's documents before filing.",
    }
  }

  if (input.totalOutputVat > 0.01 && input.standardRatedSales <= 0.01) {
    return {
      code: "VAT_TAXABLE_SALES_UNRECONCILED",
      message:
        "The period has output VAT but no standard-rated sales base. Review invoice, retail and credit-note classification before filing.",
    }
  }

  if (input.totalInputVat > 0.01 && input.standardRatedPurchases <= 0.01) {
    return {
      code: "VAT_TAXABLE_PURCHASES_UNRECONCILED",
      message:
        "The period has input VAT but no standard-rated purchase base. Review bill and expense classification before filing.",
    }
  }

  return null
}
