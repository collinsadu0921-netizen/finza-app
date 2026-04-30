import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextRequest } from "next/server"
import { POST as POST_ASK } from "../ask/route"

jest.mock("@/lib/founder/founderAkwasiRouteGuards", () => ({
  getFounderAkwasiAuthContext: jest.fn(),
}))

jest.mock("@/lib/founder/akwasiGroqJson", () => ({
  akwasiGroqJsonCompletion: jest.fn(),
}))

import { getFounderAkwasiAuthContext } from "@/lib/founder/founderAkwasiRouteGuards"
import { akwasiGroqJsonCompletion } from "@/lib/founder/akwasiGroqJson"

const mockCtx = getFounderAkwasiAuthContext as jest.MockedFunction<typeof getFounderAkwasiAuthContext>
const mockGroq = akwasiGroqJsonCompletion as jest.MockedFunction<typeof akwasiGroqJsonCompletion>

function makeQuery(result: { data: unknown; error: unknown }) {
  const q = {
    select: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(result),
  }
  return q
}

describe("POST /api/founder/akwasi/ask context", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGroq.mockResolvedValue(JSON.stringify({ answer: "ok", sources: [] }))
  })

  it("passes active_decisions into the model user payload", async () => {
    const decisions = [{ id: "dec1", decision: "Focus retail", area: "product", status: "active" }]
    const from = jest.fn((table: string) => {
      if (table === "founder_decisions") return makeQuery({ data: decisions, error: null })
      if (table === "founder_notes") return makeQuery({ data: [], error: null })
      if (table === "founder_tasks") return makeQuery({ data: [], error: null })
      if (table === "founder_briefings") return makeQuery({ data: [], error: null })
      return makeQuery({ data: [], error: null })
    })

    mockCtx.mockResolvedValue({
      ok: true,
      user: { id: "u1" } as never,
      admin: { from } as never,
    })

    const req = new NextRequest("http://localhost/api/founder/akwasi/ask", {
      method: "POST",
      body: JSON.stringify({ question: "What should we prioritize?" }),
    })
    await POST_ASK(req)

    expect(mockGroq).toHaveBeenCalled()
    const call = mockGroq.mock.calls[0]?.[0]
    expect(call?.user).toContain("active_decisions")
    expect(call?.user).toContain("Focus retail")
  })
})
