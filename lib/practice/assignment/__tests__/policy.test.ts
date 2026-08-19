import {
  CLIENT_NOT_ASSIGNED,
  canAssignTaskToUser,
  canManageClientAssignments,
  hasPortfolioWideVisibility,
  isClientInScope,
  resolveAuthorizedClientIds,
} from "../policy"

const effective = ["biz-a", "biz-b", "biz-c"]

describe("assignment policy", () => {
  it("lets a partner assign senior and junior", () => {
    expect(canManageClientAssignments("partner")).toBe(true)
    expect(canManageClientAssignments("senior")).toBe(false)
    expect(canManageClientAssignments("junior")).toBe(false)
    expect(canManageClientAssignments("readonly")).toBe(false)
  })

  it("gives partners portfolio-wide visibility", () => {
    expect(hasPortfolioWideVisibility("partner")).toBe(true)
    expect(
      resolveAuthorizedClientIds({
        role: "partner",
        effectiveClientIds: effective,
        assignedClientIds: ["biz-a"],
        firmHasAssignmentRows: true,
      })
    ).toEqual(effective)
  })

  it("restricts senior/junior/readonly to assigned effective clients once enforcement is on", () => {
    for (const role of ["senior", "junior", "readonly"] as const) {
      expect(
        resolveAuthorizedClientIds({
          role,
          effectiveClientIds: effective,
          assignedClientIds: ["biz-a"],
          firmHasAssignmentRows: true,
        })
      ).toEqual(["biz-a"])
    }
  })

  it("keeps pre-P1B firm-wide visibility when the firm has no assignment rows", () => {
    expect(
      resolveAuthorizedClientIds({
        role: "junior",
        effectiveClientIds: effective,
        assignedClientIds: [],
        firmHasAssignmentRows: false,
      })
    ).toEqual(effective)
  })

  it("does not grant access from assignment alone when engagement is not effective", () => {
    expect(
      resolveAuthorizedClientIds({
        role: "senior",
        effectiveClientIds: ["biz-a"],
        assignedClientIds: ["biz-a", "biz-suspended"],
        firmHasAssignmentRows: true,
      })
    ).toEqual(["biz-a"])
  })

  it("hides unassigned work clients from restricted roles", () => {
    expect(
      isClientInScope({
        role: "senior",
        businessId: "biz-b",
        assigned: false,
        firmHasAssignmentRows: true,
      })
    ).toBe(false)
    expect(CLIENT_NOT_ASSIGNED).toBe("CLIENT_NOT_ASSIGNED")
  })

  it("prevents task assignment to staff without client access once enforcement is on", () => {
    expect(
      canAssignTaskToUser({
        assigneeRole: "junior",
        assigneeAssignedToClient: false,
        firmHasAssignmentRows: true,
      })
    ).toBe(false)
    expect(
      canAssignTaskToUser({
        assigneeRole: "junior",
        assigneeAssignedToClient: true,
        firmHasAssignmentRows: true,
      })
    ).toBe(true)
    expect(
      canAssignTaskToUser({
        assigneeRole: "partner",
        assigneeAssignedToClient: false,
        firmHasAssignmentRows: true,
      })
    ).toBe(true)
  })
})
