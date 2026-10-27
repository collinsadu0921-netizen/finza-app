import { containsMojibake, repairMojibake } from "../repairMojibake"

describe("repairMojibake", () => {
  it("repairs the CP850 cedi corruption", () => {
    expect(repairMojibake("\u00D4\u00E9\u00C112,345.67")).toBe("₵12,345.67")
  })

  it("repairs CP850 punctuation and arrows", () => {
    expect(repairMojibake("VAT filing \u00D4\u00C7\u00F6 August 2026")).toBe(
      "VAT filing — August 2026"
    )
    expect(repairMojibake("2100\u00D4\u00C7\u00F42130")).toBe("2100–2130")
    expect(repairMojibake("2026-08-01 \u00D4\u00E5\u00C6 2026-08-31")).toBe(
      "2026-08-01 → 2026-08-31"
    )
    expect(repairMojibake("\u00D4\u00A3\u00F4 LEDGER SOURCE")).toBe("✓ LEDGER SOURCE")
    expect(repairMojibake("Posting\u00D4\u00C7\u00AA")).toBe("Posting…")
    expect(repairMojibake("EMI \u252C\u00C0 Ref")).toBe("EMI · Ref")
  })

  it("repairs the Windows-1252 cedi corruption", () => {
    expect(repairMojibake("\u00E2\u201A\u00B5 500.00")).toBe("₵ 500.00")
  })

  it("leaves legitimate UTF-8 text and accents untouched", () => {
    const text = "₵1,234.56 — 2026-08-01 → 2026-08-31 · å ä ö"
    expect(repairMojibake(text)).toBe(text)
    expect(containsMojibake(text)).toBe(false)
  })

  it("detects known mojibake sequences", () => {
    expect(containsMojibake("\u00D4\u00E9\u00C1 10.00")).toBe(true)
    expect(containsMojibake("\u00E2\u201A\u00B5 10.00")).toBe(true)
    expect(containsMojibake("GH₵ 10.00")).toBe(false)
  })
})
