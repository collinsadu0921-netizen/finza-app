/**
 * Decisions route access + DELETE soft-delete wiring (mocked guard / admin).
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextRequest, NextResponse } from "next/server"
import { DELETE as DELETE_DECISION } from "../decisions/[id]/route"
import { POST as POST_DECISION } from "../decisions/route"

jest.mock("@/lib/founder/founderAkwasiRouteGuards", () => ({
  getFounderAkwasiAuthContext: jest.fn(),
}))

import { getFounderAkwasiAuthContext } from "@/lib/founder/founderAkwasiRouteGuards"

const mockCtx = getFounderAkwasiAuthContext as jest.MockedFunction<typeof getFounderAkwasiAuthContext>

describe("decisions API extended", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("DELETE returns 401 when unauthenticated", async () => {
    mockCtx.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    })
    const res = await DELETE_DECISION(
      new Request("http://localhost/api/founder/akwasi/decisions/x") as never,
      { params: Promise.resolve({ id: "d1" }) }
    )
    expect(res.status).toBe(401)
  })

  it("DELETE returns 403 for non-founder", async () => {
    mockCtx.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    })
    const res = await DELETE_DECISION(
      new Request("http://localhost/api/founder/akwasi/decisions/x") as never,
      { params: Promise.resolve({ id: "d1" }) }
    )
    expect(res.status).toBe(403)
  })

  it("DELETE soft-deletes via deleted_at when founder", async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { id: "d1", deleted_at: "2026-01-01T00:00:00.000Z" },
      error: null,
    })
    const select = jest.fn().mockReturnValue({ maybeSingle })
    const is = jest.fn().mockReturnValue({ select })
    const eq = jest.fn().mockReturnValue({ is })
    const update = jest.fn().mockReturnValue({ eq })
    const from = jest.fn().mockReturnValue({ update })
    mockCtx.mockResolvedValue({
      ok: true,
      user: { id: "founder-1" } as never,
      admin: { from } as never,
    })

    const res = await DELETE_DECISION(
      new Request("http://localhost/api/founder/akwasi/decisions/d1") as never,
      { params: Promise.resolve({ id: "d1" }) }
    )
    expect(res.status).toBe(200)
    expect(from).toHaveBeenCalledWith("founder_decisions")
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ deleted_at: expect.any(String) }))
  })

  it("POST creates decision when founder", async () => {
    const single = jest.fn().mockResolvedValue({
      data: {
        id: "new",
        decision: "Ship v1",
        reason: null,
        area: "product",
        status: "active",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      error: null,
    })
    const select = jest.fn().mockReturnValue({ single })
    const insert = jest.fn().mockReturnValue({ select })
    const from = jest.fn().mockReturnValue({ insert })
    mockCtx.mockResolvedValue({
      ok: true,
      user: { id: "founder-1" } as never,
      admin: { from } as never,
    })

    const req = new NextRequest("http://localhost/api/founder/akwasi/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "Ship v1", area: "product" }),
    })
    const res = await POST_DECISION(req)
    expect(res.status).toBe(200)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "Ship v1",
        area: "product",
        status: "active",
        created_by: "founder-1",
      })
    )
  })
})
