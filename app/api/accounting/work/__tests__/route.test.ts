import { GET } from "../route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer")
jest.mock("@/lib/accounting/firm/requireMember", () => ({
  requireFirmMemberForApi: jest.fn(async () => null),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"

const mockCreate = createSupabaseServerClient as jest.MockedFunction<typeof createSupabaseServerClient>

type TableData = Record<string, unknown[]>

function chain(result: { data: unknown; error: unknown }) {
  const api: Record<string, unknown> = {}
  const self = () => api
  api.select = self
  api.eq = self
  api.in = self
  api.is = self
  api.limit = self
  api.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return api
}

function mockSupabase(opts: {
  userId: string
  memberships: { firm_id: string }[]
  tables: TableData
}) {
  mockCreate.mockResolvedValue({
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: opts.userId } }, error: null })),
    },
    from: jest.fn((table: string) => {
      if (table === "accounting_firm_users") {
        const rows = opts.tables.accounting_firm_users ?? opts.memberships
        return chain({ data: rows, error: null })
      }
      return chain({ data: opts.tables[table] ?? [], error: null })
    }),
  } as never)
}

function request(url: string) {
  return new NextRequest(url)
}

describe("GET /api/accounting/work", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("does not return another firm's records when firm_id is forged", async () => {
    mockSupabase({
      userId: "user-a",
      memberships: [{ firm_id: "firm-a" }],
      tables: {
        firm_client_engagements: [
          {
            id: "eng-b",
            accounting_firm_id: "firm-b",
            client_business_id: "biz-b",
            status: "accepted",
            effective_from: "2026-01-01",
            effective_to: null,
          },
        ],
        client_tasks: [
          {
            id: "task-b",
            client_business_id: "biz-b",
            title: "Secret",
            status: "pending",
            priority: "high",
            assigned_to_user_id: null,
            due_at: null,
            created_at: "2026-08-01T00:00:00.000Z",
          },
        ],
      },
    })

    const res = await GET(request("http://localhost/api/accounting/work?firm_id=firm-b"))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.items).toBeUndefined()
  })

  it("does not leak Firm B work to Firm A when querying the active firm", async () => {
    mockSupabase({
      userId: "user-a",
      memberships: [{ firm_id: "firm-a" }],
      tables: {
        firm_client_engagements: [
          {
            id: "eng-a",
            accounting_firm_id: "firm-a",
            client_business_id: "biz-a",
            status: "accepted",
            effective_from: "2026-01-01",
            effective_to: null,
          },
        ],
        businesses: [{ id: "biz-a", name: "Alpha Ltd" }],
        client_tasks: [
          {
            id: "task-a",
            client_business_id: "biz-a",
            title: "Alpha task",
            status: "pending",
            priority: "normal",
            assigned_to_user_id: "user-a",
            due_at: null,
            created_at: "2026-08-01T00:00:00.000Z",
          },
        ],
      },
    })

    const res = await GET(request("http://localhost/api/accounting/work?firm_id=firm-a"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.firm_id).toBe("firm-a")
    expect(body.items.every((item: { business_id: string }) => item.business_id === "biz-a")).toBe(true)
    expect(body.items.some((item: { title: string }) => item.title === "Alpha task")).toBe(true)
  })
})
