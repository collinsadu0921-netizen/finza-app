import { PATCH } from "../route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer")
jest.mock("@/lib/accounting/firm/requireMember", () => ({
  requireFirmMemberForApi: jest.fn(async () => null),
}))
jest.mock("@/lib/accounting/firm/engagements", () => ({
  getEngagementById: jest.fn(),
}))
jest.mock("@/lib/accounting/firm/activityLog", () => ({
  logFirmActivity: jest.fn(async () => undefined),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getEngagementById } from "@/lib/accounting/firm/engagements"

const mockCreate = createSupabaseServerClient as jest.MockedFunction<typeof createSupabaseServerClient>
const mockGetEngagement = getEngagementById as jest.MockedFunction<typeof getEngagementById>

function makeRequest(status: string) {
  return new NextRequest("http://localhost/api/accounting/firm/engagements/eng-1/status", {
    method: "PATCH",
    body: JSON.stringify({ status }),
    headers: { "Content-Type": "application/json" },
  })
}

function mockSupabase(role: string) {
  mockCreate.mockResolvedValue({
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: "partner-1" } }, error: null })),
    },
    from: jest.fn(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { role }, error: null }),
          }),
        }),
      }),
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () => ({ data: { id: "eng-1", status: "suspended" }, error: null }),
          }),
        }),
      }),
    })),
  } as never)
}

describe("PATCH /api/accounting/firm/engagements/[id]/status", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("denies partner pending → accepted (owner must accept)", async () => {
    mockSupabase("partner")
    mockGetEngagement.mockResolvedValue({
      id: "eng-1",
      accounting_firm_id: "firm-1",
      status: "pending",
      effective_from: "2026-01-01",
    } as never)

    const res = await PATCH(makeRequest("accepted"), { params: { id: "eng-1" } })
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.error_code).toBe("OWNER_ACCEPTANCE_REQUIRED")
  })

  it("allows partner to suspend an accepted engagement", async () => {
    mockSupabase("partner")
    mockGetEngagement.mockResolvedValue({
      id: "eng-1",
      accounting_firm_id: "firm-1",
      status: "accepted",
      effective_from: "2026-01-01",
    } as never)

    const res = await PATCH(makeRequest("suspended"), { params: { id: "eng-1" } })
    expect(res.status).toBe(200)
  })
})
