import {
  singleTenderReferenceAfterMethodChange,
  singleTenderReferenceOnOpen,
  splitLineAfterMethodChange,
} from "../tenderReferenceState"

describe("tender reference isolation", () => {
  it("starts a new sale with no card or MoMo reference", () => {
    expect(singleTenderReferenceOnOpen()).toBe("")
  })

  it("does not reuse a card reference when switching to MoMo", () => {
    expect(singleTenderReferenceAfterMethodChange("card", "momo", "STAGE-CARD-001")).toBe("")
  })

  it("does not reuse a MoMo reference when switching to card", () => {
    expect(singleTenderReferenceAfterMethodChange("momo", "card", "STAGE-MOMO-001")).toBe("")
  })

  it("keeps the reference while the cashier stays on the same tender", () => {
    expect(singleTenderReferenceAfterMethodChange("card", "card", "STAGE-CARD-001")).toBe("STAGE-CARD-001")
  })

  it("clears a cancelled reference on the next open", () => {
    const leftover = singleTenderReferenceAfterMethodChange("card", "card", "STAGE-CARD-001")
    expect(leftover).toBe("STAGE-CARD-001")
    expect(singleTenderReferenceOnOpen()).toBe("")
  })

  it("keeps each split line reference and clears only the line whose method changed", () => {
    const lines = [
      { method: "cash" as const, amount: 4 },
      { method: "card" as const, amount: 3, reference: "STAGE-CARD-SPLIT-001" },
      { method: "momo" as const, amount: 3, reference: "STAGE-MOMO-SPLIT-001" },
    ]
    const next = lines.map((line, index) =>
      index === 1 ? splitLineAfterMethodChange(line, "momo") : line
    )
    expect(next[0]).toEqual(lines[0])
    expect(next[1]).toEqual({ method: "momo", amount: 3, reference: undefined })
    expect(next[2].reference).toBe("STAGE-MOMO-SPLIT-001")
  })
})
