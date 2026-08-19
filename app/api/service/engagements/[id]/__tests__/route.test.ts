import { PATCH } from "../route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer")
jest.mock("@/lib/firmActivityLog", () => ({
  logFirmActivity: jest.fn(async () => undefined),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryMinTier", () => ({
  enforceServiceIndustryMinTier: jest.fn(async () => null),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"

const mockCreate = createSupabaseServerClient as jest.MockedFunction<typeof createSupabaseServerClient>

function makeRequest(action: string) {
  return new NextRequest("http://localhost/api/service/engagements/eng-1", {
    method: "PATCH",
    body: JSON.stringify({ action }),
    headers: { "Content-Type": "application/json" },
  })
}

function mockOwnerAccept(opts: { userId: string; ownerId: string; status?: string }) {
  mockCreate.mockResolvedValue({
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: opts.userId } }, error: null })),
      getSession: jest.fn(async () => ({ data: { session: { user: { id: opts.userId } } } })),
    },
    from: jest.fn((table: string) => {
      if (table === "firm_client_engagements") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "eng-1",
                  client_business_id: "biz-abc",
                  accounting_firm_id: "firm-1",
                  status: opts.status ?? "pending",
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: { id: "eng-1", status: "accepted" },
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      if (table === "businesses") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { owner_id: opts.ownerId }, error: null }),
            }),
          }),
        }
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }
    }),
  } as never)
}

describe("PATCH /api/service/engagements/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("allows the client owner to accept a pending engagement", async () => {
    mockOwnerAccept({ userId: "owner-1", ownerId: "owner-1" })
    const res = await PATCH(makeRequest("accept"), { params: { id: "eng-1" } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it("denies an unrelated business owner", async () => {
    mockOwnerAccept({ userId: "other-owner", ownerId: "owner-1" })
    const res = await PATCH(makeRequest("accept"), { params: { id: "eng-1" } })
    expect(res.status).toBe(403)
  })
})
