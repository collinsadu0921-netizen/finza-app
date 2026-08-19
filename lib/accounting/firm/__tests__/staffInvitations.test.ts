import {
  generateInvitationToken,
  hashInvitationToken,
  isValidPracticeStaffRole,
  normalizeInvitationEmail,
  practiceStaffRoleLabel,
} from "../staffInvitations"

describe("staffInvitations", () => {
  it("normalizes email", () => {
    expect(normalizeInvitationEmail("  User@Example.COM ")).toBe("user@example.com")
  })

  it("validates practice roles", () => {
    expect(isValidPracticeStaffRole("senior")).toBe(true)
    expect(isValidPracticeStaffRole("admin")).toBe(false)
  })

  it("hashes token deterministically", () => {
    const { token, tokenHash } = generateInvitationToken()
    expect(token.length).toBeGreaterThan(20)
    expect(hashInvitationToken(token)).toBe(tokenHash)
    expect(hashInvitationToken(token)).not.toBe(token)
  })

  it("labels roles for UI", () => {
    expect(practiceStaffRoleLabel("readonly")).toBe("Readonly")
  })
})
