import {
  mapRetailReceiptApiToEscpos,
  type RetailReceiptApiBody,
} from "@/app/retail/lib/mapRetailReceiptApiToEscpos"

function minimalBody(overrides: Partial<RetailReceiptApiBody> = {}): RetailReceiptApiBody {
  return {
    sale: {
      id: "550e8400-e29b-41d4-a716-446655440000",
      amount: 10,
      created_at: "2026-01-01T12:00:00.000Z",
    },
    sale_items: [],
    business: { name: "Acme Ltd" },
    ...overrides,
  } as RetailReceiptApiBody
}

describe("mapRetailReceiptApiToEscpos logo", () => {
  it("prefers store logo_url over business logo_url", () => {
    const data = mapRetailReceiptApiToEscpos(
      minimalBody({
        store: { name: "Main", logo_url: "https://cdn.example/store.png" },
        business: {
          name: "Acme",
          logo_url: "https://cdn.example/biz.png",
        },
      }),
      "GHS",
      "₵"
    )
    expect(data.logo).toBe("https://cdn.example/store.png")
  })

  it("falls back to business logo when store has no logo", () => {
    const data = mapRetailReceiptApiToEscpos(
      minimalBody({
        store: { name: "Main", logo_url: null },
        business: { name: "Acme", logo_url: "  https://cdn.example/biz.png  " },
      }),
      "GHS",
      "₵"
    )
    expect(data.logo).toBe("https://cdn.example/biz.png")
  })

  it("omits logo when neither URL is set", () => {
    const data = mapRetailReceiptApiToEscpos(
      minimalBody({
        business: { name: "Acme", logo_url: null },
      }),
      "GHS",
      "₵"
    )
    expect(data.logo).toBeUndefined()
  })
})
