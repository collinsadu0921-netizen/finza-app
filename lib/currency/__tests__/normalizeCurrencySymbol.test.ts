import {
  isCorruptedGhsSymbol,
  MOJIBAKE_GHS_CEDI,
  normalizeCurrencySymbol,
  resolveDocumentCurrencySymbol,
} from "../normalizeCurrencySymbol"

describe("normalizeCurrencySymbol", () => {
  it("repairs Latin-1 mojibake to canonical cedi", () => {
    expect(normalizeCurrencySymbol(MOJIBAKE_GHS_CEDI, "GHS")).toBe("₵")
    expect(normalizeCurrencySymbol(MOJIBAKE_GHS_CEDI)).toBe("₵")
  })

  it("prefers mapped symbol from ISO code over stored mojibake", () => {
    expect(normalizeCurrencySymbol(MOJIBAKE_GHS_CEDI, "USD")).toBe("$")
  })

  it("returns canonical GHS symbol when only code is provided", () => {
    expect(normalizeCurrencySymbol(null, "GHS")).toBe("₵")
  })

  it("preserves valid non-GHS symbols", () => {
    expect(normalizeCurrencySymbol("$", "USD")).toBe("$")
    expect(normalizeCurrencySymbol("KSh", "KES")).toBe("KSh")
  })

  it("does not treat valid cedi as corrupted", () => {
    expect(isCorruptedGhsSymbol("₵")).toBe(false)
    expect(normalizeCurrencySymbol("₵", "GHS")).toBe("₵")
  })

  it("resolveDocumentCurrencySymbol matches normalizeCurrencySymbol", () => {
    expect(resolveDocumentCurrencySymbol("GHS", MOJIBAKE_GHS_CEDI)).toBe("₵")
  })
})

describe("isCorruptedGhsSymbol", () => {
  it("detects mojibake cedi variants", () => {
    expect(isCorruptedGhsSymbol(MOJIBAKE_GHS_CEDI)).toBe(true)
    expect(isCorruptedGhsSymbol("GHâ‚µ")).toBe(true)
  })

  it("does not flag unrelated currency symbols", () => {
    expect(isCorruptedGhsSymbol("$")).toBe(false)
    expect(isCorruptedGhsSymbol("GHS")).toBe(false)
  })
})
