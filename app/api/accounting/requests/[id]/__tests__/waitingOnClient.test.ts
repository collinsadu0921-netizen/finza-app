import { PATCH } from "../route"
import { NextRequest } from "next/server"
import { CLIENT_REQUEST_STATUS_SET } from "@/lib/practice/work/requestStatus"

jest.mock("@/lib/supabaseServer")
jest.mock("@/lib/accounting/permissions", () => ({
  assertAccountingAccess: jest.fn(),
  accountingUserFromRequest: jest.fn(() => ({})),
}))
jest.mock("@/lib/accounting/resolveAccountingContext", () => ({
  resolveAccountingContext: jest.fn(async () => ({ businessId: "biz-1" })),
}))
jest.mock("@/lib/accounting/authorityEngine", () => ({
  getAccountingAuthority: jest.fn(async () => ({
    allowed: true,
    firmId: "firm-1",
    engagementId: "eng-1",
  })),
}))
jest.mock("@/lib/accounting/firm/activityLog", () => ({
  logFirmActivity: jest.fn(async () => undefined),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"

const mockCreate = createSupabaseServerClient as jest.MockedFunction<typeof createSupabaseServerClient>

function mockUpdate(status: string) {
  mockCreate.mockResolvedValue({
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
    },
    from: jest.fn(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "req-1",
                  status: "open",
                  metadata: {},
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
      update: (patch: { status?: string }) => {
        expect(patch.status).toBe(status)
        return {
          eq: () => ({
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: { id: "req-1", status, metadata: {} },
                  error: null,
                }),
              }),
            }),
          }),
        }
      },
    })),
  } as never)
}

describe("PATCH client request waiting_on_client", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("persists waiting_on_client", async () => {
    expect(CLIENT_REQUEST_STATUS_SET.has("waiting_on_client")).toBe(true)
    mockUpdate("waiting_on_client")

    const req = new NextRequest("http://localhost/api/accounting/requests/req-1", {
      method: "PATCH",
      body: JSON.stringify({ business_id: "biz-1", status: "waiting_on_client" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: "req-1" }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.request.status).toBe("waiting_on_client")
  })
})
