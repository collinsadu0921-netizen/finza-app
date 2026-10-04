import {
  missingManualTenderReference,
  paymentLinesMatchSaleAmount,
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

  it("allows card and manual MoMo lines with no reference", () => {
    const card = withNormalizedTenderReferences([{ method: "card", amount: 10 }])
    const momo = withNormalizedTenderReferences([{ method: "momo", amount: 10, reference: "  " }])
    expect(missingManualTenderReference(card)).toBe(false)
    expect(missingManualTenderReference(momo)).toBe(false)
    expect(salePaymentReferenceFromLines(card)).toBeNull()
    expect(salePaymentReferenceFromLines(momo)).toBeNull()
    expect(JSON.parse(JSON.stringify(card))).toEqual([{ method: "card", amount: 10 }])
    expect(JSON.parse(JSON.stringify(momo))).toEqual([{ method: "momo", amount: 10 }])
  })

  it("keeps a supplied card or MoMo reference and drops a blank one on a split", () => {
    const both = withNormalizedTenderReferences([
      { method: "cash", amount: 4 },
      { method: "card", amount: 3, reference: "STAGE-CARD-SPLIT-002" },
      { method: "momo", amount: 3, reference: "STAGE-MOMO-SPLIT-002" },
    ])
    expect(salePaymentReferenceFromLines(both)).toBeNull()
    expect(JSON.parse(JSON.stringify(both))).toEqual([
      { method: "cash", amount: 4 },
      { method: "card", amount: 3, reference: "STAGE-CARD-SPLIT-002" },
      { method: "momo", amount: 3, reference: "STAGE-MOMO-SPLIT-002" },
    ])

    const cardOnly = withNormalizedTenderReferences([
      { method: "cash", amount: 4 },
      { method: "card", amount: 3, reference: "STAGE-CARD-SPLIT-002" },
      { method: "momo", amount: 3, reference: "" },
    ])
    expect(salePaymentReferenceFromLines(cardOnly)).toBeNull()
    expect(JSON.parse(JSON.stringify(cardOnly))[2]).toEqual({ method: "momo", amount: 3 })

    const none = withNormalizedTenderReferences([
      { method: "cash", amount: 4 },
      { method: "card", amount: 3 },
      { method: "momo", amount: 3, reference: "   " },
    ])
    expect(salePaymentReferenceFromLines(none)).toBeNull()
    expect(JSON.parse(JSON.stringify(none))).toEqual([
      { method: "cash", amount: 4 },
      { method: "card", amount: 3 },
      { method: "momo", amount: 3 },
    ])
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

  it.each([
    [
      "cash + card",
      [
        { method: "cash" as const, amount: 4 },
        { method: "card" as const, amount: 6, reference: "STAGE-CARD-SPLIT-001" },
      ],
    ],
    [
      "cash + MoMo",
      [
        { method: "cash" as const, amount: 4 },
        { method: "momo" as const, amount: 6, reference: "STAGE-MOMO-SPLIT-001" },
      ],
    ],
    [
      "card + MoMo",
      [
        { method: "card" as const, amount: 3, reference: "STAGE-CARD-SPLIT-001" },
        { method: "momo" as const, amount: 7, reference: "STAGE-MOMO-SPLIT-001" },
      ],
    ],
    [
      "cash + card + MoMo",
      [
        { method: "cash" as const, amount: 4 },
        { method: "momo" as const, amount: 3, reference: "STAGE-MOMO-SPLIT-001" },
        { method: "card" as const, amount: 3, reference: "STAGE-CARD-SPLIT-001" },
      ],
    ],
  ])("accepts %s when line totals match the sale", (_label, lines) => {
    const normalized = withNormalizedTenderReferences(lines)
    const total = normalized.reduce((sum, line) => sum + line.amount, 0)
    expect(paymentLinesMatchSaleAmount(normalized, total)).toBe(true)
    expect(missingManualTenderReference(normalized)).toBe(false)
    const cash = normalized.find((line) => line.method === "cash")
    if (cash) expect(cash.reference).toBeUndefined()
    expect(normalized.filter((line) => line.method !== "cash").every((line) => line.reference)).toBe(true)
  })

  it("rejects split lines whose totals do not match the sale", () => {
    const lines = [
      { method: "cash" as const, amount: 4 },
      { method: "card" as const, amount: 3, reference: "STAGE-CARD-SPLIT-001" },
    ]
    expect(paymentLinesMatchSaleAmount(lines, 10)).toBe(false)
  })
})
