import { GET } from "../route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer")
jest.mock("@/lib/accounting/firm/requireMember", () => ({
  requireFirmMemberForApi: jest.fn(async () => null),
}))
jest.mock("@/lib/accounting/permissions", () => ({
  assertAccountingAccess: jest.fn(),
  accountingUserFromRequest: jest.fn(() => ({})),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"

const mockCreate = createSupabaseServerClient as jest.MockedFunction<typeof createSupabaseServerClient>

type Row = Record<string, unknown>

function filterable(rows: Row[]) {
  let filtered = [...rows]
  const api: Record<string, unknown> = {}
  const self = () => api
  api.select = self
  api.eq = (col: string, val: unknown) => {
    if (filtered.some((row) => col in row)) {
      filtered = filtered.filter((row) => row[col] === val)
    }
    return api
  }
  api.in = (col: string, ids: unknown[]) => {
    if (filtered.some((row) => col in row)) {
      filtered = filtered.filter((row) => ids.includes(row[col]))
    }
    return api
  }
  api.is = (col: string, val: unknown) => {
    if (filtered.some((row) => col in row)) {
      filtered = filtered.filter((row) => (val === null ? row[col] == null : row[col] === val))
    }
    return api
  }
  api.order = self
  api.limit = self
  api.maybeSingle = async () => ({ data: filtered[0] ?? null, error: null })
  api.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: filtered, error: null }).then(resolve)
  return api
}

function mockDb(userId: string, tables: Record<string, Row[]>) {
  mockCreate.mockResolvedValue({
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: userId } }, error: null })),
    },
    from: jest.fn((table: string) => filterable(tables[table] ?? [])),
  } as never)
}

const dualMembership = [
  { firm_id: "firm-a", role: "partner", user_id: "multi-1" },
  { firm_id: "firm-b", role: "partner", user_id: "multi-1" },
]

const tables = {
  accounting_firm_users: dualMembership,
  accounting_firms: [
    { id: "firm-a", assignment_scope_enabled_at: null },
    { id: "firm-b", assignment_scope_enabled_at: null },
  ],
  firm_client_engagements: [
    {
      accounting_firm_id: "firm-a",
      client_business_id: "biz-a",
      status: "accepted",
      effective_from: "2026-01-01",
      effective_to: null,
    },
    {
      accounting_firm_id: "firm-b",
      client_business_id: "biz-b",
      status: "accepted",
      effective_from: "2026-01-01",
      effective_to: null,
    },
  ],
  client_tasks: [
    {
      id: "task-a",
      firm_id: "firm-a",
      client_business_id: "biz-a",
      title: "Firm A task",
      businesses: { id: "biz-a", name: "A Ltd" },
    },
    {
      id: "task-b",
      firm_id: "firm-b",
      client_business_id: "biz-b",
      title: "Firm B task",
      businesses: { id: "biz-b", name: "B Ltd" },
    },
  ],
}

describe("GET /api/accounting/tasks active firm", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDb("multi-1", tables)
  })

  it("returns only Firm A tasks when firm_id=firm-a", async () => {
    const res = await GET(new NextRequest("http://localhost/api/accounting/tasks?firm_id=firm-a"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.firm_id).toBe("firm-a")
    expect(body.tasks.every((row: { firm_id: string }) => row.firm_id === "firm-a")).toBe(true)
    expect(body.tasks.some((row: { title: string }) => row.title === "Firm B task")).toBe(false)
  })

  it("returns only Firm B tasks when firm_id=firm-b", async () => {
    const res = await GET(new NextRequest("http://localhost/api/accounting/tasks?firm_id=firm-b"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.firm_id).toBe("firm-b")
    expect(body.tasks.every((row: { firm_id: string }) => row.firm_id === "firm-b")).toBe(true)
  })

  it("denies a forged firm_id", async () => {
    const res = await GET(new NextRequest("http://localhost/api/accounting/tasks?firm_id=firm-c"))
    expect(res.status).toBe(403)
  })

  it("does not leak another firm via client filter", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/accounting/tasks?firm_id=firm-a&client=biz-b")
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tasks).toHaveLength(0)
  })
})
