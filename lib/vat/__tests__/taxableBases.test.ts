import { describe, expect, it } from "@jest/globals"
import {
  parseVatTaxableBases,
  taxableBaseInputs,
  vatTaxableBaseException,
} from "../taxableBases"

describe("VAT taxable-base normalization", () => {
  it("normalizes numeric and warning fields", () => {
    const bases = parseVatTaxableBases({
      standard_rated_sales: "100.005",
      zero_rated_sales: 50,
      exempt_sales: 25,
      standard_rated_purchases: 40,
      unclassified_sales_count: 2,
      warnings: ["review classification", 42],
    })

    expect(bases.standard_rated_sales).toBe(100.01)
    expect(bases.zero_rated_sales).toBe(50)
    expect(bases.exempt_sales).toBe(25)
    expect(bases.standard_rated_purchases).toBe(40)
    expect(bases.unclassified_sales_count).toBe(2)
    expect(bases.warnings).toEqual(["review classification"])
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
      totalOutputVat: 15,
      totalInputVat: 0,
      standardRatedSales: 0,
      standardRatedPurchases: 0,
      taxableBasesComplete: false,
    })

    expect(exception?.code).toBe("VAT_TAXABLE_BASE_UNAVAILABLE")
  })

  it("blocks output VAT without a standard-rated sales base", () => {
    const exception = vatTaxableBaseException({
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
      totalOutputVat: 0,
      totalInputVat: 0,
      standardRatedSales: 0,
      standardRatedPurchases: 0,
      taxableBasesComplete: true,
    })

    expect(exception).toBeNull()
  })
})
