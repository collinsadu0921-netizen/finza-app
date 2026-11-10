import { describe, expect, it } from "@jest/globals"
import {
  calculateVatReturnTotals,
  resolveVatReturnPosition,
} from "../vatReturnCalculation"

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
    expect(result.separate_nhil_payable).toBe(2.5)
    expect(result.separate_getfund_payable).toBe(2.5)
    expect(result.separate_covid_payable).toBe(1)
    expect(result.separate_levies_payable).toBe(6)
    expect(result.total_tax_payable).toBe(16.9)
    expect(result.total_tax_refund).toBe(0)
  })

  it("matches the December 2025 production UAT case", () => {
    const result = calculateVatReturnTotals({
      rows: rows({
        VAT: { credits: 130.43, debits: 130.43 },
        NHIL: { credits: 20.51, debits: 0 },
        GETFund: { credits: 20.51, debits: 0 },
        COVID: { credits: 8.2, debits: 0 },
      }),
      periodEndDate: "2025-12-31",
      taxableSales: 820.35,
      taxablePurchases: 820.35,
    })

    expect(result.period_is_post_2026).toBe(false)
    // VAT 3 net is VAT-only: output VAT 130.43 - input VAT 130.43.
    expect(result.net_vat_payable).toBe(0)
    expect(result.net_vat_refund).toBe(0)
    // NHIL/GETFund/COVID are separate pre-2026 levies.
    expect(result.separate_nhil_payable).toBe(20.51)
    expect(result.separate_getfund_payable).toBe(20.51)
    expect(result.separate_covid_payable).toBe(8.2)
    expect(result.separate_levies_payable).toBe(49.22)
    expect(result.total_tax_payable).toBe(49.22)
    expect(result.total_tax_refund).toBe(0)
  })

  it("does not offset a pre-2026 VAT refund against separate levies", () => {
    const result = calculateVatReturnTotals({
      rows: rows({
        VAT: { credits: 10, debits: 20 },
        NHIL: { credits: 2.5, debits: 0 },
        GETFund: { credits: 2.5, debits: 0 },
        COVID: { credits: 1, debits: 0 },
      }),
      periodEndDate: "2025-12-31",
    })

    expect(result.net_vat_payable).toBe(0)
    expect(result.net_vat_refund).toBe(10)
    expect(result.separate_levies_payable).toBe(6)
    expect(result.total_tax_payable).toBe(6)
    expect(result.total_tax_refund).toBe(10)
  })

  it("preserves the January 2027 post-2026 refund", () => {
    const result = calculateVatReturnTotals({
      rows: rows({
        VAT: { credits: 456.25, debits: 738.75 },
        NHIL: { credits: 76, debits: 123.08 },
        GETFund: { credits: 76, debits: 123.08 },
        COVID: { credits: 0, debits: 0 },
      }),
      periodEndDate: "2027-01-31",
      taxableSales: 3641.75,
      taxablePurchases: 4925.09,
    })

    expect(result.period_is_post_2026).toBe(true)
    expect(result.net_vat_payable).toBe(0)
    expect(result.net_vat_refund).toBe(376.66)
    expect(result.separate_levies_payable).toBe(0)
    expect(result.total_tax_payable).toBe(0)
    expect(result.total_tax_refund).toBe(376.66)
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

    // Box 2/9 include zero-rated taxable supplies but exclude exempt supplies.
    expect(result.total_taxable_sales).toBe(150)
    expect(result.total_standard_rated_sales).toBe(100)
    expect(result.total_zero_rated_sales).toBe(50)
    expect(result.total_exempt_sales).toBe(25)
    expect(result.total_taxable_purchases).toBe(45)
    expect(result.total_standard_rated_purchases).toBe(40)
    expect(result.total_zero_rated_purchases).toBe(5)
    expect(result.total_exempt_purchases).toBe(2)
    expect(result.taxable_bases_source).toBe("provided")
    expect(result.taxable_bases_complete).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it("does not derive taxable bases from VAT / 15%", () => {
    const result = calculateVatReturnTotals({
      rows: rows({ VAT: { credits: 15, debits: 0 } }),
      periodEndDate: "2026-03-31",
    })

    expect(result.total_taxable_sales).toBe(0)
    expect(result.total_taxable_purchases).toBe(0)
    expect(result.taxable_bases_source).toBe("unavailable")
    expect(result.taxable_bases_complete).toBe(false)
    expect(result.warnings).toHaveLength(2)
    expect(result.warnings.join(" ")).toContain("transaction evidence")
  })

  it("supports a zero-rated-only return with no output VAT", () => {
    const result = calculateVatReturnTotals({
      rows: rows({}),
      periodEndDate: "2026-03-31",
      taxableSales: 0,
      zeroRatedSales: 100,
      taxablePurchases: 0,
    })

    expect(result.total_output_vat).toBe(0)
    expect(result.total_taxable_sales).toBe(100)
    expect(result.total_zero_rated_sales).toBe(100)
    expect(result.taxable_bases_source).toBe("provided")
    expect(result.taxable_bases_complete).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it("keeps exempt supplies outside taxable sales", () => {
    const result = calculateVatReturnTotals({
      rows: rows({ VAT: { credits: 15, debits: 0 } }),
      periodEndDate: "2026-03-31",
      taxableSales: 100,
      exemptSales: 25,
      taxablePurchases: 0,
    })

    expect(result.total_taxable_sales).toBe(100)
    expect(result.total_exempt_sales).toBe(25)
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

  it("splits a stored pre-2026 return into VAT-only net and separate levies", () => {
    const position = resolveVatReturnPosition({
      periodEndDate: "2025-12-31",
      netVatPayable: 0,
      netVatRefund: 0,
      totalOutputNhil: 20.51,
      totalOutputGetfund: 20.51,
      totalOutputCovid: 8.2,
    })

    expect(position.net_vat_payable).toBe(0)
    expect(position.net_vat_refund).toBe(0)
    expect(position.separate_nhil_payable).toBe(20.51)
    expect(position.separate_getfund_payable).toBe(20.51)
    expect(position.separate_covid_payable).toBe(8.2)
    expect(position.separate_levies_payable).toBe(49.22)
    expect(position.total_tax_payable).toBe(49.22)
    expect(position.total_tax_refund).toBe(0)
  })

  it("does not create separate levies for a stored post-2026 return", () => {
    const position = resolveVatReturnPosition({
      periodEndDate: "2027-01-31",
      netVatPayable: 0,
      netVatRefund: 376.66,
      totalOutputNhil: 76,
      totalOutputGetfund: 76,
      totalOutputCovid: 0,
    })

    expect(position.net_vat_refund).toBe(376.66)
    expect(position.separate_levies_payable).toBe(0)
    expect(position.total_tax_payable).toBe(0)
    expect(position.total_tax_refund).toBe(376.66)
  })
})
