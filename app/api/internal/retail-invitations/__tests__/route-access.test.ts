import { beforeEach, describe, expect, it, jest } from "@jest/globals"
import { NextRequest, NextResponse } from "next/server"
import { GET, POST } from "../route"

jest.mock("@/lib/retail/invitations/requireInternalOps", () => ({
  requireInternalOps: jest.fn(),
}))

jest.mock("@/lib/retail/invitations/retailInvitationAdmin", () => ({
  materializeExpiredRetailInvitations: jest.fn(),
  listRetailInvitations: jest.fn(),
  createRetailInvitation: jest.fn(),
  sendRetailInvitationEmail: jest.fn(),
}))

import { requireInternalOps } from "@/lib/retail/invitations/requireInternalOps"
import { createRetailInvitation, listRetailInvitations } from "@/lib/retail/invitations/retailInvitationAdmin"

const gate = requireInternalOps as jest.MockedFunction<typeof requireInternalOps>
const createInvite = createRetailInvitation as jest.MockedFunction<typeof createRetailInvitation>
const listInvites = listRetailInvitations as jest.MockedFunction<typeof listRetailInvitations>

describe("/api/internal/retail-invitations access", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns 401 when the caller is not signed in", async () => {
    gate.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    })
    const res = await GET(new NextRequest("http://localhost/api/internal/retail-invitations"))
    expect(res.status).toBe(401)
  })

  it("returns 403 for an ordinary tenant owner, admin, cashier, or staff user", async () => {
    gate.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    })
    const res = await POST(
      new NextRequest("http://localhost/api/internal/retail-invitations", {
        method: "POST",
        body: JSON.stringify({ email: "a@b.co", businessName: "Shop" }),
      })
    )
    expect(res.status).toBe(403)
    expect(createInvite).not.toHaveBeenCalled()
  })

  it("does not return a token hash to an authorized operator", async () => {
    gate.mockResolvedValue({
      ok: true,
      user: { id: "admin-1" } as never,
      admin: {} as never,
      requestId: "req-1",
    })
    listInvites.mockResolvedValue({
      rows: [
        {
          id: "inv-1",
          email_normalized: "owner@example.com",
          business_name: "Shop",
          token_version: 1,
          status: "pending",
          expires_at: "2026-10-01T00:00:00.000Z",
          invited_by_user_id: "admin-1",
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z",
          accepted_at: null,
          accepted_by_user_id: null,
          accepted_business_id: null,
          revoked_at: null,
          internal_note: null,
          last_email_provider_status: null,
          last_email_provider_id: null,
          last_email_error: null,
          last_email_attempted_at: null,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    const res = await GET(new NextRequest("http://localhost/api/internal/retail-invitations?status=pending"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(JSON.stringify(json)).not.toContain("token_hash")
    expect(json.rows).toHaveLength(1)
  })
})
