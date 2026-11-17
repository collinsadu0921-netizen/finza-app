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

  it("mode switch preserves entered price and reinterprets it", () => {
    // Same entered value 70,000, different modes → different net/gross.
    const excl = computeExpenseTax(70000, true, "exclusive", "2026-11-09")
    const incl = computeExpenseTax(70000, true, "inclusive", "2026-11-09")

    expect(excl.baseAmount).toBe(70000)       // 70k is the net
    expect(excl.total).toBe(84000)            // gross 84k
    expect(incl.baseAmount).toBe(58333.34)    // 70k is now gross → net 58,333.34 (legacy rounding balance)
    expect(incl.total).toBe(70000)            // gross stays 70k
    // persisted components stay consistent with the gross total (posting balances)
    expect(incl.baseAmount + incl.nhil + incl.getfund + incl.vat).toBe(70000)
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

  it("rounds self-consistently for non-clean amounts (no one-cent drift)", () => {
    const round2 = (v: number) => Math.round(v * 100) / 100
    for (const mode of ["exclusive", "inclusive"] as const) {
      const entered = mode === "exclusive" ? 70001 : 84001.2
      const r = computeExpenseTax(entered, true, mode, "2026-11-09")
      // Invariant: totalTax is exactly the sum of the rounded components,
      // and base + totalTax equals the gross total (both to 2dp).
      expect(r.totalTax).toBe(round2(r.nhil + r.getfund + r.covid + r.vat))
      expect(r.total).toBe(round2(r.baseAmount + r.totalTax))
    }
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
