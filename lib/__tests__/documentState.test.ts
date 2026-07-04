import {
  type EstimateStatus,
  type ProformaStatus,
  ESTIMATE_ACTIONS,
  ESTIMATE_STATES,
  ESTIMATE_TRANSITIONS,
  canEditEstimate,
  canEditProforma,
  isEstimateActionAllowed,
  isValidEstimateTransition,
  shouldCreateRevision,
} from "@/lib/documentState"

describe("documentState — estimates", () => {
  it("includes rejected in shared constants", () => {
    expect(ESTIMATE_STATES.rejected).toBe("rejected")
    expect(ESTIMATE_ACTIONS.rejected).toEqual(["duplicate"])
    expect(ESTIMATE_TRANSITIONS.rejected).toEqual([])
  })

  it("models sent → accepted | rejected transitions used by accept/reject APIs", () => {
    expect(isValidEstimateTransition("sent", "accepted")).toBe(true)
    expect(isValidEstimateTransition("sent", "rejected")).toBe(true)
    expect(isValidEstimateTransition("draft", "sent")).toBe(true)
    expect(isValidEstimateTransition("sent", "draft")).toBe(false)
  })

  it("rejected estimates are not editable and do not create revisions", () => {
    expect(canEditEstimate("rejected" as EstimateStatus)).toBe(false)
    expect(shouldCreateRevision("estimate", "rejected")).toBe(false)
  })

  it("allows duplicate action on rejected (parity with expired)", () => {
    expect(isEstimateActionAllowed("rejected", "duplicate")).toBe(true)
    expect(isEstimateActionAllowed("rejected", "edit")).toBe(false)
  })
})

describe("documentState — proformas", () => {
  it("allows edit for draft and sent only", () => {
    expect(canEditProforma("draft")).toBe(true)
    expect(canEditProforma("sent")).toBe(true)
    expect(canEditProforma("accepted" as ProformaStatus)).toBe(false)
    expect(canEditProforma("converted" as ProformaStatus)).toBe(false)
    expect(canEditProforma("cancelled" as ProformaStatus)).toBe(false)
    expect(canEditProforma("rejected" as ProformaStatus)).toBe(false)
  })

  it("creates revision only when editing sent proforma", () => {
    expect(shouldCreateRevision("proforma", "draft")).toBe(false)
    expect(shouldCreateRevision("proforma", "sent")).toBe(true)
    expect(shouldCreateRevision("proforma", "accepted")).toBe(false)
  })
})
