import {
  missingManualTenderReference,
  salePaymentReferenceFromLines,
  withNormalizedTenderReferences,
} from "../manualTenderReference"

describe("manual card and MoMo references", () => {
  it("does not require a reference for cash", () => {
    expect(missingManualTenderReference([{ method: "cash", amount: 20 }])).toBe(false)
    expect(salePaymentReferenceFromLines([{ method: "cash", amount: 20, reference: "ignore" }])).toBeNull()
    expect(withNormalizedTenderReferences([{ method: "cash", amount: 20, reference: "ignore" }])).toEqual([
      { method: "cash", amount: 20 },
    ])
  })

  it("keeps a card bank-terminal reference on the sale when it is the only non-cash line", () => {
    const lines = withNormalizedTenderReferences([{ method: "card", amount: 40, reference: " RRN-100 " }])
    expect(missingManualTenderReference(lines)).toBe(false)
    expect(lines[0].reference).toBe("RRN-100")
    expect(salePaymentReferenceFromLines(lines)).toBe("RRN-100")
  })

  it("keeps a manual MoMo reference on the sale", () => {
    const lines = [{ method: "momo" as const, amount: 15, reference: "MOMO-77" }]
    expect(missingManualTenderReference(lines)).toBe(false)
    expect(salePaymentReferenceFromLines(lines)).toBe("MOMO-77")
  })

  it("rejects card and manual MoMo lines that have no reference", () => {
    expect(missingManualTenderReference([{ method: "card", amount: 10 }])).toBe(true)
    expect(missingManualTenderReference([{ method: "momo", amount: 10, reference: "  " }])).toBe(true)
  })

  it("keeps each non-cash reference on its own split line", () => {
    const lines = withNormalizedTenderReferences([
      { method: "cash", amount: 10, reference: "nope" },
      { method: "card", amount: 20, reference: "CARD-1" },
      { method: "momo", amount: 5, reference: "MOMO-2" },
    ])
    expect(lines.map((line) => line.reference)).toEqual([undefined, "CARD-1", "MOMO-2"])
    expect(salePaymentReferenceFromLines(lines)).toBeNull()
  })
})
