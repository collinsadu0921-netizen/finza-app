import { retailReceiptDisplayRef } from "@/app/retail/lib/mapRetailReceiptApiToEscpos"

describe("retailReceiptDisplayRef", () => {
  it("formats standard UUID as first8...last5 uppercase", () => {
    expect(retailReceiptDisplayRef("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550E8400...40000"
    )
  })

  it("accepts compact lowercase input", () => {
    expect(retailReceiptDisplayRef("550e8400e29b41d4a716446655440000")).toBe(
      "550E8400...40000"
    )
  })
})
