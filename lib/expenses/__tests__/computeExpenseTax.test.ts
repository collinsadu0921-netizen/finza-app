import { describe, expect, it } from "@jest/globals"
import { computeExpenseTax, normalizeExpensePricingMode } from "../computeExpenseTax"

describe("computeExpenseTax", () => {
  it("exclusive: net GH₵70,000 adds 20% tax → gross GH₵84,000 (post-2026)", () => {
    const r = computeExpenseTax(70000, true, "exclusive", "2026-11-09")
    expect(r.baseAmount).toBe(70000)
    expect(r.nhil).toBe(1750)
    expect(r.getfund).toBe(1750)
    expect(r.covid).toBe(0)
    expect(r.vat).toBe(10500)
    expect(r.totalTax).toBe(14000)
    expect(r.total).toBe(84000)
  })

  it("inclusive: gross GH₵84,000 extracts tax → net GH₵70,000 (post-2026)", () => {
    const r = computeExpenseTax(84000, true, "inclusive", "2026-11-09")
    expect(r.baseAmount).toBe(70000)
    expect(r.totalTax).toBe(14000)
    expect(r.total).toBe(84000)
  })

  it("inclusive and exclusive produce identical net/tax/gross", () => {
    const ex = computeExpenseTax(70000, true, "exclusive", "2026-11-09")
    const inc = computeExpenseTax(84000, true, "inclusive", "2026-11-09")
    expect(ex.baseAmount).toBe(inc.baseAmount)
    expect(ex.totalTax).toBe(inc.totalTax)
    expect(ex.total).toBe(inc.total)
  })

  it("taxes disabled: base = total = entered, no tax", () => {
    const r = computeExpenseTax(70000, false, "exclusive", "2026-11-09")
    expect(r.baseAmount).toBe(70000)
    expect(r.total).toBe(70000)
    expect(r.totalTax).toBe(0)
    expect(r.nhil).toBe(0)
    expect(r.vat).toBe(0)
  })

  it("pre-2026 compound exclusive: COVID + compound VAT", () => {
    const r = computeExpenseTax(70000, true, "exclusive", "2025-12-01")
    expect(r.baseAmount).toBe(70000)
    expect(r.nhil).toBe(1750)
    expect(r.getfund).toBe(1750)
    expect(r.covid).toBe(700)
    expect(r.vat).toBe(11130)
    expect(r.totalTax).toBe(15330)
    expect(r.total).toBe(85330)
  })
})

describe("normalizeExpensePricingMode", () => {
  it("maps 'exclusive' to exclusive and everything else to inclusive", () => {
    expect(normalizeExpensePricingMode("exclusive")).toBe("exclusive")
    expect(normalizeExpensePricingMode("inclusive")).toBe("inclusive")
    expect(normalizeExpensePricingMode(undefined)).toBe("inclusive")
    expect(normalizeExpensePricingMode("bogus")).toBe("inclusive")
  })
})
