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

const accepted = {
  status: "accepted",
  effective_from: "2026-01-01",
  effective_to: null,
}

describe("GET /api/accounting/dashboard", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("denies a forged firm_id", async () => {
    mockSupabase({
      userId: "partner-a",
      memberships: [{ firm_id: "firm-a", role: "partner", user_id: "partner-a" }],
      tables: {
        firm_client_engagements: [
          {
            id: "eng-b",
            accounting_firm_id: "firm-b",
            client_business_id: "biz-b",
            ...accepted,
          },
        ],
      },
    })

    const res = await GET(request("http://localhost/api/accounting/dashboard?firm_id=firm-b"))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.summary).toBeUndefined()
    expect(body.error).toMatch(/not a member/i)
  })

  it("does not include Firm B clients or staff on Firm A", async () => {
    mockSupabase({
      userId: "partner-a",
      memberships: [{ firm_id: "firm-a", role: "partner", user_id: "partner-a" }],
      tables: {
        accounting_firm_users: [
          { firm_id: "firm-a", role: "partner", user_id: "partner-a" },
          { firm_id: "firm-b", role: "partner", user_id: "partner-b" },
        ],
        firm_client_engagements: [
          {
            id: "eng-a",
            accounting_firm_id: "firm-a",
            client_business_id: "biz-a",
            ...accepted,
          },
          {
            id: "eng-b",
            accounting_firm_id: "firm-b",
            client_business_id: "biz-b",
            ...accepted,
          },
        ],
        accounting_firms: [{ id: "firm-a", assignment_scope_enabled_at: "2026-08-19T00:00:00.000Z" }],
        businesses: [
          { id: "biz-a", name: "ABC Ltd" },
          { id: "biz-b", name: "Firm B Client" },
        ],
        users: [
          { id: "partner-a", full_name: "Partner A" },
          { id: "partner-b", full_name: "Partner B" },
        ],
        client_tasks: [
          {
            id: "task-a",
            client_business_id: "biz-a",
            title: "Firm A task",
            status: "pending",
            priority: "normal",
            assigned_to_user_id: "partner-a",
            due_at: "2026-08-01T00:00:00.000Z",
            created_at: "2026-08-01T00:00:00.000Z",
          },
          {
            id: "task-b",
            client_business_id: "biz-b",
            title: "Firm B secret",
            status: "pending",
            priority: "high",
            assigned_to_user_id: "partner-b",
            due_at: "2026-08-01T00:00:00.000Z",
            created_at: "2026-08-01T00:00:00.000Z",
          },
        ],
      },
    })

    const res = await GET(request("http://localhost/api/accounting/dashboard?firm_id=firm-a"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.firm_id).toBe("firm-a")
    expect(body.summary.clients).toBe(1)
    expect(body.team.every((row: { user_id: string }) => row.user_id !== "partner-b")).toBe(true)
    expect(JSON.stringify(body)).not.toContain("Firm B secret")
    expect(JSON.stringify(body)).not.toContain("biz-b")
  })

  it("switches metrics when the active firm changes", async () => {
    const tables = {
      accounting_firm_users: [
        { firm_id: "firm-a", role: "partner", user_id: "dual" },
        { firm_id: "firm-b", role: "partner", user_id: "dual" },
      ],
      firm_client_engagements: [
        { id: "eng-a1", accounting_firm_id: "firm-a", client_business_id: "biz-1", ...accepted },
        { id: "eng-a2", accounting_firm_id: "firm-a", client_business_id: "biz-2", ...accepted },
        { id: "eng-b1", accounting_firm_id: "firm-b", client_business_id: "biz-b", ...accepted },
      ],
      accounting_firms: [
        { id: "firm-a", assignment_scope_enabled_at: "2026-08-19T00:00:00.000Z" },
        { id: "firm-b", assignment_scope_enabled_at: null },
      ],
      businesses: [
        { id: "biz-1", name: "Client 1" },
        { id: "biz-2", name: "Client 2" },
        { id: "biz-b", name: "Client B1" },
      ],
      users: [{ id: "dual", full_name: "Dual Partner" }],
      client_tasks: [
        {
          id: "task-1",
          client_business_id: "biz-1",
          title: "C1",
          status: "pending",
          priority: "normal",
          assigned_to_user_id: null,
          due_at: null,
          created_at: "2026-08-01T00:00:00.000Z",
        },
        {
          id: "task-2",
          client_business_id: "biz-2",
          title: "C2",
          status: "pending",
          priority: "normal",
          assigned_to_user_id: null,
          due_at: null,
          created_at: "2026-08-01T00:00:00.000Z",
        },
        {
          id: "task-b",
          client_business_id: "biz-b",
          title: "CB",
          status: "pending",
          priority: "normal",
          assigned_to_user_id: null,
          due_at: null,
          created_at: "2026-08-01T00:00:00.000Z",
        },
      ],
    }

    mockSupabase({ userId: "dual", memberships: tables.accounting_firm_users, tables })
    const a = await GET(request("http://localhost/api/accounting/dashboard?firm_id=firm-a"))
    const aBody = await a.json()

    mockSupabase({ userId: "dual", memberships: tables.accounting_firm_users, tables })
    const b = await GET(request("http://localhost/api/accounting/dashboard?firm_id=firm-b"))
    const bBody = await b.json()

    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(aBody.firm_id).toBe("firm-a")
    expect(bBody.firm_id).toBe("firm-b")
    expect(aBody.summary.clients).toBe(2)
    expect(bBody.summary.clients).toBe(1)
    expect(aBody.summary.open_work).toBe(2)
    expect(bBody.summary.open_work).toBe(1)
  })

  it("scopes a senior dashboard to assigned clients when enforcement is enabled", async () => {
    mockSupabase({
      userId: "senior-a",
      memberships: [{ firm_id: "firm-a", role: "senior", user_id: "senior-a" }],
      tables: {
        firm_client_engagements: [
          { id: "eng-1", accounting_firm_id: "firm-a", client_business_id: "biz-1", ...accepted },
          { id: "eng-2", accounting_firm_id: "firm-a", client_business_id: "biz-2", ...accepted },
          {
            id: "eng-3",
            accounting_firm_id: "firm-a",
            client_business_id: "biz-3",
            status: "suspended",
            effective_from: "2026-01-01",
            effective_to: null,
          },
        ],
        accounting_firms: [{ id: "firm-a", assignment_scope_enabled_at: "2026-08-19T00:00:00.000Z" }],
        accounting_firm_client_assignments: [
          {
            id: "asg-1",
            firm_id: "firm-a",
            user_id: "senior-a",
            client_business_id: "biz-1",
            unassigned_at: null,
          },
        ],
        businesses: [
          { id: "biz-1", name: "Client 1" },
          { id: "biz-2", name: "Client 2" },
          { id: "biz-3", name: "Client 3" },
        ],
        users: [{ id: "senior-a", full_name: "Senior A" }],
        client_tasks: [
          {
            id: "task-1",
            client_business_id: "biz-1",
            title: "Client 1 task",
            status: "pending",
            priority: "normal",
            assigned_to_user_id: "senior-a",
            due_at: null,
            created_at: "2026-08-01T00:00:00.000Z",
          },
          {
            id: "task-2",
            client_business_id: "biz-2",
            title: "Client 2 task",
            status: "pending",
            priority: "normal",
            assigned_to_user_id: null,
            due_at: null,
            created_at: "2026-08-01T00:00:00.000Z",
          },
        ],
      },
    })

    const res = await GET(request("http://localhost/api/accounting/dashboard?firm_id=firm-a"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.role).toBe("senior")
    expect(body.summary.clients).toBe(1)
    expect(body.show.team).toBe(false)
    expect(body.needs_attention.every((item: { business_id: string }) => item.business_id === "biz-1")).toBe(true)
    expect(JSON.stringify(body)).not.toContain("Client 2 task")
    expect(JSON.stringify(body)).not.toContain("Client 3")
  })
})
