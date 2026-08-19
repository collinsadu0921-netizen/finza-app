import { resolveAuthority } from "../authority"

describe("resolveAuthority engagement status", () => {
  it("allows view_reports when engagement status is accepted", () => {
    const result = resolveAuthority({
      firmRole: "readonly",
      engagementAccess: "read",
      action: "view_reports",
      engagementStatus: "accepted",
    })
    expect(result.allowed).toBe(true)
  })

  it("denies view_reports when engagement is suspended", () => {
    const result = resolveAuthority({
      firmRole: "partner",
      engagementAccess: "approve",
      action: "view_reports",
      engagementStatus: "suspended",
    })
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe("ENGAGEMENT_NOT_ACTIVE")
  })

  it("denies create_journal for readonly even with write engagement", () => {
    const result = resolveAuthority({
      firmRole: "readonly",
      engagementAccess: "write",
      action: "create_journal",
      engagementStatus: "accepted",
    })
    expect(result.allowed).toBe(false)
    expect(result.reasonCode).toBe("READONLY_ROLE")
  })
})
