import { jsonbToTaxResult } from "../helpers"

describe("jsonbToTaxResult", () => {
  it("returns null for null, undefined, invalid JSON string, or non-object root", () => {
    expect(jsonbToTaxResult(null)).toBeNull()
    expect(jsonbToTaxResult(undefined)).toBeNull()
    expect(jsonbToTaxResult("{not json")).toBeNull()
    expect(jsonbToTaxResult(42)).toBeNull()
  })

  it("returns null for canonical wrapper with empty lines and no legacy tax_lines", () => {
    expect(
      jsonbToTaxResult({
        lines: [],
        meta: { jurisdiction: "GH", effective_date_used: "2025-12-31", engine_version: "GH-2025-A" },
        pricing_mode: "inclusive",
      })
    ).toBeNull()
  })

  it("parses canonical { lines, meta, pricing_mode } and preserves line codes and amounts", () => {
    const canonical = {
      lines: [
        { code: "NHIL", amount: 2.5, rate: 0.025, name: "NHIL" },
        { code: "GETFUND", amount: 2.5, rate: 0.025, name: "GETFund" },
        { code: "COVID", amount: 1, rate: 0.01, name: "COVID Levy" },
        { code: "VAT", amount: 15.9, rate: 0.15, name: "VAT" },
      ],
      meta: {
        jurisdiction: "GH",
        effective_date_used: "2025-12-31",
        engine_version: "GH-2025-A",
      },
      pricing_mode: "inclusive",
    }
    const result = jsonbToTaxResult(canonical)
    expect(result).not.toBeNull()
    expect(result!.taxLines).toHaveLength(4)
    expect(result!.taxLines.map((l) => l.code)).toEqual(["NHIL", "GETFUND", "COVID", "VAT"])
    expect(result!.taxLines.map((l) => l.amount)).toEqual([2.5, 2.5, 1, 15.9])
    expect(result!.tax_total).toBe(21.9)
    expect(result!.subtotal_excl_tax).toBe(0)
    expect(result!.total_incl_tax).toBe(21.9)
  })

  it("parses canonical JSON string", () => {
    const payload = JSON.stringify({
      lines: [{ code: "VAT", amount: 15, rate: 0.15, name: "VAT" }],
      meta: { jurisdiction: "GH", effective_date_used: "2026-01-01", engine_version: "GH-2026-B" },
      pricing_mode: "inclusive",
    })
    const result = jsonbToTaxResult(payload)
    expect(result).not.toBeNull()
    expect(result!.taxLines).toEqual([
      expect.objectContaining({ code: "VAT", amount: 15, name: "VAT" }),
    ])
    expect(result!.tax_total).toBe(15)
  })

  it("prefers non-empty canonical lines over legacy tax_lines when both exist", () => {
    const result = jsonbToTaxResult({
      lines: [{ code: "VAT", amount: 10, name: "VAT" }],
      tax_lines: [{ code: "VAT", amount: 99, name: "VAT" }],
    })
    expect(result!.taxLines).toHaveLength(1)
    expect(result!.taxLines[0].amount).toBe(10)
    expect(result!.tax_total).toBe(10)
  })

  it("keeps legacy behavior for { tax_lines, subtotal_excl_tax, tax_total, total_incl_tax }", () => {
    const legacy = {
      tax_lines: [
        { code: "NHIL", name: "NHIL", rate: 0.025, base: 100, amount: 2.5 },
        { code: "VAT", name: "VAT", rate: 0.15, base: 80, amount: 12 },
      ],
      subtotal_excl_tax: 100,
      tax_total: 14.5,
      total_incl_tax: 114.5,
    }
    const result = jsonbToTaxResult(legacy)
    expect(result).not.toBeNull()
    expect(result!.taxLines).toHaveLength(2)
    expect(result!.subtotal_excl_tax).toBe(100)
    expect(result!.tax_total).toBe(14.5)
    expect(result!.total_incl_tax).toBe(114.5)
  })

  it("returns empty taxLines for legacy empty tax_lines array with zero totals", () => {
    const result = jsonbToTaxResult({
      tax_lines: [],
      subtotal_excl_tax: 0,
      tax_total: 0,
      total_incl_tax: 50,
    })
    expect(result).not.toBeNull()
    expect(result!.taxLines).toEqual([])
    expect(result!.subtotal_excl_tax).toBe(0)
    expect(result!.tax_total).toBe(0)
    expect(result!.total_incl_tax).toBe(50)
  })

  it("supports root array of line objects", () => {
    const result = jsonbToTaxResult([{ code: "VAT", amount: 7.5, name: "VAT", rate: 0.15, base: 50 }])
    expect(result).not.toBeNull()
    expect(result!.taxLines).toHaveLength(1)
    expect(result!.tax_total).toBe(7.5)
  })

  it("maps ledger fields from top-level or meta on canonical lines", () => {
    const result = jsonbToTaxResult({
      lines: [
        {
          code: "VAT",
          amount: 15,
          ledger_account_code: "2100",
          ledger_side: "credit",
        },
        {
          code: "NHIL",
          amount: 2.5,
          meta: { ledger_account_code: "2110", ledger_side: "credit" },
        },
      ],
      meta: { jurisdiction: "GH", effective_date_used: "2025-06-01", engine_version: "GH-2025-A" },
      pricing_mode: "inclusive",
    })
    expect(result!.taxLines[0].ledger_account_code).toBe("2100")
    expect(result!.taxLines[0].ledger_side).toBe("credit")
    expect(result!.taxLines[1].ledger_account_code).toBe("2110")
    expect(result!.taxLines[1].ledger_side).toBe("credit")
  })

  it("uses optional base_amount and total_amount on canonical object when legacy totals absent", () => {
    const result = jsonbToTaxResult({
      lines: [{ code: "VAT", amount: 15, name: "VAT" }],
      meta: { jurisdiction: "GH", effective_date_used: "2025-12-31", engine_version: "GH-2025-A" },
      pricing_mode: "inclusive",
      base_amount: 100,
      total_amount: 115,
    })
    expect(result!.tax_total).toBe(15)
    expect(result!.subtotal_excl_tax).toBe(100)
    expect(result!.total_incl_tax).toBe(115)
  })
})
