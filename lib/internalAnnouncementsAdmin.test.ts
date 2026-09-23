import { afterEach, describe, expect, it } from "@jest/globals"
import type { User } from "@supabase/supabase-js"
import { isInternalOpsAdmin } from "./internalAnnouncementsAdmin"

const original = process.env.INTERNAL_ANNOUNCEMENT_ADMIN_EMAILS
const originalFounder = process.env.FINZA_FOUNDER_USER_ID

function user(partial: Partial<User>): User {
  return partial as User
}

describe("internal retail operator gate", () => {
  afterEach(() => {
    if (original === undefined) delete process.env.INTERNAL_ANNOUNCEMENT_ADMIN_EMAILS
    else process.env.INTERNAL_ANNOUNCEMENT_ADMIN_EMAILS = original
    if (originalFounder === undefined) delete process.env.FINZA_FOUNDER_USER_ID
    else process.env.FINZA_FOUNDER_USER_ID = originalFounder
  })

  it("allows an allowlisted operator and the founder, and denies tenant roles", () => {
    process.env.INTERNAL_ANNOUNCEMENT_ADMIN_EMAILS = "ops@example.com"
    process.env.FINZA_FOUNDER_USER_ID = "founder-1"
    expect(isInternalOpsAdmin(user({ id: "x", email: "OPS@example.com" }))).toBe(true)
    expect(isInternalOpsAdmin(user({ id: "founder-1", email: "founder@example.com" }))).toBe(true)
    expect(
      isInternalOpsAdmin(
        user({
          id: "owner-1",
          email: "owner@example.com",
          app_metadata: { role: "owner" },
        })
      )
    ).toBe(false)
    expect(isInternalOpsAdmin(user({ id: "cashier-1", email: "cashier@example.com" }))).toBe(false)
    expect(isInternalOpsAdmin(null)).toBe(false)
  })

  it("denies a user after they are removed from the allowlist", () => {
    process.env.INTERNAL_ANNOUNCEMENT_ADMIN_EMAILS = "ops@example.com"
    const operator = user({ id: "ops-1", email: "ops@example.com" })
    expect(isInternalOpsAdmin(operator)).toBe(true)
    process.env.INTERNAL_ANNOUNCEMENT_ADMIN_EMAILS = ""
    expect(isInternalOpsAdmin(operator)).toBe(false)
  })
})
