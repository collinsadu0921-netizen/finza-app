import { extractTaxLineRows } from "../extractTaxLineRows"

describe("extractTaxLineRows", () => {
  it("returns lines from canonical { lines, meta, pricing_mode }", () => {
    const rows = [{ code: "VAT", amount: 10 }]
    expect(extractTaxLineRows({ lines: rows, meta: {}, pricing_mode: "inclusive" })).toBe(rows)
  })

  it("returns nested array from legacy { tax_lines, subtotal_excl_tax, tax_total, total_incl_tax }", () => {
    const rows = [{ code: "VAT", amount: 5 }]
    expect(
      extractTaxLineRows({
        tax_lines: rows,
        subtotal_excl_tax: 100,
        tax_total: 5,
        total_incl_tax: 105,
      })
    ).toBe(rows)
  })

  it("returns a raw root array", () => {
    const rows = [{ code: "NHIL", amount: 1 }]
    expect(extractTaxLineRows(rows)).toBe(rows)
  })

  it("returns [] for empty canonical lines", () => {
    expect(extractTaxLineRows({ lines: [], meta: {} })).toEqual([])
  })

  it("returns null for invalid or null input", () => {
    expect(extractTaxLineRows(null)).toBeNull()
    expect(extractTaxLineRows(undefined)).toBeNull()
    expect(extractTaxLineRows("not-json")).toBeNull()
    expect(extractTaxLineRows(42)).toBeNull()
    expect(extractTaxLineRows({})).toBeNull()
    expect(extractTaxLineRows({ lines: "bad" })).toBeNull()
  })

  it("prefers lines over tax_lines when both are arrays (canonical wins)", () => {
    const canonical: unknown[] = []
    const legacy = [{ code: "VAT", amount: 1 }]
    expect(extractTaxLineRows({ lines: canonical, tax_lines: legacy })).toBe(canonical)
  })
})
