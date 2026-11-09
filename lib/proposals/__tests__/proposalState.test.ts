import {
  normalizeProposalStatus,
  proposalCanBeEditedByStaff,
  proposalInvoiceConversionBlockReason,
  proposalPublicAcceptAllowed,
  proposalStaffSendInitialAllowed,
  proposalStatusIsTerminal,
  proposalTransitionPublicAcceptIsValid,
} from "../proposalState"

describe("proposalState", () => {
  it("normalizes unknown to draft", () => {
    expect(normalizeProposalStatus("")).toBe("draft")
    expect(normalizeProposalStatus("nope")).toBe("draft")
  })

  it("terminal locks staff edits", () => {
    expect(proposalCanBeEditedByStaff("accepted")).toBe(false)
    expect(proposalCanBeEditedByStaff("rejected")).toBe(false)
    expect(proposalCanBeEditedByStaff("sent")).toBe(true)
    expect(proposalCanBeEditedByStaff("viewed")).toBe(true)
  })

  it("public accept only from sent or viewed", () => {
    expect(proposalPublicAcceptAllowed("sent")).toBe(true)
    expect(proposalPublicAcceptAllowed("viewed")).toBe(true)
    expect(proposalPublicAcceptAllowed("draft")).toBe(false)
    expect(proposalPublicAcceptAllowed("accepted")).toBe(false)
  })

  it("send initial only from draft", () => {
    expect(proposalStaffSendInitialAllowed("draft")).toBe(true)
    expect(proposalStaffSendInitialAllowed("sent")).toBe(false)
  })

  it("terminal statuses", () => {
    expect(proposalStatusIsTerminal("accepted")).toBe(true)
    expect(proposalStatusIsTerminal("sent")).toBe(false)
  })

  it("transition helpers align with public accept", () => {
    expect(proposalTransitionPublicAcceptIsValid("sent")).toBe(true)
    expect(proposalTransitionPublicAcceptIsValid("viewed")).toBe(true)
    expect(proposalTransitionPublicAcceptIsValid("draft")).toBe(false)
  })

  it("blocks invoice conversion unless the proposal is accepted and unconverted", () => {
    expect(
      proposalInvoiceConversionBlockReason({
        status: "accepted",
        converted_estimate_id: null,
        converted_invoice_id: null,
        pricing_mode: "line_items",
      })
    ).toBeNull()
    expect(
      proposalInvoiceConversionBlockReason({
        status: "accepted",
        converted_estimate_id: null,
        converted_invoice_id: "inv-1",
        pricing_mode: "line_items",
      })
    ).toBe("already_invoiced")
    expect(
      proposalInvoiceConversionBlockReason({
        status: "accepted",
        converted_estimate_id: "est-1",
        converted_invoice_id: null,
        pricing_mode: "fixed",
      })
    ).toBe("already_linked_estimate")
    expect(
      proposalInvoiceConversionBlockReason({
        status: "sent",
        converted_estimate_id: null,
        converted_invoice_id: null,
        pricing_mode: "fixed",
      })
    ).toBe("wrong_status")
    expect(
      proposalInvoiceConversionBlockReason({
        status: "accepted",
        converted_estimate_id: null,
        converted_invoice_id: null,
        pricing_mode: "custom",
      })
    ).toBe("pricing")
  })
})
