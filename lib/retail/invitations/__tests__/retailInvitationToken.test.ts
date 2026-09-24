import { describe, expect, it } from "@jest/globals"
import {
  buildRetailInvitePath,
  generateRetailInvitationToken,
  hashRetailInvitationToken,
  normalizeRetailInviteEmail,
  classifyRetailInvitationForUser,
  safeRetailInviteNextPath,
} from "../retailInvitationToken"

describe("retail invitation tokens", () => {
  it("stores only a sha256 hash and keeps the raw token out of the hash", () => {
    const { token, tokenHash } = generateRetailInvitationToken()
    expect(tokenHash).toHaveLength(64)
    expect(tokenHash).not.toContain(token)
    expect(hashRetailInvitationToken(token)).toBe(tokenHash)
    expect(hashRetailInvitationToken(`${token}x`)).not.toBe(tokenHash)
  })

  it("normalizes email case", () => {
    expect(normalizeRetailInviteEmail("  Owner@Finza.COM ")).toBe("owner@finza.com")
  })

  it("accepts only a same-origin retail invite path", () => {
    const { token } = generateRetailInvitationToken()
    const path = buildRetailInvitePath(token)
    expect(safeRetailInviteNextPath(path)).toBe(path)
    expect(safeRetailInviteNextPath("https://evil.example/retail/invite/abc")).toBeNull()
    expect(safeRetailInviteNextPath("//evil.example")).toBeNull()
    expect(safeRetailInviteNextPath("/retail/invite/../admin")).toBeNull()
    expect(safeRetailInviteNextPath("/retail/invite/resume")).toBe("/retail/invite/resume")
  })

  it("shows acceptance only for a matching pending invitation", () => {
    const future = "2099-01-01T00:00:00.000Z"
    const past = "2000-01-01T00:00:00.000Z"
    expect(
      classifyRetailInvitationForUser({
        status: "pending",
        expiresAt: future,
        invitationEmail: "owner@example.com",
        userEmail: "Owner@Example.com",
      })
    ).toBe("ready")
    expect(
      classifyRetailInvitationForUser({
        status: "pending",
        expiresAt: future,
        invitationEmail: "owner@example.com",
        userEmail: "other@example.com",
      })
    ).toBe("denied")
    for (const status of ["accepted", "revoked", "expired"]) {
      expect(
        classifyRetailInvitationForUser({
          status,
          expiresAt: future,
          invitationEmail: "owner@example.com",
          userEmail: "owner@example.com",
        })
      ).toBe("unavailable")
    }
    expect(
      classifyRetailInvitationForUser({
        status: "pending",
        expiresAt: past,
        invitationEmail: "owner@example.com",
        userEmail: "owner@example.com",
      })
    ).toBe("unavailable")
  })

  it("rotation produces a different hash so the previous link cannot be reused", () => {
    const first = generateRetailInvitationToken()
    const second = generateRetailInvitationToken()
    expect(second.tokenHash).not.toBe(first.tokenHash)
    expect(hashRetailInvitationToken(first.token)).not.toBe(second.tokenHash)
  })
})
