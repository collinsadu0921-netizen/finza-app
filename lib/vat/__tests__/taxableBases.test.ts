import { describe, expect, it } from "@jest/globals"
import {
  parseVatTaxableBases,
  taxableBaseInputs,
  vatTaxableBaseException,
  type VatTaxableBases,
} from "../taxableBases"

function bases(overrides: Partial<VatTaxableBases> = {}): VatTaxableBases {
  return {
    ...parseVatTaxableBases({}),
    ...overrides,
  }
}

describe("VAT taxable-base normalization", () => {
  it("normalizes numeric and warning fields", () => {
    const parsed = parseVatTaxableBases({
      standard_rated_sales: "100.005",
      zero_rated_sales: 50,
      exempt_sales: 25,
      standard_rated_purchases: 40,
      unclassified_sales_count: 2,
      invalid_fx_count: 1,
      classification_conflict_count: 3,
      unsupported_fx_credit_note_count: 4,
      warnings: ["review classification", 42],
    })

    expect(parsed.standard_rated_sales).toBe(100.01)
    expect(parsed.zero_rated_sales).toBe(50)
    expect(parsed.exempt_sales).toBe(25)
    expect(parsed.standard_rated_purchases).toBe(40)
    expect(parsed.unclassified_sales_count).toBe(2)
    expect(parsed.invalid_fx_count).toBe(1)
    expect(parsed.classification_conflict_count).toBe(3)
    expect(parsed.unsupported_fx_credit_note_count).toBe(4)
    expect(parsed.warnings).toEqual(["review classification"])
  })

  it("passes standard, zero-rated and exempt bases to the calculator", () => {
    const inputs = taxableBaseInputs(
      parseVatTaxableBases({
        standard_rated_sales: 100,
        zero_rated_sales: 50,
        exempt_sales: 25,
        standard_rated_purchases: 40,
        zero_rated_purchases: 5,
        exempt_purchases: 2,
      })
    )

    expect(inputs).toEqual({
      taxableSales: 100,
      taxablePurchases: 40,
      zeroRatedSales: 50,
      exemptSales: 25,
      zeroRatedPurchases: 5,
      exemptPurchases: 2,
    })
  })

  it("blocks filing when the taxable bases are incomplete", () => {
    const exception = vatTaxableBaseException({
      bases: bases(),
      totalOutputVat: 15,
      totalInputVat: 0,
      standardRatedSales: 0,
      standardRatedPurchases: 0,
      taxableBasesComplete: false,
    })

    expect(exception?.code).toBe("VAT_TAXABLE_BASE_UNAVAILABLE")
  })

  it("blocks filing when any document is unclassified", () => {
    const exception = vatTaxableBaseException({
      bases: bases({ unclassified_purchases_count: 1 }),
      totalOutputVat: 15,
      totalInputVat: 0,
      standardRatedSales: 100,
      standardRatedPurchases: 0,
      taxableBasesComplete: true,
    })

    expect(exception?.code).toBe("VAT_TAXABLE_BASE_UNCLASSIFIED")
  })

  it("blocks filing when a standard document fell back to its subtotal", () => {
    const exception = vatTaxableBaseException({
      bases: bases({ fallback_sales_count: 1 }),
      totalOutputVat: 15,
      totalInputVat: 0,
      standardRatedSales: 100,
      standardRatedPurchases: 0,
      taxableBasesComplete: true,
    })

    expect(exception?.code).toBe("VAT_TAXABLE_BASE_FALLBACK")
  })

  it("blocks filing when a foreign-currency document has no valid rate", () => {
    const exception = vatTaxableBaseException({
      bases: bases({ invalid_fx_count: 1 }),
      totalOutputVat: 15,
      totalInputVat: 0,
      standardRatedSales: 100,
      standardRatedPurchases: 0,
      taxableBasesComplete: true,
    })

    expect(exception?.code).toBe("VAT_TAXABLE_BASE_FX_INVALID")
  })

  it("blocks filing when a classification conflicts with tax evidence", () => {
    const exception = vatTaxableBaseException({
      bases: bases({ classification_conflict_count: 1 }),
      totalOutputVat: 15,
      totalInputVat: 0,
      standardRatedSales: 100,
      standardRatedPurchases: 0,
      taxableBasesComplete: true,
    })

    expect(exception?.code).toBe("VAT_TAXABLE_BASE_CLASSIFICATION_CONFLICT")
  })

  it("blocks filing when a foreign-currency credit note cannot be converted", () => {
    const exception = vatTaxableBaseException({
      bases: bases({ unsupported_fx_credit_note_count: 1 }),
      totalOutputVat: 15,
      totalInputVat: 0,
      standardRatedSales: 100,
      standardRatedPurchases: 0,
      taxableBasesComplete: true,
    })

    expect(exception?.code).toBe(
      "VAT_TAXABLE_BASE_FX_CREDIT_NOTE_UNSUPPORTED"
    )
  })

  it("blocks filing when taxable sales do not reconcile to ledger revenue", () => {
    const exception = vatTaxableBaseException({
      bases: bases({
        standard_rated_sales: 100,
        ledger_revenue_credits: 90,
      }),
      totalOutputVat: 15,
      totalInputVat: 0,
      standardRatedSales: 100,
      standardRatedPurchases: 0,
      taxableBasesComplete: true,
    })

    expect(exception?.code).toBe("VAT_TAXABLE_BASE_LEDGER_MISMATCH")
  })

  it("blocks output VAT without a standard-rated sales base", () => {
    const exception = vatTaxableBaseException({
      bases: bases(),
      totalOutputVat: 15,
      totalInputVat: 0,
      standardRatedSales: 0,
      standardRatedPurchases: 0,
      taxableBasesComplete: true,
    })

    expect(exception?.code).toBe("VAT_TAXABLE_SALES_UNRECONCILED")
  })

  it("blocks input VAT without a standard-rated purchase base", () => {
    const exception = vatTaxableBaseException({
      bases: bases(),
      totalOutputVat: 0,
      totalInputVat: 7.5,
      standardRatedSales: 0,
      standardRatedPurchases: 0,
      taxableBasesComplete: true,
    })

    expect(exception?.code).toBe("VAT_TAXABLE_PURCHASES_UNRECONCILED")
  })

  it("allows a zero-rated-only period with no VAT", () => {
    const exception = vatTaxableBaseException({
      bases: bases({ zero_rated_sales: 500, ledger_revenue_credits: 500 }),
      totalOutputVat: 0,
      totalInputVat: 0,
      standardRatedSales: 0,
      standardRatedPurchases: 0,
      taxableBasesComplete: true,
    })

    expect(exception).toBeNull()
  })
})
