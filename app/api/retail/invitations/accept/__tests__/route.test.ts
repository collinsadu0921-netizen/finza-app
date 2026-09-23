import { beforeEach, describe, expect, it, jest } from "@jest/globals"
import { NextRequest } from "next/server"
import { POST } from "../route"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/supabaseServiceRole", () => ({
  getSupabaseServiceRoleClient: jest.fn(() => ({})),
}))
jest.mock("@/lib/retail/invitations/retailInvitationAdmin", () => ({
  acceptRetailInvitation: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { acceptRetailInvitation } from "@/lib/retail/invitations/retailInvitationAdmin"

const getClient = createSupabaseServerClient as jest.MockedFunction<typeof createSupabaseServerClient>
const accept = acceptRetailInvitation as jest.MockedFunction<typeof acceptRetailInvitation>

function withUser(email: string | null) {
  getClient.mockResolvedValue({
    auth: {
      getUser: async () => ({ data: { user: email ? { id: "user-1", email } : null } }),
    },
  } as never)
}

describe("POST /api/retail/invitations/accept", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("rejects an unauthenticated caller", async () => {
    withUser(null)
    const res = await POST(
      new NextRequest("http://localhost/api/retail/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ token: "abc" }),
      })
    )
    expect(res.status).toBe(401)
    expect(accept).not.toHaveBeenCalled()
  })

  it("maps email mismatch, expiry, reuse, and a valid acceptance without returning a token", async () => {
    withUser("Owner@Example.com")
    accept.mockRejectedValueOnce(new Error("retail_invitation_email_mismatch"))
    let res = await POST(
      new NextRequest("http://localhost/api/retail/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ token: "raw-token" }),
      })
    )
    expect(res.status).toBe(403)

    accept.mockRejectedValueOnce(new Error("retail_invitation_expired"))
    res = await POST(
      new NextRequest("http://localhost/api/retail/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ token: "raw-token" }),
      })
    )
    expect(res.status).toBe(410)

    accept.mockRejectedValueOnce(new Error("retail_invitation_not_pending"))
    res = await POST(
      new NextRequest("http://localhost/api/retail/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ token: "raw-token" }),
      })
    )
    expect(res.status).toBe(409)

    accept.mockResolvedValueOnce("business-1")
    res = await POST(
      new NextRequest("http://localhost/api/retail/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ token: "raw-token" }),
      })
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true, businessId: "business-1" })
    expect(JSON.stringify(json)).not.toContain("raw-token")
    expect(accept).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ email: "Owner@Example.com", userId: "user-1" })
    )
  })
})
