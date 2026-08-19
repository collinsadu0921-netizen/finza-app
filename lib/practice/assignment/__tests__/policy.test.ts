import {
  CLIENT_NOT_ASSIGNED,
  canAssignTaskToUser,
  canManageAssignmentEnforcement,
  canManageClientAssignments,
  hasPortfolioWideVisibility,
  isClientInScope,
  resolveAuthorizedClientIds,
} from "../policy"

const effective = ["biz-a", "biz-b", "biz-c"]

describe("assignment policy", () => {
  it("lets only a partner manage assignments and enforcement", () => {
    expect(canManageClientAssignments("partner")).toBe(true)
    expect(canManageAssignmentEnforcement("partner")).toBe(true)
    expect(canManageClientAssignments("senior")).toBe(false)
    expect(canManageAssignmentEnforcement("senior")).toBe(false)
    expect(canManageClientAssignments("junior")).toBe(false)
    expect(canManageClientAssignments("readonly")).toBe(false)
  })

  it("gives partners portfolio-wide visibility even when enforcement is on", () => {
    expect(hasPortfolioWideVisibility("partner")).toBe(true)
    expect(
      resolveAuthorizedClientIds({
        role: "partner",
        effectiveClientIds: effective,
        assignedClientIds: ["biz-a"],
        assignmentEnforcementEnabled: true,
      })
    ).toEqual(effective)
  })

  it("keeps legacy firm-wide visibility while enforcement is off", () => {
    for (const role of ["senior", "junior", "readonly"] as const) {
      expect(
        resolveAuthorizedClientIds({
          role,
          effectiveClientIds: effective,
          assignedClientIds: [],
          assignmentEnforcementEnabled: false,
        })
      ).toEqual(effective)
    }
  })

  it("restricts senior/junior/readonly after enforcement is enabled", () => {
    for (const role of ["senior", "junior", "readonly"] as const) {
      expect(
        resolveAuthorizedClientIds({
          role,
          effectiveClientIds: effective,
          assignedClientIds: ["biz-a"],
          assignmentEnforcementEnabled: true,
        })
      ).toEqual(["biz-a"])
    }
  })

  it("does not turn enforcement off just because assignment rows are empty", () => {
    expect(
      resolveAuthorizedClientIds({
        role: "senior",
        effectiveClientIds: effective,
        assignedClientIds: [],
        assignmentEnforcementEnabled: true,
      })
    ).toEqual([])
  })

  it("does not grant access from assignment alone when engagement is not effective", () => {
    expect(
      resolveAuthorizedClientIds({
        role: "senior",
        effectiveClientIds: ["biz-a"],
        assignedClientIds: ["biz-a", "biz-suspended"],
        assignmentEnforcementEnabled: true,
      })
    ).toEqual(["biz-a"])
  })

  it("hides unassigned clients from restricted roles after enablement", () => {
    expect(
      isClientInScope({
        role: "senior",
        businessId: "biz-b",
        assigned: false,
        assignmentEnforcementEnabled: true,
      })
    ).toBe(false)
    expect(CLIENT_NOT_ASSIGNED).toBe("CLIENT_NOT_ASSIGNED")
  })

  it("prevents task assignment to staff without client access once enforcement is on", () => {
    expect(
      canAssignTaskToUser({
        assigneeRole: "junior",
        assigneeAssignedToClient: false,
        assignmentEnforcementEnabled: true,
      })
    ).toBe(false)
    expect(
      canAssignTaskToUser({
        assigneeRole: "junior",
        assigneeAssignedToClient: true,
        assignmentEnforcementEnabled: true,
      })
    ).toBe(true)
    expect(
      canAssignTaskToUser({
        assigneeRole: "partner",
        assigneeAssignedToClient: false,
        assignmentEnforcementEnabled: true,
      })
    ).toBe(true)
  })
})
