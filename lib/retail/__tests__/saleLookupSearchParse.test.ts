import {
  normalizeSaleUuidFromLookupInput,
  parseSaleAmountSearch,
  parseSaleHistoryDateSearch,
  saleLookupIlikePattern,
} from "@/lib/retail/saleLookupSearchParse"

describe("saleLookupSearchParse", () => {
  it("normalizes hyphenated and compact UUIDs", () => {
    const a = "550E8400-E29B-41D4-A716-446655440000"
    expect(normalizeSaleUuidFromLookupInput(a)).toBe("550e8400-e29b-41d4-a716-446655440000")
    expect(normalizeSaleUuidFromLookupInput("550E8400E29B41D4A716446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000"
    )
  })

  it("parses calendar date bounds", () => {
    const d = parseSaleHistoryDateSearch("2026-04-17")
    expect(d).not.toBeNull()
    expect(d!.start).toBe("2026-04-17T00:00:00.000Z")
    expect(d!.end.startsWith("2026-04-18")).toBe(true)
  })

  it("parses strict amounts", () => {
    expect(parseSaleAmountSearch("120.50")).toBe(120.5)
    expect(parseSaleAmountSearch("120,50")).toBe(120.5)
    expect(parseSaleAmountSearch("2024-01-01")).toBeNull()
  })

  it("strips ilike wildcards from pattern", () => {
    expect(saleLookupIlikePattern("a%b_c")).toBe("abc")
  })
})
