import { describe, it, expect, afterEach } from "@jest/globals"
import type { User } from "@supabase/supabase-js"
import { isFinzaFounderAccess } from "../isFinzaFounder"

const originalFounderId = process.env.FINZA_FOUNDER_USER_ID

function user(partial: Partial<User> & { id: string }): User {
  return partial as User
}

describe("isFinzaFounderAccess", () => {
  afterEach(() => {
    if (originalFounderId === undefined) {
      delete process.env.FINZA_FOUNDER_USER_ID
    } else {
      process.env.FINZA_FOUNDER_USER_ID = originalFounderId
    }
  })

  it("returns false for null user", () => {
    expect(isFinzaFounderAccess(null)).toBe(false)
  })

  it("returns true when FINZA_FOUNDER_USER_ID matches user.id (trimmed)", () => {
    process.env.FINZA_FOUNDER_USER_ID = "  abc-123  "
    expect(isFinzaFounderAccess(user({ id: "abc-123" }))).toBe(true)
  })

  it("returns false when env id does not match", () => {
    process.env.FINZA_FOUNDER_USER_ID = "other"
    expect(isFinzaFounderAccess(user({ id: "abc-123" }))).toBe(false)
  })

  it("returns true when app_metadata.finza_platform_owner is true", () => {
    delete process.env.FINZA_FOUNDER_USER_ID
    expect(
      isFinzaFounderAccess(
        user({
          id: "any",
          app_metadata: { finza_platform_owner: true },
        })
      )
    ).toBe(true)
  })

  it("returns false for normal tenant user without env or flag", () => {
    delete process.env.FINZA_FOUNDER_USER_ID
    expect(
      isFinzaFounderAccess(
        user({
          id: "tenant-user",
          app_metadata: {},
        })
      )
    ).toBe(false)
  })
})
