import { assertProposalSections, parsePricingFromRow, pricingPayloadSchema } from "../schema"
import { validateAndNormalizePricingForDb } from "../pricingForDb"

describe("proposal sections schema", () => {
  it("parses valid blocks", () => {
    const blocks = assertProposalSections([
      { type: "heading", level: 2, text: "Hello" },
      { type: "image", asset_id: "11111111-1111-4111-8111-111111111111", caption: "x" },
    ])
    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe("heading")
  })

  it("throws on invalid image block", () => {
    expect(() =>
      assertProposalSections([{ type: "image", asset_id: "not-a-uuid" } as never])
    ).toThrow()
  })
})

describe("pricing payload", () => {
  it("accepts fixed pricing", () => {
    const p = pricingPayloadSchema.parse({ mode: "fixed", amount: 100, label: "Total" })
    expect(p.mode).toBe("fixed")
    const db = validateAndNormalizePricingForDb("fixed", { amount: 100, label: "Total" })
    expect(db.pricing_mode).toBe("fixed")
    expect(db.pricing_payload.amount).toBe(100)
  })

  it("normalizes line_items for DB", () => {
    const db = validateAndNormalizePricingForDb("line_items", {
      items: [{ description: "A", quantity: 1, unit_price: 10 }],
    })
    expect(db.pricing_mode).toBe("line_items")
    expect(Array.isArray(db.pricing_payload.items)).toBe(true)
  })

  it("parsePricingFromRow coerces line item numbers and camelCase keys from JSON", () => {
    const p = parsePricingFromRow("line_items", {
      items: [{ description: "Svc", quantity: "2", unitPrice: "50.5" }],
    })
    expect(p.mode).toBe("line_items")
    if (p.mode === "line_items") {
      expect(p.items[0].quantity).toBe(2)
      expect(p.items[0].unit_price).toBe(50.5)
    }
  })
})
