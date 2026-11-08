import { describe, expect, it } from "@jest/globals"
import { calculateVatReturnTotals } from "../vatReturnCalculation"

const rows = (overrides: Partial<Record<string, { credits?: number; debits?: number }>>) => {
  const base = {
    VAT: { credits: 0, debits: 0 },
    NHIL: { credits: 0, debits: 0 },
    GETFund: { credits: 0, debits: 0 },
    COVID: { credits: 0, debits: 0 },
    ...overrides,
  }
  return Object.entries(base).map(([tax_code, value]) => ({
    tax_code,
    period_credits: value.credits ?? 0,
    period_debits: value.debits ?? 0,
  }))
}

describe("calculateVatReturnTotals", () => {
  it("uses VAT-only net for pre-2026 periods", () => {
    const result = calculateVatReturnTotals({
      rows: rows({
        VAT: { credits: 15.9, debits: 5 },
        NHIL: { credits: 2.5, debits: 2 },
        GETFund: { credits: 2.5, debits: 2 },
        COVID: { credits: 1, debits: 1 },
      }),
      periodEndDate: "2025-12-31",
    })

    expect(result.period_is_post_2026).toBe(false)
    expect(result.net_vat_payable).toBe(10.9)
    expect(result.total_output_tax).toBe(21.9)
    expect(result.total_input_tax).toBe(10)
  })

  it("uses VAT + NHIL + GETFund net for post-2026 periods", () => {
    const result = calculateVatReturnTotals({
      rows: rows({
        VAT: { credits: 15, debits: 5 },
        NHIL: { credits: 2.5, debits: 1 },
        GETFund: { credits: 2.5, debits: 1 },
        COVID: { credits: 0, debits: 0 },
      }),
      periodEndDate: "2026-01-01",
    })

    expect(result.period_is_post_2026).toBe(true)
    expect(result.net_vat_payable).toBe(13)
    expect(result.total_output_tax).toBe(20)
    expect(result.total_input_tax).toBe(7)
  })

  it("applies adjustments to the regime-aware net and totals", () => {
    const result = calculateVatReturnTotals({
      rows: rows({
        VAT: { credits: 15, debits: 0 },
        NHIL: { credits: 2.5, debits: 0 },
        GETFund: { credits: 2.5, debits: 0 },
      }),
      periodEndDate: "2026-03-31",
      outputAdjustment: 1,
      inputAdjustment: 0.5,
    })

    expect(result.net_vat_payable).toBe(20.5)
    expect(result.total_output_tax).toBe(21)
    expect(result.total_input_tax).toBe(0.5)
  })

  it("reports provided zero-rated and exempt classifications", () => {
    const result = calculateVatReturnTotals({
      rows: rows({ VAT: { credits: 15, debits: 0 } }),
      periodEndDate: "2026-03-31",
      taxableSales: 100,
      zeroRatedSales: 50,
      exemptSales: 25,
      taxablePurchases: 40,
      zeroRatedPurchases: 5,
      exemptPurchases: 2,
    })

    expect(result.total_taxable_sales).toBe(100)
    expect(result.total_zero_rated_sales).toBe(50)
    expect(result.total_exempt_sales).toBe(25)
    expect(result.total_taxable_purchases).toBe(40)
    expect(result.total_zero_rated_purchases).toBe(5)
    expect(result.total_exempt_purchases).toBe(2)
    expect(result.taxable_bases_source).toBe("provided")
    expect(result.warnings).toEqual([])
  })

  it("warns when taxable bases fall back to VAT / 15%", () => {
    const result = calculateVatReturnTotals({
      rows: rows({ VAT: { credits: 15, debits: 0 } }),
      periodEndDate: "2026-03-31",
    })

    expect(result.total_taxable_sales).toBe(100)
    expect(result.taxable_bases_source).toBe("derived_from_vat")
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("Zero-rated and exempt")
  })

  it("does not treat COVID as part of the post-2026 net", () => {
    const result = calculateVatReturnTotals({
      rows: rows({
        VAT: { credits: 15, debits: 0 },
        NHIL: { credits: 2.5, debits: 0 },
        GETFund: { credits: 2.5, debits: 0 },
        COVID: { credits: 1, debits: 0 },
      }),
      periodEndDate: "2026-01-01",
    })

    expect(result.total_output_covid).toBe(1)
    expect(result.total_output_tax).toBe(21)
    expect(result.net_vat_payable).toBe(20)
  })
})
