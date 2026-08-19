import { GET } from "../route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer")
jest.mock("@/lib/accounting/firm/requireMember", () => ({
  requireFirmMemberForApi: jest.fn(async () => null),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"

const mockCreate = createSupabaseServerClient as jest.MockedFunction<typeof createSupabaseServerClient>

type TableData = Record<string, unknown[]>

function filterable(rows: unknown[]) {
  let filtered = [...rows]
  const api: Record<string, unknown> = {}
  const self = () => api
  api.select = self
  api.eq = (col: string, val: unknown) => {
    if (filtered.some((row) => col in (row as object))) {
      filtered = filtered.filter((row) => (row as Record<string, unknown>)[col] === val)
    }
    return api
  }
  api.in = (col: string, ids: unknown[]) => {
    if (filtered.some((row) => col in (row as object))) {
      filtered = filtered.filter((row) => ids.includes((row as Record<string, unknown>)[col]))
    }
    return api
  }
  api.is = (col: string, val: unknown) => {
    if (filtered.some((row) => col in (row as object))) {
      filtered = filtered.filter((row) => {
        const current = (row as Record<string, unknown>)[col]
        return val === null ? current == null : current === val
      })
    }
    return api
  }
  api.limit = self
  api.maybeSingle = async () => ({ data: filtered[0] ?? null, error: null })
  api.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: filtered, error: null }).then(resolve)
  return api
}

function mockSupabase(opts: {
  userId: string
  memberships: { firm_id: string; role?: string; user_id?: string }[]
  tables: TableData
}) {
  mockCreate.mockResolvedValue({
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: opts.userId } }, error: null })),
    },
    from: jest.fn((table: string) => {
      if (table === "accounting_firm_users") {
        const rows = opts.tables.accounting_firm_users ?? opts.memberships
        return filterable(rows)
      }
      return filterable(opts.tables[table] ?? [])
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
      memberships: [{ firm_id: "firm-a", role: "partner", user_id: "user-a" }],
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
      memberships: [{ firm_id: "firm-a", role: "partner", user_id: "user-a" }],
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

  it("restricts senior Work to assigned clients and hides unassigned-client items", async () => {
    mockSupabase({
      userId: "senior-1",
      memberships: [{ firm_id: "firm-a", role: "senior", user_id: "senior-1" }],
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
          {
            id: "eng-b",
            accounting_firm_id: "firm-a",
            client_business_id: "biz-b",
            status: "accepted",
            effective_from: "2026-01-01",
            effective_to: null,
          },
        ],
        accounting_firms: [{ id: "firm-a", assignment_scope_enabled_at: "2026-08-19T00:00:00.000Z" }],
        accounting_firm_client_assignments: [
          {
            id: "asg-1",
            firm_id: "firm-a",
            user_id: "senior-1",
            client_business_id: "biz-a",
            unassigned_at: null,
          },
        ],
        businesses: [
          { id: "biz-a", name: "ABC Ltd" },
          { id: "biz-b", name: "Hidden Co" },
        ],
        client_tasks: [
          {
            id: "task-a",
            client_business_id: "biz-a",
            title: "Assigned client task",
            status: "pending",
            priority: "normal",
            assigned_to_user_id: "senior-1",
            due_at: null,
            created_at: "2026-08-01T00:00:00.000Z",
          },
          {
            id: "task-b",
            client_business_id: "biz-b",
            title: "Foreign client unassigned work",
            status: "pending",
            priority: "high",
            assigned_to_user_id: null,
            due_at: null,
            created_at: "2026-08-01T00:00:00.000Z",
          },
        ],
      },
    })

    const res = await GET(request("http://localhost/api/accounting/work?firm_id=firm-a"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.every((item: { business_id: string }) => item.business_id === "biz-a")).toBe(true)
    expect(body.items.some((item: { title: string }) => item.title === "Foreign client unassigned work")).toBe(
      false
    )
    expect(body.clients.every((client: { id: string }) => client.id === "biz-a")).toBe(true)
  })

  it("keeps My Work inside authorized client scope", async () => {
    mockSupabase({
      userId: "junior-1",
      memberships: [{ firm_id: "firm-a", role: "junior", user_id: "junior-1" }],
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
        accounting_firms: [{ id: "firm-a", assignment_scope_enabled_at: "2026-08-19T00:00:00.000Z" }],
        accounting_firm_client_assignments: [
          {
            id: "asg-1",
            firm_id: "firm-a",
            user_id: "junior-1",
            client_business_id: "biz-a",
            unassigned_at: null,
          },
        ],
        businesses: [{ id: "biz-a", name: "ABC Ltd" }],
        client_tasks: [
          {
            id: "task-mine",
            client_business_id: "biz-a",
            title: "My task",
            status: "pending",
            priority: "normal",
            assigned_to_user_id: "junior-1",
            due_at: null,
            created_at: "2026-08-01T00:00:00.000Z",
          },
          {
            id: "task-other",
            client_business_id: "biz-a",
            title: "Someone else",
            status: "pending",
            priority: "normal",
            assigned_to_user_id: "senior-1",
            due_at: null,
            created_at: "2026-08-01T00:00:00.000Z",
          },
        ],
      },
    })

    const res = await GET(request("http://localhost/api/accounting/work?firm_id=firm-a&view=my"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].title).toBe("My task")
  })
})
