import { customPricingNotesToHtml, parseCustomPricingNotes } from "../parseCustomPricing"

describe("parseCustomPricingNotes", () => {
  it("parses rate schedule sample with heading, spacers, and rate rows", () => {
    const raw = `Pricing Schedule

2 Bedroom / 3 Bathroom apartment turnover cleaning: GHS 1,250 per apartment per turnover

1 Bedroom / 1 Bathroom apartment turnover cleaning: GHS 950 per apartment per turnover

Heavy reset: priced separately after assessment`

    const blocks = parseCustomPricingNotes(raw)
    expect(blocks[0]).toEqual({ type: "heading", text: "Pricing Schedule" })
    expect(blocks[1]).toEqual({ type: "spacer" })
    expect(blocks[2]).toMatchObject({ type: "rate_row" })
    expect(blocks[3]).toEqual({ type: "spacer" })
    expect(blocks[4]).toMatchObject({ type: "rate_row" })
    expect(blocks[5]).toEqual({ type: "spacer" })
    expect(blocks[6]).toMatchObject({ type: "rate_row", label: "Heavy reset", value: "priced separately after assessment" })
  })

  it("parses bullet lines", () => {
    const blocks = parseCustomPricingNotes("- First\n• Second")
    expect(blocks).toEqual([
      { type: "bullet", text: "First" },
      { type: "bullet", text: "Second" },
    ])
  })

  it("does not treat URLs as rate rows", () => {
    const blocks = parseCustomPricingNotes("See https://example.com/path for details")
    expect(blocks).toEqual([{ type: "paragraph", text: "See https://example.com/path for details" }])
  })
})

describe("customPricingNotesToHtml", () => {
  it("wraps rate rows in a group with label/value columns", () => {
    const html = customPricingNotesToHtml("A: B")
    expect(html).toContain("cp-rate-group")
    expect(html).toContain("cp-rate-row")
    expect(html).toContain("cp-label")
    expect(html).toContain("cp-value")
    expect(html).toContain("A")
    expect(html).toContain("B")
  })
})
