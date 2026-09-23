import { describe, expect, it } from "@jest/globals"
import {
  buildRetailInvitePath,
  generateRetailInvitationToken,
  hashRetailInvitationToken,
  normalizeRetailInviteEmail,
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
  })

  it("rotation produces a different hash so the previous link cannot be reused", () => {
    const first = generateRetailInvitationToken()
    const second = generateRetailInvitationToken()
    expect(second.tokenHash).not.toBe(first.tokenHash)
    expect(hashRetailInvitationToken(first.token)).not.toBe(second.tokenHash)
  })
})
