import {
  buildCustomerApprovalPatch,
  customerApprovalActionsForStatus,
  isCustomerApprovalStatus,
  parseCustomerApprovalAction,
} from "../customerApproval"

describe("customerApproval helpers", () => {
  it("parses action and status aliases", () => {
    expect(parseCustomerApprovalAction({ action: "approve" })).toBe("approve")
    expect(parseCustomerApprovalAction({ status: "pending_approval" })).toBe("request")
    expect(parseCustomerApprovalAction({ status: "not_requested" })).toBe("reset")
    expect(parseCustomerApprovalAction({ status: "invalid" })).toBeNull()
  })

  it("builds approve patch without financial status fields", () => {
    const patch = buildCustomerApprovalPatch("approve", "user-1", { note: "Phone OK" })
    expect(patch).toMatchObject({
      customer_approval_status: "approved",
      customer_approval_updated_by: "user-1",
      customer_approval_note: "Phone OK",
      customer_rejected_at: null,
    })
    expect(patch).not.toHaveProperty("status")
    expect(patch).not.toHaveProperty("total")
  })

  it("builds reset patch clearing approval timestamps", () => {
    const patch = buildCustomerApprovalPatch("reset", "user-1")
    expect(patch).toMatchObject({
      customer_approval_status: "not_requested",
      customer_approval_requested_at: null,
      customer_approved_at: null,
      customer_rejected_at: null,
    })
  })

  it("validates approval statuses", () => {
    expect(isCustomerApprovalStatus("approved")).toBe(true)
    expect(isCustomerApprovalStatus("paid")).toBe(false)
  })

  it("returns UI actions per approval state", () => {
    expect(customerApprovalActionsForStatus("pending_approval", false)).toEqual([
      "approve",
      "reject",
      "reset",
    ])
    expect(customerApprovalActionsForStatus("approved", true)).toEqual([])
  })
})
