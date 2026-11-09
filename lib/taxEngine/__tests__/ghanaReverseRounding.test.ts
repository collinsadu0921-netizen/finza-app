import { describe, expect, it } from "@jest/globals"
import { ghanaTaxEngineCanonical } from "../jurisdictions/ghana"
import { toTaxLinesJsonb } from "../serialize"

const post2026 = {
  jurisdiction: "GH",
  effectiveDate: "2026-11-09",
  taxInclusive: true,
  transactionType: "sale" as const,
}

describe("Ghana reverse-calculation rounding", () => {
  it("anchors GH₵100 tax-inclusive tax-line bases to the persisted subtotal", () => {
    const result = ghanaTaxEngineCanonical.reverseCalculate(100, post2026)

    expect(result.base_amount).toBe(83.34)
    expect(result.total_tax).toBe(16.66)
    expect(result.total_amount).toBe(100)

    const lines = Object.fromEntries(result.lines.map((line) => [line.code, line]))
    expect(lines.NHIL.amount).toBe(2.08)
    expect(lines.GETFUND.amount).toBe(2.08)
    expect(lines.VAT.amount).toBe(12.5)
    expect(Number(lines.NHIL.meta?.base)).toBe(83.34)
    expect(Number(lines.GETFUND.meta?.base)).toBe(83.34)
    expect(Number(lines.VAT.meta?.base)).toBe(83.34)

    const serialized = toTaxLinesJsonb(result)
    const jsonLines = serialized.lines as Array<{
      code: string
      meta?: { base?: number }
    }>
    expect(jsonLines.every((line) => Number(line.meta?.base) === 83.34)).toBe(
      true
    )
  })

  it("keeps the anchored base for multiple lines and a discount", () => {
    // Tax-inclusive invoices sum discounted line totals and reverse-calculate
    // the tax-inclusive total. Per-line allocation happens outside the engine.
    const taxInclusiveLineTotal = 60 + 50 - 10
    const result = ghanaTaxEngineCanonical.reverseCalculate(
      taxInclusiveLineTotal,
      post2026
    )

    expect(result.total_amount).toBe(100)
    expect(result.base_amount).toBe(83.34)
    expect(
      result.lines
        .filter((line) => line.code !== "VAT")
        .every((line) => Number(line.meta?.base) === 83.34)
    ).toBe(true)
  })

  it("keeps pre-2026 levy bases aligned while retaining the compound VAT base", () => {
    const result = ghanaTaxEngineCanonical.reverseCalculate(100, {
      ...post2026,
      effectiveDate: "2025-12-31",
    })

    const lines = Object.fromEntries(result.lines.map((line) => [line.code, line]))
    expect(Number(lines.NHIL.meta?.base)).toBe(result.base_amount)
    expect(Number(lines.GETFUND.meta?.base)).toBe(result.base_amount)
    expect(Number(lines.COVID.meta?.base)).toBe(result.base_amount)
    expect(Number(lines.VAT.meta?.base)).toBeGreaterThanOrEqual(
      result.base_amount
    )
    expect(result.total_amount).toBe(100)
  })
})
