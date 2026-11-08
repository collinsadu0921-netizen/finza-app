import { describe, expect, it } from "@jest/globals"
import {
  calculateCartTaxes,
  calculateGhanaVAT,
  extractTaxFromInclusivePrice,
} from "../vat"

describe("Ghana VAT retail helpers - regime accuracy", () => {
  it("extracts post-2026 inclusive tax on the same base", () => {
    const result = extractTaxFromInclusivePrice(120, 1, "standard", "2026-01-01")

    expect(result.taxable_amount).toBe(100)
    expect(result.nhil).toBe(2.5)
    expect(result.getfund).toBe(2.5)
    expect(result.covid).toBe(0)
    expect(result.vat_base).toBe(100)
    expect(result.vat).toBe(15)
    expect(result.total_tax).toBe(20)
    expect(result.total_with_tax).toBe(120)
  })

  it("keeps pre-2026 inclusive VAT compounded on the levies", () => {
    const result = extractTaxFromInclusivePrice(121.9, 1, "standard", "2025-12-31")

    expect(result.taxable_amount).toBe(100)
    expect(result.nhil).toBe(2.5)
    expect(result.getfund).toBe(2.5)
    expect(result.covid).toBe(1)
    expect(result.vat_base).toBe(106)
    expect(result.vat).toBe(15.9)
    expect(result.total_tax).toBe(21.9)
    expect(result.total_with_tax).toBe(121.9)
  })

  it("uses the simplified base for post-2026 exclusive cart totals", () => {
    const result = calculateCartTaxes(
      [{ product: { id: "p1", name: "Service", price: 100 }, quantity: 1 }],
      [],
      false,
      "2026-01-01"
    )

    expect(result.totals.nhil).toBe(2.5)
    expect(result.totals.getfund).toBe(2.5)
    expect(result.totals.vat).toBe(15)
    expect(result.totals.total_tax).toBe(20)
    expect(result.totals.grand_total).toBe(120)
  })

  it("uses the simplified base for post-2026 inclusive cart totals", () => {
    const result = calculateCartTaxes(
      [{ product: { id: "p1", name: "Service", price: 120 }, quantity: 1 }],
      [],
      true,
      "2026-01-01"
    )

    expect(result.totals.nhil).toBe(2.5)
    expect(result.totals.getfund).toBe(2.5)
    expect(result.totals.vat).toBe(15)
    expect(result.totals.total_tax).toBe(20)
    expect(result.totals.grand_total).toBe(120)
  })

  it("keeps pre-2026 exclusive retail VAT compounded without COVID", () => {
    const result = calculateCartTaxes(
      [{ product: { id: "p1", name: "Service", price: 100 }, quantity: 1 }],
      [],
      false,
      "2025-12-31"
    )

    // Retail deliberately excludes the COVID levy from pricing. VAT remains
    // compounded on NHIL + GETFund, so the base is 105 and VAT is 15.75.
    expect(result.totals.vat).toBe(15.75)
    expect(result.totals.total_tax).toBe(20.75)
    expect(result.totals.grand_total).toBe(120.75)
  })

  it("does not tax zero-rated or exempt supplies", () => {
    for (const vatType of ["zero", "exempt"] as const) {
      const inclusive = extractTaxFromInclusivePrice(120, 1, vatType, "2026-01-01")
      expect(inclusive.total_tax).toBe(0)
      expect(inclusive.vat).toBe(0)
      expect(inclusive.taxable_amount).toBe(120)

      const exclusive = calculateGhanaVAT(100, 1, vatType, "2026-01-01")
      expect(exclusive.total_tax).toBe(0)
      expect(exclusive.vat).toBe(0)
      expect(exclusive.taxable_amount).toBe(100)
    }
  })
})
