import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextResponse } from "next/server"
import { GET as GET_NOTES } from "../notes/route"
import { GET as GET_DECISIONS } from "../decisions/route"
import { POST as POST_ASK } from "../ask/route"

jest.mock("@/lib/founder/founderAkwasiRouteGuards", () => ({
  getFounderAkwasiAuthContext: jest.fn(),
}))

import { getFounderAkwasiAuthContext } from "@/lib/founder/founderAkwasiRouteGuards"

const mockCtx = getFounderAkwasiAuthContext as jest.MockedFunction<typeof getFounderAkwasiAuthContext>

describe("/api/founder/akwasi access", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("GET notes returns 403 when guard returns forbidden", async () => {
    mockCtx.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    })
    const res = await GET_NOTES()
    expect(res.status).toBe(403)
  })

  it("GET notes returns 401 when guard returns unauthorized", async () => {
    mockCtx.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    })
    const res = await GET_NOTES()
    expect(res.status).toBe(401)
  })

  it("GET decisions returns 403 for non-founder context", async () => {
    mockCtx.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    })
    const res = await GET_DECISIONS()
    expect(res.status).toBe(403)
  })

  it("POST ask returns 403 for non-founder context", async () => {
    mockCtx.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    })
    const req = new Request("http://localhost/api/founder/akwasi/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "What is the roadmap?" }),
    })
    const res = await POST_ASK(req as unknown as import("next/server").NextRequest)
    expect(res.status).toBe(403)
  })
})
