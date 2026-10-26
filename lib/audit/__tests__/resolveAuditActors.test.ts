import { describe, expect, it, jest } from "@jest/globals"
import { resolveAuditActors } from "@/lib/audit/resolveAuditActors"

function createAdminMock(options: {
  members?: Array<{ user_id: string; display_name: string | null; email: string | null }>
  users?: Array<{ id: string; full_name: string | null; email: string | null }>
}) {
  const memberIn = jest.fn(() =>
    Promise.resolve({ data: options.members ?? [], error: null })
  )
  const memberEq = jest.fn(() => ({ in: memberIn }))
  const memberSelect = jest.fn(() => ({ eq: memberEq }))
  const userIn = jest.fn(() => Promise.resolve({ data: options.users ?? [], error: null }))
  const userSelect = jest.fn(() => ({ in: userIn }))
  const from = jest.fn((table: string) => {
    if (table === "business_users") return { select: memberSelect }
    if (table === "users") return { select: userSelect }
    throw new Error(`Unexpected table: ${table}`)
  })
  return { from, memberEq, memberIn, userIn }
}

describe("resolveAuditActors", () => {
  it("scopes member lookup to the business and user IDs", async () => {
    const admin = createAdminMock({})
    await resolveAuditActors(admin as never, "business-1", ["user-1"])
    expect(admin.memberEq).toHaveBeenCalledWith("business_id", "business-1")
    expect(admin.memberIn).toHaveBeenCalledWith("user_id", ["user-1"])
    expect(admin.userIn).toHaveBeenCalledWith("id", ["user-1"])
  })

  it("prefers business member display name, then public name, then email", async () => {
    const admin = createAdminMock({
      members: [{ user_id: "user-1", display_name: "Member Name", email: "member@example.com" }],
      users: [{ id: "user-1", full_name: "Public Name", email: "public@example.com" }],
    })
    const actors = await resolveAuditActors(admin as never, "business-1", ["user-1"])
    expect(actors.get("user-1")?.label).toBe("Member Name")
  })

  it("falls back to public email when no name exists", async () => {
    const admin = createAdminMock({
      members: [],
      users: [{ id: "user-1", full_name: "", email: "staging@test.com" }],
    })
    const actors = await resolveAuditActors(admin as never, "business-1", ["user-1"])
    expect(actors.get("user-1")?.label).toBe("staging@test.com")
  })

  it("returns no label for an ID that does not exist in scoped data", async () => {
    const admin = createAdminMock({ members: [], users: [] })
    const actors = await resolveAuditActors(admin as never, "business-1", ["missing"])
    expect(actors.get("missing")?.label).toBeNull()
  })

  it("does not query when there are no actor IDs", async () => {
    const admin = createAdminMock({})
    const actors = await resolveAuditActors(admin as never, "business-1", [null, "", undefined])
    expect(admin.from).not.toHaveBeenCalled()
    expect(actors.size).toBe(0)
  })
})
