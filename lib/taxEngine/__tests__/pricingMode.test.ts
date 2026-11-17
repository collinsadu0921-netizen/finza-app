import { describe, expect, it } from "@jest/globals"
import { getCanonicalTaxResultFromLineItems } from "../helpers"
import { calculateTaxes } from "../index"

// Post-2026 Ghana simplified regime: NHIL 2.5% + GETFund 2.5% + VAT 15% = 20% flat,
// no compound. Effective date >= 2026-01-01.
const ghPost2026 = {
  jurisdiction: "GH",
  effectiveDate: "2026-11-09",
}

const netLine70000 = [{ quantity: 1, unit_price: 70000, discount_amount: 0 }]
const grossLine84000 = [{ quantity: 1, unit_price: 84000, discount_amount: 0 }]

describe("Tax pricing mode (inclusive vs exclusive) — GH", () => {
  it("exclusive GH₵70,000 adds tax on top → gross GH₵84,000", () => {
    const result = getCanonicalTaxResultFromLineItems(netLine70000, {
      ...ghPost2026,
      taxInclusive: false,
    })

    expect(result.pricing_mode).toBe("exclusive")
    expect(result.base_amount).toBe(70000)
    expect(result.total_tax).toBe(14000)
    expect(result.total_amount).toBe(84000)

    const byCode = Object.fromEntries(
      result.lines.map((line) => [line.code, line.amount])
    )
    expect(byCode.NHIL).toBe(1750)
    expect(byCode.GETFUND).toBe(1750)
    expect(byCode.VAT).toBe(10500)
  })

  it("inclusive GH₵84,000 extracts tax → net GH₵70,000", () => {
    const result = getCanonicalTaxResultFromLineItems(grossLine84000, {
      ...ghPost2026,
      taxInclusive: true,
    })

    expect(result.pricing_mode).toBe("inclusive")
    expect(result.base_amount).toBe(70000)
    expect(result.total_tax).toBe(14000)
    expect(result.total_amount).toBe(84000)
  })

  it("inclusive and exclusive inputs produce identical net/tax/gross", () => {
    const exclusive = getCanonicalTaxResultFromLineItems(netLine70000, {
      ...ghPost2026,
      taxInclusive: false,
    })
    const inclusive = getCanonicalTaxResultFromLineItems(grossLine84000, {
      ...ghPost2026,
      taxInclusive: true,
    })

    expect(exclusive.base_amount).toBe(inclusive.base_amount)
    expect(exclusive.total_tax).toBe(inclusive.total_tax)
    expect(exclusive.total_amount).toBe(inclusive.total_amount)
  })

  it("legacy calculateTaxes interface also honors taxInclusive=false for GH", () => {
    // The update route uses calculateTaxes + legacyToCanonicalResult; ensure it
    // produces the same forward (exclusive) result.
    const result = calculateTaxes(netLine70000, "GH", "2026-11-09", false)

    expect(result.subtotal_excl_tax).toBe(70000)
    expect(result.tax_total).toBe(14000)
    expect(result.total_incl_tax).toBe(84000)
  })

  it("exclusive mode applies the pre-2026 compound VAT (historical date)", () => {
    // Pre-2026: NHIL 2.5% + GETFund 2.5% + COVID 1% on base; VAT 15% on top of
    // base + levies. Net 70,000 → gross 85,330.
    const result = getCanonicalTaxResultFromLineItems(netLine70000, {
      jurisdiction: "GH",
      effectiveDate: "2025-12-01",
      taxInclusive: false,
    })

    expect(result.pricing_mode).toBe("exclusive")
    expect(result.base_amount).toBe(70000)
    const byCode = Object.fromEntries(
      result.lines.map((line) => [line.code, line.amount])
    )
    expect(byCode.NHIL).toBe(1750)
    expect(byCode.GETFUND).toBe(1750)
    expect(byCode.COVID).toBe(700)
    expect(byCode.VAT).toBe(11130)
    expect(result.total_tax).toBe(15330)
    expect(result.total_amount).toBe(85330)
  })

  it("exclusive mode applies discounts before tax", () => {
    // Two lines: 40000 + 40000, with a 10000 discount → net base 70000.
    const lineItems = [
      { quantity: 1, unit_price: 40000, discount_amount: 0 },
      { quantity: 1, unit_price: 40000, discount_amount: 10000 },
    ]
    const result = getCanonicalTaxResultFromLineItems(lineItems, {
      ...ghPost2026,
      taxInclusive: false,
    })

    expect(result.base_amount).toBe(70000)
    expect(result.total_tax).toBe(14000)
    expect(result.total_amount).toBe(84000)
  })
})
