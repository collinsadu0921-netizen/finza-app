import {
  humanizeLedgerType,
  ledgerReferenceLabel,
  ledgerSourceLabel,
  shortReferenceId,
} from "../ledgerDisplay"

describe("VAT ledger display helpers", () => {
  it("humanizes machine reference types", () => {
    expect(humanizeLedgerType("invoice")).toBe("Invoice")
    expect(humanizeLedgerType("credit_note")).toBe("Credit note")
    expect(humanizeLedgerType("bill_payment")).toBe("Bill payment")
    expect(humanizeLedgerType("unknown_source")).toBe("Unknown source")
  })

  it("prefers the resolved document number", () => {
    expect(
      ledgerReferenceLabel({
        reference_type: "invoice",
        reference_id: "0f4c1a9e-1111-2222-3333-444455556666",
        reference_label: "Invoice INV-00042",
      })
    ).toBe("Invoice INV-00042")
  })

  it("never renders a full raw UUID", () => {
    const id = "0f4c1a9e-1111-2222-3333-444455556666"
    expect(ledgerReferenceLabel({ reference_type: "invoice", reference_id: id })).toBe(
      "#0f4c1a9e"
    )
    expect(shortReferenceId(id)).toBe("0f4c1a9e")
  })

  it("falls back to the source type when no reference exists", () => {
    expect(ledgerSourceLabel({ source_type: "manual_journal" })).toBe("Manual journal")
    expect(ledgerSourceLabel({})).toBe("—")
  })
})
